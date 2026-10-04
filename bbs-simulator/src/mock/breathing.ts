import { Simulator } from '../types';

// The idealised breathing pattern drawn on the Ready preview and the Home cards. It is a
// picture of the settings, not data: real readings come from the device (src/device/).

type Pattern = Pick<Simulator, 'respiratoryRate' | 'ieRatio'>;

// Normalised lung volume (0 = end of exhale, 1 = end of inhale) at time t.
// Inhale takes 1/(1+ieRatio) of each breath, so a 1:2 pattern exhales twice as long.
export function volumeAt(p: Pattern, t: number): number {
  const period = 60 / p.respiratoryRate;
  const inhaleFrac = 1 / (1 + p.ieRatio);
  const phase = (((t % period) + period) % period) / period;
  if (phase < inhaleFrac) return (1 - Math.cos((Math.PI * phase) / inhaleFrac)) / 2;
  return (1 + Math.cos((Math.PI * (phase - inhaleFrac)) / (1 - inhaleFrac))) / 2;
}
