import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRun } from '../state/RunContext';
import { fs, colors, font, themedStyles } from '../theme';

// Persistent strip above every screen in demo mode, so simulated data is never mistaken
// for the real device. App.tsx renders it outside the navigator.
export function DemoBanner({ top }: { top: number }) {
  return (
    <View style={[styles.demo, { paddingTop: top + 6 }]} accessibilityRole="header" accessibilityLabel="Demo mode: simulated data, saved separately from real runs">
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
  const accent = { success: colors.success, info: colors.accent, warning: colors.warning, error: colors.danger }[notice.tone];
  return (
    <View style={[styles.notice, { bottom, borderLeftColor: accent }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Text style={styles.noticeText}>{notice.text}</Text>
      <Pressable onPress={dismissNotice} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss message">
        <Text style={styles.noticeClose}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  demo: { backgroundColor: colors.demo, paddingHorizontal: 20, paddingBottom: 7, alignItems: 'center' },
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
    paddingRight: 14,
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
