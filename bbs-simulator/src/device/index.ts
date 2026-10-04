import { CONNECT_TIMEOUT_MS, DEVICE_URL, USE_MOCK_DEVICE } from './config';
import { createEsp32Device } from './esp32Device';
import { createMockDevice } from './mockDevice';
import { Device } from './types';

// The single device instance the whole app talks to (chosen in config.ts).
export const device: Device = USE_MOCK_DEVICE
  ? createMockDevice()
  : createEsp32Device(DEVICE_URL, CONNECT_TIMEOUT_MS);

export type { Device, DeviceInfo, Reading } from './types';
