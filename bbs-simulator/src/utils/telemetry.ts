import { TelemetryRow } from '../device/types';
import { Sample } from '../types';

// CO2 sensor (MH-Z16) saturates at 50 000 ppm, so readings near it are unreliable.
export const CO2_WARN_PPM = 45000;

export const ppmToPercent = (ppm: number) => ppm / 10000;

// Average 10 Hz telemetry into one Sample per second since `startMs` (display, stats and
// CSV). The phase is the last one seen in that second; CO2 also keeps the raw peak so the
// saturation warning isn't hidden by averaging.
export function perSecond(rows: TelemetryRow[], startMs: number): Sample[] {
  const buckets = new Map<number, TelemetryRow[]>();
  for (const r of rows) {
    const sec = Math.floor((r.sampledAt - startMs) / 1000);
    if (sec < 0) continue;
    const b = buckets.get(sec);
    if (b) b.push(r);
    else buckets.set(sec, [r]);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((sec) => {
      const b = buckets.get(sec)!;
      const avg = (f: (r: TelemetryRow) => number) => b.reduce((s, r) => s + f(r), 0) / b.length;
      const last = b.reduce((a, r) => (r.sampledAt >= a.sampledAt ? r : a));
      return {
        t: sec,
        tidalVolume: null,
        pressure: null,
        temperature: avg((r) => r.tempC),
        co2Ppm: avg((r) => r.co2Ppm),
        co2PeakPpm: Math.max(...b.map((r) => r.co2Ppm)),
        humidity: avg((r) => r.rhPct),
        inhaleFan: avg((r) => r.rpmInhale),
        exhaleFan: avg((r) => r.rpmExhale),
        phase: last.phase,
      };
    });
}
