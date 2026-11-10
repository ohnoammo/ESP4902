import { IMAGE_ROWS, WIDTH } from './protocol';

// Leak detection works on raw counts, so it needs no °C calibration. Each pixel keeps a
// "resting" level that drops quickly and rises slowly, so it settles on the level between
// breaths. Warm exhaled air escaping past the mask lifts a patch of pixels well above their
// resting level; a big enough patch, held for a few frames, is reported as a hotspot.

// The alert threshold is a rise above the resting level, in raw counts, set by the user on a
// slider. Recommended points: on this camera's calibration curve 55–60 counts is about 1 °C
// near skin temperature, so these are roughly 5, 2.5 and 1.4 °C (confirmed once the camera is here).
export const RECOMMENDED = [
  { key: 'low', label: 'Low', counts: 300, hint: 'Only clear leaks; fewest false alerts.' },
  { key: 'medium', label: 'Medium', counts: 150, hint: 'Recommended for most tests.' },
  { key: 'high', label: 'High', counts: 80, hint: 'Catches small leaks; may react to warm air near the mask.' },
] as const;
export const THRESHOLD_MIN = 40; // most sensitive the slider goes
export const THRESHOLD_MAX = 400; // least sensitive

const MIN_AREA = 12; // pixels (0.1 % of the frame): ignores single noisy pixels
const HOLD_FRAMES = 3; // consecutive frames before a hotspot is reported
const FALL = 0.3; // resting level follows cooling quickly…
const RISE = 0.005; // …and warming slowly (about 8 s at 25 fps)

export interface Hotspot {
  area: number; // pixels
  peakRise: number; // counts above resting level at the warmest point
  x0: number; // bounding box, pixels
  y0: number;
  x1: number;
  y1: number;
}

export class LeakDetector {
  private rest: Float32Array | null = null;
  private held = 0;

  reset() {
    this.rest = null;
    this.held = 0;
  }

  // Feeds one frame; returns the hotspot once it has held for HOLD_FRAMES, else null.
  update(y16: Uint16Array, threshold: number): Hotspot | null {
    if (!this.rest) {
      this.rest = Float32Array.from(y16);
      return null;
    }
    const rest = this.rest;
    let area = 0, peakRise = 0, x0 = WIDTH, y0 = IMAGE_ROWS, x1 = -1, y1 = -1;
    for (let i = 0; i < y16.length; i++) {
      const v = y16[i];
      const rise = v - rest[i];
      if (rise > threshold) {
        area++;
        if (rise > peakRise) peakRise = rise;
        const x = i % WIDTH, y = (i / WIDTH) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      rest[i] += rise * (rise < 0 ? FALL : RISE);
    }
    this.held = area >= MIN_AREA ? this.held + 1 : 0;
    return this.held >= HOLD_FRAMES ? { area, peakRise, x0, y0, x1, y1 } : null;
  }
}

// Two-point °C calibration made by the team: aim the centre at two references of known
// temperature (e.g. ice water and a thermometer-checked warm object) and record the counts.
// Between and near those points the camera's response is close to linear.
export interface Calibration {
  a: { counts: number; c: number };
  b: { counts: number; c: number };
  at: number; // when it was made
}

export const toCelsius = (cal: Calibration, counts: number) =>
  cal.a.c + ((counts - cal.a.counts) * (cal.b.c - cal.a.c)) / (cal.b.counts - cal.a.counts);

// Counts per °C, for showing the leak threshold in °C once calibrated.
export const countsPerC = (cal: Calibration) => (cal.b.counts - cal.a.counts) / (cal.b.c - cal.a.c);

// Average of the 5 × 5 pixels under the crosshair: what a calibration point records.
export function centreCounts(y16: Uint16Array): number {
  const cx = WIDTH >> 1, cy = IMAGE_ROWS >> 1;
  let sum = 0;
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) sum += y16[y * WIDTH + x];
  return sum / 25;
}
