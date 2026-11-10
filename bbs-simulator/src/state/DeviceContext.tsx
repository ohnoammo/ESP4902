import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Backend,
  CommandName,
  CommandRecord,
  createBackend,
  DeviceStatus,
  StartParams,
  TelemetryRow,
} from '../device';
import { AppMode } from '../types';

// One connection to the device, live (Supabase) or demo. Device state is read from the
// device's own reports, never inferred from commands:
//   online  = device_status.last_seen within ONLINE_WINDOW_MS (heartbeat every 5 s)
//   running = the newest telemetry row's phase is not 'idle'
// Telemetry arrives ~10 rows/s; rows are queued and merged into the rolling buffer on a
// RENDER_MS tick, so the UI re-renders ~3 times a second rather than once per row.

const BUFFER_SEC = 60;
const RENDER_MS = 333;
const ONLINE_WINDOW_MS = 15000;
// With no rows for this long the newest phase is out of date (the failsafe stops a run
// ~10 s after the device loses the network), so "running" is reported as unknown.
const STALE_MS = 15000;

type ConnStatus = 'idle' | 'connecting' | 'connected' | 'failed';

interface DeviceContextValue {
  mode: AppMode | null;
  status: ConnStatus;
  progress: number;
  error: string | null; // why connecting failed, or a live-update problem
  connect: (mode: AppMode) => Promise<boolean>;
  disconnect: () => void;
  deviceStatus: DeviceStatus | null;
  online: boolean;
  latest: TelemetryRow | null; // newest row by sampled_at
  stale: boolean; // no fresh telemetry: the running state is unknown
  running: boolean; // latest phase isn't idle (and the data is fresh)
  buffer: React.MutableRefObject<TelemetryRow[]>; // last BUFFER_SEC, oldest first
  version: number; // changes whenever `buffer` does
  commands: Record<string, CommandRecord>;
  sendCommand: (command: CommandName, params: StartParams | Record<string, never>) => Promise<CommandRecord>;
  refreshCommand: (id: CommandRecord['id']) => Promise<void>;
  fetchRange: (fromMs: number, toMs: number) => Promise<TelemetryRow[]>;
}

const DeviceContext = createContext<DeviceContextValue | undefined>(undefined);

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppMode | null>(null);
  const [status, setStatus] = useState<ConnStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [latest, setLatest] = useState<TelemetryRow | null>(null);
  const [version, setVersion] = useState(0);
  const [commands, setCommands] = useState<Record<string, CommandRecord>>({});
  const [now, setNow] = useState(Date.now());

  const backend = useRef<Backend | null>(null);
  const buffer = useRef<TelemetryRow[]>([]);
  const queue = useRef<TelemetryRow[]>([]);
  const seen = useRef(new Set<TelemetryRow['id']>());
  const newest = useRef<TelemetryRow | null>(null);

  // Merge queued rows into the buffer at most every RENDER_MS.
  useEffect(() => {
    if (status !== 'connected') return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (!queue.current.length) return;
      const incoming = queue.current;
      queue.current = [];
      for (const r of incoming) {
        if (seen.current.has(r.id)) continue;
        seen.current.add(r.id);
        buffer.current.push(r);
        if (!newest.current || r.sampledAt >= newest.current.sampledAt) newest.current = r;
      }
      buffer.current.sort((a, b) => a.sampledAt - b.sampledAt);
      const cutoff = (newest.current?.sampledAt ?? Date.now()) - BUFFER_SEC * 1000;
      const firstKept = buffer.current.findIndex((r) => r.sampledAt >= cutoff);
      if (firstKept > 0) {
        for (const r of buffer.current.slice(0, firstKept)) seen.current.delete(r.id);
        buffer.current = buffer.current.slice(firstKept);
      }
      setLatest(newest.current);
      setVersion((v) => v + 1);
    }, RENDER_MS);
    return () => clearInterval(id);
  }, [status]);

  const reset = () => {
    buffer.current = [];
    queue.current = [];
    seen.current = new Set();
    newest.current = null;
    setLatest(null);
    setDeviceStatus(null);
    setCommands({});
    setError(null);
  };

  const connect = useCallback(async (m: AppMode) => {
    backend.current?.close();
    reset();
    setMode(m);
    setStatus('connecting');
    setProgress(0);
    const b = createBackend(m);
    backend.current = b;
    try {
      await b.open(
        {
          onTelemetry: (rows) => queue.current.push(...rows),
          onStatus: setDeviceStatus,
          onCommand: (c) => setCommands((prev) => ({ ...prev, [String(c.id)]: c })),
          onError: setError,
        },
        BUFFER_SEC,
        setProgress
      );
      if (backend.current !== b) return false; // superseded by another connect/disconnect
      setStatus('connected');
      return true;
    } catch (e) {
      b.close();
      if (backend.current === b) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('failed');
      }
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    backend.current?.close();
    backend.current = null;
    reset();
    setMode(null);
    setStatus('idle');
    setProgress(0);
  }, []);

  useEffect(() => () => backend.current?.close(), []);

  const sendCommand = useCallback<DeviceContextValue['sendCommand']>(async (command, params) => {
    if (!backend.current) throw new Error('Not connected to the device.');
    const record = await backend.current.sendCommand(command, params);
    // A Realtime update may already have arrived with a newer status; keep that one.
    setCommands((prev) => (prev[String(record.id)] ? prev : { ...prev, [String(record.id)]: record }));
    return record;
  }, []);

  const refreshCommand = useCallback(async (id: CommandRecord['id']) => {
    const fresh = await backend.current?.getCommand(id).catch(() => null);
    if (fresh) setCommands((prev) => ({ ...prev, [String(fresh.id)]: fresh }));
  }, []);

  const fetchRange = useCallback(async (fromMs: number, toMs: number) => {
    if (!backend.current) throw new Error('Not connected to the device.');
    return backend.current.fetchRange(fromMs, toMs);
  }, []);

  const online = !!deviceStatus?.lastSeen && now - deviceStatus.lastSeen <= ONLINE_WINDOW_MS;
  const stale = !latest || now - latest.sampledAt > STALE_MS;
  const running = !!latest && !stale && latest.phase !== 'idle';

  const value = useMemo(
    () => ({
      mode,
      status,
      progress,
      error,
      connect,
      disconnect,
      deviceStatus,
      online,
      latest,
      stale,
      running,
      buffer,
      version,
      commands,
      sendCommand,
      refreshCommand,
      fetchRange,
    }),
    [mode, status, progress, error, connect, disconnect, deviceStatus, online, latest, stale, running, version, commands, sendCommand, refreshCommand, fetchRange]
  );
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice() {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice must be used within DeviceProvider');
  return ctx;
}
