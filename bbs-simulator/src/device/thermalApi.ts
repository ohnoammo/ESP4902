import { getSupabase, supabaseConfigured } from '../lib/supabase';
import { ThermalEvent } from '../thermal/events';
import { DEVICE_ID } from './types';

// Live mode's thermal events in the Supabase `thermal_events` table, so every phone sees them
// on a run's page. Same access as `runs`: read, insert, update, no delete. An event is written
// when it starts (ended_at null) and again when it ends. Alert pictures stay on the phone.

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export async function saveThermalEvent(e: ThermalEvent): Promise<void> {
  if (!supabaseConfigured) return;
  const { error } = await getSupabase()
    .from('thermal_events')
    .upsert({ id: e.id, device_id: DEVICE_ID, kind: e.kind, started_at: iso(e.start), ended_at: iso(e.end), peak: e.peak });
  if (error) throw new Error(error.message);
}

// Events overlapping a run's time window.
export async function fetchThermalEvents(start: number, end: number): Promise<ThermalEvent[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await getSupabase()
    .from('thermal_events')
    .select('id, kind, started_at, ended_at, peak')
    .eq('device_id', DEVICE_ID)
    .lte('started_at', iso(end))
    .or(`ended_at.is.null,ended_at.gte.${iso(start)}`)
    .order('started_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    start: Date.parse(r.started_at),
    end: r.ended_at ? Date.parse(r.ended_at) : null,
    peak: r.peak ?? null,
  }));
}

// The phone's own events win (they carry the alarm picture); others' fill in the rest.
export function mergeEvents(local: ThermalEvent[], remote: ThermalEvent[]): ThermalEvent[] {
  const ids = new Set(local.map((e) => e.id));
  return [...local, ...remote.filter((e) => !ids.has(e.id))].sort((a, b) => a.start - b.start);
}
