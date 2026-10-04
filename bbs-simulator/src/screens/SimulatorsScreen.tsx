import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Icon, Screen, useTopInset } from '../components/basics';
import { ActiveRunBanner } from '../components/ActiveRunBanner';
import { DeviceStatusLine, UnrecordedRunCard } from '../components/DeviceStatus';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { TextSizeButton } from '../components/controls';
import { MiniBreathWave } from '../components/waves';
import { HomeStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { useRun } from '../state/RunContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { Simulator } from '../types';
import { formatRatio } from '../utils/format';
import * as svgs from '../assets/svgs';

export function SimulatorsScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Simulators'>) {
  const top = useTopInset();
  const { simulators, deleteSimulator } = useData();
  const { active } = useRun();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingTop: top + 47 }]}>
        <View style={styles.titleRow}>
          <Text style={type.hero} accessibilityRole="header">
            Simulators
          </Text>
          <TextSizeButton />
        </View>
        <DeviceStatusLine style={styles.status} />
        <ActiveRunBanner />
        <UnrecordedRunCard />
        <View style={styles.list}>
          {simulators.map((sim) => {
            const running = active?.simulator.id === sim.id;
            return (
              // Swipe left for Cancel / Delete, like runs in Sessions. Recorded runs keep their
              // own copy of the settings, so deleting a simulator never affects them.
              <SwipeToDelete
                key={sim.id}
                style={styles.cardClip}
                open={openId === sim.id}
                onOpenChange={(o) => setOpenId(o ? sim.id : null)}
                onPress={() => navigation.navigate('Ready', { simulatorId: sim.id })}
                onDelete={() => {
                  setOpenId(null);
                  deleteSimulator(sim.id);
                }}
                label={`${sim.name}: ${sim.respiratoryRate} breaths per minute, blower ${sim.duty} percent, I to E ${formatRatio(sim.ieRatio)}${running ? ', recording' : ''}`}
              >
                <SimulatorCard sim={sim} running={running} />
              </SwipeToDelete>
            );
          })}
          <Pressable
            onPress={() => navigation.navigate('NewSimulator')}
            accessibilityRole="button"
            accessibilityLabel="Add simulator"
            style={({ pressed }) => [styles.add, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.addText}>+ Add simulator</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function SimulatorCard({ sim, running }: { sim: Simulator; running: boolean }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.nameRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {sim.name}
          </Text>
          {running && <Icon xml={svgs.dotRecording} size={8} />}
        </View>
        <View style={styles.cardWave}>
          <MiniBreathWave pattern={sim} />
        </View>
      </View>
      <View style={styles.stats}>
        <Stat value={`${sim.respiratoryRate} bpm`} label="resp. rate" />
        <Stat value={`${sim.duty} %`} label="blower" />
        <Stat value={formatRatio(sim.ieRatio)} label="I:E ratio" />
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  content: { paddingBottom: 70 },
  status: { marginLeft: 37, marginRight: 24, marginTop: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 37, paddingRight: 24 },
  list: { marginTop: 26, marginHorizontal: 24, gap: 18 },
  cardClip: { borderRadius: 30 },
  card: {
    minHeight: 146,
    paddingBottom: 20,
    borderRadius: 30,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingLeft: 26,
    paddingTop: 28,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  cardName: { ...font.bold, fontSize: fs(26), color: colors.text, flexShrink: 1 },
  cardWave: { marginRight: 23, marginTop: -2 },
  // 105pt columns in the 393pt frame; they narrow on smaller phones.
  stats: { flexDirection: 'row', marginTop: 32, paddingRight: 12 },
  stat: { flex: 1, maxWidth: 105 },
  statValue: { ...font.bold, fontSize: fs(20), color: colors.text },
  statLabel: { ...font.regular, fontSize: fs(13), color: colors.subtle, marginTop: 3 },
  add: {
    height: 110,
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { ...font.bold, fontSize: fs(18), color: colors.strong },
}));
