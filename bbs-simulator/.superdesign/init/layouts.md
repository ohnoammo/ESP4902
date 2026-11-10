# Layouts

- `App.tsx`: providers + Gate; DemoBanner (demo mode) above the navigator, NoticeBar toast, TextSizeDialog.
- `src/navigation/RootNavigator.tsx`: native stacks inside bottom tabs (Home, Sessions, Settings).
- `src/navigation/TabBar.tsx`: custom white bottom bar, three navy circles, the active tab rises into a notch with an orange label; hidden on pushed screens.
- `src/components/AppBanners.tsx`: DemoBanner (yellow strip) and NoticeBar (bottom toast).
- `src/components/ActiveRunBanner.tsx`: "Recording" pill at the top of tab roots.

Screens are full-bleed dark navy; content insets 37pt (text) / 24pt (cards); hero titles 45pt bold; 393pt phone frame.

### `App.tsx`

```tsx
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

```

### `src/navigation/RootNavigator.tsx`

```tsx
import React from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer, NavigationState, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors } from '../theme';
import { HomeStackParams, RootParams, SessionsStackParams, TabParams } from './types';
import { TabBar } from './TabBar';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { SimulatorsScreen } from '../screens/SimulatorsScreen';
import { NewSimulatorScreen } from '../screens/NewSimulatorScreen';
import { ReadyScreen } from '../screens/ReadyScreen';
import { RunningScreen } from '../screens/RunningScreen';
import { SensorsScreen } from '../screens/SensorsScreen';
import { SessionsScreen } from '../screens/SessionsScreen';
import { FolderScreen } from '../screens/FolderScreen';
import { SessionScreen } from '../screens/SessionScreen';
import { CompareSelectScreen } from '../screens/CompareSelectScreen';
import { CompareScreen } from '../screens/CompareScreen';
import { AssistantScreen } from '../screens/AssistantScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const Root = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator<TabParams>();
const HomeStack = createNativeStackNavigator<HomeStackParams>();
const SessionsStack = createNativeStackNavigator<SessionsStackParams>();

// Built at render time: `colors` is the live palette and changes with the theme.
function navTheme(): Theme {
  const base = colors.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.cardBorder,
      primary: colors.accent,
    },
  };
}

const stackOptions = () => ({ headerShown: false, contentStyle: { backgroundColor: colors.background } });

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={stackOptions()}>
      <HomeStack.Screen name="Simulators" component={SimulatorsScreen} />
      <HomeStack.Screen
        name="NewSimulator"
        component={NewSimulatorScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <HomeStack.Screen name="Ready" component={ReadyScreen} />
      <HomeStack.Screen name="Running" component={RunningScreen} />
      <HomeStack.Screen name="Sensors" component={SensorsScreen} />
    </HomeStack.Navigator>
  );
}

function SessionsNavigator() {
  return (
    <SessionsStack.Navigator screenOptions={stackOptions()}>
      <SessionsStack.Screen name="Sessions" component={SessionsScreen} />
      <SessionsStack.Screen name="Folder" component={FolderScreen} />
      <SessionsStack.Screen name="Session" component={SessionScreen} />
      <SessionsStack.Screen
        name="CompareSelect"
        component={CompareSelectScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <SessionsStack.Screen name="Compare" component={CompareScreen} />
      <SessionsStack.Screen name="Assistant" component={AssistantScreen} />
    </SessionsStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      <Tabs.Screen name="HomeTab" component={HomeNavigator} />
      <Tabs.Screen name="SessionsTab" component={SessionsNavigator} />
      <Tabs.Screen name="SettingsTab" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}

export function RootNavigator({
  initialState,
  onStateChange,
}: {
  initialState?: NavigationState;
  onStateChange: (state: NavigationState | undefined) => void;
}) {
  return (
    <NavigationContainer
      theme={navTheme()}
      initialState={initialState}
      onStateChange={onStateChange} documentTitle={{ formatter: () => 'BBS Simulator' }}>
      <Root.Navigator screenOptions={{ ...stackOptions(), animation: 'fade' }}>
        <Root.Screen name="Welcome" component={WelcomeScreen} />
        <Root.Screen name="Main" component={MainTabs} />
      </Root.Navigator>
    </NavigationContainer>
  );
}

```

