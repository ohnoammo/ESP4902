import { Phase, Simulator } from '../types';
import { flowCheck } from './twin';

// Every duty band edge lives here (15 V, OPEN AIR, measured 2026-10-14). They will move after
// the loaded sweep: re-derive them here without touching any screen. Warnings never block Start.

export type BandLevel = 'error' | 'warn' | 'info' | 'ok';

export interface DutyBand {
  below: number; // the band covers duty < below (and >= the previous band's edge)
  key: string;
  label: string;
  level: BandLevel;
}

export const DUTY_BANDS: DutyBand[] = [
  { below: 19, key: 'no_flow', label: 'No flow. Driver will not run', level: 'error' },
  { below: 36, key: 'below_range', label: 'Below human range', level: 'warn' },
  { below: 64, key: 'light', label: 'Light flow range', level: 'ok' },
  { below: 72, key: 'between', label: 'Between ranges', level: 'info' },
  { below: 88, key: 'heavy', label: 'Heavy flow range', level: 'ok' },
  { below: 100, key: 'above_heavy', label: 'Above heavy range (open air only)', level: 'warn' },
  { below: Infinity, key: 'saturated', label: 'Saturated', level: 'warn' },
];

export const DUTY_BANDS_NOTE = '15 V, open air. Bands move after the loaded sweep.';

export function bandFor(duty: number): DutyBand {
  return DUTY_BANDS.find((b) => duty < b.below)!;
}

// Breath presets are classified on their peak duty, free presets on their fixed duty.
export const bandForSimulator = (sim: Pick<Simulator, 'duty'>) => bandFor(sim.duty);

// Live states the firmware reports itself (ground truth, shown over the band).
export const PHASE_BANNERS: Partial<Record<Phase, { text: string; level: BandLevel }>> = {
  free_kick: { text: 'Kick-starting fan', level: 'info' },
  free_below: { text: 'Below 19 %. No flow', level: 'error' },
  free_nospin: { text: 'Output on but fan not turning. Check wiring', level: 'error' },
  free_sat: { text: 'Saturated. No headroom under load', level: 'warn' },
};

// Measured on the rig (2026-10-14): the blower lags duty by ~0.6 s and can't brake, so the
// inhale/exhale contrast collapses above ~15 bpm and with longer exhales. Shown, not blocked.
// Flow breaths: only the fans' capacity (installed calibration), see flowCheck in twin.ts.
export function breathLimitation(sim: Pick<Simulator, 'mode' | 'respiratoryRate' | 'ieRatio' | 'vt'>): string | null {
  if (sim.mode === 'flow') {
    if (sim.vt == null || sim.respiratoryRate === null) return null;
    return flowCheck(sim.vt, sim.respiratoryRate).message;
  }
  if (sim.mode !== 'breath') return null;
  const fast = (sim.respiratoryRate ?? 0) > 15;
  const long = sim.ieRatio >= 2;
  if (!fast && !long) return null;
  return 'The blower lags duty by ~0.6 s and can’t brake, so ' +
    (fast ? 'above ~15 bpm the inhale/exhale contrast is weak (0.88 measured at 20 bpm)' : 'at 1:2 and longer exhales the short inhale shows little contrast') +
    '. A firmware phase lead is being tested.';
}
