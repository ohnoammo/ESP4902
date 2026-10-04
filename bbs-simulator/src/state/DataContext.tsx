import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppMode, Folder, Phase, RunDetails, Sample, SessionMeta, Simulator } from '../types';
import { BPM_RANGE, DEVICE_ID } from '../device';
import { listRuns, RunPatch, RunRowView, subscribeRuns, updateRun } from '../device/runsApi';
import { newId } from '../utils/format';
import { perSecond } from '../utils/telemetry';
import { useDevice } from './DeviceContext';

// Simulator presets are shared by both modes. Runs and folders are kept per mode, so demo
// runs are never stored or listed alongside real ones.
//   demo runs: stored on the phone, samples included (the simulation isn't kept anywhere else)
//   live runs: rows in the Supabase `runs` table (see device/runsApi.ts); readings are fetched
//              from `telemetry` when a run is opened. Folders and ordering stay on the phone.
const KEYS = {
  simulators: 'bbs.simulators',
  sessions: (mode: AppMode) => `bbs.${mode}.sessions`,
  folders: (mode: AppMode) => `bbs.${mode}.folders`,
  layout: 'bbs.live.layout', // phone-side order and folders of live runs
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
  return {
    headform: null,
    mask: null,
    notes: null,
    firmware: null,
    endedBy: 'user',
    ...s,
    endedAt: s.endedAt ?? s.startedAt + s.durationSec * 1000,
    simulator,
    deviceId: s.deviceId ?? DEVICE_ID,
  };
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

// Phone-side organisation of live runs (the runs table has no folders or ordering).
interface Layout {
  order: string[]; // run ids, top first; runs not listed here go on top, newest first
  folderOf: Record<string, string>; // run id -> folder id
}
const EMPTY_LAYOUT: Layout = { order: [], folderOf: {} };

interface Store {
  mode: AppMode | null; // whose runs these are; null until a mode is chosen
  sessions: SessionMeta[]; // demo runs (live runs come from Supabase)
  folders: Folder[];
  layout: Layout; // live only
}

interface DataContextValue {
  loaded: boolean;
  simulators: Simulator[];
  sessions: SessionMeta[];
  folders: Folder[];
  syncError: string | null; // last failed write to Supabase
  addSimulator: (sim: Omit<Simulator, 'id'>) => void;
  deleteSimulator: (id: string) => void;
  resetSimulators: () => void;
  addSession: (meta: SessionMeta, samples: Sample[]) => void; // demo runs
  applyRun: (run: RunRowView) => void; // a live run row just written by this phone
  renameSession: (id: string, name: string) => void;
  updateDetails: (id: string, details: RunDetails) => Promise<void>;
  deleteSession: (id: string) => void; // live: archives the run
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
  const [store, setStore] = useState<Store>({ mode: null, sessions: [], folders: [], layout: EMPTY_LAYOUT });
  const [remote, setRemote] = useState<RunRowView[]>([]); // live runs from Supabase
  const [syncError, setSyncError] = useState<string | null>(null);
  const sampleCache = useRef(new Map<string, Sample[]>());

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
    setRemote([]);
    setSyncError(null);
    if (!loaded || !mode) {
      setStore({ mode: null, sessions: [], folders: [], layout: EMPTY_LAYOUT });
      return;
    }
    let alive = true;
    AsyncStorage.multiGet([KEYS.sessions(mode), KEYS.folders(mode), KEYS.layout])
      .then(([[, r], [, f], [, l]]) => {
        if (!alive) return;
        setStore({
          mode,
          sessions: mode === 'demo' && r ? JSON.parse(r).map(migrateSession) : [],
          folders: f ? JSON.parse(f) : [],
          layout: mode === 'live' && l ? { ...EMPTY_LAYOUT, ...JSON.parse(l) } : EMPTY_LAYOUT,
        });
      })
      .catch(() => alive && setStore({ mode, sessions: [], folders: [], layout: EMPTY_LAYOUT }));
    if (mode !== 'live') {
      return () => {
        alive = false;
      };
    }
    // Live runs: the list from Supabase, then every insert/update via Realtime.
    listRuns()
      .then((runs) => alive && setRemote(runs))
      .catch((e) => alive && setSyncError(`Couldn't load runs: ${e instanceof Error ? e.message : String(e)}`));
    const unsubscribe = subscribeRuns((run) => alive && upsert(setRemote, run));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [loaded, mode]);

  // Persist after the initial load so defaults never overwrite saved data. Everything is
  // written to the namespace it was loaded from, so switching modes can't cross them over.
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEYS.simulators, JSON.stringify(simulators)).catch(() => {});
  }, [loaded, simulators]);
  useEffect(() => {
    if (store.mode === 'demo') {
      AsyncStorage.multiSet([
        [KEYS.sessions('demo'), JSON.stringify(store.sessions)],
        [KEYS.folders('demo'), JSON.stringify(store.folders)],
      ]).catch(() => {});
    } else if (store.mode === 'live') {
      AsyncStorage.multiSet([
        [KEYS.folders('live'), JSON.stringify(store.folders)],
        [KEYS.layout, JSON.stringify(store.layout)],
      ]).catch(() => {});
    }
  }, [store]);

  const update = useCallback((fn: (s: Store) => Partial<Store>) => {
    setStore((prev) => (prev.mode ? { ...prev, ...fn(prev) } : prev));
  }, []);

  // What the Sessions list shows. Live: non-archived rows in the phone's order (new runs on
  // top, newest first), with the phone's folder assignments.
  const sessions = useMemo<SessionMeta[]>(() => {
    if (store.mode !== 'live') return store.sessions;
    const visible = remote.filter((r) => !r.archived);
    const byId = new Map(visible.map((r) => [r.id, r]));
    const placed = new Set(store.layout.order);
    const fresh = visible.filter((r) => !placed.has(r.id)).sort((a, b) => b.startedAt - a.startedAt);
    const ordered = store.layout.order.map((id) => byId.get(id)).filter((r): r is RunRowView => !!r);
    return [...fresh, ...ordered].map(({ archived: _a, ...r }) => ({ ...r, folderId: store.layout.folderOf[r.id] ?? null }));
  }, [store, remote]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const modeRef = useRef(store.mode);
  modeRef.current = store.mode;

  // Write to Supabase; on failure, report it and reload the list so the screen shows the truth.
  const writeRun = useCallback(async (id: string, patch: RunPatch) => {
    try {
      const row = await updateRun(id, patch);
      upsert(setRemote, row);
      setSyncError(null);
    } catch (e) {
      setSyncError(`Couldn't save to Supabase: ${e instanceof Error ? e.message : String(e)}`);
      listRuns().then(setRemote).catch(() => {});
      throw e;
    }
  }, []);

  const addSimulator = useCallback((sim: Omit<Simulator, 'id'>) => {
    setSimulators((prev) => [...prev, { ...sim, id: newId('sim') }]);
  }, []);

  const deleteSimulator = useCallback((id: string) => {
    setSimulators((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const resetSimulators = useCallback(() => setSimulators(DEFAULT_SIMULATORS), []);

  const addSession = useCallback(
    (meta: SessionMeta, samples: Sample[]) => {
      sampleCache.current.set(meta.id, samples);
      AsyncStorage.setItem(KEYS.samples(meta.id), JSON.stringify(packSamples(samples))).catch(() => {});
      update((s) => ({ sessions: [meta, ...s.sessions] }));
    },
    [update]
  );

  const applyRun = useCallback((run: RunRowView) => {
    sampleCache.current.delete(run.id); // its time range may have changed
    upsert(setRemote, run);
  }, []);

  const renameSession = useCallback(
    (id: string, name: string) => {
      if (modeRef.current === 'live') {
        upsert(setRemote, { ...findRemote(sessionsRef.current, id), name });
        void writeRun(id, { name }).catch(() => {});
      } else {
        update((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, name } : x)) }));
      }
    },
    [update, writeRun]
  );

  const updateDetails = useCallback(
    async (id: string, details: RunDetails) => {
      if (modeRef.current === 'live') {
        await writeRun(id, details);
      } else {
        update((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...details } : x)) }));
      }
    },
    [update, writeRun]
  );

  const deleteSession = useCallback(
    (id: string) => {
      sampleCache.current.delete(id);
      if (modeRef.current === 'live') {
        // No deletes in Supabase: archive it, which hides it everywhere.
        setRemote((prev) => prev.filter((r) => r.id !== id));
        void writeRun(id, { archived: true }).catch(() => {});
      } else {
        AsyncStorage.removeItem(KEYS.samples(id)).catch(() => {});
        update((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
      }
    },
    [update, writeRun]
  );

  const moveSession = useCallback(
    (id: string, folderId: string | null) => {
      if (modeRef.current === 'live') {
        update((s) => {
          const folderOf = { ...s.layout.folderOf };
          if (folderId) folderOf[id] = folderId;
          else delete folderOf[id];
          return { layout: { ...s.layout, folderOf } };
        });
      } else {
        update((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, folderId } : x)) }));
      }
    },
    [update]
  );

  // Reorders a subset (e.g. one folder's runs) in place: the slots those runs occupy
  // in the global list are refilled in the new order, everything else stays put.
  const reorderSessions = useCallback(
    (orderedIds: string[]) => {
      const subset = new Set(orderedIds);
      const refill = <T,>(list: T[], idOf: (x: T) => string, byId: Map<string, T>) => {
        let next = 0;
        return list.map((x) => (subset.has(idOf(x)) ? byId.get(orderedIds[next++])! : x));
      };
      if (modeRef.current === 'live') {
        const ids = sessionsRef.current.map((x) => x.id);
        update((s) => ({ layout: { ...s.layout, order: refill(ids, (x) => x, new Map(ids.map((x) => [x, x]))) } }));
      } else {
        update((s) => ({ sessions: refill(s.sessions, (x) => x.id, new Map(s.sessions.map((x) => [x.id, x]))) }));
      }
    },
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
        layout: {
          ...s.layout,
          folderOf: Object.fromEntries(Object.entries(s.layout.folderOf).filter(([, f]) => f !== id)),
        },
      })),
    [update]
  );

  const clearAllSessions = useCallback(() => {
    sampleCache.current.clear();
    if (modeRef.current === 'live') {
      const ids = sessionsRef.current.map((x) => x.id);
      setRemote([]);
      update(() => ({ folders: [], layout: EMPTY_LAYOUT }));
      void Promise.all(ids.map((id) => writeRun(id, { archived: true }))).catch(() => {});
    } else {
      AsyncStorage.multiRemove(sessionsRef.current.map((s) => KEYS.samples(s.id))).catch(() => {});
      update(() => ({ sessions: [], folders: [] }));
    }
  }, [update, writeRun]);

  const loadSamples = useCallback(
    async (id: string) => {
      const cached = sampleCache.current.get(id);
      if (cached) return cached;
      let samples: Sample[];
      if (modeRef.current === 'live') {
        const run = sessionsRef.current.find((s) => s.id === id);
        if (!run) return [];
        const rows = await fetchRange(run.startedAt, run.endedAt ?? Date.now());
        samples = perSecond(rows, run.startedAt);
        if (run.endedAt === null) return samples; // still recording: don't cache a partial run
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
      sessions,
      folders: store.folders,
      syncError,
      addSimulator,
      deleteSimulator,
      resetSimulators,
      addSession,
      applyRun,
      renameSession,
      updateDetails,
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
      sessions,
      store.folders,
      syncError,
      addSimulator,
      deleteSimulator,
      resetSimulators,
      addSession,
      applyRun,
      renameSession,
      updateDetails,
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

function upsert(set: React.Dispatch<React.SetStateAction<RunRowView[]>>, run: RunRowView) {
  set((prev) => {
    const i = prev.findIndex((r) => r.id === run.id);
    if (i === -1) return [run, ...prev];
    const next = prev.slice();
    next[i] = run;
    return next;
  });
}

function findRemote(sessions: SessionMeta[], id: string): RunRowView {
  const { folderId: _f, ...run } = sessions.find((s) => s.id === id)!;
  return { ...run, archived: false };
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
