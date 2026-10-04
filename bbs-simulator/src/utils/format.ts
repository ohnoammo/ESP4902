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

// "22 Sep · 8 min"
export function formatRunMeta(startedAt: number, durationSec: number): string {
  const d = new Date(startedAt);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${formatDuration(durationSec)}`;
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
