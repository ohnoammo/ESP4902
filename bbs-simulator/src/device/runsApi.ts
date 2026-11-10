import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { RunDetails, SessionMeta, SimMode } from '../types';
import { DEVICE_ID } from './types';

// Live runs: rows in the Supabase `runs` table. A run holds its time range, settings and
// test notes; its readings stay in `telemetry`. There is no delete policy: "deleting" a
// run sets archived = true, and archived runs are never listed. Folders and ordering are
// kept on the phone (DataContext), not here.

// Flow runs need the migration supabase/migrations/20261106_flow_runs.sql (runs.mode allows
// 'flow', and a vt_l column), applied to ESP4902 on 2026-11-10. On a database without it, set
// this false: flow runs then aren't saved (a clear error) and vt_l isn't selected.
export const FLOW_RUNS_IN_DB = true;

const COLUMNS =
  'id, name, device_id, mode, started_at, ended_at, ended_by, bpm, duty, ie_ratio, firmware, headform, mask, notes, archived' +
  (FLOW_RUNS_IN_DB ? ', vt_l' : '');

const ts = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null;
  const ms = Date.parse(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isNaN(ms) ? null : ms;
};

// Empty strings are stored as null so "no headform" is one value, not two.
const text = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export interface RunRowView extends Omit<SessionMeta, 'folderId'> {
  archived: boolean;
}

export function toRun(r: any): RunRowView {
  const startedAt = ts(r.started_at) ?? Date.now();
  const endedAt = ts(r.ended_at);
  return {
    id: String(r.id),
    name: r.name,
    simulator: {
      name: r.name,
      mode: r.mode === 'free' ? 'free' : r.mode === 'flow' ? 'flow' : 'breath',
      duty: r.duty,
      ...(r.mode === 'flow' ? { vt: r.vt_l ?? null } : {}),
      respiratoryRate: r.bpm ?? null,
      ieRatio: Number(r.ie_ratio) || 1,
    },
    deviceId: r.device_id,
    startedAt,
    endedAt,
    endedBy: r.ended_by ?? null,
    durationSec: Math.max(0, ((endedAt ?? Date.now()) - startedAt) / 1000),
    firmware: r.firmware ?? null,
    headform: r.headform ?? null,
    mask: r.mask ?? null,
    notes: r.notes ?? null,
    archived: !!r.archived,
  };
}

export async function listRuns(): Promise<RunRowView[]> {
  const { data, error } = await getSupabase()
    .from('runs')
    .select(COLUMNS)
    .eq('device_id', DEVICE_ID)
    .eq('archived', false)
    .order('started_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toRun);
}

// The device's run still in progress (at most one, enforced by the database), if any.
export async function findOpenRun(): Promise<RunRowView | null> {
  const { data, error } = await getSupabase()
    .from('runs')
    .select(COLUMNS)
    .eq('device_id', DEVICE_ID)
    .is('ended_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toRun(data) : null;
}

export interface NewRun extends RunDetails {
  name: string;
  startedAt: number;
  mode: SimMode;
  bpm: number | null; // required for breath and flow runs (the database enforces it), null for free
  duty: number; // flow: the twin's peak feed-forward duty
  ieRatio: number | null; // null for free runs
  vt: number | null; // flow runs: tidal volume (L)
  firmware: string | null;
  startCommandId: number | string | null;
}

export async function insertRun(run: NewRun): Promise<RunRowView> {
  if (run.mode === 'flow' && !FLOW_RUNS_IN_DB) {
    throw new Error("flow runs can't be saved until the runs table allows them (migration 20261106_flow_runs)");
  }
  const { data, error } = await getSupabase()
    .from('runs')
    .insert({
      ...(run.mode === 'flow' ? { vt_l: run.vt } : {}),
      name: run.name.trim().slice(0, 40) || 'Run',
      started_at: new Date(run.startedAt).toISOString(),
      mode: run.mode,
      bpm: run.mode === 'free' ? null : run.bpm,
      duty: run.duty,
      ie_ratio: run.mode === 'free' ? null : run.ieRatio,
      firmware: run.firmware,
      headform: text(run.headform),
      mask: text(run.mask),
      notes: text(run.notes),
      start_command_id: run.startCommandId === null ? null : Number(run.startCommandId),
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toRun(data);
}

export interface RunPatch extends Partial<RunDetails> {
  name?: string;
  endedAt?: number;
  endedBy?: 'user' | 'device';
  stopCommandId?: number | string | null;
  archived?: boolean;
}

export async function updateRun(id: string, patch: RunPatch): Promise<RunRowView> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim().slice(0, 40);
  if (patch.headform !== undefined) row.headform = text(patch.headform);
  if (patch.mask !== undefined) row.mask = text(patch.mask);
  if (patch.notes !== undefined) row.notes = text(patch.notes);
  if (patch.endedAt !== undefined) row.ended_at = new Date(patch.endedAt).toISOString();
  if (patch.endedBy !== undefined) row.ended_by = patch.endedBy;
  if (patch.stopCommandId !== undefined) row.stop_command_id = patch.stopCommandId === null ? null : Number(patch.stopCommandId);
  if (patch.archived !== undefined) row.archived = patch.archived;
  const { data, error } = await getSupabase().from('runs').update(row).eq('id', Number(id)).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return toRun(data);
}

// Inserts and updates from any phone, so a run started elsewhere shows up here too.
export function subscribeRuns(onChange: (run: RunRowView) => void): () => void {
  const sb = getSupabase();
  const channel: RealtimeChannel = sb
    .channel(`runs-${DEVICE_ID}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'runs', filter: `device_id=eq.${DEVICE_ID}` }, (p) => {
      if (p.new && 'id' in p.new) onChange(toRun(p.new));
    })
    .subscribe();
  return () => void sb.removeChannel(channel);
}
