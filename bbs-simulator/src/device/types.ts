import { Phase } from '../types';

// The device contract, shared by the Supabase backend (real device) and the demo
// backend (simulated). See DEVICE_INTEGRATION.md for the tables behind it.

export const DEVICE_ID = 'sim01';

// One `telemetry` row, with timestamps as epoch ms.
export interface TelemetryRow {
  id: number | string;
  sampledAt: number; // device time the reading was taken: plot against this
  phase: Phase;
  rpmInhale: number;
  rpmExhale: number;
  co2Ppm: number;
  tempC: number;
  rhPct: number;
}

// The `device_status` row: a heartbeat every 5 s while the device is on the network.
export interface DeviceStatus {
  deviceId: string;
  lastSeen: number | null; // epoch ms
  firmware: string | null;
  wifiRssi: number | null; // dBm
}

export type CommandName = 'start' | 'stop';
export type CommandStatus = 'pending' | 'done' | 'error' | 'expired';

export interface StartParams {
  bpm: number; // integer 5–40
  duty: number; // integer 0–100
}

// One `commands` row.
export interface CommandRecord {
  id: number | string;
  command: CommandName;
  params: Partial<StartParams>;
  status: CommandStatus;
  createdAt: number;
  ackedAt: number | null;
}

export interface BackendHandlers {
  onTelemetry: (rows: TelemetryRow[]) => void; // new rows, any order
  onStatus: (status: DeviceStatus) => void;
  onCommand: (command: CommandRecord) => void; // inserts and status changes
  onError: (message: string) => void; // e.g. the Realtime channel dropped
}

export interface Backend {
  kind: 'live' | 'demo';
  // Loads the status, the latest row and the last `historySec` of telemetry (passed to
  // the handlers), then subscribes for changes. Rejects if the backend is unreachable.
  open(handlers: BackendHandlers, historySec: number, onProgress: (fraction: number) => void): Promise<void>;
  close(): void;
  // Inserts a command; rejects with the database's own message if it's refused.
  sendCommand(command: CommandName, params: StartParams | Record<string, never>): Promise<CommandRecord>;
  // Re-reads one command (fallback if a Realtime update was missed).
  getCommand(id: CommandRecord['id']): Promise<CommandRecord | null>;
  // All telemetry with fromMs <= sampled_at <= toMs, oldest first.
  fetchRange(fromMs: number, toMs: number): Promise<TelemetryRow[]>;
}

export const BPM_RANGE = { min: 5, max: 40 };
export const DUTY_RANGE = { min: 0, max: 100 };

// The same rule the database enforces, checked before sending so the user gets a clear
// message instead of a constraint error.
export function validateStart(p: StartParams): string | null {
  if (!Number.isInteger(p.bpm) || p.bpm < BPM_RANGE.min || p.bpm > BPM_RANGE.max) {
    return `Respiratory rate must be a whole number from ${BPM_RANGE.min} to ${BPM_RANGE.max} bpm.`;
  }
  if (!Number.isInteger(p.duty) || p.duty < DUTY_RANGE.min || p.duty > DUTY_RANGE.max) {
    return `Blower power must be a whole number from ${DUTY_RANGE.min} to ${DUTY_RANGE.max} %.`;
  }
  return null;
}
