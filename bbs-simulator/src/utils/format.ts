const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatClock(totalSec: number): string {
  const s = Math.floor(totalSec);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// "8:20" style axis label.
export function formatAxis(totalSec: number): string {
  const s = Math.round(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDuration(totalSec: number): string {
  if (totalSec < 60) return `${Math.max(1, Math.round(totalSec))} s`;
  return `${Math.round(totalSec / 60)} min`;
}

// All times are shown in Singapore time whatever the phone's zone. Singapore has no
// daylight saving, so a fixed +8 h offset is exact and avoids relying on Intl time zones.
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const sgt = (ms: number) => new Date(ms + SGT_OFFSET_MS); // read with getUTC*()
const pad2 = (n: number) => String(n).padStart(2, '0');

// "22 Sep"
export function formatDateSgt(ms: number): string {
  const d = sgt(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// "14:05:09"
export function formatTimeSgt(ms: number): string {
  const d = sgt(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

// "2026-09-22 14:05:09.300" for CSV export.
export function formatTimestampSgt(ms: number): string {
  const d = sgt(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${formatTimeSgt(ms)}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
}

// "22 Sep · 8 min", or "22 Sep · recording" for a run that hasn't ended.
export function formatRunMeta(run: { startedAt: number; durationSec: number; endedAt: number | null }): string {
  return `${formatDateSgt(run.startedAt)} · ${run.endedAt === null ? 'recording' : formatDuration(run.durationSec)}`;
}

export function formatRatio(ie: number): string {
  return `1:${Number.isInteger(ie) ? ie : ie.toFixed(1)}`;
}

export function formatNumber(v: number, decimals: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
