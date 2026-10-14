import { Sample, SensorKey } from '../types';

type NumericField = 'dutyCmd' | 'inhaleFan' | 'exhaleFan' | 'temperature' | 'co2Ppm' | 'humidity';

export interface SeriesDef {
  field: NumericField;
  statLabel: string; // "rpm" -> "min rpm"
  scale?: number; // stored value × scale = displayed value (CO2: ppm -> %)
}

export interface SensorDef {
  key: SensorKey;
  chip: string;
  chipWidth: number; // preferred chip width (chips shrink to fit, see SensorChips)
  unit: string; // used in compare rows, e.g. "Average °C"
  decimals: number;
  series: SeriesDef[];
  missing: string; // shown when the run has no values for this sensor
}

// CO2 is stored and handled in ppm (as the device reports it) and shown as %.
// The second blower's rpm only appears once it is wired (its values are null until then).
export const SENSORS: SensorDef[] = [
  {
    key: 'blower',
    chip: 'Blower',
    chipWidth: 84,
    unit: 'rpm',
    decimals: 0,
    series: [
      { field: 'inhaleFan', statLabel: 'rpm' },
      { field: 'exhaleFan', statLabel: '2nd blower rpm' },
    ],
    missing: 'No blower readings in this run.',
  },
  {
    key: 'duty',
    chip: 'Duty',
    chipWidth: 70,
    unit: '%',
    decimals: 0,
    series: [{ field: 'dutyCmd', statLabel: '% duty' }],
    missing: 'No duty readings in this run (firmware before 0.7).',
  },
  {
    key: 'co2',
    chip: 'CO2',
    chipWidth: 68,
    unit: '%',
    decimals: 2,
    series: [{ field: 'co2Ppm', statLabel: '%', scale: 1 / 10000 }],
    missing: 'CO2 sensor not connected.',
  },
  {
    key: 'temp',
    chip: 'Temp',
    chipWidth: 75,
    unit: '°C',
    decimals: 1,
    series: [{ field: 'temperature', statLabel: '°C' }],
    missing: 'Temperature sensor not connected.',
  },
  {
    key: 'humidity',
    chip: 'Humidity',
    chipWidth: 104,
    unit: '% RH',
    decimals: 0,
    series: [{ field: 'humidity', statLabel: '% RH' }],
    missing: 'Humidity sensor not connected.',
  },
];

export const sensorByKey = (key: SensorKey) => SENSORS.find((s) => s.key === key)!;

// Displayed value of one series for a sample, or null if there is none.
export function seriesValue(s: SeriesDef, sample: Sample): number | null {
  const v = sample[s.field];
  return v === null ? null : v * (s.scale ?? 1);
}

// The series of a sensor that actually have values in these samples.
export const presentSeries = (def: SensorDef, samples: Sample[]) =>
  def.series.filter((s) => samples.some((x) => x[s.field] !== null));

const fixed = (v: number | null, d: number) => (v === null ? '' : v.toFixed(d));

// CSV export: one row per second (1 s averages of the telemetry). CO2 stays in ppm; missing
// values (not measured, sensor not connected) are left blank.
export const CSV_COLUMNS: { label: string; value: (s: Sample) => string }[] = [
  { label: 'Time (s)', value: (s) => String(s.t) },
  { label: 'Phase', value: (s) => s.phase },
  { label: 'Duty (%)', value: (s) => fixed(s.dutyCmd, 1) },
  { label: 'Blower (rpm)', value: (s) => s.inhaleFan.toFixed(0) },
  { label: 'Second blower (rpm)', value: (s) => fixed(s.exhaleFan, 0) },
  { label: 'Tidal volume (mL, not measured yet)', value: (s) => fixed(s.tidalVolume, 0) },
  { label: 'Peak pressure (cmH2O, not measured yet)', value: (s) => fixed(s.pressure, 2) },
  { label: 'Temperature (C)', value: (s) => fixed(s.temperature, 2) },
  { label: 'CO2 (ppm)', value: (s) => fixed(s.co2Ppm, 0) },
  { label: 'CO2 peak (ppm)', value: (s) => fixed(s.co2PeakPpm, 0) },
  { label: 'Humidity (% RH)', value: (s) => fixed(s.humidity, 1) },
];
