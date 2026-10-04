import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Folder, Sample, SessionMeta, Simulator } from '../types';
import { CSV_COLUMNS } from '../constants/sensors';
import { newId } from '../utils/format';

// Everything is saved on the device. Run metadata lives in one small index key;
// each run's samples get their own key so listing sessions never loads sensor data.
const KEYS = {
  simulators: 'bbs.simulators',
  sessions: 'bbs.sessions',
  folders: 'bbs.folders',
  samples: (id: string) => `bbs.samples.${id}`,
};

export const DEFAULT_SIMULATORS: Simulator[] = [
  { id: 'sim-adult', name: 'Adult', tidalVolume: 500, respiratoryRate: 15, ieRatio: 2 },
  { id: 'sim-elderly', name: 'Elderly', tidalVolume: 400, respiratoryRate: 18, ieRatio: 2 },
];

const FIELDS = CSV_COLUMNS.map((c) => c.field);

function packSamples(samples: Sample[]): number[][] {
  return samples.map((s) => FIELDS.map((f) => Math.round(s[f] * 100) / 100));
}

function unpackSamples(rows: number[][]): Sample[] {
  return rows.map((row) => Object.fromEntries(FIELDS.map((f, i) => [f, row[i]])) as unknown as Sample);
}

interface DataContextValue {
  loaded: boolean;
  simulators: Simulator[];
  sessions: SessionMeta[];
  folders: Folder[];
  addSimulator: (sim: Omit<Simulator, 'id'>) => void;
  deleteSimulator: (id: string) => void;
  resetSimulators: () => void;
  addSession: (meta: SessionMeta, samples: Sample[]) => void;
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
  const [loaded, setLoaded] = useState(false);
  const [simulators, setSimulators] = useState<Simulator[]>(DEFAULT_SIMULATORS);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const sampleCache = useRef(new Map<string, Sample[]>());

  useEffect(() => {
    (async () => {
      try {
        const [s, r, f] = await AsyncStorage.multiGet([KEYS.simulators, KEYS.sessions, KEYS.folders]);
        if (s[1]) setSimulators(JSON.parse(s[1]));
        if (r[1]) setSessions(JSON.parse(r[1]));
        if (f[1]) setFolders(JSON.parse(f[1]));
      } catch {
        // Corrupt or unavailable storage: start from defaults rather than crash.
      }
      setLoaded(true);
    })();
  }, []);

  // Persist after the initial load so defaults never overwrite saved data.
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEYS.simulators, JSON.stringify(simulators)).catch(() => {});
  }, [loaded, simulators]);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEYS.sessions, JSON.stringify(sessions)).catch(() => {});
  }, [loaded, sessions]);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEYS.folders, JSON.stringify(folders)).catch(() => {});
  }, [loaded, folders]);

  const addSimulator = useCallback((sim: Omit<Simulator, 'id'>) => {
    setSimulators((prev) => [...prev, { ...sim, id: newId('sim') }]);
  }, []);

  const deleteSimulator = useCallback((id: string) => {
    setSimulators((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const resetSimulators = useCallback(() => setSimulators(DEFAULT_SIMULATORS), []);

  const addSession = useCallback((meta: SessionMeta, samples: Sample[]) => {
    sampleCache.current.set(meta.id, samples);
    AsyncStorage.setItem(KEYS.samples(meta.id), JSON.stringify(packSamples(samples))).catch(() => {});
    setSessions((prev) => [meta, ...prev]);
  }, []);

  const renameSession = useCallback((id: string, name: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);

  const deleteSession = useCallback((id: string) => {
    sampleCache.current.delete(id);
    AsyncStorage.removeItem(KEYS.samples(id)).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const moveSession = useCallback((id: string, folderId: string | null) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, folderId } : s)));
  }, []);

  // Reorders a subset (e.g. one folder's runs) in place: the slots those runs occupy
  // in the global list are refilled in the new order, everything else stays put.
  const reorderSessions = useCallback((orderedIds: string[]) => {
    setSessions((prev) => {
      const subset = new Set(orderedIds);
      const byId = new Map(prev.map((s) => [s.id, s]));
      let next = 0;
      return prev.map((s) => (subset.has(s.id) ? byId.get(orderedIds[next++])! : s));
    });
  }, []);

  const addFolder = useCallback((name: string) => {
    const id = newId('folder');
    setFolders((prev) => [...prev, { id, name }]);
    return id;
  }, []);

  const deleteFolder = useCallback((id: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setSessions((prev) => prev.map((s) => (s.folderId === id ? { ...s, folderId: null } : s)));
  }, []);

  const clearAllSessions = useCallback(() => {
    setSessions((prev) => {
      AsyncStorage.multiRemove(prev.map((s) => KEYS.samples(s.id))).catch(() => {});
      return [];
    });
    sampleCache.current.clear();
    setFolders([]);
  }, []);

  const loadSamples = useCallback(async (id: string) => {
    const cached = sampleCache.current.get(id);
    if (cached) return cached;
    const raw = await AsyncStorage.getItem(KEYS.samples(id));
    const samples = raw ? unpackSamples(JSON.parse(raw)) : [];
    sampleCache.current.set(id, samples);
    return samples;
  }, []);

  const value = useMemo(
    () => ({
      loaded,
      simulators,
      sessions,
      folders,
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
      sessions,
      folders,
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
