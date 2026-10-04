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
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  accessibilityLabel: string;
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
  const nudge = (dir: 1 | -1) => onChange(Math.min(max, Math.max(min, value + dir * step)));

  return (
    <View
      style={sliderStyles.hit}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      {...responder.panHandlers}
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
