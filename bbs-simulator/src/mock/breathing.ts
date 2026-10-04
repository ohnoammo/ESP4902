import { Sample, Simulator } from '../types';

// Breathing maths. `volumeAt` draws the idealised pattern (Ready preview, Home cards) and
// feeds the simulated device; `SensorModel` fakes the other sensors for the simulated
// device only (src/device/mockDevice.ts). Real readings come from src/device/esp32Device.ts.

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

function noise(scale: number) {
  return (Math.random() - 0.5) * 2 * scale;
}

// Per-run sensor simulation. Slow signals drift with a per-run random phase so two
// recorded runs never look identical when compared.
export class SensorModel {
  private seed = Math.random() * Math.PI * 2;
  private breathIndex = -1;
  private lastBreath = { tidalVolume: 0, pressure: 0 };

  constructor(private sim: Simulator) {}

  sample(t: number): Sample {
    const { tidalVolume, respiratoryRate } = this.sim;
    const breath = Math.floor(t / (60 / respiratoryRate));
    if (breath !== this.breathIndex) {
      this.breathIndex = breath;
      this.lastBreath = {
        tidalVolume: tidalVolume * (1 + noise(0.012)),
        pressure: (tidalVolume / 500) * 2.05 * (1 + noise(0.04)),
      };
    }
    const fanBase = 1500 + tidalVolume * 0.5 + respiratoryRate * 5;
    const s = this.seed;
    return {
      t,
      tidalVolume: this.lastBreath.tidalVolume,
      pressure: this.lastBreath.pressure,
      temperature:
        33.1 + 1.1 * (1 - Math.exp(-t / 120)) + 0.35 * Math.sin((2 * Math.PI * t) / 90 + s) + noise(0.04),
      co2: 3.9 + 0.25 * Math.sin((2 * Math.PI * t) / 70 + s * 2) + noise(0.05),
      humidity: 90 + 2.2 * Math.sin((2 * Math.PI * t) / 110 + s * 3) + noise(0.3),
      inhaleFan: fanBase + 70 * Math.sin((2 * Math.PI * t) / 45 + s) + noise(12),
      exhaleFan: fanBase * 0.66 + 80 * Math.sin((2 * Math.PI * t) / 50 + s * 4) + noise(12),
    };
  }
}
