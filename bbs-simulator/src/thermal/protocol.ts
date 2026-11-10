// CB360 thermal camera (Guide "MobIR" module) USB protocol, worked out from the vendor app
// CB360 2.0.12 (package com.parts.mobileir.CB360). Full notes: THERMAL_CAMERA.md.
//
// The camera is a USB device with a vendor interface (alternate setting 1) holding one bulk
// IN and one bulk OUT endpoint. Commands are ASCII strings written to OUT; frames stream on IN.

export const USB_VENDOR_ID = 0x0525;
export const USB_PRODUCT_IDS = [0xa4a0, 0xa4a1];

// One frame: 120 × 93 little-endian 16-bit words = 1 header ("param line") row, 90 image
// rows, 2 reference rows. 25 frames per second.
export const WIDTH = 120;
export const IMAGE_ROWS = 90;
export const REF_ROWS = 2;
export const FRAME_WORDS = WIDTH * (1 + IMAGE_ROWS + REF_ROWS);
export const FRAME_BYTES = FRAME_WORDS * 2;
export const FRAME_MARK = 0xaa55; // header row word 0
export const USB_READ_BYTES = 16384;

const ascii = (s: string) => new TextEncoder().encode(s);
export const COMMANDS = {
  startStream: ascii('StartX=1'),
  stopStream: ascii('StopX=1'),
  // Flat-field correction: the shutter closes briefly and the image is re-levelled.
  recalibrate: ascii('DoNUC=1'),
};

export interface CameraHeader {
  deviceName: string; // "CB360" for this camera
  usbVersion: number;
  shutterC: number; // shutter temperature
  lensC: number;
  sensorC: number; // focal-plane array (detector) temperature
  shutterClosed: boolean;
  emissivityRaw: number; // camera setting, units not confirmed yet
}

// Header temperatures use the vendor app's own conversions (OtherUtils.getTemp / getFPATemp).
const round2 = (v: number) => Math.trunc(v * 100) / 100;
const shutterTemp = (x: number) => round2(-4.0235e-11 * x * x * x + 1.218402729e-6 * x * x - 0.018218076216914 * x + 127.361304901973);
const fpaTemp = (x: number) => round2((338180000 - x * 18181.804) / 1e6);

// Parses the header row; null if the frame doesn't start with the frame mark.
export function parseHeader(words: Uint16Array): CameraHeader | null {
  if (words[0] !== FRAME_MARK) return null;
  let name = '';
  for (let i = 4; i <= 8; i++) name += String.fromCharCode(words[i] & 0xff, words[i] >> 8);
  return {
    deviceName: name.slice(0, 5),
    usbVersion: words[1],
    shutterC: shutterTemp(words[9]),
    lensC: shutterTemp(words[10]),
    sensorC: fpaTemp(words[11]),
    shutterClosed: words[12] !== 0,
    emissivityRaw: words[50] & 0xff,
  };
}

export interface ThermalFrame {
  header: CameraHeader;
  // Raw detector counts ("Y16"), WIDTH × IMAGE_ROWS, row-major. Higher = warmer, but the
  // counts-to-°C conversion is in the vendor's closed native library and not reproduced yet.
  y16: Uint16Array;
  at: number;
}

// Reassembles frames from arbitrary-sized USB reads, re-syncing on the frame mark the way the
// vendor's UsbBuffer does: a frame is accepted only if the next one also starts on a mark.
export class FrameAssembler {
  private buf = new Uint8Array(FRAME_BYTES * 4);
  private len = 0;

  push(chunk: Uint8Array): ThermalFrame[] {
    if (this.len + chunk.length > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + chunk.length));
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;
    const frames: ThermalFrame[] = [];
    let pos = 0;
    while (this.len - pos >= FRAME_BYTES + 2) {
      if (this.markAt(pos) && this.markAt(pos + FRAME_BYTES)) {
        const frame = this.decode(pos);
        if (frame) frames.push(frame);
        pos += FRAME_BYTES;
      } else {
        pos += 2; // slide to the next word until we're aligned on a mark again
      }
    }
    this.buf.copyWithin(0, pos, this.len);
    this.len -= pos;
    return frames;
  }

  private markAt(p: number) {
    return (this.buf[p] | (this.buf[p + 1] << 8)) === FRAME_MARK;
  }

  private decode(p: number): ThermalFrame | null {
    const words = new Uint16Array(FRAME_WORDS);
    for (let i = 0; i < FRAME_WORDS; i++) words[i] = this.buf[p + 2 * i] | (this.buf[p + 2 * i + 1] << 8);
    const header = parseHeader(words);
    if (!header) return null;
    return { header, y16: words.slice(WIDTH, WIDTH * (1 + IMAGE_ROWS)), at: Date.now() };
  }
}

export interface FrameStats {
  min: number;
  max: number;
  minAt: number; // pixel index
  maxAt: number;
  center: number;
}

export function frameStats(y16: Uint16Array): FrameStats {
  let min = 65535, max = 0, minAt = 0, maxAt = 0;
  for (let i = 0; i < y16.length; i++) {
    const v = y16[i];
    if (v < min) { min = v; minAt = i; }
    if (v > max) { max = v; maxAt = i; }
  }
  const center = y16[(IMAGE_ROWS >> 1) * WIDTH + (WIDTH >> 1)];
  return { min, max, minAt, maxAt, center };
}
