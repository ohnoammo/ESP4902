import { dutyForFlow } from '../constants/twin';
import { BREATH_FLOOR_DUTY } from '../device/types';
import { Simulator } from '../types';

// The COMMANDED duty shape, drawn on the Ready preview and the Home cards. It is what the
// firmware writes to the PWM (same half-sine and 20 % floor), not airflow: the blower lags it
// by ~0.6 s and can't brake.

type Pattern = Pick<Simulator, 'mode' | 'duty' | 'respiratoryRate' | 'ieRatio' | 'vt'>;

// Duty (%) commanded at time t (s), or null for a preset with no rate (or Vt) set yet.
// Flow: the twin's feed-forward duty for the target flow, inhale fan then exhale fan (each
// half a half-sine carrying Vt; below the table's first flow the fan holds 25 %).
export function dutyAt(p: Pattern, t: number): number | null {
  if (p.mode === 'free') return p.duty;
  if (p.respiratoryRate === null) return null;
  if (p.mode === 'flow') {
    if (p.vt == null) return null;
    const period = 60 / p.respiratoryRate;
    const x = ((t % period) + period) % period;
    const inhale = x < period / 2;
    const q = Math.PI * p.vt * p.respiratoryRate * Math.sin((Math.PI * (inhale ? x : x - period / 2)) / (period / 2));
    return Math.min(100, dutyForFlow(q, inhale ? 'inhale' : 'exhale'));
  }
  const period = 60 / p.respiratoryRate;
  const inhale = period / (1 + p.ieRatio);
  const x = ((t % period) + period) % period;
  const peak = Math.max(BREATH_FLOOR_DUTY, p.duty);
  return x < inhale ? BREATH_FLOOR_DUTY + (peak - BREATH_FLOOR_DUTY) * Math.sin((Math.PI * x) / inhale) : BREATH_FLOOR_DUTY;
}
