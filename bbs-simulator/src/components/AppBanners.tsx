import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ClippedFan, faultMessage, Q_MAX_IN } from '../constants/twin';
import { useDevice } from '../state/DeviceContext';
import { useRun } from '../state/RunContext';
import { fs, colors, font, themedStyles } from '../theme';

// Persistent strip above every screen in demo mode, so simulated data is never mistaken
// for the real device. App.tsx renders it outside the navigator.
export function DemoBanner({ top }: { top: number }) {
  return (
    <View style={[styles.demo, { paddingTop: top + 8 }]} accessibilityRole="header" accessibilityLabel="Demo mode: simulated data, saved separately from real runs">
      <Text style={styles.demoTitle}>DEMO · simulated data</Text>
      <Text style={styles.demoSub}>Not the real device. Demo runs are kept apart from real runs.</Text>
    </View>
  );
}

// App-wide message for things that finish after you have moved on (a Stop being
// confirmed, the device ending a run). Good news fades; problems stay until dismissed.
export function NoticeBar({ bottom }: { bottom: number }) {
  const { notice, dismissNotice } = useRun();
  useEffect(() => {
    if (!notice || (notice.tone !== 'success' && notice.tone !== 'info')) return;
    const id = setTimeout(dismissNotice, 6000);
    return () => clearTimeout(id);
  }, [notice, dismissNotice]);
  if (!notice) return null;
  const accent = { success: colors.success, info: colors.accent, warning: colors.warning, error: colors.dangerInk }[notice.tone];
  return (
    <View style={[styles.notice, { bottom, borderLeftColor: accent }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Text style={styles.noticeText}>{notice.text}</Text>
      <Pressable onPress={dismissNotice} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss message">
        <Text style={styles.noticeClose}>✕</Text>
      </Pressable>
    </View>
  );
}

// A fault stays shown this long after the last row that reported it, so fault 3 (only at the
// clipped peaks) reads as one steady banner instead of flashing every breath.
const FAULT_HOLD_MS = 5000;
// Most severe first: a stalled fan matters more than a clipped peak.
const FAULT_ORDER = [1, 2, 3] as const;

// The fault the device is reporting now (telemetry.fault), or null. For fault 3, which fan is
// clipped comes from the target flow: only a target above the inhale fan's capacity clips
// inhale; anything else above the exhale fan's is the exhale fan.
export type ActiveFault = { code: 1 | 2 | 3; clipped: ClippedFan };
export function useActiveFault(): ActiveFault | null {
  const { buffer, version, running } = useDevice();
  return useMemo(() => {
    if (!running) return null;
    const rows = buffer.current;
    if (!rows.length) return null;
    const from = rows[rows.length - 1].sampledAt - FAULT_HOLD_MS;
    const seen = new Set<number>();
    let inhale = false;
    let exhale = false;
    for (let i = rows.length - 1; i >= 0 && rows[i].sampledAt >= from; i--) {
      const tw = rows[i].twin;
      if (!tw?.fault) continue;
      seen.add(tw.fault);
      if (tw.fault === 3) {
        if (rows[i].phase === 'inhale' && (tw.qTarget ?? 0) > Q_MAX_IN) inhale = true;
        else exhale = true; // exhale, or the end of inhale while the exhale fan is already driven
      }
    }
    const code = FAULT_ORDER.find((c) => seen.has(c));
    if (!code) return null;
    return { code, clipped: inhale && exhale ? 'both' : inhale ? 'inhale' : 'exhale' };
  }, [version, running, buffer]);
}

// The fault to show, with its dismiss: once dismissed it stays hidden until the run ends,
// unless a more severe fault (lower code) appears.
export function useFaultBanner() {
  const fault = useActiveFault();
  const { running } = useDevice();
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    if (!running) setDismissed(null);
  }, [running]);
  const shown = fault && (dismissed === null || fault.code < dismissed) ? fault : null;
  return { fault: shown, dismiss: () => fault && setDismissed(fault.code) };
}

// Non-blocking strip under the demo banner while the device reports a fault. It sits in the
// layout (not over it), so it never covers Stop. Red only for a stalled fan (an error);
// clipping and trim are warnings. The code is always in words too, never colour alone.
export function FaultBanner({
  fault,
  top,
  onDismiss,
}: {
  fault: ActiveFault;
  top: number;
  onDismiss: () => void;
}) {
  const error = fault.code === 1;
  return (
    <View
      style={[styles.fault, { paddingTop: top + 10, borderLeftColor: error ? colors.dangerInk : colors.warning }]}
      accessibilityLiveRegion="polite"
    >
      <View style={{ flex: 1 }} accessible accessibilityRole="alert">
        <Text style={styles.faultTag}>
          {error ? 'Fault' : 'Warning'} · code {fault.code}
        </Text>
        <Text style={styles.noticeText}>{faultMessage(fault.code, fault.clipped)}</Text>
      </View>
      <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide this warning until the run ends">
        <Text style={styles.noticeClose}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  fault: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderLeftWidth: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 10,
  },
  faultTag: { ...font.bold, fontSize: fs(12), letterSpacing: 0.5, color: colors.muted, marginBottom: 2 },

  demo: { backgroundColor: colors.demo, paddingHorizontal: 16, paddingBottom: 8, alignItems: 'center' },
  demoTitle: { ...font.bold, fontSize: 15, letterSpacing: 1, color: colors.onDemo },
  demoSub: { ...font.regular, fontSize: 12, color: colors.onDemo, marginTop: 1, textAlign: 'center' },
  notice: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 16,
    borderRadius: 16,
    borderLeftWidth: 5,
    backgroundColor: colors.card,
    borderColor: colors.dialogBorder,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  noticeText: { ...font.regular, flex: 1, fontSize: fs(14), lineHeight: fs(19), color: colors.text },
  noticeClose: { ...font.bold, fontSize: 16, color: colors.muted },
}));
