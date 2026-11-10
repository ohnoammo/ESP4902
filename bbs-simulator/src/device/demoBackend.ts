import {
  CAL_DUTY,
  dutyForFlow,
  flowAtDuty,
  flowForRpm,
  minCalibratedRpm,
  Q_MAX_EX,
  Q_MAX_IN,
  rpmAtDuty,
  rpmForFlow,
  TRIM_LIMIT,
  TWIN_PRESETS,
  TwinDirection,
} from '../constants/twin';
import { Phase } from '../types';
import {
  Backend,
  BackendHandlers,
  BREATH_FLOOR_DUTY,
  CommandRecord,
  DEVICE_ID,
  StartParams,
  TelemetryRow,
  TwinSample,
  validateStart,
} from './types';

// Simulated device for demo mode.
//   - rows every 100 ms, delivered in batches once a second; a heartbeat every 5 s
//   - flow (firmware final-1.0-twin): two fans, only one driven at a time. Target
//     Q(t) = pi*Vt*f*sin(2*pi*t/T), + inhale (inhale fan), - exhale (exhale fan). Feed-forward
//     looks LEAD_S ahead through that fan's INSTALLED table, plus KP*(rpm_cmd - rpm), plus a
//     learned trim per duty band. The simulated fans run FAN_GAIN off the table so the trim
//     has something to learn. A target above a fan's capacity holds it at 100 %
//     and reports fault 3, so every preset except demo_15 clips its exhale peaks.
//     The run ends after `breaths` (default 10), like the firmware.
//   - BME280: temperature, humidity and ambient pressure drift slowly around room values
//   - free (final-1.0-twin): the chosen fan at a fixed duty until stop, kick at 25 % from rest
//   - breath: the old duty half-sine (firmware blower-0.7), kept for recorded runs; the blower
//     follows duty ~0.6 s late and can't brake

const SAMPLE_MS = 100;
const KEEP_MS = 60 * 60 * 1000; // an hour of history in memory, enough for any demo run
const ACK_DELAY_MS = 450;
const LAG_MS = 600;
const SPIN_UP_TAU_S = 0.25;
const COAST_RPM_PER_S = 2500;
const NO_FLOW_BELOW = 19;
const KICK_DUTY = 25;
const KICK_MS = 1000;
// Twin firmware constants (esp4902_final.ino).
const LEAD_S = 0.2;
const KP = 0.005;
const TRIM_KI = 0.0005;
const STEADY_RPM_RATE = 3000;
const NOSPIN_S = 2;
const BREATHS_DEFAULT = 10;
// Simulated fans run 4 % faster than the table, so the trim learns a small negative correction.
// (A slow fan would wind the trim up to its limit at 100 % duty, fault 2, on every clipped peak.)
const FAN_GAIN = 1.04;
const FAN_TAU_S = 0.3; // fan spin-up time constant under the twin

// Measured steady-state rpm at 15 V, open air (2026-10-14).
const STEADY_RPM: [number, number][] = [
  [19, 2460],
  [30, 4965],
  [50, 9100],
  [70, 13545],
  [100, 20100],
];

function steadyRpm(duty: number): number {
  if (duty < NO_FLOW_BELOW) return 0;
  for (let i = 1; i < STEADY_RPM.length; i++) {
    const [d0, r0] = STEADY_RPM[i - 1];
    const [d1, r1] = STEADY_RPM[i];
    if (duty <= d1) return r0 + ((duty - d0) / (d1 - d0)) * (r1 - r0);
  }
  return STEADY_RPM[STEADY_RPM.length - 1][1];
}

