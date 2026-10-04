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
