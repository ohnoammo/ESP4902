# Components (shared UI primitives)

Framework: Expo (React Native 0.86 + react-native-web), React 19. No component library: custom
primitives styled with StyleSheet via `themedStyles` (src/theme.ts). Icons are Figma-exported SVG
strings rendered with react-native-svg (`Icon`). Every font size goes through `fs()` (text scaling).

- basics.tsx: Icon, Screen, BackButton, PrimaryButton (pill, accent/danger), PillButton, OutlinePill, LinkText, Field, RecordingStatus
- controls.tsx: Slider, SegmentedToggle, SensorChips, Dialog, TextSizeButton, TextSizeDialog
- BandPill.tsx: duty band pill + StateBanner
- DeviceStatus.tsx: DeviceStatusLine, UnrecordedRunCard

### `src/components/basics.tsx`

```tsx
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fs, colors, font, inset, themedStyles, type } from '../theme';
import * as svgs from '../assets/svgs';

export function Icon({ xml, size, width, height, style }: {
  xml: string;
  size?: number;
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const w = width ?? size ?? 24;
  const h = height ?? size ?? 24;
  return (
    <View style={[{ width: w, height: h }, style]} pointerEvents="none">
      <SvgXml xml={xml} width={w} height={h} />
    </View>
  );
}

// Top padding that reproduces the Figma frames' vertical rhythm on any device:
// the frames assume a 47pt status bar, so content is offset from the real inset.
export function useTopInset() {
  const insets = useSafeAreaInsets();
  return Math.max(insets.top, 12);
}

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Icon xml={svgs.backChevron} size={41} style={styles.flip} />
      <Text style={type.back}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  variant = 'accent',
  disabled,
  loading,
  height = 48,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'accent' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'danger' ? colors.danger : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: bg, height, borderRadius: height / 2 },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.onAccent} /> : <Text style={type.button}>{label}</Text>}
    </Pressable>
  );
}

export function PillButton({
  label,
  onPress,
  kind,
  bold,
  width = 86,
}: {
  label: string;
  onPress: () => void;
  kind: 'outline' | 'accent' | 'danger';
  bold?: boolean;
  width?: number;
}) {
  const bg = kind === 'accent' ? colors.accent : kind === 'danger' ? colors.danger : 'transparent';
  const fg = kind === 'danger' ? colors.dangerText : kind === 'accent' ? colors.onAccent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        { width, backgroundColor: bg },
        kind === 'outline' && styles.pillOutline,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[bold ? font.bold : font.regular, { fontSize: fs(13), color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function LinkText({
  label,
  onPress,
  color = colors.accentText,
  bold = true,
  size = 16,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  bold?: boolean;
  size?: number;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => pressed && styles.pressed}>
      <Text style={[bold ? font.bold : font.regular, { fontSize: fs(size), color }]}>{label}</Text>
    </Pressable>
  );
}

// Bold text in an accent-outlined pill: header actions that need to stand out (Ask, Compare).
export function OutlinePill({
  label,
  onPress,
  small,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  small?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.outlinePill, small && styles.outlinePillSmall, pressed && styles.pressed]}
    >
      <Text style={[styles.outlinePillText, small && styles.outlinePillTextSmall]}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { big?: boolean }) {
  const { big, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      selectionColor={colors.accent}
      {...rest}
      style={[styles.field, big && styles.fieldBig, style]}
    />
  );
}

export function RecordingStatus({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.recording, style]}>
      <Icon xml={svgs.dotRecording} size={8} />
      <Text style={styles.recordingText}>Recording</Text>
    </View>
  );
}

export const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: 13, height: 41 },
  flip: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  primary: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: inset.card,
  },
  pill: { height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pillOutline: { borderWidth: 1, borderColor: colors.dialogBorder },
  outlinePill: {
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: colors.accent,
    paddingHorizontal: 22,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlinePillSmall: { minHeight: 36, borderRadius: 18, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 4 },
  outlinePillText: { ...font.bold, fontSize: fs(18), color: colors.accentText },
  outlinePillTextSmall: { fontSize: fs(14) },
  field: {
    ...font.regular,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 20,
    fontSize: fs(16),
    color: colors.text,
  },
  fieldBig: { height: 45, borderRadius: 12, fontSize: fs(25), paddingHorizontal: 17 },
  recording: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  recordingText: { ...font.regular, fontSize: fs(16), color: colors.muted },
}));

```

### `src/components/controls.tsx`

