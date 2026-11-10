import { Platform } from 'react-native';
import {
  COMMANDS,
  FrameAssembler,
  IMAGE_ROWS,
  ThermalFrame,
  USB_PRODUCT_IDS,
  USB_READ_BYTES,
  USB_VENDOR_ID,
  WIDTH,
} from './protocol';

export interface ThermalSource {
  start(onFrame: (f: ThermalFrame) => void, onError: (message: string) => void): Promise<void>;
  stop(): Promise<void>;
  recalibrate(): Promise<void>;
}

// WebUSB is Chrome/Edge only (desktop and Android). Expo Go has no USB access, so on a phone
// the camera page is used from the web build in Chrome, with the camera on the USB-C port.
export const webUsbAvailable = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && !!(navigator as any).usb;

const isCb360 = (d: any) => d.vendorId === USB_VENDOR_ID && USB_PRODUCT_IDS.includes(d.productId);

// A CB360 that is plugged in and that this browser has already been allowed to use (after the
// first pick, Chrome remembers it). null if none: either unplugged or never picked.
export async function findCb360(): Promise<any | null> {
  if (!webUsbAvailable()) return null;
  const devices = await (navigator as any).usb.getDevices();
  return devices.find(isCb360) ?? null;
}

// Calls back on plug / unplug of a CB360. Returns the unsubscribe.
export function watchCb360(onChange: (event: 'connect' | 'disconnect', device: any) => void): () => void {
  if (!webUsbAvailable()) return () => {};
  const usb = (navigator as any).usb;
  const on = (kind: 'connect' | 'disconnect') => (e: any) => isCb360(e.device) && onChange(kind, e.device);
  const c = on('connect'), d = on('disconnect');
  usb.addEventListener('connect', c);
  usb.addEventListener('disconnect', d);
  return () => {
    usb.removeEventListener('connect', c);
    usb.removeEventListener('disconnect', d);
  };
}

export class WebUsbSource implements ThermalSource {
  private device: any = null;
  private epIn = 0;
  private epOut = 0;
  private running = false;

  // `known`: a CB360 already allowed (findCb360); without it the browser's device picker opens.
  constructor(private known: any | null = null) {}

  get usbDevice() {
    return this.device;
  }

  async start(onFrame: (f: ThermalFrame) => void, onError: (message: string) => void) {
    const usb = (navigator as any).usb;
    // The picker must be opened from a tap; a device allowed before needs no picker.
    this.device =
      this.known ??
      (await usb.requestDevice({
        filters: USB_PRODUCT_IDS.map((productId) => ({ vendorId: USB_VENDOR_ID, productId })),
      }));
    const d = this.device;
    await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    // Same pick as the vendor app: the interface whose alternate setting 1 has two bulk endpoints.
    for (const iface of d.configuration.interfaces) {
      const alt = iface.alternates.find((a: any) => a.alternateSetting === 1 && a.endpoints.length === 2);
      if (!alt) continue;
      await d.claimInterface(iface.interfaceNumber);
      await d.selectAlternateInterface(iface.interfaceNumber, 1);
      for (const ep of alt.endpoints) {
        if (ep.type !== 'bulk') continue;
        if (ep.direction === 'in') this.epIn = ep.endpointNumber;
        else this.epOut = ep.endpointNumber;
      }
      break;
    }
    if (!this.epIn || !this.epOut) throw new Error('This device has no CB360 data interface.');
    await d.transferOut(this.epOut, COMMANDS.startStream);
    this.running = true;
    const assembler = new FrameAssembler();
    (async () => {
      while (this.running) {
        try {
          const r = await d.transferIn(this.epIn, USB_READ_BYTES);
          if (r.status !== 'ok' || !r.data) continue;
          for (const f of assembler.push(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength))) onFrame(f);
        } catch (e) {
          if (this.running) onError(e instanceof Error ? e.message : String(e));
          this.running = false;
        }
      }
    })();
  }

  async stop() {
    this.running = false;
    const d = this.device;
    this.device = null;
    if (!d) return;
    try {
      await d.transferOut(this.epOut, COMMANDS.stopStream);
      await d.close();
    } catch {
      // Already unplugged.
    }
  }

  async recalibrate() {
    if (this.device) await this.device.transferOut(this.epOut, COMMANDS.recalibrate);
  }
}

// Demo mode: a simulated head and mask at ~10 fps. The face is warm, the mask cooler, and warm
// exhaled air leaks over the nose bridge on each breath (15 bpm), which is what the camera is for.
export class DemoThermalSource implements ThermalSource {
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(onFrame: (f: ThermalFrame) => void) {
    const t0 = Date.now();
    this.timer = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      const breath = Math.max(0, Math.sin((t / 4) * 2 * Math.PI)); // exhale half of a 4 s breath
      const y16 = new Uint16Array(WIDTH * IMAGE_ROWS);
      for (let y = 0; y < IMAGE_ROWS; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const fx = (x - 60) / 30, fy = (y - 46) / 40; // face oval
          const face = fx * fx + fy * fy < 1;
          const mx = (x - 60) / 22, my = (y - 62) / 14; // mask
          const mask = mx * mx + my * my < 1;
          const lx = (x - 60) / 14, ly = (y - 46) / 5; // leak over the nose bridge
          const leak = Math.exp(-(lx * lx + ly * ly)) * breath;
          let v = 7000 + y * 2;
          if (face) v = 7900 + Math.round(40 * Math.cos(fy * 2));
          if (mask) v = 7650;
          v += Math.round(leak * 600) + Math.round(Math.random() * 12);
          y16[y * WIDTH + x] = v;
        }
      }
      onFrame({
        y16,
        at: Date.now(),
        header: { deviceName: 'DEMO', usbVersion: 0, shutterC: 31.4, lensC: 30.9, sensorC: 33.2, shutterClosed: false, emissivityRaw: 95 },
      });
    }, 100);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async recalibrate() {}
}
