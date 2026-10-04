import React, { useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { NavigationState } from '@react-navigation/native';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DeviceProvider, useDevice } from './src/state/DeviceContext';
import { DataProvider, useData } from './src/state/DataContext';
import { RunProvider } from './src/state/RunContext';
import { ThemeProvider, useTheme } from './src/state/ThemeContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { TextSizeDialog } from './src/components/controls';
import { DemoBanner, NoticeBar } from './src/components/AppBanners';
import { colors } from './src/theme';

function Gate() {
  const { loaded } = useData();
  const { mode: scheme, textScale } = useTheme();
  const { mode } = useDevice();
  const insets = useSafeAreaInsets();
  // Switching theme or text size remounts the navigator so every screen re-reads the
  // palette and font sizes; the navigation state is carried over so you stay on the same screen.
  const navState = useRef<NavigationState | undefined>(undefined);
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  const demo = mode === 'demo';
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {demo && <DemoBanner top={insets.top} />}
      {/* Under the demo banner the status bar is already cleared, so screens get no top inset. */}
      <SafeAreaInsetsContext.Provider value={demo ? { ...insets, top: 0 } : insets}>
        <View style={{ flex: 1 }}>
          <RootNavigator
            key={`${scheme}-${textScale}`}
            initialState={navState.current}
            onStateChange={(s) => {
              navState.current = s;
            }}
          />
          <NoticeBar bottom={Math.max(insets.bottom, 27) + 96} />
        </View>
      </SafeAreaInsetsContext.Provider>
      <TextSizeDialog />
      <StatusBar style={demo ? 'dark' : scheme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <DeviceProvider>
          <DataProvider>
            <RunProvider>
              <Gate />
            </RunProvider>
          </DataProvider>
        </DeviceProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
