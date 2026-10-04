// A saved preset of what to send the device. The firmware takes only `bpm` (5–40) and
// `duty` (blower power, 0–100 %); I:E is fixed at 1:1 in the current firmware but kept
// here so the UI and future firmware can use it.
export interface Simulator {
  id: string;
  name: string;
  respiratoryRate: number; // breaths per minute, sent as `bpm`
  duty: number; // blower power %, sent as `duty`
  ieRatio: number; // exhale part of 1:X; always 1 for now
}

export type Phase = 'inhale' | 'exhale' | 'idle';

// One second of readings (telemetry arrives at 10 Hz and is averaged per second for
// display). Tidal volume and peak pressure aren't measured yet: they stay null until the
// firmware (or an RPM-based estimate) provides them.
export interface Sample {
  t: number; // seconds since the run started
  tidalVolume: number | null; // mL
  pressure: number | null; // cmH2O
  temperature: number; // °C
  co2Ppm: number; // ppm, average over the second
  co2PeakPpm: number; // ppm, highest raw reading in the second (saturation check)
  humidity: number; // % RH
  inhaleFan: number; // RPM
  exhaleFan: number; // RPM
  phase: Phase; // phase at the end of the second
}

export type AppMode = 'live' | 'demo';

// Free-text test notes, entered when starting a run and editable afterwards.
export interface RunDetails {
  headform: string | null;
  mask: string | null;
  notes: string | null;
}

// A recorded run. Live runs are rows in the Supabase `runs` table (readings stay in
// `telemetry`); demo runs are kept on the phone. Folders and ordering are always local.
export interface SessionMeta extends RunDetails {
  id: string;
  name: string;
  simulator: Omit<Simulator, 'id'>;
  deviceId: string;
  startedAt: number; // epoch ms (device sampled_at)
  endedAt: number | null; // null while recording
  endedBy: 'user' | 'device' | null;
  durationSec: number; // to endedAt, or to when it was loaded if still recording
  firmware: string | null;
  folderId: string | null;
}

export interface Folder {
  id: string;
  name: string;
}

export type SensorKey = 'temp' | 'co2' | 'humidity' | 'fans';
