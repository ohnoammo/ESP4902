import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RunDetails, Simulator } from '../types';
import { CommandRecord, CommandStatus, DEVICE_ID, validateStart } from '../device';
import { findOpenRun, insertRun, RunRowView, updateRun } from '../device/runsApi';
import { formatTimeSgt, newId } from '../utils/format';
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
//
// Live runs are rows in the Supabase `runs` table: inserted (ended_at null) when recording
// begins, completed when it ends. On connect, a run left open (app closed mid-run) is
// resumed if the device is still running, or closed at the first idle row if it isn't.

export const NO_RESPONSE_MS = 10000;
// Allow for the device clock being slightly behind the phone's when matching rows to a Start.
const CLOCK_SLACK_MS = 2000;

interface ActiveRun {
  simulator: Simulator;
  startedAt: number; // sampled_at of the first non-idle row
  details: RunDetails;
  runId: string | null; // live: the `runs` row, once inserted
}

interface SentCommand {
  id: CommandRecord['id'];
  sentAt: number; // phone time, for the no-response timer
  simulator?: Simulator; // for starts
  details?: RunDetails;
}

export type CommandOutcome = CommandStatus | 'no-response';

export interface Notice {
  text: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface RunContextValue {
  active: ActiveRun | null;
  elapsed: number; // seconds
  pendingStart: SentCommand | null; // sent, recording hasn't begun yet
  startOutcome: CommandOutcome | null; // of the latest start, for the Ready screen
  startError: string | null; // validation or database error for the latest start
  notice: Notice | null; // stop outcomes and run endings, shown app-wide
  lastEnded: { sessionId: string; byDevice: boolean } | null;
  lastDetails: RunDetails; // prefilled for the next run (tests usually repeat a setup)
  start: (sim: Simulator, details: RunDetails) => Promise<void>;
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

const NO_DETAILS: RunDetails = { headform: null, mask: null, notes: null };

export function RunProvider({ children }: { children: React.ReactNode }) {
  const { addSession, applyRun } = useData();
  const {
    mode,
    status,
    buffer,
    version,
    latest,
    stale,
    running,
    commands,
    online,
    deviceStatus,
    sendCommand,
    refreshCommand,
    fetchRange,
  } = useDevice();
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pendingStart, setPendingStart] = useState<SentCommand | null>(null);
  const [lastStart, setLastStart] = useState<SentCommand | null>(null);
  const [lastStop, setLastStop] = useState<SentCommand | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastEnded, setLastEnded] = useState<RunContextValue['lastEnded']>(null);
  const [lastDetails, setLastDetails] = useState<RunDetails>(NO_DETAILS);
  const [now, setNow] = useState(Date.now());
  const activeRef = useRef(active);
  activeRef.current = active;
  const saving = useRef(false);
  // The in-flight insert of the live run row, so ending a run can wait for its id.
  const inserting = useRef<Promise<string | null> | null>(null);
  const recovered = useRef(false);

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
    inserting.current = null;
    recovered.current = false;
  }, [mode]);

  // Live: create the `runs` row as soon as recording begins.
  const beginLiveRun = useCallback(
    (run: ActiveRun, startCommandId: CommandRecord['id'] | null) => {
      const { simulator: sim, details } = run;
      inserting.current = insertRun({
        name: sim.name,
        startedAt: run.startedAt,
        bpm: Math.round(sim.respiratoryRate),
        duty: Math.round(sim.duty),
        ieRatio: sim.ieRatio,
        firmware: deviceStatus?.firmware ?? null,
        startCommandId,
        ...details,
      })
        .then((row) => {
          applyRun(row);
          setActive((a) => (a && a.startedAt === run.startedAt ? { ...a, runId: row.id } : a));
          return row.id;
        })
        .catch((e) => {
          setNotice({ text: `Couldn't save this run to Supabase: ${errorText(e)}. Recording continues.`, tone: 'error' });
          return null;
        });
    },
    [applyRun, deviceStatus]
  );

  const save = useCallback(
    async (endAt: number, byDevice: boolean, stopCommandId: CommandRecord['id'] | null = null) => {
      const run = activeRef.current;
      if (!run || saving.current) return null;
      saving.current = true;
      try {
        const endedBy = byDevice ? ('device' as const) : ('user' as const);
        let id: string | null;
        if (mode === 'live') {
          id = run.runId ?? (await inserting.current) ?? null;
          if (id) {
            try {
              applyRun(await updateRun(id, { endedAt: endAt, endedBy, stopCommandId }));
            } catch (e) {
              setNotice({ text: `Couldn't record the end of this run in Supabase: ${errorText(e)}`, tone: 'error' });
            }
          }
        } else {
          // Demo readings exist only in memory, so they are copied onto the phone.
          const { id: _id, ...simulator } = run.simulator;
          id = newId('run');
          addSession(
            {
              id,
              name: simulator.name,
              simulator,
              deviceId: DEVICE_ID,
              startedAt: run.startedAt,
              endedAt: endAt,
              endedBy,
              durationSec: Math.max(0, (endAt - run.startedAt) / 1000),
              firmware: deviceStatus?.firmware ?? null,
              folderId: null,
              ...run.details,
            },
            perSecond(await fetchRange(run.startedAt, endAt), run.startedAt)
          );
        }
        setActive(null);
        inserting.current = null;
        if (id) setLastEnded({ sessionId: id, byDevice });
        return id;
      } finally {
        saving.current = false;
      }
    },
    [addSession, applyRun, deviceStatus, fetchRange, mode]
  );

  // Live: once connected and the telemetry is loaded, deal with a run left open earlier.
  useEffect(() => {
    if (mode !== 'live' || status !== 'connected' || version === 0 || recovered.current) return;
    recovered.current = true;
    (async () => {
      try {
        const open = await findOpenRun();
        if (!open || activeRef.current) return;
        const { simulator, startedAt, id, headform, mask, notes } = open;
        if (running) {
          // Still breathing: carry on recording it.
          setActive({ simulator: { id: `run-${id}`, ...simulator }, startedAt, details: { headform, mask, notes }, runId: id });
          inserting.current = Promise.resolve(id);
          setNotice({ text: `Resumed recording "${open.name}", which was still running.`, tone: 'info' });
          return;
        }
        // Not running: it ended while the app was away. Close it where the device went idle.
        const rows = await fetchRange(startedAt, Date.now());
        const end = rows.find((r) => r.sampledAt > startedAt && r.phase === 'idle')?.sampledAt ?? rows[rows.length - 1]?.sampledAt ?? startedAt;
        applyRun(await updateRun(id, { endedAt: end, endedBy: 'device' }));
        setNotice({ text: `"${open.name}" was left open; it ended at ${formatTimeSgt(end)} SGT when the device went idle.`, tone: 'info' });
      } catch (e) {
        setNotice({ text: `Couldn't check for an unfinished run: ${errorText(e)}`, tone: 'warning' });
      }
    })();
  }, [mode, status, version, running, fetchRange, applyRun]);

  // Follow the telemetry: begin recording when a started device goes non-idle, end it
  // when the device reports idle.
  useEffect(() => {
    const rows = buffer.current;
    if (pendingStart && !active) {
      const first = rows.find((r) => r.phase !== 'idle' && r.sampledAt >= pendingStart.sentAt - CLOCK_SLACK_MS);
      if (first) {
        const run: ActiveRun = {
          simulator: pendingStart.simulator!,
          startedAt: first.sampledAt,
          details: pendingStart.details ?? NO_DETAILS,
          runId: null,
        };
        setActive(run);
        setElapsed(0);
        setPendingStart(null);
        if (mode === 'live') beginLiveRun(run, pendingStart.id);
        return;
      }
      const s = commands[String(pendingStart.id)]?.status;
      if (s === 'error' || s === 'expired') setPendingStart(null);
    }
    if (active && latest && !stale && latest.phase === 'idle' && latest.sampledAt > active.startedAt) {
      const firstIdle = rows.find((r) => r.sampledAt > active.startedAt && r.phase === 'idle');
      void save(firstIdle?.sampledAt ?? latest.sampledAt, true).then((id) => {
        if (id) setNotice({ text: 'The device stopped, so the run ended and was saved.', tone: 'info' });
      });
    }
  }, [version, latest, stale, pendingStart, active, commands, buffer, save, mode, beginLiveRun]);

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
    async (sim: Simulator, details: RunDetails) => {
      setStartError(null);
      setLastDetails(details);
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
        const sent = { id: record.id, sentAt: Date.now(), simulator: sim, details };
        setLastStart(sent);
        setPendingStart(sent);
        setLastEnded(null);
      } catch (e) {
        setStartError(errorText(e));
      }
    },
    [online, sendCommand]
  );

  const sendStop = useCallback(async (): Promise<CommandRecord['id'] | null> => {
    try {
      const record = await sendCommand('stop', {});
      setLastStop({ id: record.id, sentAt: Date.now() });
      return record.id;
    } catch (e) {
      setNotice({ text: `Stop failed: ${errorText(e)}`, tone: 'error' });
      return null;
    }
  }, [sendCommand]);

  const stop = useCallback(async () => {
    setPendingStart(null);
    const stopId = await sendStop();
    if (!activeRef.current) return null;
    // Recording ends now; if the device keeps going, the Stop notice says so.
    return save(Math.max(latest?.sampledAt ?? 0, Date.now()), false, stopId);
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
      lastDetails,
      start,
      stop,
      stopDevice: async () => {
        await sendStop();
      },
      dismissNotice: () => setNotice(null),
    }),
    [active, elapsed, pendingStart, startOutcome, startError, notice, lastEnded, lastDetails, start, stop, sendStop]
  );
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRun() {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRun must be used within RunProvider');
  return ctx;
}

export type { RunRowView };