```tsx
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fs, colors, font, TEXT_SCALE_LABELS, TEXT_SCALES, themedStyles } from '../theme';
import { SENSORS } from '../constants/sensors';
import { SensorKey } from '../types';
import { useTheme } from '../state/ThemeContext';
import { Icon, PrimaryButton } from './basics';
import * as svgs from '../assets/svgs';
import { themedSvgs } from '../assets/themedSvgs';

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  accessibilityLabel,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  accessibilityLabel: string;
  disabled?: boolean; // shown dimmed and ignores input
}) {
  const [width, setWidth] = useState(0);
  const grabX = useRef(0);
  const latest = useRef({ width, min, max, step, onChange });
  latest.current = { width, min, max, step, onChange };

  const setFromX = (x: number) => {
    const { width: w, min: lo, max: hi, step: st, onChange: cb } = latest.current;
    if (!w) return;
    const frac = Math.min(1, Math.max(0, x / w));
    const raw = lo + frac * (hi - lo);
    cb(Math.round(raw / st) * st);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        grabX.current = e.nativeEvent.locationX;
        setFromX(grabX.current);
      },
      onPanResponderMove: (_, g) => setFromX(grabX.current + g.dx),
    })
  ).current;

  const frac = (value - min) / (max - min);
  const nudge = (dir: 1 | -1) => !disabled && onChange(Math.min(max, Math.max(min, value + dir * step)));

  return (
    <View
      style={[sliderStyles.hit, disabled && sliderStyles.disabled]}
      pointerEvents={disabled ? 'none' : 'auto'}
      accessibilityState={{ disabled: !!disabled }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      {...(disabled ? {} : responder.panHandlers)}
    >
      <View pointerEvents="none" style={sliderStyles.track}>
        <View style={[sliderStyles.fill, { width: frac * width }]} />
      </View>
      <View pointerEvents="none" style={[sliderStyles.thumb, { left: frac * width - 8 }]}>
        <Icon xml={themedSvgs.sliderThumb()} size={16} />
      </View>
    </View>
  );
}

const sliderStyles = themedStyles(() => ({
  hit: { height: 32, justifyContent: 'center', cursor: 'pointer' } as any,
  disabled: { opacity: 0.35, cursor: 'default' } as any,
  track: { height: 6, borderRadius: 3, backgroundColor: colors.sliderTrack, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  // Soft shadow keeps the thumb visible against the pale light-mode track.
  thumb: {
    position: 'absolute',
    top: 8,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
}));

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={segStyles.wrap} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            style={[segStyles.option, active && segStyles.active]}
          >
            <Text style={[active ? font.bold : font.regular, { fontSize: fs(15), color: active ? colors.text : colors.muted }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const segStyles = themedStyles(() => ({
  wrap: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 3,
  },
  option: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  active: { backgroundColor: colors.segmentActive },
}));

// Chips start at their Figma widths and shrink together on phones narrower than the
// 393pt frame. They never shrink below their label (estimated at ~0.6em per character,
// since layout can't measure text up front). If even those minimums don't fit the row
// (large text on a narrow phone), the chips wrap onto a second line.
const CHIP_PAD = 12;
const CHIP_GAP = 8;
const chipMin = (label: string) => Math.ceil(label.length * fs(14) * 0.6) + CHIP_PAD * 2;

export function SensorChips({ value, onChange }: { value: SensorKey; onChange: (k: SensorKey) => void }) {
  const [rowWidth, setRowWidth] = useState(0);
  const needed = SENSORS.reduce((sum, s) => sum + chipMin(s.chip), 0) + CHIP_GAP * (SENSORS.length - 1);
  const wrap = rowWidth > 0 && needed > rowWidth;
  return (
    <View style={[chipStyles.row, wrap && chipStyles.wrap]} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      {SENSORS.map((s) => {
        const active = s.key === value;
        const min = chipMin(s.chip);
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            accessibilityRole="button"
            accessibilityLabel={s.chip}
            accessibilityState={{ selected: active }}
            style={[
              chipStyles.chip,
              { flexBasis: Math.max(s.chipWidth, min), minWidth: min },
              active ? chipStyles.active : chipStyles.idle,
            ]}
          >
            <Text style={[font.regular, { fontSize: fs(14), color: active ? colors.onAccent : colors.text }]}>{s.chip}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const chipStyles = themedStyles(() => ({
  row: { flexDirection: 'row', gap: CHIP_GAP },
  wrap: { flexWrap: 'wrap' },
  chip: { height: 52, borderRadius: 26, paddingHorizontal: CHIP_PAD, flexGrow: 0, flexShrink: 1, alignItems: 'center', justifyContent: 'center' },
  active: { backgroundColor: colors.accent },
  idle: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
}));

// Centred dialog over a dimmed screen (New folder / Delete folder frames).
export function Dialog({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  return (
    // react-native-web unmounts a closing Modal on `animationend`, which never fires in a
    // throttled/background tab and leaves the dialog stuck on screen; skip the fade on web.
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={dialogStyles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onRequestClose} accessibilityLabel="Close dialog" />
        <View style={dialogStyles.box}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const dialogStyles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 319,
    maxWidth: '88%',
    backgroundColor: colors.card,
    borderColor: colors.dialogBorder,
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
  },
}));

// Round "Aa" button at the top right of each tab's title; opens the Text size dialog.
// Its own label stays a fixed size so it is always easy to find.
export function TextSizeButton() {
  const { setTextSizeOpen } = useTheme();
  return (
    <Pressable
      onPress={() => setTextSizeOpen(true)}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Text size"
      style={({ pressed }) => [textSizeStyles.button, pressed && { opacity: 0.7 }]}
    >
      <Text style={textSizeStyles.buttonText}>Aa</Text>
    </Pressable>
  );
}

// Rendered by App.tsx above the navigator, so it stays open while each size is applied
// (changing the size remounts every screen).
export function TextSizeDialog() {
  const { textScale, setTextScale, textSizeOpen, setTextSizeOpen } = useTheme();
  return (
    <Dialog visible={textSizeOpen} onRequestClose={() => setTextSizeOpen(false)}>
      <Text style={textSizeStyles.title}>Text size</Text>
      <Text style={textSizeStyles.preview}>Readings and labels will look like this.</Text>
      <SegmentedToggle<string>
        options={TEXT_SCALES.map((s, i) => ({ key: String(s), label: TEXT_SCALE_LABELS[i] }))}
        value={String(textScale)}
        onChange={(s) => setTextScale(Number(s))}
      />
      <PrimaryButton label="Done" onPress={() => setTextSizeOpen(false)} style={textSizeStyles.done} />
    </Dialog>
  );
}

const textSizeStyles = themedStyles(() => ({
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
  },
  buttonText: { ...font.bold, fontSize: 18, color: colors.strong },
  title: { ...font.bold, fontSize: fs(17), color: colors.text, textAlign: 'center', marginTop: 8 },
  preview: { ...font.regular, fontSize: fs(15), color: colors.muted, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  done: { marginHorizontal: 0, marginTop: 16 },
}));

```

