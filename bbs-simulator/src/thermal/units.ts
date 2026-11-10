import { formatNumber } from '../utils/format';

// Temperature unit, as in the CB360 app's settings. Everything is stored in °C; this is display only.
export type TempUnit = 'C' | 'F' | 'K';

export const UNIT_LABEL: Record<TempUnit, string> = { C: '°C', F: '°F', K: 'K' };

export const fromC = (c: number, u: TempUnit) => (u === 'F' ? c * 1.8 + 32 : u === 'K' ? c + 273.15 : c);
export const toC = (v: number, u: TempUnit) => (u === 'F' ? (v - 32) / 1.8 : u === 'K' ? v - 273.15 : v);

export const fmtTemp = (c: number, u: TempUnit, decimals = 1) => `${formatNumber(fromC(c, u), decimals)} ${UNIT_LABEL[u]}`;

// A temperature difference (no offset, only the scale).
export const fmtRise = (dc: number, u: TempUnit, decimals = 1) => `${formatNumber(u === 'F' ? dc * 1.8 : dc, decimals)} ${UNIT_LABEL[u]}`;
