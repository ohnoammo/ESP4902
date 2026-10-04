import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BackButton, Icon, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { BreathWave } from '../components/waves';
import { HomeStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { useRun } from '../state/RunContext';
import { useConnection } from '../state/ConnectionContext';
import { fs, colors, font, heroSize, themedStyles, type } from '../theme';
import { formatRatio } from '../utils/format';
import * as svgs from '../assets/svgs';

export function ReadyScreen({ navigation, route }: NativeStackScreenProps<HomeStackParams, 'Ready'>) {
  const top = useTopInset();
  const { simulators } = useData();
  const { active, start } = useRun();
  const { status } = useConnection();
  const [starting, setStarting] = useState(false);
  const sim = simulators.find((s) => s.id === route.params.simulatorId);

  if (!sim) {
    return (
      <Screen style={{ paddingTop: top + 11 }}>
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        <Text style={[type.meta, { margin: 37 }]}>This simulator no longer exists.</Text>
      </Screen>
    );
  }

  const thisRunning = active?.simulator.id === sim.id;
  const otherRunning = !!active && !thisRunning;

  const onStart = async () => {
    if (thisRunning) return navigation.navigate('Running');
    setStarting(true);
    try {
      await start(sim);
      navigation.navigate('Running');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingTop: top + 11 }]}>
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        <View style={styles.titleRow}>
          <Text style={[type.hero, styles.title, { fontSize: heroSize(sim.name) }]} numberOfLines={2} accessibilityRole="header">
            {sim.name}
          </Text>
          <View style={styles.status}>
            <Icon xml={svgs.dotConnected} size={10} />
            <Text style={styles.statusText}>{status === 'connected' ? 'Connected' : 'Offline'}</Text>
          </View>
        </View>

        <View style={styles.wave}>
          <BreathWave pattern={sim} height={124} />
        </View>
        <Text style={styles.preview}>Preview of this pattern</Text>

        <View style={styles.params}>
          <ParamRow label="Tidal volume" value={String(sim.tidalVolume)} unit="mL" />
          <ParamRow label="Respiratory rate" value={String(sim.respiratoryRate)} unit="bpm" />
          <ParamRow label="I:E ratio" value={formatRatio(sim.ieRatio)} />
        </View>

        <PrimaryButton
          label={thisRunning ? 'View live run' : otherRunning ? `${active!.simulator.name} is recording` : 'Start'}
          onPress={onStart}
          disabled={otherRunning}
          loading={starting}
          style={styles.start}
        />
      </ScrollView>
    </Screen>
  );
}

function ParamRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.param} accessible accessibilityLabel={`${label} ${value} ${unit ?? ''}`}>
      <Text style={styles.paramLabel}>{label}</Text>
      <Text style={styles.paramValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.paramUnit} numberOfLines={1}>
        {unit ?? ''}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  content: { paddingBottom: 60 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 11, paddingLeft: 37, paddingRight: 34 },
  title: { flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  statusText: { ...font.bold, fontSize: fs(16), color: colors.success },
  wave: { marginTop: 44 },
  preview: { ...font.bold, fontSize: fs(14), color: colors.muted, marginLeft: 37, marginTop: 15 },
  params: { marginTop: 31, marginHorizontal: 24, gap: 11 },
  param: {
    height: 74,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 26,
  },
  paramLabel: { ...font.bold, fontSize: fs(20), color: colors.strong, width: 188 },
  paramValue: { ...font.regular, fontSize: fs(20), color: colors.text, minWidth: 50 },
  paramUnit: { ...font.regular, fontSize: fs(20), color: colors.text, minWidth: 44, textAlign: 'right' },
  start: { marginTop: 15 },
}));
