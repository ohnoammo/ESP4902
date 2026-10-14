import { Simulator } from '../types';

// Default simulator presets (what "Restore default simulators" brings back).
//
// TEAM TO SET: the Walking / light breathing rate. Take it from the same activity table the
// flow targets came from and cite it there; do not work it backwards from peak flow
// (peak flow = π × VE, VE = rate × tidal volume, so the rate must come from the source).
// While this is null the preset is not shipped. If the sourced rate is ~20 bpm or more, the
// measured inhale/exhale contrast (0.88 at 20 bpm) says the sine can't deliver it yet: run the
// phase-lead firmware test before setting it.
export const WALKING_LIGHT_BPM: number | null = null;
// Source for WALKING_LIGHT_BPM: (cite the activity table here)

// Heavy is held back: the 30 bpm test showed this blower can't produce a breath at heavy
// rates, so it will probably become a free-flow preset at a fixed duty (continuous flow =
// π × VE, EN 13274-3). Add it here once the team decides.

export const DEFAULT_SIMULATORS: Simulator[] = [
  { id: 'sim-free-flow', name: 'Free flow', mode: 'free', duty: 50, respiratoryRate: null, ieRatio: 1 },
  ...(WALKING_LIGHT_BPM === null
    ? []
    : [
        {
          id: 'sim-walking-light',
          name: 'Walking / light',
          mode: 'breath' as const,
          duty: 50, // open-air placeholder: re-set after the loaded sweep
          respiratoryRate: WALKING_LIGHT_BPM,
          ieRatio: 1,
        },
      ]),
];
