// Breath: a half-sine inhale up to a peak duty, then exhale held at the 20 % floor.
// Free: one fixed duty, continuous flow.
export type SimMode = 'breath' | 'free';

// A saved preset of what to send the device (firmware blower-0.7).
export interface Simulator {
  id: string;
  name: string;
  mode: SimMode;
  duty: number; // breath: PEAK duty of the inhale (%); free: the fixed duty (%)
  // Breath only. A breath preset must have a rate before it can start: null means "not set"
  // (the team supplies sourced rates; the app never invents one).
  respiratoryRate: number | null; // sent as `bpm`
  ieRatio: number; // E/I, exhale part of 1:X (1 to 4), sent as `ie_ratio`; ignored in free mode
}

// Firmware phases. Everything except 'idle' is a run in progress: 'free_below' and
// 'free_nospin' are runs with zero flow, not stopped runs.
export type Phase = 'idle' | 'inhale' | 'exhale' | 'free' | 'free_kick' | 'free_below' | 'free_sat' | 'free_nospin';

// One second of readings (telemetry arrives at up to 10 Hz and is averaged per second for
// display). null means no value: not measured yet (tidal volume, peak pressure) or the
// sensor isn't connected (CO2, temperature, humidity and the second blower in 0.7).
export interface Sample {
  t: number; // seconds since the run started
  tidalVolume: number | null; // mL, not measured yet
  pressure: number | null; // cmH2O, not measured yet
  temperature: number | null; // °C
  co2Ppm: number | null; // ppm, average over the second
  co2PeakPpm: number | null; // ppm, highest raw reading in the second (saturation check)
  humidity: number | null; // % RH
  dutyCmd: number | null; // % actually written to the PWM
  inhaleFan: number; // blower RPM (the inhale/main blower)
  exhaleFan: number | null; // RPM of the second blower, once wired
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

export type SensorKey = 'blower' | 'duty' | 'co2' | 'temp' | 'humidity';
