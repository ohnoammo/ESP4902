# Routes (React Navigation, config-based; see RootNavigator in layouts.md)

| Route | Component | Layout | Renders |
|---|---|---|---|
| Root/Welcome | src/screens/WelcomeScreen.tsx | none | animated sine wave, "Connect your simulator", Connect + "Try demo mode" |
| Home/Simulators | src/screens/SimulatorsScreen.tsx | tabs | hero title + Aa button, device status line, preset cards (name, mini wave, duty/rate/I:E stats, band pill), + Add simulator |
| Home/NewSimulator | src/screens/NewSimulatorScreen.tsx | stack, no tab bar | name field, Breathing/Free flow toggle, peak duty slider + band pill, rate slider (required), I:E slider, Save |
| Home/Ready | src/screens/ReadyScreen.tsx | tabs (none active) | title + Edit, status, commanded-duty preview wave, param rows, band pill, test details, Start |
| Home/Running | src/screens/RunningScreen.tsx | stack | clock, phase banner, duty + rpm live chart, readings, Stop |
| Home/Sensors | src/screens/SensorsScreen.tsx | stack | live reading cards |
| Sessions/* | src/screens/Sessions*, Session, Folder, Compare*, Assistant | tabs/stack | run history, graphs, chat |
| Settings | src/screens/SettingsScreen.tsx | tabs | device card, appearance, text size, data |

### `src/navigation/types.ts`

```tsx
import { NavigatorScreenParams } from '@react-navigation/native';

export type HomeStackParams = {
  Simulators: undefined;
  NewSimulator: { simulatorId?: string } | undefined; // with an id: edit that simulator
  Ready: { simulatorId: string };
  Running: undefined;
  Sensors: undefined;
};

export type SessionsStackParams = {
  Sessions: undefined;
  Folder: { folderId: string };
  Session: { id: string };
  CompareSelect: { folderId?: string };
  Compare: { ids: string[] };
  Assistant: { runId?: string } | undefined;
};

export type TabParams = {
  HomeTab: NavigatorScreenParams<HomeStackParams>;
  SessionsTab: NavigatorScreenParams<SessionsStackParams>;
  SettingsTab: undefined;
};

export type RootParams = {
  Welcome: undefined;
  Main: NavigatorScreenParams<TabParams>;
};

```
