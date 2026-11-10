import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, LinkText, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { SegmentedToggle, Slider } from '../components/controls';
import { BandPill } from '../components/BandPill';
import { statusColor } from '../components/ActivityPresets';
import { flowCheck, flowPeakDuty, PEAK_STATUS_LABEL, VT_RANGE } from '../constants/twin';
import { HomeStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { SimMode } from '../types';
import { formatNumber } from '../utils/format';
import { BPM_RANGE, DUTY_RANGE } from '../device';

// New and Edit simulator.
//   flow: tidal volume 0.1–2.5 L and rate 5–40 bpm, a 1:1 sinusoidal breath run by the digital
//         twin. The device's limit is on peak = pi * Vt * bpm (see flowCheck), so the screen
//         shows VE and the peak as you set them, and warns above 17 L/min (exhale fan) or
//         105 L/min (inhale fan).
//   free: fixed duty 0–100 %.
// A flow breath needs both a rate and a Vt before it can be saved; the app never picks them.
// A peak above a fan's capacity is only a warning: it still saves and runs, clipped.
const RANGES = {
  vt: { ...VT_RANGE },
  freeDuty: { ...DUTY_RANGE, step: 1 },
  respiratoryRate: { ...BPM_RANGE, step: 1 },
};

export function NewSimulatorScreen({ navigation, route }: NativeStackScreenProps<HomeStackParams, 'NewSimulator'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { simulators, addSimulator, updateSimulator } = useData();
  const editing = simulators.find((s) => s.id === route.params?.simulatorId);
  const [name, setName] = useState(editing?.name ?? '');
  const [mode, setMode] = useState<SimMode>(editing?.mode === 'free' ? 'free' : 'flow');
  const [duty, setDuty] = useState(editing?.mode === 'free' ? editing.duty : 50);
  const [respiratoryRate, setRespiratoryRate] = useState<number | null>(editing?.respiratoryRate ?? null);
  const [vt, setVt] = useState<number | null>(editing?.vt ?? null);

  const flow = mode === 'flow';
  const rateMissing = flow && respiratoryRate === null;
  const vtMissing = flow && vt === null;
  const check = flow && vt !== null && respiratoryRate !== null ? flowCheck(vt, respiratoryRate) : null;
  // Above a fan's capacity is a warning, never a block: the firmware clips the peak (fault 3).
  const valid = name.trim().length > 0 && !rateMissing && !vtMissing;

  const save = () => {
    if (!valid) return;
    const sim = flow
      ? { name: name.trim(), mode, vt, respiratoryRate, ieRatio: 1, duty: flowPeakDuty(vt!, respiratoryRate!) }
      : { name: name.trim(), mode, duty, respiratoryRate: null, ieRatio: 1 };
    if (editing) updateSimulator(editing.id, sim);
    else addSimulator(sim);
    navigation.goBack();
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingTop: top + 16 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={type.heading} accessibilityRole="header">
              {editing ? 'Edit simulator' : 'New simulator'}
            </Text>
            <LinkText label="Cancel" bold={false} size={15} color={colors.muted} onPress={() => navigation.goBack()} />
          </View>

          <Text style={styles.fieldLabel}>Name</Text>
          <Field
            value={name}
            onChangeText={setName}
            placeholder="e.g. Fit test, 1.5 L at 15 bpm"
            autoFocus={!editing}
            returnKeyType="done"
            maxLength={32}
            accessibilityLabel="Simulator name"
          />

          <View style={styles.mode}>
            <SegmentedToggle<SimMode>
              options={[
                { key: 'flow', label: 'Flow breath' },
                { key: 'free', label: 'Free flow' },
              ]}
              value={mode}
              onChange={setMode}
            />
          </View>

          {flow ? (
            <>
              <Setting
                label="Tidal volume"
                value={vt === null ? 'Not set' : `${formatNumber(vt, 2)} L`}
                note={vt === null ? 'Required. Drag to set.' : undefined}
              >
                <Slider {...RANGES.vt} value={vt ?? VT_RANGE.min} onChange={setVt} accessibilityLabel="Tidal volume" />
              </Setting>
              <Setting
                label="Breathing rate"
                value={respiratoryRate === null ? 'Not set' : `${respiratoryRate} bpm`}
                note={respiratoryRate === null ? 'Required. Drag to set.' : undefined}
              >
                <Slider
                  {...RANGES.respiratoryRate}
                  value={respiratoryRate ?? BPM_RANGE.min}
                  onChange={setRespiratoryRate}
                  accessibilityLabel="Breathing rate"
                />
              </Setting>
              {check && (
                <View style={styles.flowBox}>
                  <View style={styles.flowRow}>
                    <Text style={styles.settingLabel}>Minute ventilation (Vt × rate)</Text>
                    <Text style={styles.settingValue}>{formatNumber(check.ve, 1)} L/min</Text>
                  </View>
                  <View style={styles.flowRow}>
                    <Text style={styles.settingLabel}>Peak flow (π × VE)</Text>
                    <Text style={styles.peakValue}>{Math.round(check.peak)} L/min</Text>
                  </View>
                  <View style={styles.statusRow}>
                    <View style={[styles.dot, { backgroundColor: statusColor(check.status) }]} />
                    <Text style={styles.settingValue}>{PEAK_STATUS_LABEL[check.status]}</Text>
                  </View>
                  {check.message && <Text style={styles.settingNote}>{check.message}</Text>}
                  {!check.message && (
                    <Text style={styles.settingNote}>Within both fans’ capacity (exhale 17 L/min, inhale 105 L/min).</Text>
                  )}
                </View>
              )}
              <Text style={styles.settingNote}>
                A 1:1 sinusoidal breath. The digital twin sets the fan duty to deliver it and shows the result live.
              </Text>
            </>
          ) : (
            <Setting label="Duty" value={`${duty} %`}>
              <Slider {...RANGES.freeDuty} value={duty} onChange={setDuty} accessibilityLabel="Duty" />
              <BandPill duty={duty} note style={styles.band} />
            </Setting>
          )}
        </ScrollView>
        <PrimaryButton
          label={editing ? 'Save changes' : 'Save simulator'}
          icon="check"
          onPress={save}
          disabled={!valid}
          style={{ marginBottom: Math.max(insets.bottom, 20) + 40 }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Setting({ label, value, note, children }: { label: string; value: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingHead}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      {children}
      {note && <Text style={styles.settingNote}>{note}</Text>}
    </View>
  );
}

const styles = themedStyles(() => ({
  content: { paddingHorizontal: 40, paddingBottom: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 32, marginBottom: 12 },
  mode: { marginTop: 24 },
  setting: { marginTop: 24 },
  settingHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  settingLabel: { ...font.bold, fontSize: fs(14), color: colors.strong },
  settingValue: { ...font.bold, fontSize: fs(15), color: colors.text },
  settingNote: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 8 },
  band: { marginTop: 12 },
  flowBox: { marginTop: 24, padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, gap: 8 },
  flowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  peakValue: { ...font.monoBold, fontSize: fs(18), color: colors.accentText },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
}));
