import React from 'react';
import { Image, Text, View } from 'react-native';
import { SessionMeta } from '../types';
import { fs, colors, font, themedStyles } from '../theme';
import { formatAxis, formatDuration } from '../utils/format';
import { EVENT_LABEL, ThermalEvent } from '../thermal/events';
import { TempUnit, fmtRise, fmtTemp } from '../thermal/units';
import { useThermal } from '../state/ThermalContext';

// What the thermal camera saw during a run: how long it was watching, and each leak or
// temperature alarm with when it happened (time into the run) and its worst value.
export function ThermalEventsCard({ run, events }: { run: SessionMeta; events: ThermalEvent[] }) {
  const unit = useThermal().settings.unit;
  const runEnd = run.endedAt ?? run.startedAt + run.durationSec * 1000;
  const clip = (e: ThermalEvent) => [Math.max(e.start, run.startedAt), Math.min(e.end ?? runEnd, runEnd)] as const;
  const watchingSec = events
    .filter((e) => e.kind === 'camera')
    .reduce((sum, e) => {
      const [a, b] = clip(e);
      return sum + Math.max(0, b - a) / 1000;
    }, 0);
  const alerts = events.filter((e) => e.kind !== 'camera');

  return (
    <View style={styles.card} accessible={alerts.length === 0}>
      <Text style={styles.title}>Thermal camera</Text>
      {watchingSec === 0 && alerts.length === 0 ? (
        <Text style={styles.muted}>The thermal camera wasn’t connected during this run.</Text>
      ) : (
        <>
          <Text style={styles.muted}>
            Watching for {formatDuration(Math.round(watchingSec))} of {formatDuration(Math.round(run.durationSec))}.
          </Text>
          {alerts.length === 0 ? (
            <Text style={styles.value}>No leaks or temperature alarms while watching.</Text>
          ) : (
            alerts.map((e) => {
              const [a, b] = clip(e);
              const from = formatAxis(Math.max(0, (a - run.startedAt) / 1000));
              const to = formatAxis(Math.max(0, (b - run.startedAt) / 1000));
              return (
                <View key={`${e.kind}-${e.start}`} style={styles.row} accessible accessibilityLabel={`${EVENT_LABEL[e.kind]}, ${from} to ${to} into the run. ${peakText(e, unit)}`}>
                  <View style={[styles.dot, { backgroundColor: e.kind === 'leak' ? colors.warning : colors.dangerInk }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.value}>{EVENT_LABEL[e.kind]}</Text>
                    <Text style={styles.meta}>
                      {from}–{to} into the run{peakText(e, unit) ? ` · ${peakText(e, unit)}` : ''}
                    </Text>
                    {e.snapshot && (
                      <Image
                        source={{ uri: e.snapshot }}
                        style={styles.snapshot}
                        resizeMode="stretch"
                        accessibilityLabel={`Thermal picture when the ${EVENT_LABEL[e.kind].toLowerCase()} started`}
                      />
                    )}
                  </View>
                </View>
              );
            })
          )}
          <Text style={styles.note}>Alert pictures are kept on the phone that ran the camera.</Text>
        </>
      )}
    </View>
  );
}

function peakText(e: ThermalEvent, u: TempUnit): string {
  if (e.peak === null) return '';
  if (e.kind === 'leak') return `up to ${fmtRise(e.peak, u)} above resting level`;
  if (e.kind === 'high') return `warmest ${fmtTemp(e.peak, u)}`;
  return `coolest ${fmtTemp(e.peak, u)}`;
}

const styles = themedStyles(() => ({
  card: {
    marginTop: 24,
    padding: 16,
    paddingLeft: 24,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 12,
  },
  title: { ...font.bold, fontSize: fs(16), color: colors.strong },
  muted: { ...font.regular, fontSize: fs(14), lineHeight: fs(19), color: colors.muted },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  value: { ...font.regular, fontSize: fs(14), lineHeight: fs(19), color: colors.text },
  meta: { ...font.mono, fontSize: fs(13), lineHeight: fs(18), color: colors.muted, marginTop: 2 },
  snapshot: { width: '100%', aspectRatio: 120 / 90, borderRadius: 12, marginTop: 8, backgroundColor: '#000000' },
  note: { ...font.regular, fontSize: fs(14), color: colors.muted },
}));
