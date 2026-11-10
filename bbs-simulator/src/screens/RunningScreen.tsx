import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, Icon, PrimaryButton, RecordingStatus, Screen, useTopInset } from '../components/basics';
import { LineGraph } from '../components/waves';
import { DeviceStatusLine } from '../components/DeviceStatus';
import { BandPill, StateBanner } from '../components/BandPill';
import { PHASE_BANNERS } from '../constants/dutyBands';
import { HomeStackParams } from '../navigation/types';
import { useRun } from '../state/RunContext';
import { useDevice } from '../state/DeviceContext';
import { drivenRpm } from '../device/types';
import { fs, colors, font, heroSize, themedStyles, type } from '../theme';
import { formatClock, formatNumber, formatSettings } from '../utils/format';
import * as svgs from '../assets/svgs';
import { Reveal } from '../components/motion';
import { ToolLinks } from '../components/ToolLinks';
import { useThermalAlert } from '../state/ThermalContext';

const LIVE_WINDOW_SEC = 20;
// rpm is drawn as % of the rig's top speed (100 % duty, 15 V, open air) so it shares the duty
// axis: the gap between the two lines is the blower's lag behind the command.
const MAX_RPM = 20100;

export function RunningScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Running'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { active, elapsed, stop, lastEnded } = useRun();
  const thermalAlert = useThermalAlert();
  const { buffer, version, latest, stale, online } = useDevice();
  const [stopping, setStopping] = useState(false);

  // Last LIVE_WINDOW_SEC of commanded duty and blower rpm against sampled_at (not arrival
  // time: rows come in ~1 s batches, ~1 s late). Rebuilt only when the buffer changes (~3 Hz).
  const live = useMemo(() => {
    const rows = buffer.current;
    const end = rows.length ? rows[rows.length - 1].sampledAt : Date.now();
    const from = end - LIVE_WINDOW_SEC * 1000;
    const recent = rows.filter((r) => r.sampledAt >= from);
    const withDuty = recent.filter((r) => r.dutyCmd !== null);
    return [
      { t: withDuty.map((r) => (r.sampledAt - from) / 1000), v: withDuty.map((r) => r.dutyCmd as number), color: colors.seriesA },
      { t: recent.map((r) => (r.sampledAt - from) / 1000), v: recent.map((r) => (drivenRpm(r) / MAX_RPM) * 100), color: colors.strong },
    ];
  }, [version, buffer]);

  const openRecording = (id: string) => {
    navigation.popToTop();
    (navigation as any).navigate('SessionsTab', { screen: 'Session', params: { id }, initial: false });
  };

  if (!active) {
    return (
      <Screen style={{ paddingTop: top + 12 }}>
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        {lastEnded ? (
          <View style={styles.ended}>
            <Text style={type.heading}>Run ended</Text>
            <Text style={[type.meta, styles.endedText]}>
              {lastEnded.byDevice ? 'The device stopped, so the recording ended and was saved.' : 'The recording was saved.'}
            </Text>
            <PrimaryButton label="View recording" icon="compare" onPress={() => openRecording(lastEnded.sessionId)} style={styles.endedButton} />
          </View>
        ) : (
          <Text style={[type.meta, { margin: 40 }]}>No run in progress.</Text>
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
  const banner = latest && !stale ? PHASE_BANNERS[latest.phase] : undefined;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top + 12, paddingBottom: 12 }}>
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
        <Text style={styles.settings}>{formatSettings(sim)}</Text>
        <ToolLinks onOpen={(s) => navigation.navigate(s)} style={styles.tools} />

        <Reveal index={0}>
          <Text style={styles.clock} accessibilityLabel={`Elapsed ${formatClock(elapsed)}`}>
            {formatClock(elapsed)}
          </Text>
          <RecordingStatus style={styles.recording} />
        </Reveal>

        {banner && <StateBanner text={banner.text} level={banner.level} style={styles.banner} />}
        {thermalAlert && (
          <Pressable onPress={() => navigation.navigate('Thermal')} accessibilityRole="button" accessibilityHint="Opens the thermal camera">
            <StateBanner text={thermalAlert.text} level={thermalAlert.kind === 'leak' ? 'warn' : 'error'} style={styles.banner} />
          </Pressable>
        )}
        {(stale || !online) && (
          <Text style={[styles.warning, styles.warningDanger]} accessibilityLiveRegion="polite">
            No live data from the device. If it lost the network it stops by itself within ~10 s; the run ends when it
            reports idle. Stop still works.
          </Text>
        )}

        <Reveal index={1} style={styles.chart}>
          <LineGraph height={190} duration={LIVE_WINDOW_SEC} unit="%" series={live} xLabels={[`−${LIVE_WINDOW_SEC} s`, 'now']} yRange={[0, 100]} />
          <View style={styles.legend}>
            <Legend color={colors.seriesA} label="duty commanded" />
            <Legend color={colors.strong} label={`rpm (% of ${MAX_RPM.toLocaleString('en-US')})`} />
          </View>
        </Reveal>

        <Reveal index={2} style={styles.readings}>
          <Reading value={latest && !stale ? formatNumber(drivenRpm(latest), 0) : '–'} unit="rpm" />
          <Reading value={latest && !stale && latest.dutyCmd !== null ? formatNumber(latest.dutyCmd, 0) : '–'} unit="% duty" />
          <Reading value={latest && !stale ? latest.phase : '–'} unit="phase" small />
        </Reveal>
        <BandPill duty={sim.duty} note style={styles.band} />
        <Text style={styles.unmeasured}>Tidal volume and peak pressure: not measured yet</Text>

      </ScrollView>
      {/* Pinned outside the scroll so it is always on screen. Never disabled: Stop must
          always be pressable, even mid-send or offline. */}
      <PrimaryButton
        label={stopping ? 'Stopping…' : 'Stop'}
        icon="stop"
        variant="danger"
        onPress={onStop}
        style={{ marginTop: 12, marginBottom: Math.max(insets.bottom, 20) + 12 }}
      />
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

function Reading({ value, unit, small }: { value: string; unit: string; small?: boolean }) {
  return (
    <View style={styles.reading} accessible accessibilityLabel={`${value} ${unit}`}>
      <Text style={[styles.readingValue, small && styles.readingSmall]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.readingUnit}>{unit}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingLeft: 40, paddingRight: 16 },
  title: { flex: 1 },
  status: { marginLeft: 40, marginRight: 24, marginTop: 4 },
  tools: { marginHorizontal: 24, marginTop: 12 },
  settings: { ...font.regular, fontSize: fs(14), color: colors.muted, marginLeft: 40, marginTop: 4 },
  banner: { marginHorizontal: 24, marginTop: 16 },
  band: { marginHorizontal: 40, marginTop: 16 },
  details: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailsText: { ...font.bold, fontSize: fs(16), color: colors.accentText, marginRight: -13 },
  clock: { ...font.monoBold, fontSize: fs(40), letterSpacing: -1, color: colors.text, textAlign: 'center', marginTop: 32 },
  recording: { alignSelf: 'center', marginTop: 8 },
  warning: {
    ...font.regular,
    fontSize: fs(13),
    lineHeight: fs(18),
    color: colors.text,
    marginHorizontal: 24,
    marginTop: 16,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warningDanger: { borderColor: colors.dangerInk },
  chart: { marginTop: 24, marginHorizontal: 24 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5 },
  legendText: { ...font.regular, fontSize: fs(13), color: colors.muted },
  readings: { flexDirection: 'row', paddingHorizontal: 40, marginTop: 32, gap: 12 },
  reading: { flex: 1 },
  readingValue: { ...font.mono, fontSize: fs(24), letterSpacing: -0.5, color: colors.text },
  readingSmall: { fontSize: fs(17), lineHeight: fs(31) },
  readingUnit: { ...font.regular, fontSize: fs(15), color: colors.muted, marginTop: 8 },
  unmeasured: { ...font.regular, fontSize: fs(13), color: colors.muted, marginHorizontal: 40, marginTop: 24 },
  ended: { marginHorizontal: 40, marginTop: 24 },
  endedText: { marginTop: 8 },
  endedButton: { marginHorizontal: 0, marginTop: 24 },
}));
