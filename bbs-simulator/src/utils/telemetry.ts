import { flowSign, TelemetryRow } from '../device/types';
import { Sample } from '../types';

// CO2 sensor (MH-Z16) saturates at 50 000 ppm, so readings near it are unreliable.
export const CO2_WARN_PPM = 45000;

export const ppmToPercent = (ppm: number) => ppm / 10000;

// Average of the values that exist; null when none do (a sensor that isn't connected).
export function meanOf(values: (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === null) continue;
    sum += v;
    n++;
  }
  return n ? sum / n : null;
}

// Average telemetry (up to 10 Hz) into one Sample per second since `startMs` (display, stats
// and CSV). The phase is the last one seen in that second; CO2 also keeps the raw peak so the
// saturation warning isn't hidden by averaging. Missing readings stay null.
// Twin flows are signed (+ inhale, − exhale, sign from the phase) before averaging; the fault
// is the highest code seen in the second, so a brief fault 3 at a peak isn't averaged away.
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
      const last = b.reduce((a, r) => (r.sampledAt >= a.sampledAt ? r : a));
      const co2 = b.map((r) => r.co2Ppm).filter((v): v is number => v !== null);
      const faults = b.map((r) => r.twin?.fault ?? null).filter((v): v is NonNullable<typeof v> => v !== null);
      return {
        t: sec,
        tidalVolume: null,
        pressure: null,
        temperature: meanOf(b.map((r) => r.tempC)),
        co2Ppm: meanOf(co2),
        co2PeakPpm: co2.length ? Math.max(...co2) : null,
        humidity: meanOf(b.map((r) => r.rhPct)),
        ambientPressure: meanOf(b.map((r) => r.pressureHpa)),
        dutyCmd: meanOf(b.map((r) => r.dutyCmd)),
        inhaleFan: meanOf(b.map((r) => r.rpmInhale)) ?? 0,
        exhaleFan: meanOf(b.map((r) => r.rpmExhale)),
        phase: last.phase,
        qTarget: meanOf(b.map((r) => (r.twin?.qTarget == null ? null : flowSign(r) * r.twin.qTarget))),
        qTwin: meanOf(b.map((r) => (r.twin?.qTwin == null ? null : flowSign(r) * r.twin.qTwin))),
        fault: faults.length ? Math.max(...faults) : null,
      };
    });
}
