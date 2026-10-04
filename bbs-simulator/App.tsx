import React, { useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { NavigationState } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectionProvider } from './src/state/ConnectionContext';
import { DataProvider, useData } from './src/state/DataContext';
import { RunProvider } from './src/state/RunContext';
import { ThemeProvider, useTheme } from './src/state/ThemeContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { TextSizeDialog } from './src/components/controls';
import { colors } from './src/theme';

function Gate() {
  const { loaded } = useData();
  const { mode: scheme, textScale } = useTheme();
  // Switching theme or text size remounts the navigator so every screen re-reads the
  // palette and font sizes; the navigation state is carried over so you stay on the same screen.
  const navState = useRef<NavigationState | undefined>(undefined);
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RootNavigator
        key={`${scheme}-${textScale}`}
        initialState={navState.current}
        onStateChange={(s) => {
          navState.current = s;
        }}
      />
      <TextSizeDialog />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ConnectionProvider>
          <DataProvider>
            <RunProvider>
              <Gate />
            </RunProvider>
          </DataProvider>
        </ConnectionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
