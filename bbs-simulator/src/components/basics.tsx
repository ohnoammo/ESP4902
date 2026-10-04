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
