import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinkText, LiveDot, Screen, useTopInset } from '../components/basics';
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
import { formatRatio, formatSettings } from '../utils/format';
import { BandPill } from '../components/BandPill';
import { bandFor } from '../constants/dutyBands';
import { ActivityList, PresetsExplainer, statusColor } from '../components/ActivityPresets';
import { flowCheck, PEAK_STATUS_LABEL } from '../constants/twin';
import { Reveal } from '../components/motion';
import { ToolLinks } from '../components/ToolLinks';

export function SimulatorsScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'Simulators'>) {
  const top = useTopInset();
  const { simulators, deleteSimulator } = useData();
  const { active } = useRun();
  const [openId, setOpenId] = useState<string | null>(null);
  // Edit mode makes removing visible: each card shows a remove button and a tap opens its
  // Cancel / Delete panel (the same one a left swipe reveals).
  const [editing, setEditing] = useState(false);
  const isEditing = editing && simulators.length > 0;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingTop: top + 48 }]}>
        <Reveal index={0} style={styles.titleRow}>
          <Text style={type.hero} accessibilityRole="header">
            Simulators
          </Text>
          <TextSizeButton />
        </Reveal>
        <Reveal index={1}>
          <DeviceStatusLine style={styles.status} />
          <ToolLinks onOpen={(s) => navigation.navigate(s)} style={styles.tools} />
        </Reveal>
        <ActiveRunBanner />
        <UnrecordedRunCard />
        <Reveal index={2} style={styles.sectionRow}>
          <Text style={[styles.section, { marginTop: 0, marginLeft: 0 }]} accessibilityRole="header">Your simulators</Text>
          {simulators.length > 0 && (
            <LinkText
              label={isEditing ? 'Done' : 'Edit'}
              size={15}
              onPress={() => {
                setEditing(!isEditing);
                setOpenId(null);
              }}
            />
          )}
        </Reveal>
        <View style={styles.list}>
          {simulators.map((sim, i) => {
            const running = active?.simulator.id === sim.id;
            return (
              // Swipe left for Cancel / Delete, like runs in Sessions. Recorded runs keep their
              // own copy of the settings, so deleting a simulator never affects them.
              <Reveal key={sim.id} index={3 + i}>
              <SwipeToDelete
                style={styles.cardClip}
                open={openId === sim.id}
                onOpenChange={(o) => setOpenId(o ? sim.id : null)}
                onPress={() => (isEditing ? setOpenId(sim.id) : navigation.navigate('Ready', { simulatorId: sim.id }))}
                onDelete={() => {
                  setOpenId(null);
                  deleteSimulator(sim.id);
                  if (simulators.length === 1) setEditing(false);
                }}
                label={`${sim.name}: ${formatSettings(sim)}${sim.mode === 'flow' ? '' : `, ${bandFor(sim.duty).label}`}${running ? ', recording' : ''}`}
              >
                <SimulatorCard sim={sim} running={running} editing={isEditing} />
              </SwipeToDelete>
              </Reveal>
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
        <Text style={styles.section} accessibilityRole="header">Activity presets</Text>
        <View style={styles.activities}>
          <ActivityList onOpen={(id) => navigation.navigate('Ready', { simulatorId: id })} runningId={active?.simulator.id} />
          <PresetsExplainer />
        </View>
      </ScrollView>
    </Screen>
  );
}

function SimulatorCard({ sim, running, editing }: { sim: Simulator; running: boolean; editing: boolean }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.nameRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {sim.name}
          </Text>
          {running && (
            <LiveDot />
          )}
        </View>
        {editing ? (
          <View style={styles.remove} accessibilityLabel="Remove">
            <View style={styles.removeBar} />
          </View>
        ) : (
          <View style={styles.cardWave}>
            <MiniBreathWave pattern={sim} />
          </View>
        )}
      </View>
      <View style={styles.stats}>
        {sim.mode === 'free' ? (
          <>
            <Stat value={`${sim.duty} %`} label="fixed duty" />
            <Stat value="Free" label="continuous" />
          </>
        ) : sim.mode === 'flow' ? (
          <>
            <Stat value={sim.vt == null ? '–' : `${sim.vt} L`} label={sim.vt == null ? 'Vt not set' : 'tidal volume'} />
            <Stat value={sim.respiratoryRate === null ? '–' : `${sim.respiratoryRate} bpm`} label={sim.respiratoryRate === null ? 'rate not set' : 'resp. rate'} />
            <Stat
              value={sim.vt == null || sim.respiratoryRate === null ? '–' : `${Math.round(Math.PI * sim.vt * sim.respiratoryRate)}`}
              label="peak L/min"
            />
          </>
        ) : (
          <>
            <Stat value={`${sim.duty} %`} label="peak duty" />
            <Stat value={sim.respiratoryRate === null ? '–' : `${sim.respiratoryRate} bpm`} label={sim.respiratoryRate === null ? 'rate not set' : 'resp. rate'} />
            <Stat value={formatRatio(sim.ieRatio)} label="I:E ratio" />
          </>
        )}
      </View>
      {sim.mode === 'flow' ? <FlowStatus sim={sim} /> : <BandPill duty={sim.duty} style={styles.band} />}
    </View>
  );
}

// Flow breaths: where the peak sits against the device's limits (instead of a duty band).
function FlowStatus({ sim }: { sim: Simulator }) {
  if (sim.vt == null || sim.respiratoryRate === null) return null;
  const c = flowCheck(sim.vt, sim.respiratoryRate);
  return (
    <View style={styles.flowStatus}>
      <View style={[styles.flowDot, { backgroundColor: statusColor(c.status) }]} />
      <Text style={styles.flowStatusText}>{PEAK_STATUS_LABEL[c.status]}</Text>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, !/\d/.test(value) && styles.statWord]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  content: { paddingBottom: 72 },
  tools: { marginHorizontal: 24, marginTop: 16 },
  status: { marginLeft: 40, marginRight: 24, marginTop: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 40, paddingRight: 24 },
  section: { ...font.bold, fontSize: fs(15), color: colors.muted, marginTop: 32, marginLeft: 40 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginLeft: 40, marginRight: 32 },
  remove: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', marginRight: 24 },
  removeBar: { width: 14, height: 3, borderRadius: 1.5, backgroundColor: colors.onDanger },
  activities: { marginTop: 16, marginHorizontal: 24 },
  list: { marginTop: 16, marginHorizontal: 24, gap: 16 },
  cardClip: { borderRadius: 30 },
  card: {
    minHeight: 146,
    paddingBottom: 24,
    borderRadius: 30,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingLeft: 24,
    paddingTop: 32,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  cardName: { ...font.display, fontSize: fs(26), letterSpacing: -0.5, color: colors.text, flexShrink: 1 },
  cardWave: { marginRight: 24, marginTop: -2 },
  // 105pt columns in the 393pt frame; they narrow on smaller phones.
  stats: { flexDirection: 'row', marginTop: 24, paddingRight: 12 },
  band: { marginTop: 12 },
  stat: { flex: 1, maxWidth: 105 },
  statValue: { ...font.monoBold, fontSize: fs(17), letterSpacing: -0.4, color: colors.text },
  statWord: { ...font.bold, fontSize: fs(19) },
  statLabel: { ...font.regular, fontSize: fs(13), color: colors.subtle, marginTop: 4 },
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
  flowStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  flowDot: { width: 8, height: 8, borderRadius: 4 },
  flowStatusText: { ...font.regular, fontSize: fs(14), color: colors.text },
}));
