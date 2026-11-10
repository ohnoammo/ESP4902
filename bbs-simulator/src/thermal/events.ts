// A timestamped log of alerts and of when the camera was streaming. Runs pick out the events
// inside their own start–end window (eventsIn), so this works for live and demo runs alike and
// lets a run say whether the camera was watching at all. Kept on this phone, per mode.
export interface ThermalEvent {
  id: string; // uuid, also the Supabase row id
  kind: 'leak' | 'high' | 'low' | 'camera';
  start: number; // epoch ms
  end: number | null; // null while still going
  // Worst value while it lasted: leak → rise above resting level in °C; high → warmest °C;
  // low → coolest °C. null without a calibration, and for 'camera'.
  peak: number | null;
  // The picture when an alert started (BMP data URI), like the CB360 app's alarm photo. Kept on
  // this phone for the most recent alerts only (see MAX_SNAPSHOTS), never uploaded.
  snapshot?: string;
}

export const MAX_SNAPSHOTS = 20;

export function uuid(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export function eventsIn(events: ThermalEvent[], start: number, end: number) {
  return events.filter((e) => e.start <= end && (e.end ?? Infinity) >= start);
}

// Short label for a run's event list and the CSV.
export const EVENT_LABEL: Record<ThermalEvent['kind'], string> = {
  leak: 'Possible leak',
  high: 'High temperature alarm',
  low: 'Low temperature alarm',
  camera: 'Camera watching',
};

// What was going on in second t of a run (startedAt + t s), for the CSV.
export function eventsAt(events: ThermalEvent[], ms: number) {
  const active = events.filter((e) => e.start <= ms + 999 && (e.end ?? Infinity) >= ms);
  return {
    watching: active.some((e) => e.kind === 'camera'),
    alerts: active.filter((e) => e.kind !== 'camera').map((e) => e.kind),
  };
}
