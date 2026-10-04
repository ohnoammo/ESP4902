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
import { CO2_WARN_PPM, ppmToPercent } from '../utils/telemetry';

// Live sensor values. Slow signals (temperature, CO2, humidity) are averaged over the newest
// second of telemetry (it arrives at 10 Hz). Fan speeds are shown as the newest reading:
// the fans take turns by phase, so a 1 s average would blend a running and a stopped fan.
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
    const avg = (f: (r: (typeof last)[number]) => number) => last.reduce((s, r) => s + f(r), 0) / last.length;
    return {
      at: end,
      temp: avg((r) => r.tempC),
      co2: avg((r) => r.co2Ppm),
      co2Peak: Math.max(...last.map((r) => r.co2Ppm)),
      rh: avg((r) => r.rhPct),
      inhale: rows[rows.length - 1].rpmInhale,
      exhale: rows[rows.length - 1].rpmExhale,
    };
  }, [version, buffer]);

  const rows: { label: string; value: string; sub?: string; muted?: boolean }[] = second
    ? [
        { label: 'Phase', value: latest?.phase ?? '–' },
        { label: 'Temperature', value: `${formatNumber(second.temp, 1)} °C` },
        { label: 'CO2', value: `${formatNumber(ppmToPercent(second.co2), 2)} %`, sub: `${formatNumber(second.co2, 0)} ppm` },
        { label: 'Humidity', value: `${formatNumber(second.rh, 0)} % RH` },
        { label: 'Inhale fan', value: `${formatNumber(second.inhale, 0)} RPM` },
        { label: 'Exhale fan', value: `${formatNumber(second.exhale, 0)} RPM` },
        { label: 'Tidal volume', value: 'Not measured yet', muted: true },
        { label: 'Peak pressure', value: 'Not measured yet', muted: true },
      ]
    : [];

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top + 11, flexGrow: 1 }}>
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
        {second && second.co2Peak > CO2_WARN_PPM && (
          <Text style={styles.warning}>
            CO2 is above 4.5 %. The MH-Z16 sensor saturates at 5 % (50 000 ppm), so readings may be capped.
          </Text>
        )}
        <View style={styles.cards} accessibilityLiveRegion="polite">
          {!second && <Text style={type.meta}>Waiting for readings from the device…</Text>}
          {rows.map((r) => (
            <View key={r.label} style={styles.card} accessible accessibilityLabel={`${r.label} ${r.value} ${r.sub ?? ''}`}>
              <Text style={styles.label}>{r.label}</Text>
              <View style={styles.valueBox}>
                <Text style={[styles.value, r.muted && styles.valueMuted]}>{r.value}</Text>
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
  title: { marginLeft: 37, marginTop: 11 },
  recording: { marginLeft: 44, marginTop: 8 },
  status: { marginLeft: 37, marginRight: 24, marginTop: 10 },
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
  cards: { marginTop: 20, marginHorizontal: 24, gap: 10 },
  card: {
    minHeight: 72,
    paddingVertical: 10,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 26,
    paddingRight: 22,
  },
  label: { ...font.bold, fontSize: fs(16), color: colors.strong, flex: 1 },
  valueBox: { alignItems: 'flex-end' },
  value: { ...font.bold, fontSize: fs(20), color: colors.text },
  valueMuted: { ...font.regular, fontSize: fs(15), color: colors.muted },
  sub: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 2 },
  foot: { ...font.regular, fontSize: fs(13), color: colors.muted, textAlign: 'center', marginTop: 32 },
}));