### `src/navigation/TabBar.tsx`

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, recolor, themedStyles } from '../theme';
import { Icon } from '../components/basics';
import * as svgs from '../assets/svgs';

// Screens drawn without a nav bar in Figma.
const HIDDEN = new Set(['NewSimulator', 'Running', 'Sensors', 'Session', 'CompareSelect', 'Compare', 'Assistant']);
// "Nav Bar (None)" on the Ready frame: bar visible, no tab highlighted.
const NONE_ACTIVE = new Set(['Ready']);

const TABS = {
  HomeTab: { label: 'Home', idle: svgs.navHome },
  SessionsTab: { label: 'Sessions', idle: svgs.navSessions },
  SettingsTab: { label: 'Settings', idle: svgs.navSettings },
} as const;

const SPACING = 119; // distance between the three circles in the frames
const DIP_W = 134;
const DIP_H = 98;
const DIP_RISE = 44; // how far the active notch rises above the white bar
const DIP_CENTER = 63.5;

// Dark theme: the Figma white bar with navy circles. Light theme inverts it: navy bar,
// circles/notch in the page grey, glyphs in navy. The swap is simultaneous, so the parts
// of each glyph drawn in the circle colour (door, clock hand) follow the circle.
function navXml(xml: string) {
  return colors.scheme === 'light' ? recolor(xml, { '#191629': colors.background, white: colors.strong }) : xml;
}

