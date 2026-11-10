import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BackButton, Field, LinkText, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { BandPill } from '../components/BandPill';
import { breathLimitation } from '../constants/dutyBands';
import { BreathWave } from '../components/waves';
import { DeviceStatusLine, UnrecordedRunCard } from '../components/DeviceStatus';
import { HomeStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { ACTIVITY_SIMULATORS } from '../constants/presets';
import { flowCheck, PEAK_STATUS_LABEL } from '../constants/twin';
import { CommandOutcome, useRun } from '../state/RunContext';
import { useDevice } from '../state/DeviceContext';
import { fs, colors, font, heroSize, themedStyles, type } from '../theme';
import { formatRatio } from '../utils/format';
import { Reveal } from '../components/motion';

// What to tell the user about the latest Start, by its outcome.
const START_MESSAGES: Partial<Record<CommandOutcome, string>> = {
  pending: 'Start sent. Waiting for the device…',
  done: 'The device confirmed Start. Waiting for it to start running…',
  'no-response': 'No response from device.',
  error: 'Device rejected the command.',
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
  // The user's own simulators, or a built-in activity preset (fixed: no Edit).
  const sim = [...simulators, ...ACTIVITY_SIMULATORS].find((s) => s.id === route.params.simulatorId);

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
      <Screen style={{ paddingTop: top + 12 }}>
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        <Text style={[type.meta, { margin: 40 }]}>This simulator no longer exists.</Text>
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
  // A breath preset can't start without a breathing rate (the database requires one), nor a
  // flow breath without a tidal volume.
  const rateMissing = sim.mode !== 'free' && (sim.respiratoryRate === null || (sim.mode === 'flow' && sim.vt == null));
  const disabled = !thisRunning && (otherRunning || starting || !online || running || rateMissing);
  const showOutcome = startOutcome && (startedHere || (startOutcome !== 'pending' && startOutcome !== 'done'));
  const message = rateMissing && !thisRunning ? (sim.mode === 'flow' ? 'Set the tidal volume and rate first.' : 'Set the respiratory rate first.') : (startError ?? (showOutcome ? START_MESSAGES[startOutcome!] : null));
  const problem = rateMissing || !!startError || startOutcome === 'expired' || startOutcome === 'error' || startOutcome === 'no-response';

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: top + 12 }]}
      >
        <BackButton label="Simulators" onPress={() => navigation.popTo('Simulators')} />
        <View style={styles.titleRow}>
          <Text style={[type.hero, styles.title, { fontSize: heroSize(sim.name) }]} numberOfLines={2} accessibilityRole="header">
            {sim.name}
          </Text>
          {!thisRunning && !sim.activity && <LinkText label="Edit" onPress={() => navigation.navigate('NewSimulator', { simulatorId: sim.id })} />}
        </View>
        <DeviceStatusLine style={styles.status} />
        <UnrecordedRunCard />

        <Reveal index={0} style={styles.wave}>
          <BreathWave pattern={sim} height={124} />
        </Reveal>
        <Text style={styles.preview}>
          {sim.mode === 'free'
            ? 'Commanded duty · Continuous flow'
            : rateMissing
              ? 'Commanded duty · set the breath to preview'
              : sim.mode === 'flow'
                ? 'Duty the digital twin commands for this breath (inhale fan, then exhale fan)'
                : 'Commanded duty (not airflow)'}
        </Text>

        <Reveal index={1} style={styles.params}>
          {sim.mode === 'free' ? (
            <>
              <ParamRow first label="Mode" value="Free flow" />
              <ParamRow label="Fan" value={sim.fan === 'exhale' ? 'Exhale (blows out)' : 'Inhale (sucks in)'} />
              <ParamRow label="Duty" value={String(sim.duty)} unit="%" />
            </>
          ) : sim.mode === 'flow' ? (
            <>
              <ParamRow first label="Tidal volume" value={sim.vt == null ? 'Not set' : String(sim.vt)} unit={sim.vt == null ? undefined : 'L'} />
              <ParamRow
                label="Breathing rate"
                value={sim.respiratoryRate === null ? 'Not set' : String(sim.respiratoryRate)}
                unit={sim.respiratoryRate === null ? undefined : 'bpm'}
              />
              {sim.vt != null && sim.respiratoryRate !== null && (
                <>
                  <ParamRow label="Minute ventilation" value={(sim.vt * sim.respiratoryRate).toFixed(1)} unit="L/min" />
                  <ParamRow label="Peak flow" value={String(Math.round(Math.PI * sim.vt * sim.respiratoryRate))} unit="L/min"
                    note={PEAK_STATUS_LABEL[flowCheck(sim.vt, sim.respiratoryRate).status]} />
                </>
              )}
            </>
          ) : (
            <>
              <ParamRow first label="Peak duty" value={String(sim.duty)} unit="%" note="Exhale holds the 20 % floor" />
              <ParamRow
                label="Respiratory rate"
                value={sim.respiratoryRate === null ? 'Not set' : String(sim.respiratoryRate)}
                unit={sim.respiratoryRate === null ? undefined : 'bpm'}
              />
              <ParamRow label="I:E ratio" value={formatRatio(sim.ieRatio)} />
            </>
          )}
        </Reveal>
        {sim.mode !== 'flow' && <BandPill duty={sim.duty} note style={styles.band} />}
        {breathLimitation(sim) && <Text style={styles.limitation}>{breathLimitation(sim)}</Text>}

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
          icon={thisRunning ? 'live' : 'play'}
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