const noise = (scale: number) => (Math.random() - 0.5) * 2 * scale;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function createDemoBackend(): Backend {
  let handlers: BackendHandlers | null = null;
  let timers: ReturnType<typeof setInterval>[] = [];
  let rows: TelemetryRow[] = [];
  let nextRowId = 1;
  let nextCommandId = 1;
  // Device state.
  let settings: StartParams | null = null; // null = idle
  let cycleStart = 0;
  let kickUntil = 0;
  let rpm = 0; // blower in the duty modes
  const dutyHistory: { ts: number; duty: number }[] = [];
  let lastSampled = 0;
  // Twin: one state per fan; the trim is kept between runs, like the firmware (until reboot).
  const fans: Record<TwinDirection, { rpm: number; trim: number[] }> = {
    inhale: { rpm: 0, trim: CAL_DUTY.map(() => 0) },
    exhale: { rpm: 0, trim: CAL_DUTY.map(() => 0) },
  };
  let flowRun: { vt: number; bpm: number; breaths: number } | null = null;
  let noSpin = 0;
  let rpmExpPrev = 0;
  // BME280 room values, drifting slowly.
  let env = { t: 24.5, rh: 58, p: 1008.6 };

  const bandOf = (d: number) => {
    let b = 0;
    for (let i = 1; i < CAL_DUTY.length; i++) if (Math.abs(d - CAL_DUTY[i]) < Math.abs(d - CAL_DUTY[b])) b = i;
    return b;
  };

  // The old duty breath (blower-0.7) at time ts: [phase, duty written to the PWM].
  const dutyCommand = (ts: number): [Phase, number] => {
    if (!settings || settings.mode !== 'breath' || ts < cycleStart) return ['idle', 0];
    const period = 60000 / settings.bpm;
    const inhaleMs = period / (1 + settings.ie_ratio);
    const t = (ts - cycleStart) % period;
    if (t < inhaleMs) {
      const peak = Math.max(BREATH_FLOOR_DUTY, settings.duty);
      return ['inhale', BREATH_FLOOR_DUTY + (peak - BREATH_FLOOR_DUTY) * Math.sin((Math.PI * t) / inhaleMs)];
    }
    return ['exhale', BREATH_FLOOR_DUTY];
  };

  const stepEnv = () => {
    env = {
      t: Math.min(27, Math.max(22, env.t + noise(0.01))),
      rh: Math.min(70, Math.max(45, env.rh + noise(0.05))),
      p: Math.min(1012, Math.max(1005, env.p + noise(0.01))),
    };
  };

  const base = (ts: number) => {
    stepEnv();
    return {
      id: `demo-${nextRowId++}`,
      sampledAt: ts,
      co2Ppm: null,
      tempC: Math.round(env.t * 100) / 100,
      rhPct: Math.round(env.rh * 10) / 10,
      pressureHpa: Math.round(env.p * 100) / 100,
    };
  };

  // One fan towards the speed its duty gives (slower by FAN_GAIN).
  const stepFan = (dir: TwinDirection, duty: number, dt: number) => {
    const f = fans[dir];
    const target = rpmAtDuty(duty, dir) * FAN_GAIN;
    // Spins up and down with the same lag: under load in the sealed chamber the idle fan
    // (EN low) reads about 0 within a half-breath, as on the rig.
    f.rpm += (target - f.rpm) * (1 - Math.exp(-dt / FAN_TAU_S));
  };
  const measured = (dir: TwinDirection) => {
    const r = fans[dir].rpm;
    return r < 30 ? 0 : Math.max(0, Math.round(r + noise(r * 0.01)));
  };

  // One sample of the twin controller (esp4902_final.ino controlTask, at the 10 Hz sample rate).
  const flowRow = (ts: number): TelemetryRow => {
    const run = flowRun!;
    const dt = SAMPLE_MS / 1000;
    const T = 60 / run.bpm;
    const qPeak = Math.PI * run.vt * run.bpm;
    const t = (ts - cycleStart) / 1000;
    const breath = Math.floor(t / T);
    if (run.breaths > 0 && breath >= run.breaths) {
      settings = null; // run complete: the device goes idle
      flowRun = null;
      return idleRow(ts);
    }
    const q = qPeak * Math.sin((2 * Math.PI * (t % T)) / T); // + inhale, - exhale
    const qL = qPeak * Math.sin((2 * Math.PI * ((t + LEAD_S) % T)) / T);
    const inhale = q >= 0;
    const act: TwinDirection = qL >= 0 ? 'inhale' : 'exhale'; // fan being driven
    const idle: TwinDirection = act === 'inhale' ? 'exhale' : 'inhale';
    const meas: TwinDirection = inhale ? 'inhale' : 'exhale'; // fan doing the current phase
    const qC = Math.abs(qL);
    const qT = Math.abs(q);

    const rpmAct = measured(act);
    const dFF = dutyForFlow(qC, act);
    const rpmCmd = rpmForFlow(qC, act);
    const rpmExp = rpmForFlow(qT, meas);
    const rpmRate = Math.abs(rpmExp - rpmExpPrev) / dt;
    rpmExpPrev = rpmExp;

    let fault = 0;
    let trim = 0;
    if (qC > (act === 'inhale' ? Q_MAX_IN : Q_MAX_EX)) fault = 3;
    if (dFF > 0) {
      const b = bandOf(dFF);
      const tr = fans[act].trim;
      if (act === meas && rpmRate < STEADY_RPM_RATE) tr[b] = Math.max(-TRIM_LIMIT, Math.min(TRIM_LIMIT, tr[b] + TRIM_KI * (rpmExp - rpmAct) * dt));
      trim = tr[b];
      if (Math.abs(trim) >= TRIM_LIMIT) fault = 2;
      noSpin = rpmAct < 1 ? noSpin + dt : 0;
      if (noSpin > NOSPIN_S) fault = 1;
    } else noSpin = 0;

    const duty = dFF > 0 ? Math.max(0, Math.min(100, dFF + trim + KP * (rpmCmd - rpmAct))) : 0;
    stepFan(act, duty, dt);
    stepFan(idle, 0, dt);

    const rpmM = measured(meas);
    const twin: TwinSample = {
      qTarget: r2(qT),
      qTwin: r2(flowForRpm(rpmM, meas)),
      dpTwin: null,
      dpMeas: null,
      residualPct: null,
      rpmExpected: Math.round(rpmExp),
      trim: r2(trim),
      valid: rpmM >= minCalibratedRpm(meas),
      fault: fault as TwinSample['fault'],
    };
    return {
      ...base(ts),
      phase: inhale ? 'inhale' : 'exhale',
      dutyCmd: Math.round(duty * 10) / 10,
      rpmInhale: measured('inhale'),
      rpmExhale: measured('exhale'),
      activeFan: act,
      twin,
    };
  };

  const idleRow = (ts: number): TelemetryRow => {
    const dt = SAMPLE_MS / 1000;
    stepFan('inhale', 0, dt);
    stepFan('exhale', 0, dt);
    noSpin = 0;
    rpmExpPrev = 0;
    return { ...base(ts), phase: 'idle', dutyCmd: 0, rpmInhale: measured('inhale'), rpmExhale: measured('exhale'), activeFan: null, twin: null };
  };

  // Free flow (final-1.0-twin): the chosen fan at a fixed duty, the other off, until stop.
  // From rest below 25 % it kicks at 25 % for 1 s; no tach for 2 s while driven = free_nospin.
  const freeRow = (ts: number, duty: number, fan: TwinDirection): TelemetryRow => {
    const dt = SAMPLE_MS / 1000;
    const other: TwinDirection = fan === 'inhale' ? 'exhale' : 'inhale';
    const kick = ts < kickUntil;
    const d = kick ? KICK_DUTY : duty;
    let phase: Phase = duty <= 0 ? 'free_below' : kick ? 'free_kick' : duty >= 100 ? 'free_sat' : 'free';
    stepFan(fan, d, dt);
    stepFan(other, 0, dt);
    const rpmM = measured(fan);
    noSpin = d > 0 && rpmM < 1 ? noSpin + dt : 0;
    const fault = noSpin > NOSPIN_S ? 1 : 0;
    if (fault) phase = 'free_nospin';
    return {
      ...base(ts),
      phase,
      dutyCmd: d,
      rpmInhale: measured('inhale'),
      rpmExhale: measured('exhale'),
      activeFan: fan,
      twin: {
        qTarget: r2(flowAtDuty(d, fan)),
        qTwin: r2(flowForRpm(rpmM, fan)),
        dpTwin: null,
        dpMeas: null,
        residualPct: null,
        rpmExpected: Math.round(rpmAtDuty(d, fan)),
        trim: null,
        valid: rpmM >= minCalibratedRpm(fan),
        fault: fault as TwinSample['fault'],
      },
    };
  };

  const makeRow = (ts: number): TelemetryRow => {
    if (settings?.mode === 'flow' && flowRun && ts >= cycleStart) return flowRow(ts);
    if (settings?.mode === 'free' && ts >= cycleStart) return freeRow(ts, settings.duty, settings.fan ?? 'inhale');
    if (!settings || settings.mode !== 'breath') return idleRow(ts);
    const [phase, duty] = dutyCommand(ts);
    dutyHistory.push({ ts, duty });
    while (dutyHistory.length && dutyHistory[0].ts < ts - LAG_MS - SAMPLE_MS) dutyHistory.shift();
    // The blower responds to the duty from ~0.6 s ago: spins up smoothly, coasts down slowly.
    const lagged = dutyHistory.find((h) => h.ts >= ts - LAG_MS)?.duty ?? duty;
    const target = steadyRpm(lagged);
    const dt = SAMPLE_MS / 1000;
    rpm = target > rpm ? rpm + (target - rpm) * (1 - Math.exp(-dt / SPIN_UP_TAU_S)) : Math.max(target, rpm - COAST_RPM_PER_S * dt);
    return {
      ...base(ts),
      phase,
      dutyCmd: Math.round(duty * 10) / 10,
      rpmInhale: rpm < 30 ? 0 : Math.max(0, Math.round(rpm + noise(rpm * 0.01))),
      rpmExhale: null,
      activeFan: null,
      twin: null,
    };
  };

  // Generate every 100 ms sample up to `now` and hand them over as one batch.
  const flush = () => {
    const now = Date.now();
    const batch: TelemetryRow[] = [];
    for (let ts = lastSampled + SAMPLE_MS; ts <= now; ts += SAMPLE_MS) {
      batch.push(makeRow(ts));
      lastSampled = ts;
    }
    rows.push(...batch);
    const cutoff = now - KEEP_MS;
    if (rows.length && rows[0].sampledAt < cutoff) rows = rows.filter((r) => r.sampledAt >= cutoff);
    if (batch.length) handlers?.onTelemetry(batch);
  };

  const heartbeat = () =>
    handlers?.onStatus({ deviceId: DEVICE_ID, lastSeen: Date.now(), firmware: 'demo (simulated final-1.0-twin)', wifiRssi: -50 });

  return {
    kind: 'demo',

    async open(h, historySec, onProgress) {
      handlers = h;
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 30));
        onProgress(i / steps);
      }
      // Start with a minute of idle history, like a device that has been on for a while.
      const now = Date.now();
      lastSampled = Math.floor((now - historySec * 1000) / SAMPLE_MS) * SAMPLE_MS;
      flush();
      heartbeat();
      timers = [setInterval(flush, 1000), setInterval(heartbeat, 5000)];
    },

    close() {
      timers.forEach(clearInterval);
      timers = [];
      handlers = null;
      settings = null;
      flowRun = null;
      rpm = 0;
    },

    async sendCommand(command, params) {
      if (command !== 'start' && command !== 'stop') {
        throw new Error('new row for relation "commands" violates check constraint "commands_command_check"');
      }
      const start = command === 'start' ? (params as StartParams) : null;
      if (start && validateStart(start)) {
        throw new Error('new row for relation "commands" violates check constraint "commands_params_check"');
      }
      const record: CommandRecord = {
        id: `demo-cmd-${nextCommandId++}`,
        command,
        params,
        status: 'pending',
        createdAt: Date.now(),
        ackedAt: null,
      };
      setTimeout(() => {
        if (start) {
          settings = { ...start };
          cycleStart = Math.ceil(Date.now() / SAMPLE_MS) * SAMPLE_MS;
          flowRun = null;
          if (start.mode === 'flow') {
            const p = 'preset' in start ? TWIN_PRESETS.find((x) => x.key === start.preset)! : null;
            flowRun = { vt: p ? p.vt : (start as { vt: number }).vt, bpm: p ? p.bpm : (start as { bpm: number }).bpm, breaths: BREATHS_DEFAULT };
            noSpin = 0;
            rpmExpPrev = 0;
          }
          // From standstill at a low free duty, the firmware kick-starts the fan first.
          if (start.mode === 'free') noSpin = 0;
          const free = start.mode === 'free' ? fans[start.fan ?? 'inhale'] : null;
          kickUntil = start.mode === 'free' && start.duty > 0 && start.duty < KICK_DUTY && free!.rpm < 500 ? cycleStart + KICK_MS : 0;
        } else {
          settings = null;
          flowRun = null;
        }
        handlers?.onCommand({ ...record, status: 'done', ackedAt: Date.now() });
      }, ACK_DELAY_MS);
      return record;
    },

    async getCommand() {
      return null; // updates are delivered directly; nothing to re-read
    },

    async fetchRange(fromMs, toMs) {
      flush();
      return rows.filter((r) => r.sampledAt >= fromMs && r.sampledAt <= toMs);
    },
  };
}
