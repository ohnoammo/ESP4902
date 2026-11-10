import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { PrimaryButton } from './basics';
import { themedStyles } from '../theme';

// The extra views open from Home or the live run; their back link names whichever it was.
export const backLabel = (state: { routes: { name: string }[]; index: number }) =>
  state.routes[state.index - 1]?.name === 'Running' ? 'Live run' : 'Simulators';

// Shortcuts to the rig's extra views, on Home and the live run.
export function ToolLinks({ onOpen, style }: { onOpen: (screen: 'Thermal' | 'Twin') => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      <PrimaryButton label="Thermal camera" icon="thermal" variant="outline" onPress={() => onOpen('Thermal')} style={styles.button} />
      <PrimaryButton label="Digital twin" icon="twin" variant="outline" onPress={() => onOpen('Twin')} style={styles.button} />
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, marginHorizontal: 0 },
}));
