import React from 'react';
import { Text, View } from 'react-native';
import { BandLevel, bandFor, DUTY_BANDS_NOTE } from '../constants/dutyBands';
import { fs, colors, font, themedStyles } from '../theme';

export const levelColor = (level: BandLevel) =>
  ({ error: colors.danger, warn: colors.warning, info: colors.accent, ok: colors.success })[level];

// "● Walking / light" in the band's level colour. Shows the open-air note when asked, since
// the edges come from an open-air sweep and will move.
export function BandPill({ duty, note, style }: { duty: number; note?: boolean; style?: object }) {
  const band = bandFor(duty);
  const c = levelColor(band.level);
  return (
    <View style={style} accessible accessibilityLabel={`Duty band: ${band.label}${note ? `. ${DUTY_BANDS_NOTE}` : ''}`}>
      <View style={[styles.pill, { borderColor: c }]}>
        <View style={[styles.dot, { backgroundColor: c }]} />
        <Text style={styles.text}>{band.label}</Text>
      </View>
      {note && <Text style={styles.note}>{DUTY_BANDS_NOTE}</Text>}
    </View>
  );
}

// A firmware state or warning, in its level colour.
export function StateBanner({ text, level, style }: { text: string; level: BandLevel; style?: object }) {
  return (
    <View style={[styles.banner, { borderColor: levelColor(level) }, style]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <View style={[styles.dot, { backgroundColor: levelColor(level) }]} />
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { ...font.bold, fontSize: fs(13), color: colors.text },
  note: { ...font.regular, fontSize: fs(12), color: colors.muted, marginTop: 5 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bannerText: { ...font.bold, flex: 1, fontSize: fs(14), color: colors.text },
}));
