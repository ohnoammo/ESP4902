import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, Icon, PrimaryButton, RecordingStatus, Screen, useTopInset } from '../components/basics';
import { LineGraph } from '../components/waves';
import { DeviceStatusLine } from '../components/DeviceStatus';
import { HomeStackParams } from '../navigation/types';
import { useRun } from '../state/RunContext';
import { useDevice } from '../state/DeviceContext';
import { fs, colors, font, heroSize, themedStyles, type } from '../theme';
import { formatClock } from '../utils/format';
import { CO2_WARN_PPM } from '../utils/telemetry';
import * as svgs from '../assets/svgs';

const LIVE_WINDOW_SEC = 20;

export function RunningScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Running'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { active, elapsed, stop, lastEnded } = useRun();
  const { buffer, version, latest, stale, online } = useDevice();
  const [stopping, setStopping] = useState(false);

  // Last LIVE_WINDOW_SEC of fan speeds, rebuilt only when the buffer changes (~3 Hz).
  const live = useMemo(() => {
    const rows = buffer.current;
    const end = rows.length ? rows[rows.length - 1].sampledAt : Date.now();
    const from = end - LIVE_WINDOW_SEC * 1000;
    const recent = rows.filter((r) => r.sampledAt >= from);
    const t = recent.map((r) => (r.sampledAt - from) / 1000);
    return [
      { t, v: recent.map((r) => r.rpmInhale), color: colors.strong },
      { t, v: recent.map((r) => r.rpmExhale), color: colors.seriesA },
    ];
  }, [version, buffer]);

  const openRecording = (id: string) => {
    navigation.popToTop();
    (navigation as any).navigate('SessionsTab', { screen: 'Session', params: { id }, initial: false });
  };

  if (!active) {
    return (
      <Screen style={{ paddingTop: top + 11 }}>
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        {lastEnded ? (
          <View style={styles.ended}>
            <Text style={type.heading}>Run ended</Text>
            <Text style={[type.meta, styles.endedText]}>
              {lastEnded.byDevice ? 'The device stopped, so the recording ended and was saved.' : 'The recording was saved.'}
            </Text>
            <PrimaryButton label="View recording" onPress={() => openRecording(lastEnded.sessionId)} style={styles.endedButton} />
          </View>
        ) : (
          <Text style={[type.meta, { margin: 37 }]}>No run in progress.</Text>
        )}
      </Screen>
    );
  }

  const sim = active.simulator;
  const onStop = async () => {
    setStopping(true);
    const id = await stop();
    setStopping(false);
    if (id) openRecording(id);
  };
  const co2High = !!latest && latest.co2Ppm > CO2_WARN_PPM;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top + 11, flexGrow: 1 }}>
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        <View style={styles.titleRow}>
          <Text style={[type.hero, styles.title, { fontSize: heroSize(sim.name) }]} numberOfLines={2} accessibilityRole="header">
            {sim.name}
          </Text>
          <Pressable
            onPress={() => navigation.navigate('Sensors')}
            accessibilityRole="button"
            accessibilityLabel="Sensor details"
            hitSlop={8}
            style={({ pressed }) => [styles.details, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.detailsText}>Details</Text>
            <Icon xml={svgs.detailsChevron} size={41} />
          </Pressable>
        </View>
        <DeviceStatusLine style={styles.status} />

        <Text style={styles.clock} accessibilityLabel={`Elapsed ${formatClock(elapsed)}`}>
          {formatClock(elapsed)}
        </Text>
        <RecordingStatus style={styles.recording} />

        {(stale || !online) && (
          <Text style={[styles.warning, styles.warningDanger]} accessibilityLiveRegion="polite">
            No live data from the device. If it lost the network it stops by itself within ~10 s; the run ends when it
            reports idle. Stop still works.
          </Text>
        )}
        {co2High && (
          <Text style={styles.warning} accessibilityLiveRegion="polite">
            CO2 is above 4.5 % ({Math.round(latest!.co2Ppm).toLocaleString('en-US')} ppm). The sensor saturates at 5 %, so readings may be capped.
          </Text>
        )}

        <View style={styles.chart}>
          <LineGraph height={190} duration={LIVE_WINDOW_SEC} unit="RPM" series={live} xLabels={[`−${LIVE_WINDOW_SEC} s`, 'now']} />
          <View style={styles.legend}>
            <Legend color={colors.strong} label="inhale fan" />
            <Legend color={colors.seriesA} label="exhale fan" />
          </View>
        </View>

        <View style={styles.readings}>
          <Reading value={String(sim.respiratoryRate)} unit="bpm" />
          <Reading value="–" unit="mL" note="Tidal volume not measured yet" />
          <Reading value="–" unit="cmH2O" note="Peak pressure not measured yet" />
        </View>

        <View style={{ flex: 1 }} />
        {/* Never disabled: Stop must always be pressable, even mid-send or offline. */}
        <PrimaryButton
          label={stopping ? 'Stopping…' : 'Stop'}
          variant="danger"
          onPress={onStop}
          style={{ marginTop: 32, marginBottom: Math.max(insets.bottom, 20) + 36 }}
        />
      </ScrollView>
    </Screen>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Reading({ value, unit, note }: { value: string; unit: string; note?: string }) {
  return (
    <View style={styles.reading} accessible accessibilityLabel={note ?? `${value} ${unit}`}>
      <Text style={[styles.readingValue, note && styles.readingMuted]}>{value}</Text>
      <Text style={styles.readingUnit}>{unit}</Text>
      {note && <Text style={styles.readingNote}>Not measured yet</Text>}
    </View>
  );
}

const styles = themedStyles(() => ({
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 11, paddingLeft: 37, paddingRight: 14 },
  title: { flex: 1 },
  status: { marginLeft: 37, marginRight: 24, marginTop: 4 },
  details: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  detailsText: { ...font.bold, fontSize: fs(16), color: colors.accentText, marginRight: -13 },
  clock: { ...font.bold, fontSize: fs(40), color: colors.text, textAlign: 'center', marginTop: 32, fontVariant: ['tabular-nums'] },
  recording: { alignSelf: 'center', marginTop: 6 },
  warning: {
    ...font.regular,
    fontSize: fs(13),
    lineHeight: fs(18),
    color: colors.text,
    marginHorizontal: 24,
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warningDanger: { borderColor: colors.danger },
  chart: { marginTop: 24, marginHorizontal: 24 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5 },
  legendText: { ...font.regular, fontSize: fs(13), color: colors.muted },
  readings: { flexDirection: 'row', paddingHorizontal: 37, marginTop: 28, gap: 12 },
  reading: { flex: 1 },
  readingValue: { ...font.regular, fontSize: fs(26), color: colors.text },
  readingMuted: { color: colors.muted },
  readingUnit: { ...font.regular, fontSize: fs(15), color: colors.muted, marginTop: 7 },
  readingNote: { ...font.regular, fontSize: fs(12), color: colors.muted, marginTop: 2 },
  ended: { marginHorizontal: 37, marginTop: 24 },
  endedText: { marginTop: 8 },
  endedButton: { marginHorizontal: 0, marginTop: 24 },
}));
