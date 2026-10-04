import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, Icon, PrimaryButton, RecordingStatus, Screen, useTopInset } from '../components/basics';
import { BreathWave } from '../components/waves';
import { HomeStackParams } from '../navigation/types';
import { useRun } from '../state/RunContext';
import { fs, colors, font, heroSize, themedStyles, type } from '../theme';
import { formatClock, formatNumber } from '../utils/format';
import * as svgs from '../assets/svgs';

export function RunningScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Running'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { active, elapsed, latest, live, stop } = useRun();
  const [stopping, setStopping] = useState(false);

  if (!active) {
    return (
      <Screen style={{ paddingTop: top + 11 }}>
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        <Text style={[type.meta, { margin: 37 }]}>No run in progress.</Text>
      </Screen>
    );
  }

  const sim = active.simulator;
  const onStop = async () => {
    setStopping(true);
    const id = await stop();
    navigation.popToTop();
    if (id) {
      // Land on the freshly saved recording, with the Sessions list underneath it.
      (navigation as any).navigate('SessionsTab', { screen: 'Session', params: { id }, initial: false });
    }
  };

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

        <Text style={styles.clock} accessibilityLabel={`Elapsed ${formatClock(elapsed)}`}>
          {formatClock(elapsed)}
        </Text>
        <RecordingStatus style={styles.recording} />

        <View style={styles.wave}>
          <BreathWave pattern={sim} height={180} startedAt={active.startedAt} live={live.current} />
        </View>

        <View style={styles.readings}>
          <Reading value={String(sim.respiratoryRate)} unit="bpm" width={117} />
          <Reading value={latest ? formatNumber(latest.tidalVolume, 0) : '–'} unit="mL" width={136} />
          <Reading value={latest ? formatNumber(latest.pressure, 1) : '–'} unit="cmH2O" />
        </View>

        <View style={{ flex: 1 }} />
        <PrimaryButton
          label="Stop"
          variant="danger"
          onPress={onStop}
          loading={stopping}
          style={{ marginTop: 40, marginBottom: Math.max(insets.bottom, 20) + 36 }}
        />
      </ScrollView>
    </Screen>
  );
}

function Reading({ value, unit, width }: { value: string; unit: string; width?: number }) {
  return (
    <View style={{ width }} accessible accessibilityLabel={`${value} ${unit}`}>
      <Text style={styles.readingValue}>{value}</Text>
      <Text style={styles.readingUnit}>{unit}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 11, paddingLeft: 37, paddingRight: 14 },
  title: { flex: 1 },
  details: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  detailsText: { ...font.bold, fontSize: fs(16), color: colors.accentText, marginRight: -13 },
  clock: { ...font.bold, fontSize: fs(40), color: colors.text, textAlign: 'center', marginTop: 52, fontVariant: ['tabular-nums'] },
  recording: { alignSelf: 'center', marginTop: 6 },
  wave: { marginTop: 50 },
  readings: { flexDirection: 'row', paddingLeft: 39, marginTop: 49 },
  readingValue: { ...font.regular, fontSize: fs(26), color: colors.text },
  readingUnit: { ...font.regular, fontSize: fs(15), color: colors.muted, marginTop: 7 },
}));
