import { NavigatorScreenParams } from '@react-navigation/native';

export type HomeStackParams = {
  Simulators: undefined;
  NewSimulator: undefined;
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
