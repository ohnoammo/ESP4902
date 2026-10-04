import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Sample, Simulator } from '../types';
import { device, Reading } from '../device';
import { newId } from '../utils/format';
import { useData } from './DataContext';

// A run keeps recording no matter which screen is open; only Stop (or losing the
// device) ends it. Readings arrive from the device whenever it sends them; the run
// stores one Sample per second using the latest value of each field.

interface ActiveRun {
  simulator: Simulator;
  startedAt: number;
}

export interface LivePoint {
  t: number; // seconds since the run started
  v: number; // mL
}

type SensorValues = Omit<Sample, 't'>;

const EMPTY: SensorValues = {
  tidalVolume: 0,
  pressure: 0,
  temperature: 0,
  co2: 0,
  humidity: 0,
  inhaleFan: 0,
  exhaleFan: 0,
};

const LIVE_WINDOW_SEC = 12;

interface RunContextValue {
  active: ActiveRun | null;
  elapsed: number; // seconds
  latest: Sample | null;
  // Recent `volume` readings for the live waveform (read on every animation frame).
  live: React.MutableRefObject<LivePoint[]>;
  start: (sim: Simulator) => Promise<void>;
  stop: () => Promise<string | null>; // returns saved session id
}

const RunContext = createContext<RunContextValue | undefined>(undefined);

export function RunProvider({ children }: { children: React.ReactNode }) {
  const { addSession } = useData();
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [latest, setLatest] = useState<Sample | null>(null);
  const samples = useRef<Sample[]>([]);
  const current = useRef<SensorValues>({ ...EMPTY });
  const received = useRef(false);
  const live = useRef<LivePoint[]>([]);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(
    () =>
      device.onReading((r: Reading) => {
        const run = activeRef.current;
        if (!run) return;
        const { volume, ...sensors } = r;
        if (Object.keys(sensors).length) {
          Object.assign(current.current, sensors);
          received.current = true;
        }
        if (volume !== undefined) {
          const t = (Date.now() - run.startedAt) / 1000;
          live.current.push({ t, v: volume });
          while (live.current.length && live.current[0].t < t - LIVE_WINDOW_SEC) live.current.shift();
        }
      }),
    []
  );

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const t = (Date.now() - active.startedAt) / 1000;
      setElapsed(t);
      // One stored sample per elapsed second, once the device has sent any sensor data.
      if (!received.current) return;
      while (samples.current.length <= Math.floor(t)) {
        const sample = { t: samples.current.length, ...current.current };
        samples.current.push(sample);
        setLatest(sample);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [active]);

  const save = useCallback(() => {
    const run = activeRef.current;
    if (!run) return null;
    const durationSec = (Date.now() - run.startedAt) / 1000;
    const { id: _id, ...simulator } = run.simulator;
    const id = newId('run');
    addSession(
      { id, name: simulator.name, simulator, startedAt: run.startedAt, durationSec, folderId: null },
      samples.current
    );
    setActive(null);
    setLatest(null);
    return id;
  }, [addSession]);

  // If the device drops mid-run, keep what was recorded.
  useEffect(() => device.onConnectionLost(() => void save()), [save]);

  const start = useCallback(async (sim: Simulator) => {
    samples.current = [];
    current.current = { ...EMPTY };
    received.current = false;
    live.current = [];
    setLatest(null);
    setElapsed(0);
    await device.start(sim);
    setActive({ simulator: sim, startedAt: Date.now() });
  }, []);

  const stop = useCallback(async () => {
    if (!activeRef.current) return null;
    try {
      await device.stop();
    } catch {
      // Already disconnected; still save the recording.
    }
    return save();
  }, [save]);

  const value = useMemo(
    () => ({ active, elapsed, latest, live, start, stop }),
    [active, elapsed, latest, start, stop]
  );
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRun() {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRun must be used within RunProvider');
  return ctx;
}
