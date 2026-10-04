import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Simulator } from '../types';
import { CommandRecord, CommandStatus, DEVICE_ID, validateStart } from '../device';
import { newId } from '../utils/format';
import { perSecond } from '../utils/telemetry';
import { useData } from './DataContext';
import { useDevice } from './DeviceContext';

// A run is the stretch of telemetry between the device starting and stopping. The app
// never assumes the device state from its own commands:
//   - Start inserts a 'start' command; recording begins at the first non-idle row.
//   - The run ends when a row reports 'idle' (Stop, or the device's failsafe ~10 s after
//     a network loss), or when the user presses Stop, whichever comes first.
// Commands are followed through pending -> done | error | expired via Realtime; one still
// pending after NO_RESPONSE_MS is reported as "No response from device".

export const NO_RESPONSE_MS = 10000;
// Allow for the device clock being slightly behind the phone's when matching rows to a Start.
const CLOCK_SLACK_MS = 2000;

interface ActiveRun {
  simulator: Simulator;
  startedAt: number; // sampled_at of the first non-idle row
}

interface SentCommand {
  id: CommandRecord['id'];
  sentAt: number; // phone time, for the no-response timer
  simulator?: Simulator; // for starts
}

export type CommandOutcome = CommandStatus | 'no-response';

export interface Notice {
  text: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

interface RunContextValue {
  active: ActiveRun | null;
  elapsed: number; // seconds
  pendingStart: SentCommand | null; // sent, recording hasn't begun yet
  startOutcome: CommandOutcome | null; // of the latest start, for the Ready screen
  startError: string | null; // validation or database error for the latest start
  notice: Notice | null; // stop outcomes and run endings, shown app-wide
  lastEnded: { sessionId: string; byDevice: boolean } | null;
  start: (sim: Simulator) => Promise<void>;
  stop: () => Promise<string | null>; // ends recording; returns the saved session id
  stopDevice: () => Promise<void>; // stop with no recording (device started elsewhere)
  dismissNotice: () => void;
}

const RunContext = createContext<RunContextValue | undefined>(undefined);

// Status of a sent command, with "no-response" once it has been pending too long.
export function outcomeOf(cmd: CommandRecord | undefined, sentAt: number, now: number): CommandOutcome {
  const status = cmd?.status ?? 'pending';
  if (status === 'pending' && now - sentAt > NO_RESPONSE_MS) return 'no-response';
  return status;
}

export function RunProvider({ children }: { children: React.ReactNode }) {
  const { addSession } = useData();
  const { mode, buffer, version, latest, stale, commands, online, sendCommand, refreshCommand, fetchRange } = useDevice();
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pendingStart, setPendingStart] = useState<SentCommand | null>(null);
  const [lastStart, setLastStart] = useState<SentCommand | null>(null);
  const [lastStop, setLastStop] = useState<SentCommand | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastEnded, setLastEnded] = useState<RunContextValue['lastEnded']>(null);
  const [now, setNow] = useState(Date.now());
  const activeRef = useRef(active);
  activeRef.current = active;
  const saving = useRef(false);

  // Clock for the elapsed time and the no-response timers.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (active) setElapsed(Math.max(0, (now - active.startedAt) / 1000));
  }, [now, active]);

  // Leaving the mode (disconnect) drops anything in flight.
  useEffect(() => {
    setActive(null);
    setPendingStart(null);
    setLastStart(null);
    setLastStop(null);
    setStartError(null);
    setNotice(null);
    setLastEnded(null);
  }, [mode]);

  const save = useCallback(
    async (endAt: number, byDevice: boolean) => {
      const run = activeRef.current;
      if (!run || saving.current) return null;
      saving.current = true;
      try {
        const { id: _id, ...simulator } = run.simulator;
        const id = newId('run');
        const meta = {
          id,
          name: simulator.name,
          simulator,
          deviceId: DEVICE_ID,
          startedAt: run.startedAt,
          durationSec: Math.max(0, (endAt - run.startedAt) / 1000),
          folderId: null,
        };
        // Demo readings exist only in memory, so they are copied; live ones stay in Supabase.
        const samples = mode === 'demo' ? perSecond(await fetchRange(run.startedAt, endAt), run.startedAt) : null;
        addSession(meta, samples);
        setActive(null);
        setLastEnded({ sessionId: id, byDevice });
        return id;
      } finally {
        saving.current = false;
      }
    },
    [addSession, fetchRange, mode]
  );

  // Follow the telemetry: begin recording when a started device goes non-idle, end it
  // when the device reports idle.
  useEffect(() => {
    const rows = buffer.current;
    if (pendingStart && !active) {
      const first = rows.find((r) => r.phase !== 'idle' && r.sampledAt >= pendingStart.sentAt - CLOCK_SLACK_MS);
      if (first) {
        setActive({ simulator: pendingStart.simulator!, startedAt: first.sampledAt });
        setElapsed(0);
        setPendingStart(null);
        return;
      }
      const status = commands[String(pendingStart.id)]?.status;
      if (status === 'error' || status === 'expired') setPendingStart(null);
    }
    if (active && latest && !stale && latest.phase === 'idle' && latest.sampledAt > active.startedAt) {
      const firstIdle = rows.find((r) => r.sampledAt > active.startedAt && r.phase === 'idle');
      void save(firstIdle?.sampledAt ?? latest.sampledAt, true).then((id) => {
        if (id) setNotice({ text: 'The device stopped, so the run ended and was saved.', tone: 'info' });
      });
    }
  }, [version, latest, stale, pendingStart, active, commands, buffer, save]);

  // Re-read a command once if it is still pending at the no-response deadline, in case
  // a Realtime update was missed.
  const refreshed = useRef(new Set<string>());
  useEffect(() => {
    for (const c of [lastStart, lastStop]) {
      if (!c || refreshed.current.has(String(c.id))) continue;
      if (commands[String(c.id)]?.status === 'pending' && now - c.sentAt > NO_RESPONSE_MS) {
        refreshed.current.add(String(c.id));
        void refreshCommand(c.id);
      }
    }
  }, [now, lastStart, lastStop, commands, refreshCommand]);

  // Report the outcome of the latest Stop app-wide (the user has usually moved on).
  const stopOutcome = lastStop ? outcomeOf(commands[String(lastStop.id)], lastStop.sentAt, now) : null;
  useEffect(() => {
    if (!stopOutcome) return;
    const text: Record<CommandOutcome, Notice | null> = {
      pending: { text: 'Stopping… waiting for the device.', tone: 'info' },
      done: { text: 'The device confirmed Stop.', tone: 'success' },
      error: { text: "The device didn't recognise Stop. Check it and try again.", tone: 'error' },
      expired: { text: 'Stop expired before the device received it. Press Stop again.', tone: 'error' },
      'no-response': { text: 'No response from device. It stops by itself ~10 s after losing the network.', tone: 'warning' },
    };
    setNotice(text[stopOutcome]);
  }, [stopOutcome]);

  const start = useCallback(
    async (sim: Simulator) => {
      setStartError(null);
      const params = { bpm: Math.round(sim.respiratoryRate), duty: Math.round(sim.duty) };
      const invalid = validateStart(params);
      if (invalid) {
        setStartError(invalid);
        return;
      }
      if (!online) {
        setStartError('The device is offline, so it can’t be started.');
        return;
      }
      try {
        const record = await sendCommand('start', params);
        const sent = { id: record.id, sentAt: Date.now(), simulator: sim };
        setLastStart(sent);
        setPendingStart(sent);
        setLastEnded(null);
      } catch (e) {
        setStartError(e instanceof Error ? e.message : String(e));
      }
    },
    [online, sendCommand]
  );

  const sendStop = useCallback(async () => {
    try {
      const record = await sendCommand('stop', {});
      setLastStop({ id: record.id, sentAt: Date.now() });
    } catch (e) {
      setNotice({ text: `Stop failed: ${e instanceof Error ? e.message : String(e)}`, tone: 'error' });
    }
  }, [sendCommand]);

  const stop = useCallback(async () => {
    setPendingStart(null);
    await sendStop();
    if (!activeRef.current) return null;
    // Recording ends now; if the device keeps going, the Stop notice says so.
    return save(Math.max(latest?.sampledAt ?? 0, Date.now()), false);
  }, [sendStop, save, latest]);

  const startOutcome = lastStart ? outcomeOf(commands[String(lastStart.id)], lastStart.sentAt, now) : null;

  const value = useMemo(
    () => ({
      active,
      elapsed,
      pendingStart,
      startOutcome,
      startError,
      notice,
      lastEnded,
      start,
      stop,
      stopDevice: sendStop,
      dismissNotice: () => setNotice(null),
    }),
    [active, elapsed, pendingStart, startOutcome, startError, notice, lastEnded, start, stop, sendStop]
  );
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRun() {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRun must be used within RunProvider');
  return ctx;
}
