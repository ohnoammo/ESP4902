import { BREATH_FLOOR_DUTY } from '../device/types';
import { Simulator } from '../types';

// The COMMANDED duty shape, drawn on the Ready preview and the Home cards. It is what the
// firmware writes to the PWM (same half-sine and 20 % floor), not airflow: the blower lags it
// by ~0.6 s and can't brake.

type Pattern = Pick<Simulator, 'mode' | 'duty' | 'respiratoryRate' | 'ieRatio'>;

// Duty (%) commanded at time t (s), or null for a breath preset with no rate set yet.
export function dutyAt(p: Pattern, t: number): number | null {
  if (p.mode === 'free') return p.duty;
  if (p.respiratoryRate === null) return null;
  const period = 60 / p.respiratoryRate;
  const inhale = period / (1 + p.ieRatio);
  const x = ((t % period) + period) % period;
  const peak = Math.max(BREATH_FLOOR_DUTY, p.duty);
  return x < inhale ? BREATH_FLOOR_DUTY + (peak - BREATH_FLOOR_DUTY) * Math.sin((Math.PI * x) / inhale) : BREATH_FLOOR_DUTY;
}
