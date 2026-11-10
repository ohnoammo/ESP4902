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

// Raw counts → a 24-bit BMP (a format every platform's <Image> can show), stretched between
// min and max so the full palette is used.
export function frameToBmp(y16: Uint16Array, min: number, max: number, palette: Palette, iso?: Isotherm | null): Uint8Array {
  const lut = LUTS[palette];
  const rowBytes = WIDTH * 3; // 360, already a multiple of 4
  const dataSize = rowBytes * IMAGE_ROWS;
  const bmp = new Uint8Array(54 + dataSize);
  const dv = new DataView(bmp.buffer);
  bmp[0] = 0x42; bmp[1] = 0x4d;
  dv.setUint32(2, bmp.length, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, WIDTH, true);
  dv.setInt32(22, -IMAGE_ROWS, true); // negative height = rows stored top-down
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, dataSize, true);
  const span = Math.max(1, max - min);
  for (let i = 0; i < y16.length; i++) {
    const o = 54 + i * 3;
    if (iso && y16[i] >= iso.counts) {
      bmp[o] = iso.rgb[2]; // BMP pixels are BGR
      bmp[o + 1] = iso.rgb[1];
      bmp[o + 2] = iso.rgb[0];
      continue;
    }
    const v = Math.max(0, Math.min(255, Math.round(((y16[i] - min) / span) * 255))) * 3;
    bmp[o] = lut[v + 2];
    bmp[o + 1] = lut[v + 1];
    bmp[o + 2] = lut[v];
  }
  return bmp;
}

export const bmpToDataUri = (bmp: Uint8Array) => `data:image/bmp;base64,${base64(bmp)}`;

export const frameToDataUri = (y16: Uint16Array, min: number, max: number, palette: Palette, iso?: Isotherm | null) =>
  bmpToDataUri(frameToBmp(y16, min, max, palette, iso));