function ParamRow({ label, value, unit, note, first }: { label: string; value: string; unit?: string; note?: string; first?: boolean }) {
  return (
    <View style={[styles.param, !first && styles.paramRule]} accessible accessibilityLabel={`${label} ${value} ${unit ?? ''} ${note ?? ''}`}>
      <View style={styles.paramLabelBox}>
        <Text style={styles.paramLabel}>{label}</Text>
        {note && <Text style={styles.paramNote}>{note}</Text>}
      </View>
      {/* Numbers in the readout mono; words ("Free flow", "Not set") stay in the sans. */}
      <Text style={[styles.paramValue, !/\d/.test(value) && styles.paramWord]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.paramUnit} numberOfLines={1}>
        {unit ?? ''}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  content: { paddingBottom: 64 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingLeft: 40, paddingRight: 32 },
  title: { flex: 1 },
  status: { marginLeft: 40, marginRight: 24, marginTop: 8 },
  wave: { marginTop: 32 },
  preview: { ...font.bold, fontSize: fs(14), color: colors.muted, marginLeft: 40, marginTop: 16 },
  // One card, rows split by hairlines: the settings read as a single spec sheet.
  params: {
    marginTop: 32,
    marginHorizontal: 24,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 24,
  },
  param: { minHeight: 60, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' },
  paramRule: { borderTopWidth: 1, borderTopColor: colors.dividerDim },
  paramLabelBox: { flex: 1 },
  // Labels step back (muted, regular); the values are what you check before Start.
  paramLabel: { ...font.regular, fontSize: fs(16), color: colors.muted },
  paramNote: { ...font.regular, fontSize: fs(13), color: colors.muted, opacity: 0.8, marginTop: 2 },
  paramValue: { ...font.monoBold, fontSize: fs(20), letterSpacing: -0.4, color: colors.strong, minWidth: 40, textAlign: 'right' },
  paramWord: { ...font.bold, fontSize: fs(18), letterSpacing: 0 },
  paramUnit: { ...font.regular, fontSize: fs(15), color: colors.muted, minWidth: 38, textAlign: 'right' },
  details: { marginHorizontal: 24, marginTop: 24, gap: 12 },
  detailsTitle: { ...font.bold, fontSize: fs(14), color: colors.muted, marginLeft: 8 },
  notes: { height: undefined, minHeight: 72, paddingTop: 12, textAlignVertical: 'top' },
  start: { marginTop: 16 },
  band: { marginHorizontal: 40, marginTop: 16 },
  limitation: { ...font.regular, fontSize: fs(13), lineHeight: fs(18), color: colors.text, marginHorizontal: 24, marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.warning },
  message: { ...font.regular, fontSize: fs(14), lineHeight: fs(20), color: colors.muted, marginHorizontal: 40, marginTop: 12, textAlign: 'center' },
  problem: { ...font.bold, color: colors.dangerInk },
}));