### `src/components/BandPill.tsx`

```tsx
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

```

### `src/components/DeviceStatus.tsx`

```tsx
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useDevice } from '../state/DeviceContext';
import { useRun } from '../state/RunContext';
import { fs, colors, font, themedStyles } from '../theme';
import { formatTimeSgt } from '../utils/format';
import { PillButton } from './basics';

// "● sim01 · Online · Running": the device's own report of whether it is reachable
// (heartbeat) and whether it is breathing (latest telemetry phase).
export function DeviceStatusLine({ style }: { style?: object }) {
  const { deviceStatus, online, running, stale, latest } = useDevice();
  const id = deviceStatus?.deviceId ?? 'sim01';
  const state = !latest ? 'no data yet' : stale ? 'state unknown' : running ? `Running · ${latest.phase}` : 'Idle';
  const seen = deviceStatus?.lastSeen ? ` · last seen ${formatTimeSgt(deviceStatus.lastSeen)}` : '';
  const label = online ? `${id} · Online · ${state}` : `${id} · Offline${seen}`;
  return (
    <View style={[styles.row, style]} accessible accessibilityLabel={`Device ${label}`} accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.danger }]} />
      <Text style={[styles.text, { color: online ? colors.text : colors.danger }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

// Shown when the device is running but this app isn't recording it (started elsewhere,
// or before the app connected). Stop is always available.
export function UnrecordedRunCard({ style }: { style?: object }) {
  const { running } = useDevice();
  const { active, pendingStart, stopDevice } = useRun();
  const [sending, setSending] = useState(false);
  if (!running || active || pendingStart) return null;
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.cardText}>The device is running, but this run isn’t being recorded here.</Text>
      <PillButton
        label={sending ? 'Stopping…' : 'Stop'}
        kind="danger"
        bold
        width={92}
        onPress={async () => {
          setSending(true);
          await stopDevice();
          setSending(false);
        }}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { ...font.bold, fontSize: fs(14), flexShrink: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 24,
    marginTop: 14,
    padding: 16,
    paddingLeft: 20,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  cardText: { ...font.regular, flex: 1, fontSize: fs(14), lineHeight: fs(19), color: colors.text },
}));

```
