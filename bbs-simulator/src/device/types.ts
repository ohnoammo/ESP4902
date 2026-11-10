import { TWIN_PRESETS, VT_RANGE } from '../constants/twin';
import { FanSide, Phase } from '../types';

// The device contract, shared by the Supabase backend (real device) and the demo
// backend (simulated). See DEVICE_INTEGRATION.md for the tables behind it.

export const DEVICE_ID = 'sim01';

// One `telemetry` row, with timestamps as epoch ms. Columns the firmware doesn't send stay
// null (final-1.0-twin: CO2; temperature, humidity and pressure when no BME280 is found).
export interface TelemetryRow {
  id: number | string;
  sampledAt: number; // device time the reading was taken: plot against this
  phase: Phase;
  dutyCmd: number | null; // % written to the PWM at that sample
  rpmInhale: number; // inhale fan
  rpmExhale: number | null; // exhale fan (null on firmware without a second tach)
  co2Ppm: number | null;
  tempC: number | null; // BME280
  rhPct: number | null; // BME280
  pressureHpa: number | null; // BME280, ambient (needs migration 20261111_final_pressure)
  activeFan: FanSide | null; // fan being driven (final-1.0-twin, same migration); null when idle or unknown
  twin: TwinSample | null; // null when the firmware doesn't run the twin (0.7 and earlier)
}

// Digital twin values from one row (firmware with the twin, see constants/twin.ts). Flows are
// magnitudes in L/min; the sign comes from phase. RPM is the only measurement: qTwin is the
// operating-point flow at the MEASURED rpm. There is no pressure sensor, so dpMeas and
// residualPct stay null (the residual path is future work).
export interface TwinSample {
  qTarget: number | null;
  qTwin: number | null;
  dpTwin: number | null; // Pa, CFD system curve at qTwin
  dpMeas: number | null; // Pa
  residualPct: number | null;
  rpmExpected: number | null; // operating-point rpm for the feed-forward duty
  trim: number | null; // learned duty correction, % duty (kept between breaths)
  valid: boolean | null; // false below the calibration table's first rpm
  fault: 0 | 1 | 2 | 3 | null; // ok, no spin, trim saturated, target above fan capacity
}

// Sign of a row's twin flows (q_target / q_twin are magnitudes): + inhale, − exhale. Flow
// breaths take it from the phase; free flow from the fan that runs (inhale when unknown).
export const flowSign = (r: Pick<TelemetryRow, 'phase' | 'activeFan'>) =>
  r.phase === 'exhale' || (r.phase.startsWith('free') && r.activeFan === 'exhale') ? -1 : 1;

// RPM of the fan being driven: the exhale fan when telemetry says so (or, without active_fan,
// in the exhale phase), else the inhale fan.
export const drivenRpm = (r: Pick<TelemetryRow, 'phase' | 'activeFan' | 'rpmInhale' | 'rpmExhale'>) =>
  (r.activeFan === 'exhale' || (r.activeFan === null && r.phase === 'exhale')) && r.rpmExhale !== null ? r.rpmExhale : r.rpmInhale;

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
  | { mode: 'free'; duty: number; fan?: FanSide }
  // Flow-based breath driven by the twin (needs twin firmware): Vt in L.
  | { mode: 'flow'; vt: number; bpm: number; ie_ratio: number }
  // A built-in breathing preset, by the firmware's id. Sent by name because some presets
  // have a fractional rate (20.5 bpm) and the commands table only accepts whole-number bpm.
  | { mode: 'flow'; preset: string };

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
  if (p.mode === 'flow' && 'preset' in p) {
    return TWIN_PRESETS.some((t) => t.key === p.preset) ? null : `Unknown breathing preset "${p.preset}".`;
  }
  if (p.mode === 'flow') {
    if (!(p.vt >= VT_RANGE.min && p.vt <= VT_RANGE.max)) return `Tidal volume must be from ${VT_RANGE.min} to ${VT_RANGE.max} L.`;
    if (!Number.isInteger(p.bpm) || p.bpm < BPM_RANGE.min || p.bpm > BPM_RANGE.max) {
      return `Respiratory rate must be a whole number from ${BPM_RANGE.min} to ${BPM_RANGE.max} bpm.`;
    }
    return null;
  }
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
