import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, RecordingStatus, Screen, useTopInset } from '../components/basics';
import { DeviceStatusLine } from '../components/DeviceStatus';
import { HomeStackParams } from '../navigation/types';
import { useRun } from '../state/RunContext';
import { useDevice } from '../state/DeviceContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { formatNumber, formatTimeSgt } from '../utils/format';
import { meanOf } from '../utils/telemetry';

// Live sensor values. Slow signals (BME280 temperature, humidity, pressure) are averaged over the newest
// second of telemetry; duty and rpm are the newest reading (the breath duty swings within a
// second, so an average would hide it). A sensor the firmware doesn't send shows
// "Not connected", never 0.
export function SensorsScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Sensors'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { active } = useRun();
  const { buffer, version, latest, mode } = useDevice();

  const second = useMemo(() => {
    const rows = buffer.current;
    if (!rows.length) return null;
    const end = rows[rows.length - 1].sampledAt;
    const last = rows.filter((r) => r.sampledAt > end - 1000);
    const newest = rows[rows.length - 1];
    return {
      at: end,
      temp: meanOf(last.map((r) => r.tempC)),
      rh: meanOf(last.map((r) => r.rhPct)),
      pres: meanOf(last.map((r) => r.pressureHpa)),
      duty: newest.dutyCmd,
      rpm: newest.rpmInhale,
      rpm2: newest.rpmExhale,
    };
  }, [version, buffer]);

  const rows: { label: string; value: string; sub?: string; muted?: boolean }[] = second
    ? [
        { label: 'Phase', value: latest?.phase ?? '–' },
        { label: 'Duty', value: second.duty === null ? '–' : `${formatNumber(second.duty, 0)} %`, sub: 'commanded' },
        { label: 'Inhale fan', value: `${formatNumber(second.rpm, 0)} rpm` },
        second.rpm2 === null
          ? { label: 'Exhale fan', value: 'Not connected', muted: true }
          : { label: 'Exhale fan', value: `${formatNumber(second.rpm2, 0)} rpm` },
        second.temp === null
          ? { label: 'Temperature', value: 'Not connected', muted: true }
          : { label: 'Temperature', value: `${formatNumber(second.temp, 1)} °C`, sub: 'BME280' },
        second.rh === null
          ? { label: 'Humidity', value: 'Not connected', muted: true }
          : { label: 'Humidity', value: `${formatNumber(second.rh, 1)} % RH`, sub: 'BME280' },
        second.pres === null
          ? { label: 'Ambient pressure', value: 'Not connected', muted: true }
          : { label: 'Ambient pressure', value: `${formatNumber(second.pres, 1)} hPa`, sub: 'BME280' },
      ]
    : [];

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top + 12, flexGrow: 1 }}>
        <BackButton label={active?.simulator.name ?? 'Back'} onPress={() => navigation.goBack()} />
        <Text style={[type.hero, styles.title]} accessibilityRole="header">
          Sensors
        </Text>
        {active ? (
          <RecordingStatus style={styles.recording} />
        ) : (
          <Text style={[type.meta, styles.recording]}>Not recording</Text>
        )}
        <DeviceStatusLine style={styles.status} />
        <View style={styles.cards} accessibilityLiveRegion="polite">
          {!second && <Text style={type.meta}>Waiting for readings from the device…</Text>}
          {rows.map((r) => (
            <View key={r.label} style={styles.card} accessible accessibilityLabel={`${r.label} ${r.value} ${r.sub ?? ''}`}>
              <Text style={styles.label}>{r.label}</Text>
              <View style={styles.valueBox}>
                <Text style={[styles.value, /\d/.test(r.value) && styles.valueNumber, r.muted && styles.valueMuted]}>{r.value}</Text>
                {r.sub && <Text style={styles.sub}>{r.sub}</Text>}
              </View>
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[styles.foot, { marginBottom: Math.max(insets.bottom, 20) + 24 }]}>
          {second ? `1 s average · ${formatTimeSgt(second.at)} SGT · ` : ''}
          {mode === 'demo' ? 'simulated readings' : 'live from the device'}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  title: { marginLeft: 40, marginTop: 12 },
  recording: { marginLeft: 48, marginTop: 8 },
  status: { marginLeft: 40, marginRight: 24, marginTop: 12 },
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
  cards: { marginTop: 24, marginHorizontal: 24, gap: 12 },
  card: {
    minHeight: 72,
    paddingVertical: 12,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 24,
    paddingRight: 24,
  },
  label: { ...font.bold, fontSize: fs(16), color: colors.strong, flex: 1 },
  valueBox: { alignItems: 'flex-end' },
  value: { ...font.bold, fontSize: fs(20), color: colors.text },
  valueNumber: { ...font.monoBold, fontSize: fs(18), letterSpacing: -0.4 },
  valueMuted: { ...font.regular, fontSize: fs(15), color: colors.muted },
  sub: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 2 },
  foot: { ...font.regular, fontSize: fs(13), color: colors.muted, textAlign: 'center', marginTop: 32 },
}));
