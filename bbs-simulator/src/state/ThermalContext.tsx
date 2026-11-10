import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDevice } from './DeviceContext';
import { FrameStats, ThermalFrame, frameStats } from '../thermal/protocol';
import { Calibration, Hotspot, LeakDetector, RECOMMENDED, centreCounts, countsPerC, toCelsius } from '../thermal/detect';
import { DemoThermalSource, ThermalSource, WebUsbSource, findCb360, watchCb360 } from '../thermal/source';
import { Palette, frameToDataUri } from '../thermal/render';
import { MAX_SNAPSHOTS, ThermalEvent, uuid } from '../thermal/events';
import { TempUnit, fmtRise, fmtTemp } from '../thermal/units';
import { saveThermalEvent } from '../device/thermalApi';

export { eventsIn } from '../thermal/events';
export type { ThermalEvent } from '../thermal/events';

// The thermal camera lives here, not in its screen, so leak and temperature alerts keep
// working (and show on the live run) after you leave the camera page.

export interface ThermalSettings {
  palette: Palette;
  leakOn: boolean;
  leakThreshold: number; // raw counts above the resting level (slider; see RECOMMENDED)
  // High/low alarms, as in the CB360 app (same defaults: off, 120 °C and −20 °C).
  highOn: boolean;
  high: number;
  lowOn: boolean;
  low: number;
  unit: TempUnit; // display only; everything is stored in °C
  // Isotherm: paint everything at or above isoC in one colour (needs a calibration).
  isoOn: boolean;
  isoC: number;
}

const DEFAULTS: ThermalSettings = { palette: 'ironRed', leakOn: true, leakThreshold: 150, highOn: false, high: 120, lowOn: false, low: -20, unit: 'C', isoOn: false, isoC: 36 }; // isotherm just above skin temperature
const SETTINGS_KEY = 'thermal.settings';
const calKey = (mode: string) => `thermal.calibration.${mode}`;
const eventsKey = (mode: string) => `thermal.events.${mode}`;
const MAX_EVENTS = 1000; // oldest dropped first
// The simulated camera's own scale (its background is 7000 counts at 23 °C, face 7900 at 34 °C).
const DEMO_CALIBRATION: Calibration = { a: { counts: 7000, c: 23 }, b: { counts: 7900, c: 34 }, at: 0 };

// Snapshots for the screen are published at most this often; detection runs on every frame.
const PUBLISH_MS = 125;
const LEAK_CLEAR_MS = 3000; // a leak alert stays up this long after the last hotspot
const RENOTIFY_MS = 10000; // vibrate/beep again if an alert is still active after this long
const STALL_MS = 2000; // connected but no frame for this long = no input

export type ThermalStatus = 'idle' | 'connecting' | 'live' | 'error';

// Whether there's a usable picture: 'none' = not connected; 'stalled' = connected but no frames;
// 'wrongDevice' = frames whose header doesn't name a CB360.
export type ThermalInput = 'ok' | 'none' | 'stalled' | 'wrongDevice';

export interface ThermalAlert {
  kind: 'leak' | 'high' | 'low';
  text: string;
  since: number;
}

export interface ThermalSnapshot {
  frame: ThermalFrame;
  stats: FrameStats;
  hotspot: Hotspot | null;
  fps: number;
}

interface ThermalValue {
  status: ThermalStatus;
  input: ThermalInput;
  // A CB360 is plugged in and already allowed in this browser (live mode; always true in demo).
  present: boolean;
  error: string | null;
  snapshot: ThermalSnapshot | null;
  settings: ThermalSettings;
  calibration: Calibration | null;
  events: ThermalEvent[]; // oldest first; ones still going have end: null
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  recalibrateShutter: () => void;
  updateSettings: (patch: Partial<ThermalSettings>) => void;
  // Counts under the crosshair right now, for a calibration point (null with no picture).
  sampleCentre: () => number | null;
  saveCalibration: (cal: Calibration) => void;
  clearCalibration: () => void;
}

const ThermalCtx = createContext<ThermalValue | null>(null);
// Alerts on their own context so screens that only show alerts don't redraw with every frame.
const AlertCtx = createContext<ThermalAlert | null>(null);

