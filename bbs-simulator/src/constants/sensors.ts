import { Sample, SensorKey } from '../types';

type SampleField = Exclude<keyof Sample, 't'>;

export interface SeriesDef {
  field: SampleField;
  statLabel: string; // "inhale RPM" -> "min inhale RPM"
  csvLabel: string;
}

export interface SensorDef {
  key: SensorKey;
  chip: string;
  chipWidth: number; // chip widths from the Figma frame
  unit: string; // used in compare rows, e.g. "Average °C"
  decimals: number;
  series: SeriesDef[];
}

export const SENSORS: SensorDef[] = [
  {
    key: 'temp',
    chip: 'Temp',
    chipWidth: 75,
    unit: '°C',
    decimals: 1,
    series: [{ field: 'temperature', statLabel: '°C', csvLabel: 'Temperature (C)' }],
  },
  {
    key: 'co2',
    chip: 'CO2',
    chipWidth: 68,
    unit: '%',
    decimals: 1,
    series: [{ field: 'co2', statLabel: '%', csvLabel: 'CO2 (%)' }],
  },
  {
    key: 'humidity',
    chip: 'Humidity',
    chipWidth: 104,
    unit: '% RH',
    decimals: 0,
    series: [{ field: 'humidity', statLabel: '% RH', csvLabel: 'Humidity (% RH)' }],
  },
  {
    key: 'fans',
    chip: 'Fans',
    chipWidth: 64,
    unit: 'RPM',
    decimals: 0,
    series: [
      { field: 'inhaleFan', statLabel: 'inhale RPM', csvLabel: 'Inhale fan (RPM)' },
      { field: 'exhaleFan', statLabel: 'exhale RPM', csvLabel: 'Exhale fan (RPM)' },
    ],
  },
];

export const sensorByKey = (key: SensorKey) => SENSORS.find((s) => s.key === key)!;

export const CSV_COLUMNS: { field: keyof Sample; label: string; decimals: number }[] = [
  { field: 't', label: 'Time (s)', decimals: 0 },
  { field: 'tidalVolume', label: 'Tidal volume (mL)', decimals: 0 },
  { field: 'pressure', label: 'Peak pressure (cmH2O)', decimals: 2 },
  { field: 'temperature', label: 'Temperature (C)', decimals: 2 },
  { field: 'co2', label: 'CO2 (%)', decimals: 2 },
  { field: 'humidity', label: 'Humidity (% RH)', decimals: 1 },
  { field: 'inhaleFan', label: 'Inhale fan (RPM)', decimals: 0 },
  { field: 'exhaleFan', label: 'Exhale fan (RPM)', decimals: 0 },
];
