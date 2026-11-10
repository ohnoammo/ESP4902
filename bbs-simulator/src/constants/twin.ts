// Digital twin constants: the INSTALLED calibration of the final two-fan simulator
// (firmware final-1.0-twin, firmware/esp4902_final/esp4902_final.ino). Fixed values: do not
// tune them here. The firmware carries the same tables; the app uses them to simulate the twin
// in demo mode, to label the page and to warn about presets the fans can't deliver.

// Installed sweeps (15 V, sealed chambers, single runs, 10 Nov 2026). Linear interpolation.
//   Exhale: testo at the exhale nostril. Limited to ~17 L/min by recirculation around the
//           exhale fan inlet (known hardware limitation).
//   Inhale: testo at the inhale fan room outlet (centre-point reading: an upper bound).
export const CAL_DUTY = [25, 30, 35, 40, 50, 60, 70, 80, 90, 100];
export const EX_Q = [1.8, 3.0, 4.0, 5.1, 7.5, 8.8, 10.8, 13.8, 15.8, 17.3];
export const EX_RPM = [3446, 5107, 6341, 7450, 9421, 11217, 13117, 15392, 17565, 19685];
export const IN_Q = [6.4, 10.5, 14.8, 21.2, 35.8, 48.6, 61.4, 74.6, 90.1, 105.1];
export const IN_RPM = [3333, 5267, 6850, 8231, 10711, 12666, 14411, 16187, 18271, 20540];

export type TwinDirection = 'inhale' | 'exhale';

export function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x <= xs[i + 1]) return ys[i] + ((x - xs[i]) / (xs[i + 1] - xs[i])) * (ys[i + 1] - ys[i]);
  }
  return ys[ys.length - 1];
}

const qOf = (dir: TwinDirection) => (dir === 'inhale' ? IN_Q : EX_Q);
const rpmOf = (dir: TwinDirection) => (dir === 'inhale' ? IN_RPM : EX_RPM);

// Same rules as the firmware (dutyFor, rpmFor, twinFlow):
//   flow -> duty: below the table's first flow, 25 % (lowest reliable duty); above it, 100 %.
//   flow -> rpm:  below the first flow, scaled linearly towards 0.
//   rpm -> flow:  below the first rpm, scaled linearly towards 0.
export const dutyForFlow = (q: number, dir: TwinDirection) =>
  q <= 0 ? 0 : q < qOf(dir)[0] ? CAL_DUTY[0] : interp(q, qOf(dir), CAL_DUTY);
export const rpmForFlow = (q: number, dir: TwinDirection) =>
  q <= 0 ? 0 : q < qOf(dir)[0] ? (rpmOf(dir)[0] * q) / qOf(dir)[0] : interp(q, qOf(dir), rpmOf(dir));
export const flowForRpm = (rpm: number, dir: TwinDirection) =>
  rpm <= 0 ? 0 : rpm < rpmOf(dir)[0] ? (qOf(dir)[0] * rpm) / rpmOf(dir)[0] : interp(rpm, rpmOf(dir), qOf(dir));
export const rpmForDuty = (duty: number, dir: TwinDirection) => (duty <= 0 ? 0 : interp(duty, CAL_DUTY, rpmOf(dir)));
// The twin's estimate counts as calibrated when the fan turns at least as fast as the table's
// first point (the firmware's `valid`).
export const minCalibratedRpm = (dir: TwinDirection) => rpmOf(dir)[0];

// Fan capacity (100 % duty).
export const Q_MAX_IN = IN_Q[IN_Q.length - 1]; // 105.1 L/min
export const Q_MAX_EX = EX_Q[EX_Q.length - 1]; // 17.3 L/min
// Rounded figures for the warnings.
export const CAPACITY_EX = 17;
export const CAPACITY_IN = 105;

// Q_peak = π·Vt·bpm (L/min) for a sinusoid at I:E 1:1.
export const peakFlow = (vtL: number, bpm: number) => Math.PI * vtL * bpm;

// Breathing presets. `key` is the firmware's preset id: a preset start sends it by name
// ({"preset":"walk_slow"}), because the commands table only accepts whole-number bpm.
// Values: report Table V (walking [37], light exercise [38]) plus a demo both fans can deliver.
export interface TwinPreset {
  key: string;
  name: string;
  vt: number; // L
  bpm: number;
}
export const TWIN_PRESETS: TwinPreset[] = [
  { key: 'demo_15', name: 'Demo (15 L/min)', vt: 0.318, bpm: 15 },
  { key: 'walk_slow', name: 'Walking, slow', vt: 0.95, bpm: 20.5 },
  { key: 'walk_fast', name: 'Walking, fast', vt: 1.18, bpm: 25.4 },
  { key: 'light_f', name: 'Light exercise, female', vt: 0.992, bpm: 21 },
  { key: 'light_m', name: 'Light exercise, male', vt: 1.25, bpm: 20 },
];
export const TWIN_PRESET_SOURCE = 'the report’s Table V (walking [37], light exercise [38])';
export const DEFAULT_PRESET_KEY = 'demo_15';

