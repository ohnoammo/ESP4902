// Flow: a breath set by tidal volume and rate; the digital twin turns it into duty
//   (firmware blower-0.8-twin). What new and preset simulators use.
// Free: one fixed duty, continuous flow.
// Breath: the old duty half-sine (peak duty + 20 % floor). Only on runs recorded before
//   flow breaths; saved breath simulators are converted to flow when loaded.
export type SimMode = 'flow' | 'free' | 'breath';

// A saved preset of what to send the device.
export interface Simulator {
  id: string;
  name: string;
  mode: SimMode;
  // flow: the twin's peak feed-forward duty (%), for the duty band and the runs table;
  // breath: PEAK duty of the inhale (%); free: the fixed duty (%)
  duty: number;
  vt?: number | null; // flow only: tidal volume, L (null = not set yet)
  // flow and breath. Must be set before it can start: null means "not set".
  respiratoryRate: number | null; // sent as `bpm`
  ieRatio: number; // E/I, exhale part of 1:X; flow breaths are 1:1; ignored in free mode
  activity?: ActivityKey; // set only on the built-in activity simulators (src/constants/presets.ts)
}

// The firmware's preset ids (src/constants/twin.ts, TWIN_PRESETS).
export type ActivityKey = 'demo_15' | 'walk_slow' | 'walk_fast' | 'light_f' | 'light_m';

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
  // hPa, ambient (BME280). Optional: runs saved before final-1.0-twin don't have it.
  ambientPressure?: number | null;
  dutyCmd: number | null; // % actually written to the PWM
  inhaleFan: number; // inhale fan RPM
  exhaleFan: number | null; // exhale fan RPM
  phase: Phase; // phase at the end of the second
  // Digital twin, 1 s means, signed (+ inhale, − exhale). Optional for older runs.
  qTarget?: number | null; // L/min, target flow
  qTwin?: number | null; // L/min, estimated airflow (installed calibration)
  fault?: number | null; // highest fault code in the second
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

export type SensorKey = 'blower' | 'duty' | 'temp' | 'humidity' | 'pressure';
