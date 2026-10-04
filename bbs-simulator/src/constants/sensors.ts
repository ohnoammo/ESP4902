import { Sample, SensorKey } from '../types';

type NumericField = 'temperature' | 'co2Ppm' | 'humidity' | 'inhaleFan' | 'exhaleFan';

export interface SeriesDef {
  field: NumericField;
  statLabel: string; // "inhale RPM" -> "min inhale RPM"
  scale?: number; // stored value × scale = displayed value (CO2: ppm -> %)
}

export interface SensorDef {
  key: SensorKey;
  chip: string;
  chipWidth: number; // chip widths from the Figma frame
  unit: string; // used in compare rows, e.g. "Average °C"
  decimals: number;
  series: SeriesDef[];
}

// CO2 is stored and handled in ppm (as the device reports it) and shown as %.
export const SENSORS: SensorDef[] = [
  {
    key: 'temp',
    chip: 'Temp',
    chipWidth: 75,
    unit: '°C',
    decimals: 1,
    series: [{ field: 'temperature', statLabel: '°C' }],
  },
  {
    key: 'co2',
    chip: 'CO2',
    chipWidth: 68,
    unit: '%',
    decimals: 2,
    series: [{ field: 'co2Ppm', statLabel: '%', scale: 1 / 10000 }],
  },
  {
    key: 'humidity',
    chip: 'Humidity',
    chipWidth: 104,
    unit: '% RH',
    decimals: 0,
    series: [{ field: 'humidity', statLabel: '% RH' }],
  },
  {
    key: 'fans',
    chip: 'Fans',
    chipWidth: 64,
    unit: 'RPM',
    decimals: 0,
    series: [
      { field: 'inhaleFan', statLabel: 'inhale RPM' },
      { field: 'exhaleFan', statLabel: 'exhale RPM' },
    ],
  },
];

export const sensorByKey = (key: SensorKey) => SENSORS.find((s) => s.key === key)!;

// Displayed value of one series for a sample.
export const seriesValue = (s: SeriesDef, sample: Sample) => sample[s.field] * (s.scale ?? 1);

// CSV export: one row per second (1 s averages of the 10 Hz telemetry). CO2 stays in ppm;
// unmeasured values are left blank.
export const CSV_COLUMNS: { label: string; value: (s: Sample) => string }[] = [
  { label: 'Time (s)', value: (s) => String(s.t) },
  { label: 'Phase', value: (s) => s.phase },
  { label: 'Tidal volume (mL, not measured yet)', value: (s) => (s.tidalVolume === null ? '' : s.tidalVolume.toFixed(0)) },
  { label: 'Peak pressure (cmH2O, not measured yet)', value: (s) => (s.pressure === null ? '' : s.pressure.toFixed(2)) },
  { label: 'Temperature (C)', value: (s) => s.temperature.toFixed(2) },
  { label: 'CO2 (ppm)', value: (s) => s.co2Ppm.toFixed(0) },
  { label: 'CO2 peak (ppm)', value: (s) => s.co2PeakPpm.toFixed(0) },
  { label: 'Humidity (% RH)', value: (s) => s.humidity.toFixed(1) },
  { label: 'Inhale fan (RPM)', value: (s) => s.inhaleFan.toFixed(0) },
  { label: 'Exhale fan (RPM)', value: (s) => s.exhaleFan.toFixed(0) },
];
