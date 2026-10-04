import { SensorModel, volumeAt } from '../mock/breathing';
import { Simulator } from '../types';
import { Device, Reading } from './types';

// Built-in simulated device. It emits exactly what the real ESP32 is expected to send
// (see DEVICE_INTEGRATION.md): `volume` 20 times a second, the other sensors once a second.
export function createMockDevice(): Device {
  const readingListeners = new Set<(r: Reading) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const emit = (r: Reading) => readingListeners.forEach((l) => l(r));

  return {
    async connect(onProgress) {
      const steps = 40;
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, 70 + Math.random() * 40));
        onProgress(i / steps);
      }
      return { name: 'BBS-ESP32 (simulated)', address: 'built-in simulator' };
    },

    disconnect() {
      clearInterval(timer);
    },

    async start(sim: Simulator) {
      clearInterval(timer);
      const model = new SensorModel(sim);
      const startedAt = Date.now();
      let lastSecond = -1;
      timer = setInterval(() => {
        const t = (Date.now() - startedAt) / 1000;
        emit({ volume: volumeAt(sim, t) * sim.tidalVolume });
        if (Math.floor(t) !== lastSecond) {
          lastSecond = Math.floor(t);
          const { t: _t, ...sensors } = model.sample(t);
          emit(sensors);
        }
      }, 50);
    },

    async stop() {
      clearInterval(timer);
      timer = undefined;
    },

    onReading(listener) {
      readingListeners.add(listener);
      return () => readingListeners.delete(listener);
    },

    onConnectionLost() {
      return () => {}; // the simulator never drops
    },
  };
}
