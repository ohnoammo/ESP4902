import { Phase } from '../types';
import {
  Backend,
  BackendHandlers,
  BREATH_FLOOR_DUTY,
  CommandRecord,
  DEVICE_ID,
  StartParams,
  TelemetryRow,
  validateStart,
} from './types';

// Simulated device for demo mode, shaped like firmware blower-0.7 on the 15 V rig:
//   - rows every 100 ms, delivered in batches once a second; a heartbeat every 5 s
//   - breath: duty follows a half-sine from the 20 % floor up to the peak during inhale and
//     holds 20 % during exhale; inhale takes 1/(1+I:E) of each breath
//   - free: a fixed duty; below 19 % the driver won't run (free_below), from standstill at low
//     duty it kick-starts at 25 % first (free_kick), at 100 % it is saturated (free_sat)
//   - the blower's rpm follows the duty ~0.6 s late towards the measured open-air steady
//     state, and can't brake: it coasts down at most ~2,500 rpm/s
//   - CO2, temperature, humidity and the second blower aren't wired in 0.7, so they're null

const SAMPLE_MS = 100;
const KEEP_MS = 60 * 60 * 1000; // an hour of history in memory, enough for any demo run
const ACK_DELAY_MS = 450;
const LAG_MS = 600;
const SPIN_UP_TAU_S = 0.25;
const COAST_RPM_PER_S = 2500;
const NO_FLOW_BELOW = 19;
const KICK_DUTY = 25;
const KICK_MS = 1000;

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
  let rpm = 0;
  const dutyHistory: { ts: number; duty: number }[] = [];
  let lastSampled = 0;

  // What the firmware commands at time ts: [phase, duty written to the PWM].
  const command = (ts: number): [Phase, number] => {
    if (!settings || ts < cycleStart) return ['idle', 0];
    if (settings.mode === 'free') {
      const d = settings.duty;
      if (d < NO_FLOW_BELOW) return ['free_below', 0];
      if (ts < kickUntil) return ['free_kick', KICK_DUTY];
      return [d >= 100 ? 'free_sat' : 'free', d];
    }
    const period = 60000 / settings.bpm;
    const inhaleMs = period / (1 + settings.ie_ratio);
    const t = (ts - cycleStart) % period;
    if (t < inhaleMs) {
      const peak = Math.max(BREATH_FLOOR_DUTY, settings.duty);
      return ['inhale', BREATH_FLOOR_DUTY + (peak - BREATH_FLOOR_DUTY) * Math.sin((Math.PI * t) / inhaleMs)];
    }
    return ['exhale', BREATH_FLOOR_DUTY];
  };

  const makeRow = (ts: number): TelemetryRow => {
    const [phase, duty] = command(ts);
    dutyHistory.push({ ts, duty });
    while (dutyHistory.length && dutyHistory[0].ts < ts - LAG_MS - SAMPLE_MS) dutyHistory.shift();
    // The blower responds to the duty from ~0.6 s ago: spins up smoothly, coasts down slowly.
    const lagged = dutyHistory.find((h) => h.ts >= ts - LAG_MS)?.duty ?? duty;
    const target = steadyRpm(lagged);
    const dt = SAMPLE_MS / 1000;
    rpm = target > rpm ? rpm + (target - rpm) * (1 - Math.exp(-dt / SPIN_UP_TAU_S)) : Math.max(target, rpm - COAST_RPM_PER_S * dt);
    return {
      id: `demo-${nextRowId++}`,
      sampledAt: ts,
      phase,
      dutyCmd: Math.round(duty * 10) / 10,
      rpmInhale: rpm < 30 ? 0 : Math.max(0, Math.round(rpm + noise(rpm * 0.01))),
      rpmExhale: null,
      co2Ppm: null,
      tempC: null,
      rhPct: null,
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
    handlers?.onStatus({ deviceId: DEVICE_ID, lastSeen: Date.now(), firmware: 'demo (simulated 0.7)', wifiRssi: -50 });

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
          // From standstill at a low free duty, the firmware kick-starts the fan first.
          kickUntil = start.mode === 'free' && start.duty >= NO_FLOW_BELOW && start.duty < KICK_DUTY && rpm < 500 ? cycleStart + KICK_MS : 0;
        } else {
          settings = null;
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
