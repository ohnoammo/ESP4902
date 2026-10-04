import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, RecordingStatus, Screen, useTopInset } from '../components/basics';
import { HomeStackParams } from '../navigation/types';
import { useRun } from '../state/RunContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { formatNumber } from '../utils/format';

export function SensorsScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Sensors'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { active, latest } = useRun();

  const rows: [string, string][] = latest
    ? [
        ['Temperature', `${formatNumber(latest.temperature, 1)} °C`],
        ['CO2', `${formatNumber(latest.co2, 1)} %`],
        ['Humidity', `${formatNumber(latest.humidity, 0)} % RH`],
        ['Inhale fan', `${formatNumber(latest.inhaleFan, 0)} RPM`],
        ['Exhale fan', `${formatNumber(latest.exhaleFan, 0)} RPM`],
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
        <View style={styles.cards} accessibilityLiveRegion="polite">
          {rows.map(([label, value]) => (
            <View key={label} style={styles.card} accessible accessibilityLabel={`${label} ${value}`}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[styles.foot, { marginBottom: Math.max(insets.bottom, 20) + 24 }]}>
          All readings are saved with this run
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  title: { marginLeft: 37, marginTop: 11 },
  recording: { marginLeft: 44, marginTop: 8 },
  cards: { marginTop: 25, marginHorizontal: 24, gap: 12 },
  card: {
    height: 88,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 26,
  },
  label: { ...font.bold, fontSize: fs(16), color: colors.strong, flex: 1 },
  value: { ...font.bold, fontSize: fs(20), color: colors.text, width: 200, textAlign: 'center', marginRight: -10 },
  foot: { ...font.regular, fontSize: fs(13), color: colors.muted, textAlign: 'center', marginTop: 40 },
}));
