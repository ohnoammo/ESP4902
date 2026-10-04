import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppMode, Folder, Phase, Sample, SessionMeta, Simulator } from '../types';
import { BPM_RANGE, DEVICE_ID } from '../device';
import { newId } from '../utils/format';
import { perSecond } from '../utils/telemetry';
import { useDevice } from './DeviceContext';

// Simulator presets are shared by both modes. Runs and folders are kept per mode, under
// separate keys, so demo runs are never stored or listed alongside real ones.
//   demo runs: samples are copied onto the device (the simulation isn't kept anywhere else)
//   live runs: only the time range + settings are kept; readings are fetched from Supabase
//              when the run is opened. (Run metadata moves to a Supabase table once it exists.)
const KEYS = {
  simulators: 'bbs.simulators',
  sessions: (mode: AppMode) => `bbs.${mode}.sessions`,
  folders: (mode: AppMode) => `bbs.${mode}.folders`,
  samples: (id: string) => `bbs.demo.samples.${id}`,
  // Before live mode existed every run was simulated: these move into demo, once.
  legacySessions: 'bbs.sessions',
  legacyFolders: 'bbs.folders',
  legacySamples: (id: string) => `bbs.samples.${id}`,
};

export const DEFAULT_SIMULATORS: Simulator[] = [
  { id: 'sim-adult', name: 'Adult', respiratoryRate: 15, duty: 60, ieRatio: 1 },
  { id: 'sim-elderly', name: 'Elderly', respiratoryRate: 18, duty: 50, ieRatio: 1 },
];

// Simulators saved before blower power existed: keep the name and rate, fix I:E at 1:1.
function migrateSimulator(s: any): Simulator {
  return {
    id: s.id,
    name: s.name,
    respiratoryRate: Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, Math.round(s.respiratoryRate ?? 15))),
    duty: typeof s.duty === 'number' ? s.duty : 60,
    ieRatio: 1,
  };
}

function migrateSession(s: any): SessionMeta {
  const { id: _id, ...simulator } = migrateSimulator({ id: '', ...s.simulator });
  return { ...s, simulator, deviceId: s.deviceId ?? DEVICE_ID };
}

// Demo samples on disk: one row of numbers per second (nulls kept for unmeasured values).
const PHASES: Phase[] = ['idle', 'inhale', 'exhale'];
type Packed = { v: 2; rows: (number | null)[][] };

function packSamples(samples: Sample[]): Packed {
  const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  return {
    v: 2,
    rows: samples.map((s) => [
      s.t,
      r2(s.tidalVolume),
      r2(s.pressure),
      r2(s.temperature),
      Math.round(s.co2Ppm),
      Math.round(s.co2PeakPpm),
      r2(s.humidity),
      Math.round(s.inhaleFan),
      Math.round(s.exhaleFan),
      PHASES.indexOf(s.phase),
    ]),
  };
}

function unpackSamples(raw: any): Sample[] {
  if (raw?.v === 2) {
    return raw.rows.map((r: (number | null)[]) => ({
      t: r[0] as number,
      tidalVolume: r[1],
      pressure: r[2],
      temperature: r[3] as number,
      co2Ppm: r[4] as number,
      co2PeakPpm: r[5] as number,
      humidity: r[6] as number,
      inhaleFan: r[7] as number,
      exhaleFan: r[8] as number,
      phase: PHASES[r[9] as number] ?? 'idle',
    }));
  }
  // Legacy layout [t, tidalVolume, pressure, temperature, co2 %, humidity, inhaleFan, exhaleFan].
  return (raw as number[][]).map((r) => ({
    t: r[0],
    tidalVolume: r[1],
    pressure: r[2],
    temperature: r[3],
    co2Ppm: r[4] * 10000,
    co2PeakPpm: r[4] * 10000,
    humidity: r[5],
    inhaleFan: r[6],
    exhaleFan: r[7],
    phase: 'inhale',
  }));
}

