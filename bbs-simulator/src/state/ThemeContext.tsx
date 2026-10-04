import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyTextScale, applyTheme, Scheme, TEXT_SCALES } from '../theme';

export type ThemeMode = Scheme;

const KEY = 'bbs.theme';
const SCALE_KEY = 'bbs.textScale';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  textScale: number;
  setTextScale: (scale: number) => void;
  // The Text size dialog lives above the navigator (App.tsx) so it stays open while sizes apply.
  textSizeOpen: boolean;
  setTextSizeOpen: (open: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Dark is the designed look, so it's the default until the user picks otherwise.
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [textScale, setTextScaleState] = useState(1);
  const [textSizeOpen, setTextSizeOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.multiGet([KEY, SCALE_KEY])
      .then(([[, theme], [, scale]]) => {
        // Anything else (including the old 'system' option) falls back to dark.
        if (theme === 'light') setModeState('light');
        const s = Number(scale);
        if ((TEXT_SCALES as readonly number[]).includes(s)) setTextScaleState(s);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  }, []);

  const setTextScale = useCallback((s: number) => {
    setTextScaleState(s);
    AsyncStorage.setItem(SCALE_KEY, String(s)).catch(() => {});
  }, []);

  // Swap the live palette and text sizes before any child renders with them.
  applyTheme(mode);
  applyTextScale(textScale);

  const value = useMemo(
    () => ({ mode, setMode, textScale, setTextScale, textSizeOpen, setTextSizeOpen }),
    [mode, setMode, textScale, setTextScale, textSizeOpen]
  );
  if (!loaded) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