function ActiveDip({ tab }: { tab: keyof typeof TABS }) {
  if (tab === 'HomeTab') return <Icon xml={navXml(svgs.navHomeActive)} width={DIP_W} height={DIP_H} />;
  if (tab === 'SettingsTab') return <Icon xml={navXml(svgs.navSettingsActive)} width={DIP_W} height={DIP_H} />;
  return (
    <View style={{ width: DIP_W, height: DIP_H }}>
      <Icon xml={navXml(svgs.navDip)} width={DIP_W} height={DIP_H} />
      <Icon xml={navXml(svgs.navSessionsActiveIcon)} size={44} style={styles.sessionsGlyph} />
    </View>
  );
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const focused = state.routes[state.index];
  const nested = getFocusedRouteNameFromRoute(focused) ?? '';
  if (HIDDEN.has(nested)) return null;
  const highlight = !NONE_ACTIVE.has(nested);
  const height = 57 + Math.max(insets.bottom, 27);

  return (
    <View style={[styles.bar, { height }]}>
      <View style={styles.row}>
        {state.routes.map((route, i) => {
          const name = route.name as keyof typeof TABS;
          const tab = TABS[name];
          const active = highlight && i === state.index;
          const offset = (i - 1) * SPACING;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (event.defaultPrevented) return;
            // Tapping a tab always lands on that tab's root screen.
            const rootName = { HomeTab: 'Simulators', SessionsTab: 'Sessions', SettingsTab: 'Settings' }[name];
            navigation.navigate(route.name, { screen: rootName } as never);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
              style={[styles.slot, { transform: [{ translateX: offset }] }]}
            >
              {active ? (
                <>
                  <View style={styles.dip} pointerEvents="none">
                    <ActiveDip tab={name} />
                  </View>
                  <Text style={styles.label}>{tab.label}</Text>
                </>
              ) : (
                <Icon xml={navXml(tab.idle)} size={60} style={styles.circle} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  // The notch artwork starts 44pt above the bar; clipping at the bar edge leaves the
  // tab-shaped cut-out seen in the frames.
  bar: {
    backgroundColor: colors.navBar,
    overflow: 'hidden',
  },
  row: { flex: 1, alignItems: 'center' },
  slot: { position: 'absolute', top: 0, width: 100, height: 84, alignItems: 'center' },
  circle: { marginTop: 14 },
  dip: { position: 'absolute', top: -DIP_RISE, left: 50 - DIP_CENTER },
  sessionsGlyph: { position: 'absolute', left: 43, top: 43 },
  label: { ...font.bold, fontSize: 17, color: colors.navLabel, position: 'absolute', top: 59, width: 100, textAlign: 'center' },
}));

```

### `src/components/AppBanners.tsx`

```tsx
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRun } from '../state/RunContext';
import { fs, colors, font, themedStyles } from '../theme';

// Persistent strip above every screen in demo mode, so simulated data is never mistaken
// for the real device. App.tsx renders it outside the navigator.
export function DemoBanner({ top }: { top: number }) {
  return (
    <View style={[styles.demo, { paddingTop: top + 6 }]} accessibilityRole="header" accessibilityLabel="Demo mode: simulated data, saved separately from real runs">
      <Text style={styles.demoTitle}>DEMO · simulated data</Text>
      <Text style={styles.demoSub}>Not the real device. Demo runs are kept apart from real runs.</Text>
    </View>
  );
}

// App-wide message for things that finish after you have moved on (a Stop being
// confirmed, the device ending a run). Good news fades; problems stay until dismissed.
export function NoticeBar({ bottom }: { bottom: number }) {
  const { notice, dismissNotice } = useRun();
  useEffect(() => {
    if (!notice || (notice.tone !== 'success' && notice.tone !== 'info')) return;
    const id = setTimeout(dismissNotice, 6000);
    return () => clearTimeout(id);
  }, [notice, dismissNotice]);
  if (!notice) return null;
  const accent = { success: colors.success, info: colors.accent, warning: colors.warning, error: colors.danger }[notice.tone];
  return (
    <View style={[styles.notice, { bottom, borderLeftColor: accent }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Text style={styles.noticeText}>{notice.text}</Text>
      <Pressable onPress={dismissNotice} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss message">
        <Text style={styles.noticeClose}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  demo: { backgroundColor: colors.demo, paddingHorizontal: 20, paddingBottom: 7, alignItems: 'center' },
  demoTitle: { ...font.bold, fontSize: 15, letterSpacing: 1, color: colors.onDemo },
  demoSub: { ...font.regular, fontSize: 12, color: colors.onDemo, marginTop: 1, textAlign: 'center' },
  notice: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: 16,
    borderLeftWidth: 5,
    backgroundColor: colors.card,
    borderColor: colors.dialogBorder,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  noticeText: { ...font.regular, flex: 1, fontSize: fs(14), lineHeight: fs(19), color: colors.text },
  noticeClose: { ...font.bold, fontSize: 16, color: colors.muted },
}));

```

### `src/components/ActiveRunBanner.tsx`

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRun } from '../state/RunContext';
import { fs, colors, font, themedStyles } from '../theme';
import { formatClock } from '../utils/format';
import { Icon } from './basics';
import * as svgs from '../assets/svgs';

// Recording continues while you browse, so tab roots show a way back to the live run.
export function ActiveRunBanner() {
  const { active, elapsed } = useRun();
  const navigation = useNavigation<any>();
  if (!active) return null;
  return (
    <Pressable
      onPress={() => navigation.navigate('HomeTab', { screen: 'Running', initial: false })}
      accessibilityRole="button"
      accessibilityLabel={`Recording ${active.simulator.name}, ${formatClock(elapsed)}. Open live run.`}
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}
    >
      <Icon xml={svgs.dotRecording} size={8} />
      <Text style={styles.text} numberOfLines={1}>
        Recording · {active.simulator.name}
      </Text>
      <Text style={styles.time}>{formatClock(elapsed)}</Text>
      <Icon xml={svgs.detailsChevron} size={28} />
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    marginHorizontal: 24,
    marginTop: 14,
    paddingLeft: 20,
    paddingRight: 8,
    gap: 10,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  text: { ...font.bold, flex: 1, fontSize: fs(15), color: colors.text },
  time: { ...font.regular, fontSize: fs(15), color: colors.muted, fontVariant: ['tabular-nums'] },
}));

```