async function migrateLegacyRuns() {
  const [[, sessions], [, folders], [, demo]] = await AsyncStorage.multiGet([
    KEYS.legacySessions,
    KEYS.legacyFolders,
    KEYS.sessions('demo'),
  ]);
  if (!sessions || demo) return;
  const list: SessionMeta[] = JSON.parse(sessions).map(migrateSession);
  for (const s of list) {
    const raw = await AsyncStorage.getItem(KEYS.legacySamples(s.id));
    if (raw) await AsyncStorage.setItem(KEYS.samples(s.id), JSON.stringify(packSamples(unpackSamples(JSON.parse(raw)))));
  }
  await AsyncStorage.multiSet([
    [KEYS.sessions('demo'), JSON.stringify(list)],
    [KEYS.folders('demo'), folders ?? '[]'],
  ]);
  await AsyncStorage.multiRemove([KEYS.legacySessions, KEYS.legacyFolders, ...list.map((s) => KEYS.legacySamples(s.id))]);
}

interface Store {
  mode: AppMode | null; // whose runs these are; null until a mode is chosen
  sessions: SessionMeta[];
  folders: Folder[];
}

interface DataContextValue {
  loaded: boolean;
  simulators: Simulator[];
  sessions: SessionMeta[];
  folders: Folder[];
  addSimulator: (sim: Omit<Simulator, 'id'>) => void;
  deleteSimulator: (id: string) => void;
  resetSimulators: () => void;
  addSession: (meta: SessionMeta, samples: Sample[] | null) => void;
  renameSession: (id: string, name: string) => void;
  deleteSession: (id: string) => void;
  moveSession: (id: string, folderId: string | null) => void;
  reorderSessions: (orderedIds: string[]) => void;
  addFolder: (name: string) => string;
  deleteFolder: (id: string) => void;
  clearAllSessions: () => void;
  loadSamples: (id: string) => Promise<Sample[]>;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { mode, fetchRange } = useDevice();
  const [loaded, setLoaded] = useState(false);
  const [simulators, setSimulators] = useState<Simulator[]>(DEFAULT_SIMULATORS);
  const [store, setStore] = useState<Store>({ mode: null, sessions: [], folders: [] });
  const sampleCache = useRef(new Map<string, Sample[]>());
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    (async () => {
      try {
        await migrateLegacyRuns();
        const s = await AsyncStorage.getItem(KEYS.simulators);
        if (s) setSimulators(JSON.parse(s).map(migrateSimulator));
      } catch {
        // Corrupt or unavailable storage: start from defaults rather than crash.
      }
      setLoaded(true);
    })();
  }, []);

  // Load the chosen mode's runs; nothing is shown from the other mode.
  useEffect(() => {
    sampleCache.current.clear();
    if (!loaded || !mode) {
      setStore({ mode: null, sessions: [], folders: [] });
      return;
    }
    let alive = true;
    AsyncStorage.multiGet([KEYS.sessions(mode), KEYS.folders(mode)])
      .then(([[, r], [, f]]) => {
        if (!alive) return;
        setStore({
          mode,
          sessions: r ? JSON.parse(r).map(migrateSession) : [],
          folders: f ? JSON.parse(f) : [],
        });
      })
      .catch(() => alive && setStore({ mode, sessions: [], folders: [] }));
    return () => {
      alive = false;
    };
  }, [loaded, mode]);

  // Persist after the initial load so defaults never overwrite saved data. Runs are written
  // to the namespace they were loaded from, so switching modes can't cross them over.
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEYS.simulators, JSON.stringify(simulators)).catch(() => {});
  }, [loaded, simulators]);
  useEffect(() => {
    if (!store.mode) return;
    AsyncStorage.multiSet([
      [KEYS.sessions(store.mode), JSON.stringify(store.sessions)],
      [KEYS.folders(store.mode), JSON.stringify(store.folders)],
    ]).catch(() => {});
  }, [store]);

  const update = useCallback((fn: (s: Store) => Partial<Store>) => {
    setStore((prev) => (prev.mode ? { ...prev, ...fn(prev) } : prev));
  }, []);

  const addSimulator = useCallback((sim: Omit<Simulator, 'id'>) => {
    setSimulators((prev) => [...prev, { ...sim, id: newId('sim') }]);
  }, []);

  const deleteSimulator = useCallback((id: string) => {
    setSimulators((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const resetSimulators = useCallback(() => setSimulators(DEFAULT_SIMULATORS), []);

  // `samples` is given for demo runs (stored on the device) and null for live runs.
  const addSession = useCallback(
    (meta: SessionMeta, samples: Sample[] | null) => {
      if (samples) {
        sampleCache.current.set(meta.id, samples);
        AsyncStorage.setItem(KEYS.samples(meta.id), JSON.stringify(packSamples(samples))).catch(() => {});
      }
      update((s) => ({ sessions: [meta, ...s.sessions] }));
    },
    [update]
  );

  const renameSession = useCallback(
    (id: string, name: string) => update((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, name } : x)) })),
    [update]
  );

  const deleteSession = useCallback(
    (id: string) => {
      sampleCache.current.delete(id);
      if (storeRef.current.mode === 'demo') AsyncStorage.removeItem(KEYS.samples(id)).catch(() => {});
      update((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
    },
    [update]
  );

  const moveSession = useCallback(
    (id: string, folderId: string | null) =>
      update((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, folderId } : x)) })),
    [update]
  );

  // Reorders a subset (e.g. one folder's runs) in place: the slots those runs occupy
  // in the global list are refilled in the new order, everything else stays put.
  const reorderSessions = useCallback(
    (orderedIds: string[]) =>
      update((s) => {
        const subset = new Set(orderedIds);
        const byId = new Map(s.sessions.map((x) => [x.id, x]));
        let next = 0;
        return { sessions: s.sessions.map((x) => (subset.has(x.id) ? byId.get(orderedIds[next++])! : x)) };
      }),
    [update]
  );

  const addFolder = useCallback(
    (name: string) => {
      const id = newId('folder');
      update((s) => ({ folders: [...s.folders, { id, name }] }));
      return id;
    },
    [update]
  );

  const deleteFolder = useCallback(
    (id: string) =>
      update((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        sessions: s.sessions.map((x) => (x.folderId === id ? { ...x, folderId: null } : x)),
      })),
    [update]
  );

  const clearAllSessions = useCallback(() => {
    if (storeRef.current.mode === 'demo') {
      AsyncStorage.multiRemove(storeRef.current.sessions.map((s) => KEYS.samples(s.id))).catch(() => {});
    }
    sampleCache.current.clear();
    update(() => ({ sessions: [], folders: [] }));
  }, [update]);

  const loadSamples = useCallback(
    async (id: string) => {
      const cached = sampleCache.current.get(id);
      if (cached) return cached;
      const { mode: m, sessions } = storeRef.current;
      let samples: Sample[];
      if (m === 'live') {
        const run = sessions.find((s) => s.id === id);
        if (!run) return [];
        const rows = await fetchRange(run.startedAt, run.startedAt + run.durationSec * 1000);
        samples = perSecond(rows, run.startedAt);
      } else {
        const raw = await AsyncStorage.getItem(KEYS.samples(id));
        samples = raw ? unpackSamples(JSON.parse(raw)) : [];
      }
      sampleCache.current.set(id, samples);
      return samples;
    },
    [fetchRange]
  );

  const value = useMemo(
    () => ({
      loaded,
      simulators,
      sessions: store.sessions,
      folders: store.folders,
      addSimulator,
      deleteSimulator,
      resetSimulators,
      addSession,
      renameSession,
      deleteSession,
      moveSession,
      reorderSessions,
      addFolder,
      deleteFolder,
      clearAllSessions,
      loadSamples,
    }),
    [
      loaded,
      simulators,
      store,
      addSimulator,
      deleteSimulator,
      resetSimulators,
      addSession,
      renameSession,
      deleteSession,
      moveSession,
      reorderSessions,
      addFolder,
      deleteFolder,
      clearAllSessions,
      loadSamples,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
