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
