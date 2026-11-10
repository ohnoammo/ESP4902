import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './basics';
import { ACTIVITY_PRESETS, ACTIVITY_SOURCE, ActivityPreset } from '../constants/presets';
import { CAPACITY_EX, CAPACITY_IN, flowCheck, PEAK_STATUS_LABEL, PeakStatus } from '../constants/twin';
import { colors, font, fs, themedStyles } from '../theme';
import { ActivityKey } from '../types';
import { formatNumber } from '../utils/format';

const barsIcon = (filled: number, on: string, off: string) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${[0, 1, 2]
    .map((i) => `<rect x="${3 + i * 7}" y="${14 - i * 5}" width="4.5" height="${7 + i * 5}" rx="1.5" fill="${i < filled ? on : off}"/>`)
    .join('')}</svg>`;

// Warnings, not errors: a clipped peak still runs (never red, and always labelled in words).
export const statusColor = (s: PeakStatus) => (s === 'ok' ? colors.success : colors.warning);

// Bars by peak flow: 1 within both fans, 2 up to 80 L/min, 3 above.
const levelOf = (peak: number) => (peak <= 20 ? 1 : peak <= 80 ? 2 : 3);

// The built-in activity presets on the Simulators screen: flow breaths (Vt + rate).
export function ActivityList({ onOpen, runningId }: { onOpen: (simulatorId: string) => void; runningId?: string }) {
  return (
    <View style={styles.list}>
      {ACTIVITY_PRESETS.map((a) => (
        <ActivityCard key={a.key} activity={a} level={levelOf(Math.PI * a.vt * a.bpm)} running={runningId === `activity-${a.key}`}
          onPress={() => onOpen(`activity-${a.key}`)} />
      ))}
    </View>
  );
}

function ActivityCard({ activity: a, level, running, onPress }: {
  activity: ActivityPreset;
  level: number;
  running: boolean;
  onPress: () => void;
}) {
  const c = flowCheck(a.vt, a.bpm);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a.name}, ${a.vt} litres at ${a.bpm} breaths per minute, peak ${Math.round(c.peak)} litres per minute, ${PEAK_STATUS_LABEL[c.status]}${running ? ', recording' : ''}`}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.pressed }]}
    >
      <View style={styles.cardHead}>
        <Icon xml={barsIcon(level, running ? colors.accent : colors.text, colors.inputBorder)} size={26} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>{a.name}</Text>
        {running && <View style={styles.recDot} />}
        <Text style={styles.chevron}>›</Text>
      </View>
      <Stat label="Tidal volume" value={`${a.vt} L`} />
      <Stat label="Breathing rate" value={`${a.bpm} bpm`} />
      <Stat label="Peak flow" value={`${Math.round(c.peak)} L/min`} />
      <View style={styles.bandRow}>
        <View style={[styles.dot, { backgroundColor: statusColor(c.status) }]} />
        <Text style={styles.bandText}>{PEAK_STATUS_LABEL[c.status]}</Text>
        <Text style={styles.bandText}>  ·  VE {formatNumber(c.ve, 1)} L/min</Text>
      </View>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

// "How were these presets chosen?": the source values and what the device can deliver.
export function PresetsExplainer({ selected }: { selected?: ActivityKey }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.explainer}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.explainerHead}
      >
        <Text style={styles.explainerTitle}>How were these presets chosen?</Text>
        <Text style={[styles.chevron, open && { transform: [{ rotate: '180deg' }] }]}>⌄</Text>
      </Pressable>
      {open && (
        <View style={styles.explainerBody}>
          <Text style={styles.muted}>
            Tidal volume and breathing rate for each activity, from {ACTIVITY_SOURCE}. Each runs as a sinusoidal
            flow breath: VE = Vt × rate, peak flow = π × VE.
          </Text>
          <View style={[styles.tableRow, { marginTop: 12 }]}>
            <Text style={[styles.th, { flex: 1.6 }]}>Activity</Text>
            <Text style={[styles.th, styles.num]}>Vt (L)</Text>
            <Text style={[styles.th, styles.num]}>bpm</Text>
            <Text style={[styles.th, styles.num]}>VE</Text>
            <Text style={[styles.th, styles.num]}>Peak</Text>
          </View>
          {ACTIVITY_PRESETS.map((a) => {
            const c = flowCheck(a.vt, a.bpm);
            return (
              <View key={a.key} style={[styles.tableRow, styles.tableBorder]}>
                <View style={styles.nameCell}>
                  <View style={[styles.dot, { backgroundColor: statusColor(c.status) }]} />
                  <Text style={[styles.td, { flexShrink: 1 }, selected === a.key && { color: colors.accentText }]}>{a.name}</Text>
                </View>
                <Text style={[styles.td, styles.num]}>{a.vt}</Text>
                <Text style={[styles.td, styles.num]}>{a.bpm}</Text>
                <Text style={[styles.td, styles.num]}>{formatNumber(c.ve, 1)}</Text>
                <Text style={[styles.td, styles.num]}>{Math.round(c.peak)}</Text>
              </View>
            );
          })}
          <Text style={styles.sectionLabel}>What the device can deliver (peak flow)</Text>
          <Limit color={colors.success} text={`Within capacity: peak up to ${CAPACITY_EX} L/min`} />
          <Limit color={colors.warning} text={`Exhale peak clipped: ${CAPACITY_EX}–${CAPACITY_IN} L/min (exhale fan at 100 %)`} />
          <Limit color={colors.warning} text={`Both peaks clipped: above ${CAPACITY_IN} L/min`} />
          <Text style={[styles.muted, { marginTop: 12 }]}>
            The exhale fan delivers about {CAPACITY_EX} L/min at most (recirculation around its inlet), so only the demo
            preset runs unclipped. Clipped presets still run; the app shows a banner while peaks are clipped. The limit is
            on the product Vt × rate, so tidal volume and rate have no fixed ranges of their own.
          </Text>
        </View>
      )}
    </View>
  );
}

function Limit({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.limitRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.td, { flexShrink: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  list: { gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 24, borderWidth: 1, borderColor: colors.cardBorder, padding: 24 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.strong },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  cardTitle: { ...font.bold, fontSize: fs(17), color: colors.strong },
  stat: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  statLabel: { ...font.regular, fontSize: fs(15), color: colors.muted },
  statValue: { ...font.bold, fontSize: fs(16), color: colors.text },
  bandRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bandText: { ...font.regular, fontSize: fs(14), color: colors.text },
  explainer: { backgroundColor: colors.card, borderRadius: 24, marginTop: 12 },
  explainerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, minHeight: 56 },
  explainerTitle: { ...font.bold, fontSize: fs(15), color: colors.text, flex: 1 },
  chevron: { ...font.bold, fontSize: fs(22), color: colors.chevron, marginLeft: 8, lineHeight: fs(22) },
  explainerBody: { paddingHorizontal: 16, paddingBottom: 16 },
  muted: { ...font.regular, fontSize: fs(13), lineHeight: fs(18), color: colors.muted },
  sectionLabel: { ...font.bold, fontSize: fs(14), color: colors.strong, marginTop: 16, marginBottom: 8 },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  tableBorder: { borderTopWidth: 1, borderTopColor: colors.dividerDim },
  nameCell: { flex: 1.6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  th: { ...font.bold, fontSize: fs(13), color: colors.muted },
  td: { ...font.regular, fontSize: fs(14), color: colors.text },
  num: { flex: 0.8, textAlign: 'right' },
}));
