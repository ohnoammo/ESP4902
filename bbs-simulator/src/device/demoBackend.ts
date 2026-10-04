import { Phase } from '../types';
import { Backend, BackendHandlers, CommandRecord, DEVICE_ID, StartParams, TelemetryRow, validateStart } from './types';

// Simulated device for demo mode, shaped like the real one: 10 rows a second sampled
// every 100 ms but delivered in batches of 10 once a second, a heartbeat every 5 s,
// commands acknowledged after a short delay, and I:E fixed at 1:1. During inhale only the
// inhale fan spins (and vice versa) at ~70 RPM per % of blower power, as measured on the
// test rig. Temperature, humidity and CO2 are random within the test firmware's ranges.

const SAMPLE_MS = 100;
const KEEP_MS = 60 * 60 * 1000; // an hour of history in memory, enough for any demo run
const ACK_DELAY_MS = 450;
const RPM_PER_DUTY = 70;

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function createDemoBackend(): Backend {
  let handlers: BackendHandlers | null = null;
  let timers: ReturnType<typeof setInterval>[] = [];
  let rows: TelemetryRow[] = [];
  let nextRowId = 1;
  let nextCommandId = 1;
  // Device state: when it is running, from which instant, at what settings.
  let running = false;
  let cycleStart = 0;
  let settings: StartParams = { bpm: 15, duty: 60 };
  let lastSampled = 0;

  const phaseAt = (ts: number): Phase => {
    if (!running || ts < cycleStart) return 'idle';
    const period = 60000 / settings.bpm;
    return ((ts - cycleStart) % period) / period < 0.5 ? 'inhale' : 'exhale';
  };

  const makeRow = (ts: number): TelemetryRow => {
    const phase = phaseAt(ts);
    const rpm = () => Math.max(0, Math.round(settings.duty * RPM_PER_DUTY + rand(-50, 50)));
    return {
      id: `demo-${nextRowId++}`,
      sampledAt: ts,
      phase,
      rpmInhale: phase === 'inhale' ? rpm() : 0,
      rpmExhale: phase === 'exhale' ? rpm() : 0,
      co2Ppm: Math.round(rand(750, 849)),
      tempC: Math.round(rand(31, 32.9) * 10) / 10,
      rhPct: Math.round(rand(83, 86.9) * 10) / 10,
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
    handlers?.onStatus({ deviceId: DEVICE_ID, lastSeen: Date.now(), firmware: 'demo (simulated)', wifiRssi: -50 });

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
      running = false;
    },

    async sendCommand(command, params) {
      if (command !== 'start' && command !== 'stop') {
        throw new Error('new row for relation "commands" violates check constraint "commands_command_check"');
      }
      if (command === 'start' && validateStart(params as StartParams)) {
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
        if (command === 'start') {
          settings = { ...(params as StartParams) };
          running = true;
          cycleStart = Math.ceil(Date.now() / SAMPLE_MS) * SAMPLE_MS;
        } else {
          running = false;
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
