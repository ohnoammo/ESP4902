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
