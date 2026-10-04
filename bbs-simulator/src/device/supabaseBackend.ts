import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { Phase } from '../types';
import { Backend, CommandRecord, DEVICE_ID, DeviceStatus, TelemetryRow } from './types';

// The real device, through the ESP4902 Supabase project: it writes `telemetry` and
// `device_status` and acks `commands`; the app reads those via Realtime and inserts commands.

const TELEMETRY_COLUMNS = 'id, sampled_at, phase, rpm_inhale, rpm_exhale, co2_ppm, temp_c, rh_pct';
const PAGE = 1000; // PostgREST's default row cap per request
const SUBSCRIBE_TIMEOUT_MS = 8000;

// Postgres timestamps come back as "2026-10-04T18:22:07.781+00:00" from the REST API but
// can arrive as "2026-10-04 18:22:07.781+00" over Realtime; normalise before parsing.
function parseTs(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const iso = v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function toPhase(v: unknown): Phase {
  return v === 'inhale' || v === 'exhale' ? v : 'idle';
}

function toTelemetry(r: any): TelemetryRow | null {
  const sampledAt = parseTs(r.sampled_at);
  if (sampledAt === null) return null;
  return {
    id: r.id,
    sampledAt,
    phase: toPhase(r.phase),
    rpmInhale: Number(r.rpm_inhale) || 0,
    rpmExhale: Number(r.rpm_exhale) || 0,
    co2Ppm: Number(r.co2_ppm) || 0,
    tempC: Number(r.temp_c) || 0,
    rhPct: Number(r.rh_pct) || 0,
  };
}

function toStatus(r: any): DeviceStatus {
  return {
    deviceId: r.device_id,
    lastSeen: parseTs(r.last_seen),
    firmware: r.firmware ?? null,
    wifiRssi: r.wifi_rssi ?? null,
  };
}

function toCommand(r: any): CommandRecord {
  return {
    id: r.id,
    command: r.command,
    params: r.params ?? {},
    status: r.status,
    createdAt: parseTs(r.created_at) ?? Date.now(),
    ackedAt: parseTs(r.acked_at),
  };
}

export function createSupabaseBackend(): Backend {
  let channel: RealtimeChannel | null = null;

  return {
    kind: 'live',

    async open(handlers, historySec, onProgress) {
      const sb = getSupabase();
      const filter = `device_id=eq.${DEVICE_ID}`;

      // Subscribe first, then load history, so no row can fall in the gap between the two.
      // Overlaps are harmless: the device context drops rows it has already seen.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out connecting to Supabase Realtime.')), SUBSCRIBE_TIMEOUT_MS);
        let settled = false;
        channel = sb
          .channel(`device-${DEVICE_ID}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry', filter }, (p) => {
            const row = toTelemetry(p.new);
            if (row) handlers.onTelemetry([row]);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'device_status', filter }, (p) => {
            if (p.new && 'device_id' in p.new) handlers.onStatus(toStatus(p.new));
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'commands', filter }, (p) => {
            if (p.new && 'id' in p.new) handlers.onCommand(toCommand(p.new));
          })
          .subscribe((status, err) => {
            if (status === 'SUBSCRIBED' && !settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(new Error(err?.message ?? `Realtime ${status.toLowerCase().replace('_', ' ')}`));
              } else {
                handlers.onError('Live updates were interrupted. Reconnecting…');
              }
            }
          });
      });
      onProgress(0.4);

      const status = await sb.from('device_status').select('*').eq('device_id', DEVICE_ID).maybeSingle();
      if (status.error) throw new Error(status.error.message);
      if (status.data) handlers.onStatus(toStatus(status.data));
      onProgress(0.6);

      // The newest row, however old, tells us the current phase even if nothing arrived lately.
      const [latest, recent] = await Promise.all([
        sb.from('telemetry').select(TELEMETRY_COLUMNS).eq('device_id', DEVICE_ID).order('sampled_at', { ascending: false }).limit(1),
        sb
          .from('telemetry')
          .select(TELEMETRY_COLUMNS)
          .eq('device_id', DEVICE_ID)
          .gte('sampled_at', new Date(Date.now() - historySec * 1000).toISOString())
          .order('sampled_at', { ascending: true })
          .limit(PAGE),
      ]);
      if (latest.error) throw new Error(latest.error.message);
      if (recent.error) throw new Error(recent.error.message);
      const rows = [...(latest.data ?? []), ...(recent.data ?? [])].map(toTelemetry).filter((r): r is TelemetryRow => !!r);
      handlers.onTelemetry(rows);
      onProgress(1);
    },

    close() {
      if (channel) void getSupabase().removeChannel(channel);
      channel = null;
    },

    async sendCommand(command, params) {
      // device_id and status come from the database defaults.
      const { data, error } = await getSupabase().from('commands').insert({ command, params }).select().single();
      if (error) throw new Error(error.message);
      return toCommand(data);
    },

    async getCommand(id) {
      const { data, error } = await getSupabase().from('commands').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toCommand(data) : null;
    },

    async fetchRange(fromMs, toMs) {
      const sb = getSupabase();
      const out: TelemetryRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await sb
          .from('telemetry')
          .select(TELEMETRY_COLUMNS)
          .eq('device_id', DEVICE_ID)
          .gte('sampled_at', new Date(fromMs).toISOString())
          .lte('sampled_at', new Date(toMs).toISOString())
          .order('sampled_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) {
          const row = toTelemetry(r);
          if (row) out.push(row);
        }
        if (!data || data.length < PAGE) break;
      }
      return out;
    },
  };
}
