import { Simulator } from '../types';
import { Device, Reading } from './types';

// Real device: talks to the ESP32 over a WebSocket using newline-free JSON messages.
// The full protocol, with an example ESP32 sketch, is in DEVICE_INTEGRATION.md.
//
//   app → ESP32   {"type":"hello"}
//                 {"type":"start","tidalVolume":500,"respiratoryRate":15,"ieRatio":2}
//                 {"type":"stop"}
//   ESP32 → app   {"type":"info","name":"BBS-ESP32"}            (reply to hello)
//                 {"type":"reading","volume":312.5, ...}        (any Reading fields)

const READING_FIELDS: (keyof Reading)[] = [
  'volume',
  'tidalVolume',
  'pressure',
  'temperature',
  'co2',
  'humidity',
  'inhaleFan',
  'exhaleFan',
];

// Keeps only known numeric fields, so a malformed message can't corrupt a recording.
function toReading(msg: Record<string, unknown>): Reading {
  const r: Reading = {};
  for (const f of READING_FIELDS) {
    const v = msg[f];
    if (typeof v === 'number' && Number.isFinite(v)) r[f] = v;
  }
  return r;
}

export function createEsp32Device(url: string, timeoutMs: number): Device {
  let ws: WebSocket | null = null;
  let ready = false; // handshake finished
  let closingOnPurpose = false;
  const readingListeners = new Set<(r: Reading) => void>();
  const lostListeners = new Set<() => void>();

  const send = (msg: object) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Not connected to the simulator');
    ws.send(JSON.stringify(msg));
  };

  return {
    connect(onProgress) {
      return new Promise((resolve, reject) => {
        closingOnPurpose = false;
        ready = false;
        onProgress(0.1);
        const sock = new WebSocket(url);
        ws = sock;
        const timer = setTimeout(() => {
          closingOnPurpose = true;
          sock.close();
          reject(new Error(`No reply from ${url}`));
        }, timeoutMs);

        sock.onopen = () => {
          onProgress(0.6);
          sock.send(JSON.stringify({ type: 'hello' }));
        };
        sock.onmessage = (event) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return; // ignore anything that isn't JSON (e.g. debug text)
          }
          if (msg.type === 'info' && !ready) {
            ready = true;
            clearTimeout(timer);
            onProgress(1);
            resolve({ name: typeof msg.name === 'string' ? msg.name : 'ESP32', address: url });
          } else if (msg.type === 'reading') {
            const reading = toReading(msg);
            readingListeners.forEach((l) => l(reading));
          }
        };
        sock.onerror = () => {
          if (!ready) {
            clearTimeout(timer);
            reject(new Error(`Could not connect to ${url}`));
          }
        };
        sock.onclose = () => {
          const wasReady = ready;
          ready = false;
          ws = null;
          if (wasReady && !closingOnPurpose) lostListeners.forEach((l) => l());
        };
      });
    },

    disconnect() {
      closingOnPurpose = true;
      ws?.close();
      ws = null;
      ready = false;
    },

    async start(sim: Simulator) {
      send({
        type: 'start',
        tidalVolume: sim.tidalVolume,
        respiratoryRate: sim.respiratoryRate,
        ieRatio: sim.ieRatio,
      });
    },

    async stop() {
      send({ type: 'stop' });
    },

    onReading(listener) {
      readingListeners.add(listener);
      return () => readingListeners.delete(listener);
    },

    onConnectionLost(listener) {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
  };
}
