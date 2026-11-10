import { IMAGE_ROWS, WIDTH } from './protocol';
import { PALETTES, Palette } from './palettes';

export type { Palette };

// Lookup tables decoded once from the hex strings: 256 × RGB.
const LUTS = Object.fromEntries(
  PALETTES.map((p) => {
    const lut = new Uint8Array(768);
    for (let i = 0; i < 768; i++) lut[i] = parseInt(p.rgb.slice(i * 2, i * 2 + 2), 16);
    return [p.key, lut];
  })
) as Record<Palette, Uint8Array>;

export function paletteColor(palette: Palette, t: number): string {
  const lut = LUTS[palette];
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
  return `rgb(${lut[i]},${lut[i + 1]},${lut[i + 2]})`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) out += B64[bytes[i] >> 2] + B64[(bytes[i] & 3) << 4] + '==';
  else if (rest === 2) {
    const n = (bytes[i] << 8) | bytes[i + 1];
    out += B64[n >> 10] + B64[(n >> 4) & 63] + B64[(n << 2) & 63] + '=';
  }
  return out;
}

// Isotherm (the CB360's "equal line"): pixels at or above `counts` are painted one flat colour,
// so everything warmer than a set temperature stands out.
export interface Isotherm {
  counts: number;
  rgb: [number, number, number];
}

export type Rotation = 0 | 90 | 180 | 270; // clockwise

// The picture as shown: size and mapping between camera pixels and view pixels for a rotation.
export interface View {
  w: number;
  h: number;
  toView(x: number, y: number): [number, number]; // camera pixel -> view pixel
  fromView(vx: number, vy: number): [number, number]; // view pixel -> camera pixel
}
export function makeView(rot: Rotation, W: number = WIDTH, H: number = IMAGE_ROWS): View {
  const side = rot === 90 || rot === 270;
  return {
    w: side ? H : W,
    h: side ? W : H,
    toView: (x, y) =>
      rot === 90 ? [H - 1 - y, x] : rot === 180 ? [W - 1 - x, H - 1 - y] : rot === 270 ? [y, W - 1 - x] : [x, y],
    fromView: (vx, vy) =>
      rot === 90 ? [vy, H - 1 - vx] : rot === 180 ? [W - 1 - vx, H - 1 - vy] : rot === 270 ? [W - 1 - vy, vx] : [vx, vy],
  };
}

// Raw counts → a 24-bit BMP (a format every platform's <Image> can show), stretched between
// min and max so the full palette is used. The frame is rotated first; with `scale` > 1 it is
// enlarged by bilinear interpolation of the COUNTS (before colouring), which smooths the
// 120 × 90 sensor's blocks without inventing detail.
export function frameToBmp(
  y16: Uint16Array,
  min: number,
  max: number,
  palette: Palette,
  iso?: Isotherm | null,
  rot: Rotation = 0,
  scale = 1
): Uint8Array {
  const lut = LUTS[palette];
  const view = makeView(rot);
  // Rotate into view order.
  const src = new Float32Array(view.w * view.h);
  for (let vy = 0; vy < view.h; vy++)
    for (let vx = 0; vx < view.w; vx++) {
      const [x, y] = view.fromView(vx, vy);
      src[vy * view.w + vx] = y16[y * WIDTH + x];
    }
  const ow = view.w * scale;
  const oh = view.h * scale;
  const rowBytes = (ow * 3 + 3) & ~3; // BMP rows pad to 4 bytes
  const dataSize = rowBytes * oh;
  const bmp = new Uint8Array(54 + dataSize);
  const dv = new DataView(bmp.buffer);
  bmp[0] = 0x42; bmp[1] = 0x4d;
  dv.setUint32(2, bmp.length, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, ow, true);
  dv.setInt32(22, -oh, true); // negative height = rows stored top-down
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, dataSize, true);
  const span = Math.max(1, max - min);
  for (let oy = 0; oy < oh; oy++) {
    // Sample position in view pixels (pixel centres line up at any scale).
    const fy = Math.min(view.h - 1, Math.max(0, (oy + 0.5) / scale - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(view.h - 1, y0 + 1);
    const ty = fy - y0;
    for (let ox = 0; ox < ow; ox++) {
      const fx = Math.min(view.w - 1, Math.max(0, (ox + 0.5) / scale - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(view.w - 1, x0 + 1);
      const tx = fx - x0;
      const top = src[y0 * view.w + x0] * (1 - tx) + src[y0 * view.w + x1] * tx;
      const bot = src[y1 * view.w + x0] * (1 - tx) + src[y1 * view.w + x1] * tx;
      const c = top * (1 - ty) + bot * ty;
      const o = 54 + oy * rowBytes + ox * 3;
      if (iso && c >= iso.counts) {
        bmp[o] = iso.rgb[2]; // BMP pixels are BGR
        bmp[o + 1] = iso.rgb[1];
        bmp[o + 2] = iso.rgb[0];
        continue;
      }
      const v = Math.max(0, Math.min(255, Math.round(((c - min) / span) * 255))) * 3;
      bmp[o] = lut[v + 2];
      bmp[o + 1] = lut[v + 1];
      bmp[o + 2] = lut[v];
    }
  }
  return bmp;
}

export const bmpToDataUri = (bmp: Uint8Array) => `data:image/bmp;base64,${base64(bmp)}`;

export const frameToDataUri = (y16: Uint16Array, min: number, max: number, palette: Palette, iso?: Isotherm | null, rot: Rotation = 0) =>
  bmpToDataUri(frameToBmp(y16, min, max, palette, iso, rot));