export function ThermalProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useDevice();
  const demo = mode === 'demo';
  const [status, setStatus] = useState<ThermalStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ThermalSnapshot | null>(null);
  const [settings, setSettings] = useState<ThermalSettings>(DEFAULTS);
  const [storedCal, setStoredCal] = useState<Calibration | null>(null);
  const [alert, setAlert] = useState<ThermalAlert | null>(null);
  const [events, setEvents] = useState<ThermalEvent[]>([]);
  const [input, setInput] = useState<ThermalInput>('none');
  const [present, setPresent] = useState(false);
  const lastFrameAt = useRef(0);
  const openAlert = useRef<ThermalEvent | null>(null);
  const openCamera = useRef<ThermalEvent | null>(null);
  const alertKind = useRef<ThermalAlert['kind'] | null>(null);
  alertKind.current = alert?.kind ?? null;
  const calibration = demo ? storedCal ?? DEMO_CALIBRATION : storedCal;

  const source = useRef<ThermalSource | null>(null);
  const detector = useRef(new LeakDetector());
  const latest = useRef<{ frame: ThermalFrame; hotspot: Hotspot | null } | null>(null);
  const lastHotspotAt = useRef(0);
  const frames = useRef({ n: 0, since: Date.now(), fps: 0 });
  // The frame callback reads current settings and calibration without restarting the stream.
  const live = useRef({ settings, calibration });
  live.current = { settings, calibration };

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((s) => {
        if (!s) return;
        const saved = JSON.parse(s);
        // Settings saved before the slider had a named sensitivity: map it to its threshold.
        const named = RECOMMENDED.find((r) => r.key === saved.sensitivity);
        if (named && saved.leakThreshold === undefined) saved.leakThreshold = named.counts;
        setSettings({ ...DEFAULTS, ...saved });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setStoredCal(null);
    setEvents([]);
    // Events still open belong to the previous mode's log; don't carry them over.
    openAlert.current = null;
    openCamera.current = null;
    if (!mode) return;
    AsyncStorage.multiGet([calKey(mode), eventsKey(mode)])
      .then(([[, cal], [, ev]]) => {
        if (cal) setStoredCal(JSON.parse(cal));
        // Events saved before they had ids get one now (needed to sync them to Supabase).
        if (ev) setEvents((JSON.parse(ev) as ThermalEvent[]).map((e) => (e.id ? e : { ...e, id: uuid() })));
      })
      .catch(() => {});
  }, [mode]);

  // Live mode: every event also goes to Supabase (when it starts and when it ends), so other
  // phones see it on the run's page. A failed write is retried at the next save of that event.
  const sync = useCallback(
    (e: ThermalEvent) => {
      if (mode !== 'live') return;
      saveThermalEvent(e).catch((err) => console.warn('thermal event sync failed', err));
    },
    [mode]
  );

  const logEvent = useCallback(
    (e: ThermalEvent) => {
      setEvents((prev) => {
        const next = [...prev, e].slice(-MAX_EVENTS);
        // Pictures are large: keep them on the most recent alerts only.
        let kept = 0;
        for (let i = next.length - 1; i >= 0; i--) {
          if (!next[i].snapshot) continue;
          if (++kept > MAX_SNAPSHOTS) next[i] = { ...next[i], snapshot: undefined };
        }
        if (mode) AsyncStorage.setItem(eventsKey(mode), JSON.stringify(next)).catch(() => {});
        return next;
      });
      sync(e);
    },
    [mode, sync]
  );

  // An alert opens an event when it starts and closes it when it clears or changes kind.
  useEffect(() => {
    const open = openAlert.current;
    if (open && open.kind !== alert?.kind) {
      logEvent({ ...open, end: Date.now() });
      openAlert.current = null;
    }
    if (alert && !openAlert.current) {
      // The picture at the moment the alert starts, as the CB360 app takes an alarm photo.
      const l = latest.current;
      const snap = l ? frameStats(l.frame.y16) : null;
      openAlert.current = {
        id: uuid(),
        kind: alert.kind,
        start: alert.since,
        end: null,
        peak: null,
        snapshot: l && snap ? frameToDataUri(l.frame.y16, snap.min, snap.max, live.current.settings.palette) : undefined,
      };
      sync(openAlert.current);
    }
  }, [alert?.kind, logEvent, sync]);

  // Same for the camera streaming, so a run knows whether it was being watched.
  useEffect(() => {
    if (status === 'live' && !openCamera.current) {
      openCamera.current = { id: uuid(), kind: 'camera', start: Date.now(), end: null, peak: null };
      sync(openCamera.current);
    }
    if (status !== 'live' && openCamera.current) {
      logEvent({ ...openCamera.current, end: Date.now() });
      openCamera.current = null;
    }
  }, [status, logEvent, sync]);

  const onFrame = useCallback((frame: ThermalFrame) => {
    const { settings: s } = live.current;
    const hotspot = s.leakOn ? detector.current.update(frame.y16, s.leakThreshold) : null;
    if (hotspot) lastHotspotAt.current = Date.now();
    latest.current = { frame, hotspot };
    lastFrameAt.current = Date.now();
    frames.current.n++;
  }, []);

  const stopSource = useCallback(async () => {
    const s = source.current;
    source.current = null;
    await s?.stop();
    latest.current = null;
    detector.current.reset();
    setSnapshot(null);
    setAlert(null);
  }, []);

  const connect = useCallback(async () => {
    await stopSource();
    setError(null);
    setStatus('connecting');
    // A CB360 allowed before connects straight away; otherwise the browser's picker opens.
    const s: ThermalSource = demo ? new DemoThermalSource() : new WebUsbSource(await findCb360().catch(() => null));
    lastFrameAt.current = Date.now();
    source.current = s;
    try {
      await s.start(onFrame, (message) => {
        setError(`The camera stopped sending: ${message}`);
        setStatus('error');
      });
      setStatus('live');
    } catch (e) {
      source.current = null;
      const message = e instanceof Error ? e.message : String(e);
      // Closing the browser's device picker without choosing isn't an error worth showing.
      const cancelled = /No device selected/i.test(message);
      setError(cancelled ? null : message);
      setStatus(cancelled ? 'idle' : 'error');
    }
  }, [demo, onFrame, stopSource]);

  const disconnect = useCallback(async () => {
    await stopSource();
    setStatus('idle');
  }, [stopSource]);

  // Live mode: know whether a CB360 is plugged in, and drop the stream if it's unplugged.
  useEffect(() => {
    if (demo || !mode) {
      setPresent(demo);
      return;
    }
    findCb360().then((d) => setPresent(!!d)).catch(() => setPresent(false));
    return watchCb360((kind, device) => {
      setPresent(kind === 'connect');
      const current = source.current instanceof WebUsbSource ? source.current.usbDevice : null;
      if (kind === 'disconnect' && current === device) {
        stopSource();
        setStatus('idle');
        setError('No input: the CB360 was unplugged.');
      }
    });
  }, [demo, mode, stopSource]);

  // Leaving demo mode (or connecting to the real device) drops the simulated camera.
  useEffect(() => {
    disconnect();
  }, [mode]);

  // Publishes a snapshot and works out alerts a few times a second.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const f = frames.current;
      if (now - f.since >= 1000) {
        f.fps = Math.round((f.n * 1000) / (now - f.since));
        f.n = 0;
        f.since = now;
      }
      const l = latest.current;
      const nextInput: ThermalInput =
        !source.current || !l
          ? source.current && now - lastFrameAt.current > STALL_MS ? 'stalled' : 'none'
          : now - lastFrameAt.current > STALL_MS
            ? 'stalled'
            : !l.frame.header.deviceName.startsWith('CB360') && l.frame.header.deviceName !== 'DEMO'
              ? 'wrongDevice'
              : 'ok';
      setInput(nextInput);
      if (!l) return;
      const stats = frameStats(l.frame.y16);
      setSnapshot({ frame: l.frame, stats, hotspot: l.hotspot, fps: f.fps });
      setAlert((prev) => nextAlert(prev, stats, now));
      trackPeak(stats, l.hotspot);
    }, PUBLISH_MS);
    return () => clearInterval(id);
  }, []);

  const nextAlert = (prev: ThermalAlert | null, stats: FrameStats, now: number): ThermalAlert | null => {
    const { settings: s, calibration: cal } = live.current;
    let next: Omit<ThermalAlert, 'since'> | null = null;
    // Temperature alarms first: they need a calibration, as °C does.
    if (cal && s.highOn && toCelsius(cal, stats.max) > s.high) {
      next = { kind: 'high', text: `Above the ${fmtTemp(s.high, s.unit, 0)} alarm: warmest spot ${fmtTemp(toCelsius(cal, stats.max), s.unit)}` };
    } else if (cal && s.lowOn && toCelsius(cal, stats.min) < s.low) {
      next = { kind: 'low', text: `Below the ${fmtTemp(s.low, s.unit, 0)} alarm: coolest spot ${fmtTemp(toCelsius(cal, stats.min), s.unit)}` };
    } else if (s.leakOn && now - lastHotspotAt.current < LEAK_CLEAR_MS) {
      const h = latest.current?.hotspot;
      const rise = h && cal ? ` (${fmtRise(h.peakRise / countsPerC(cal), s.unit)} above its resting level)` : '';
      next = { kind: 'leak', text: `Possible leak: a warm patch is appearing${rise}. Check the mask seal.` };
    }
    if (!next) return null;
    if (prev && prev.kind === next.kind) {
      if (now - prev.since >= RENOTIFY_MS) {
        notify();
        return { ...next, since: now };
      }
      return prev.text === next.text ? prev : { ...next, since: prev.since };
    }
    notify();
    return { ...next, since: now };
  };

  // Keeps the open alert event's worst value up to date.
  const trackPeak = (stats: FrameStats, hotspot: Hotspot | null) => {
    const open = openAlert.current;
    const cal = live.current.calibration;
    if (!open || !cal || open.kind !== alertKind.current) return;
    if (open.kind === 'leak' && hotspot) {
      const rise = hotspot.peakRise / countsPerC(cal);
      open.peak = Math.max(open.peak ?? -Infinity, rise);
    } else if (open.kind === 'high') {
      open.peak = Math.max(open.peak ?? -Infinity, toCelsius(cal, stats.max));
    } else if (open.kind === 'low') {
      open.peak = Math.min(open.peak ?? Infinity, toCelsius(cal, stats.min));
    }
  };

  const updateSettings = useCallback((patch: Partial<ThermalSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    if (patch.leakOn === false) detector.current.reset();
  }, []);

  const saveCalibration = useCallback((cal: Calibration) => {
    setStoredCal(cal);
    if (mode) AsyncStorage.setItem(calKey(mode), JSON.stringify(cal)).catch(() => {});
  }, [mode]);

  const clearCalibration = useCallback(() => {
    setStoredCal(null);
    if (mode) AsyncStorage.removeItem(calKey(mode)).catch(() => {});
  }, [mode]);

  // Closed events plus any still going (copied, so their latest worst value shows).
  const allEvents = useMemo(
    () => [...events, ...[openCamera.current, openAlert.current].filter((e): e is ThermalEvent => !!e).map((e) => ({ ...e }))],
    [events, alert, status, snapshot]
  );

  const value = useMemo<ThermalValue>(
    () => ({
      status,
      input,
      present,
      error,
      snapshot,
      settings,
      calibration,
      events: allEvents,
      connect,
      disconnect,
      recalibrateShutter: () => {
        source.current?.recalibrate();
        detector.current.reset(); // the picture re-levels after a shutter cycle
      },
      updateSettings,
      sampleCentre: () => (latest.current ? centreCounts(latest.current.frame.y16) : null),
      saveCalibration,
      clearCalibration,
    }),
    [status, input, present, error, snapshot, settings, calibration, allEvents, connect, disconnect, updateSettings, saveCalibration, clearCalibration]
  );

  return (
    <ThermalCtx.Provider value={value}>
      <AlertCtx.Provider value={alert}>{children}</AlertCtx.Provider>
    </ThermalCtx.Provider>
  );
}

// Vibrates for 1 s like the CB360 app, plus a short tone on the web (phones vibrate instead).
function notify() {
  Vibration.vibrate(1000);
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {
    // Audio blocked until the page has been tapped: the on-screen alert still shows.
  }
}

export function useThermal() {
  const v = useContext(ThermalCtx);
  if (!v) throw new Error('useThermal outside ThermalProvider');
  return v;
}

export const useThermalAlert = () => useContext(AlertCtx);
