export interface Simulator {
  id: string;
  name: string;
  tidalVolume: number; // mL
  respiratoryRate: number; // breaths per minute
  ieRatio: number; // exhale part of 1:X
}

// One reading per second while a run records.
export interface Sample {
  t: number; // seconds since start
  tidalVolume: number; // mL, last completed breath
  pressure: number; // cmH2O, peak of last breath
  temperature: number; // °C
  co2: number; // %
  humidity: number; // % RH
  inhaleFan: number; // RPM
  exhaleFan: number; // RPM
}

export interface SessionMeta {
  id: string;
  name: string;
  simulator: Omit<Simulator, 'id'>;
  startedAt: number; // epoch ms
  durationSec: number;
  folderId: string | null;
}

export interface Folder {
  id: string;
  name: string;
}

export type SensorKey = 'temp' | 'co2' | 'humidity' | 'fans';
