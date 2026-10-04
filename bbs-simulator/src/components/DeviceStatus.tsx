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
