import { Phase } from '../types';

// The device contract, shared by the Supabase backend (real device) and the demo
// backend (simulated). See DEVICE_INTEGRATION.md for the tables behind it.

export const DEVICE_ID = 'sim01';

// One `telemetry` row, with timestamps as epoch ms. Columns the firmware doesn't send stay
// null (in blower-0.7: CO2, temperature, humidity and the second blower's rpm).
export interface TelemetryRow {
  id: number | string;
  sampledAt: number; // device time the reading was taken: plot against this
  phase: Phase;
  dutyCmd: number | null; // % written to the PWM at that sample
  rpmInhale: number; // main blower
  rpmExhale: number | null; // second blower, not wired yet
  co2Ppm: number | null;
  tempC: number | null;
  rhPct: number | null;
}

export const PHASES: Phase[] = ['idle', 'inhale', 'exhale', 'free', 'free_kick', 'free_below', 'free_sat', 'free_nospin'];

// The `device_status` row: a heartbeat every 5 s while the device is on the network.
export interface DeviceStatus {
  deviceId: string;
  lastSeen: number | null; // epoch ms
  firmware: string | null;
  wifiRssi: number | null; // dBm
}

export type CommandName = 'start' | 'stop';
export type CommandStatus = 'pending' | 'done' | 'error' | 'expired';

// What a start sends. Missing params keep the firmware's LAST used value, so breath always
// sends bpm, duty and ie_ratio; free sends mode and duty (bpm and I:E are ignored).
export type StartParams =
  | { mode: 'breath'; bpm: number; duty: number; ie_ratio: number }
  | { mode: 'free'; duty: number };

// One `commands` row.
export interface CommandRecord {
  id: number | string;
  command: CommandName;
  params: Record<string, unknown> | null;
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
// Breath peak duty: the firmware clamps it to 20..100 (exhale holds the 20 % floor).
export const BREATH_DUTY_RANGE = { min: 20, max: 100 };
export const BREATH_FLOOR_DUTY = 20;
// The firmware accepts E/I 0.25..4; below 1 (inhale longer than exhale) isn't a pattern we target.
export const IE_RANGE = { min: 1, max: 4 };

// The same rule the database enforces, checked before sending so the user gets a clear
// message instead of a constraint error.
export function validateStart(p: StartParams): string | null {
  if (!Number.isInteger(p.duty) || p.duty < DUTY_RANGE.min || p.duty > DUTY_RANGE.max) {
    return `Duty must be a whole number from ${DUTY_RANGE.min} to ${DUTY_RANGE.max} %.`;
  }
  if (p.mode === 'free') return null;
  if (!Number.isInteger(p.bpm) || p.bpm < BPM_RANGE.min || p.bpm > BPM_RANGE.max) {
    return `Respiratory rate must be a whole number from ${BPM_RANGE.min} to ${BPM_RANGE.max} bpm.`;
  }
  if (!(p.ie_ratio >= IE_RANGE.min && p.ie_ratio <= IE_RANGE.max)) {
    return `I:E must be from 1:${IE_RANGE.min} to 1:${IE_RANGE.max}.`;
  }
  return null;
}
