import { ActivityKey, Simulator } from '../types';
import { flowPeakDuty, TWIN_PRESET_SOURCE, TWIN_PRESETS } from './twin';

// Activity presets: the built-in flow-breath simulators on the Simulators screen (demo plus
// walking and light exercise, the firmware's presets).
// Built from TWIN_PRESETS (src/constants/twin.ts, the one place the values live) on every
// launch, never stored, so a corrected value reaches every phone with the next build.
// Each is a flow breath: tidal volume + rate; peak flow = pi * VE, VE = Vt * bpm.
export interface ActivityPreset {
  key: ActivityKey;
  name: string;
  vt: number; // L
  bpm: number;
  ieRatio: number;
}

export const ACTIVITY_PRESETS: ActivityPreset[] = TWIN_PRESETS.map((p) => ({
  key: p.key as ActivityKey,
  name: p.name,
  vt: p.vt,
  bpm: p.bpm,
  ieRatio: 1,
}));

// The activity table the values come from.
export const ACTIVITY_SOURCE: string | null = TWIN_PRESET_SOURCE;

export const activityFor = (key: ActivityKey | undefined) => ACTIVITY_PRESETS.find((a) => a.key === key);

// The activity presets as simulators. Fixed: no Edit, no Delete.
export const ACTIVITY_SIMULATORS: Simulator[] = ACTIVITY_PRESETS.map((a) => ({
  id: `activity-${a.key}`,
  name: a.name,
  mode: 'flow' as const,
  vt: a.vt,
  duty: flowPeakDuty(a.vt, a.bpm),
  respiratoryRate: a.bpm,
  ieRatio: a.ieRatio,
  activity: a.key,
}));

// The user's own simulators start with Free flow (what "Restore default simulators" brings back).
export const DEFAULT_SIMULATORS: Simulator[] = [
  { id: 'sim-free-flow', name: 'Free flow', mode: 'free', duty: 50, respiratoryRate: null, ieRatio: 1 },
];
