import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BackButton, Field, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { BreathWave } from '../components/waves';
import { DeviceStatusLine, UnrecordedRunCard } from '../components/DeviceStatus';
import { HomeStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { CommandOutcome, useRun } from '../state/RunContext';
import { useDevice } from '../state/DeviceContext';
import { fs, colors, font, heroSize, themedStyles, type } from '../theme';
import { formatRatio } from '../utils/format';

// What to tell the user about the latest Start, by its outcome.
const START_MESSAGES: Partial<Record<CommandOutcome, string>> = {
  pending: 'Start sent. Waiting for the device…',
  done: 'The device confirmed Start. Waiting for it to begin breathing…',
  'no-response': 'No response from device.',
  error: 'The device didn’t recognise the command.',
  expired: 'Start expired, device was unreachable. Press again.',
};

export function ReadyScreen({ navigation, route }: NativeStackScreenProps<HomeStackParams, 'Ready'>) {
  const top = useTopInset();
  const { simulators } = useData();
  const { active, pendingStart, startOutcome, startError, start, lastDetails } = useRun();
  // Test notes saved with the run; prefilled from the last run, since tests usually repeat a setup.
  const [headform, setHeadform] = useState(lastDetails.headform ?? '');
  const [mask, setMask] = useState(lastDetails.mask ?? '');
  const [notes, setNotes] = useState(lastDetails.notes ?? '');
  const { online, running } = useDevice();
  const sim = simulators.find((s) => s.id === route.params.simulatorId);

  const thisRunning = !!sim && active?.simulator.id === sim.id;
  const startedHere = !!sim && pendingStart?.simulator?.id === sim.id;

  // Recording begins when the telemetry shows the device breathing (the pending start is
  // cleared at that moment); if the start came from this screen, go to the live view.
  const startedFromHere = useRef(false);
  useEffect(() => {
    if (startedHere) startedFromHere.current = true;
    if (thisRunning && startedFromHere.current) {
      startedFromHere.current = false;
      navigation.navigate('Running');
    }
  }, [thisRunning, startedHere, navigation]);

  if (!sim) {
    return (
      <Screen style={{ paddingTop: top + 11 }}>
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        <Text style={[type.meta, { margin: 37 }]}>This simulator no longer exists.</Text>
      </Screen>
    );
  }

  const otherRunning = !!active && !thisRunning;
  const starting = !!pendingStart;
  // Start is disabled while a start is pending, while the device is offline, or while it
  // is already running (Stop for that is on the card above).
  const label = thisRunning
    ? 'View live run'
    : otherRunning
      ? `${active!.simulator.name} is recording`
      : starting
        ? 'Starting…'
        : !online
          ? 'Device offline'
          : running
            ? 'Device is already running'
            : 'Start';
  const disabled = !thisRunning && (otherRunning || starting || !online || running);
  const showOutcome = startOutcome && (startedHere || (startOutcome !== 'pending' && startOutcome !== 'done'));
  const message = startError ?? (showOutcome ? START_MESSAGES[startOutcome!] : null);
  const problem = !!startError || startOutcome === 'expired' || startOutcome === 'error' || startOutcome === 'no-response';

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: top + 11 }]}
      >
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        <View style={styles.titleRow}>
          <Text style={[type.hero, styles.title, { fontSize: heroSize(sim.name) }]} numberOfLines={2} accessibilityRole="header">
            {sim.name}
          </Text>
        </View>
        <DeviceStatusLine style={styles.status} />
        <UnrecordedRunCard />

        <View style={styles.wave}>
          <BreathWave pattern={sim} height={124} />
        </View>
        <Text style={styles.preview}>Preview of this pattern</Text>

        <View style={styles.params}>
          <ParamRow label="Respiratory rate" value={String(sim.respiratoryRate)} unit="bpm" />
          <ParamRow label="Blower power" value={String(sim.duty)} unit="%" />
          <ParamRow label="I:E ratio" value={formatRatio(sim.ieRatio)} note="Fixed 1:1 in current firmware" />
        </View>

        {!thisRunning && (
          <View style={styles.details}>
            <Text style={styles.detailsTitle}>Test details (optional)</Text>
            <Field value={headform} onChangeText={setHeadform} placeholder="Headform" maxLength={80} accessibilityLabel="Headform" />
            <Field value={mask} onChangeText={setMask} placeholder="Mask" maxLength={80} accessibilityLabel="Mask" />
            <Field
              value={notes}
              onChangeText={setNotes}
              placeholder="Notes"
              multiline
              maxLength={500}
              style={styles.notes}
              accessibilityLabel="Notes"
            />
          </View>
        )}

        <PrimaryButton
          label={label}
          onPress={() =>
            thisRunning
              ? navigation.navigate('Running')
              : start(sim, { headform: headform || null, mask: mask || null, notes: notes || null })
          }
          disabled={disabled}
          loading={starting && !thisRunning}
          style={styles.start}
        />
        {message && (
          <Text style={[styles.message, problem && styles.problem]} accessibilityLiveRegion="polite">
            {message}
          </Text>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ParamRow({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <View style={styles.param} accessible accessibilityLabel={`${label} ${value} ${unit ?? ''} ${note ?? ''}`}>
      <View style={styles.paramLabelBox}>
        <Text style={styles.paramLabel}>{label}</Text>
        {note && <Text style={styles.paramNote}>{note}</Text>}
      </View>
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
  status: { marginLeft: 37, marginRight: 24, marginTop: 6 },
  wave: { marginTop: 30 },
  preview: { ...font.bold, fontSize: fs(14), color: colors.muted, marginLeft: 37, marginTop: 15 },
  params: { marginTop: 31, marginHorizontal: 24, gap: 11 },
  param: {
    minHeight: 74,
    paddingVertical: 10,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 26,
    paddingRight: 20,
  },
  paramLabelBox: { flex: 1 },
  paramLabel: { ...font.bold, fontSize: fs(20), color: colors.strong },
  paramNote: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 3 },
  paramValue: { ...font.regular, fontSize: fs(20), color: colors.text, minWidth: 40, textAlign: 'right' },
  paramUnit: { ...font.regular, fontSize: fs(20), color: colors.text, minWidth: 44, textAlign: 'right' },
  details: { marginHorizontal: 24, marginTop: 20, gap: 10 },
  detailsTitle: { ...font.bold, fontSize: fs(14), color: colors.muted, marginLeft: 6 },
  notes: { height: undefined, minHeight: 72, paddingTop: 12, textAlignVertical: 'top' },
  start: { marginTop: 18 },
  message: { ...font.regular, fontSize: fs(14), lineHeight: fs(20), color: colors.muted, marginHorizontal: 37, marginTop: 12, textAlign: 'center' },
  problem: { ...font.bold, color: colors.danger },
}));