// The firmware accepts Vt 0.1..2.5 L.
export const VT_RANGE = { min: 0.1, max: 2.5, step: 0.01 };

// Where a breath's peak sits against the two fans. Never blocks a start: above a fan's
// capacity the firmware holds that fan at 100 % and reports fault 3 while the peak is clipped.
export type PeakStatus = 'ok' | 'exhaleClipped' | 'bothClipped';
export function peakStatus(qPeak: number): PeakStatus {
  if (qPeak > Q_MAX_IN) return 'bothClipped';
  return qPeak > Q_MAX_EX ? 'exhaleClipped' : 'ok';
}

export const PEAK_STATUS_LABEL: Record<PeakStatus, string> = {
  ok: 'Within capacity',
  exhaleClipped: 'Exhale peak clipped',
  bothClipped: 'Both peaks clipped',
};

export interface FlowCheck {
  ve: number; // L/min
  peak: number; // L/min
  status: PeakStatus;
  okVt: [number, number] | null; // Vt range within both fans' capacity at this rate
  message: string | null; // null when within capacity
}

// Everything the editor and Ready screen say about a flow breath. Warnings only.
export function flowCheck(vt: number, bpm: number): FlowCheck {
  const ve = vt * bpm;
  const peak = Math.PI * ve;
  const status = peakStatus(peak);
  const hi = Math.min(VT_RANGE.max, Q_MAX_EX / Math.PI / bpm);
  const okVt: [number, number] | null = VT_RANGE.min <= hi ? [VT_RANGE.min, hi] : null;
  const range = okVt ? ` At ${formatBpm(bpm)} bpm, Vt up to ${okVt[1].toFixed(2)} L stays within both fans.` : '';
  const message =
    status === 'bothClipped'
      ? `Peak ${peak.toFixed(0)} L/min is above both fans’ capacity (exhale ${CAPACITY_EX}, inhale ${CAPACITY_IN} L/min), so inhale and exhale peaks will be clipped.${range}`
      : status === 'exhaleClipped'
        ? `Peak ${peak.toFixed(0)} L/min is above the exhale fan’s ${CAPACITY_EX} L/min capacity, so exhale peaks will be clipped. Inhale is within range.${range}`
        : null;
  return { ve, peak, status, okVt, message };
}

const formatBpm = (bpm: number) => (Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1));

// The peak feed-forward duty of the inhale fan for a flow breath, for runs.duty.
export const flowPeakDuty = (vt: number, bpm: number) =>
  Math.round(Math.min(100, dutyForFlow(Math.min(Math.PI * vt * bpm, Q_MAX_IN), 'inhale')));

// Flow that a duty gives the inhale fan, to convert old duty presets.
export const flowForDuty = (duty: number) => (duty < CAL_DUTY[0] ? IN_Q[0] : interp(duty, CAL_DUTY, IN_Q));

// RPM trim: duty correction limit; at the limit the fan can't reach the speed (fault 2).
export const TRIM_LIMIT = 10;

// telemetry.fault (firmware final-1.0-twin).
export type TwinFault = 0 | 1 | 2 | 3;
export const FAULT_LABEL: Record<TwinFault, string> = { 0: 'OK', 1: 'No spin', 2: 'Trim at limit', 3: 'Above capacity' };

// Plain message per fault, for the banner. For fault 3, `clipped` says which fan: the firmware
// drives the next phase's fan 0.2 s early, so the phase alone can't tell.
export type ClippedFan = 'exhale' | 'inhale' | 'both';
export function faultMessage(fault: 1 | 2 | 3, clipped: ClippedFan = 'exhale'): string {
  if (fault === 1) return 'A fan is commanded but not spinning. Check its power and wiring.';
  if (fault === 2) return 'A fan can’t reach the speed it needs: the trim is at its limit (low supply or a worn fan).';
  if (clipped === 'both') return 'Inhale and exhale targets above simulator capacity: peaks are being clipped.';
  if (clipped === 'inhale') return 'Inhale target above simulator capacity: peaks are being clipped.';
  return 'Exhale target above simulator capacity: peaks are being clipped.';
}

// The page's "Where these numbers come from" text, kept beside the tables it describes.
export const TWIN_SOURCES = [
  'Fan speed is the only measurement (tach, 1 pulse per rev). There is no flow or pressure sensor in the airway.',
  'Estimated airflow is the installed calibration’s flow at the measured fan speed: each fan swept from 25 to 100 % duty at 15 V with the chambers sealed, single runs, 10 Nov 2026.',
  `Exhale flow was measured at the exhale nostril and tops out at ${Q_MAX_EX} L/min (recirculation around the exhale fan inlet). Inhale flow was measured at the inhale fan outlet (centre point), so treat it as an upper bound; max ${Q_MAX_IN} L/min.`,
  'Below 25 % duty there is no data: the fan runs at 25 % and the estimate is scaled towards 0.',
  'Feed-forward looks 0.2 s ahead. The rpm trim corrects duty so the measured speed matches the expected speed, and keeps what it learns until the device restarts.',
];
