import { Simulator } from '../types';

export interface DeviceInfo {
  name: string;
  address: string;
}

// One message's worth of data from the device. Every field is optional so the device
// can send fast and slow data separately (e.g. `volume` 20×/s, sensors 1×/s); the app
// keeps the most recent value of each field.
export interface Reading {
  volume?: number; // mL, instantaneous lung volume — drives the live waveform
  tidalVolume?: number; // mL, volume of the last completed breath
  pressure?: number; // cmH2O, peak pressure of the last breath
  temperature?: number; // °C
  co2?: number; // %
  humidity?: number; // % RH
  inhaleFan?: number; // RPM
  exhaleFan?: number; // RPM
}

// Everything the app needs from a device. There are two implementations:
// mockDevice (built-in simulator) and esp32Device (WebSocket); config.ts picks one.
export interface Device {
  connect(onProgress: (fraction: number) => void): Promise<DeviceInfo>;
  disconnect(): void;
  start(sim: Simulator): Promise<void>;
  stop(): Promise<void>;
  // Both return an unsubscribe function.
  onReading(listener: (reading: Reading) => void): () => void;
  onConnectionLost(listener: () => void): () => void;
}
