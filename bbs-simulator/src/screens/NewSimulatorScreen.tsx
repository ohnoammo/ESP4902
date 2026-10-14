import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, LinkText, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { SegmentedToggle, Slider } from '../components/controls';
import { BandPill } from '../components/BandPill';
import { breathLimitation } from '../constants/dutyBands';
import { HomeStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { SimMode } from '../types';
import { formatRatio } from '../utils/format';
import { BPM_RANGE, BREATH_DUTY_RANGE, DUTY_RANGE, IE_RANGE } from '../device';

// New and Edit simulator. Ranges are what the firmware and database accept, in whole numbers:
//   breath: peak duty 20–100 % (the firmware clamps to the 20 % floor), rate 5–40 bpm, I:E 1–4
//   free:   fixed duty 0–100 %
// A breath preset needs a breathing rate before it can be saved; the app never picks one.
const RANGES = {
  breathDuty: { ...BREATH_DUTY_RANGE, step: 1 },
  freeDuty: { ...DUTY_RANGE, step: 1 },
  respiratoryRate: { ...BPM_RANGE, step: 1 },
  ieRatio: { ...IE_RANGE, step: 0.5 },
};

export function NewSimulatorScreen({ navigation, route }: NativeStackScreenProps<HomeStackParams, 'NewSimulator'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { simulators, addSimulator, updateSimulator } = useData();
  const editing = simulators.find((s) => s.id === route.params?.simulatorId);
  const [name, setName] = useState(editing?.name ?? '');
  const [mode, setMode] = useState<SimMode>(editing?.mode ?? 'breath');
  const [duty, setDuty] = useState(editing?.duty ?? 50);
  const [respiratoryRate, setRespiratoryRate] = useState<number | null>(editing?.respiratoryRate ?? null);
  const [ieRatio, setIeRatio] = useState(editing?.ieRatio ?? 1);

  const breath = mode === 'breath';
  const shownDuty = breath ? Math.max(BREATH_DUTY_RANGE.min, duty) : duty;
  const rateMissing = breath && respiratoryRate === null;
  const valid = name.trim().length > 0 && !rateMissing;
  const limitation = breathLimitation({ mode, respiratoryRate, ieRatio });

  const save = () => {
    if (!valid) return;
    const sim = {
      name: name.trim(),
      mode,
      duty: shownDuty,
      respiratoryRate: breath ? respiratoryRate : null,
      ieRatio: breath ? ieRatio : 1,
    };
    if (editing) updateSimulator(editing.id, sim);
    else addSimulator(sim);
    navigation.goBack();
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingTop: top + 17 }]}
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
            placeholder="e.g. Walking / light"
            autoFocus={!editing}
            returnKeyType="done"
            maxLength={32}
            accessibilityLabel="Simulator name"
          />

          <View style={styles.mode}>
            <SegmentedToggle<SimMode>
              options={[
                { key: 'breath', label: 'Breathing' },
                { key: 'free', label: 'Free flow' },
              ]}
              value={mode}
              onChange={setMode}
            />
          </View>

          <Setting label={breath ? 'Peak duty' : 'Duty'} value={`${shownDuty} %`}>
            <Slider
              {...(breath ? RANGES.breathDuty : RANGES.freeDuty)}
              value={shownDuty}
              onChange={setDuty}
              accessibilityLabel={breath ? 'Peak duty' : 'Duty'}
            />
            <BandPill duty={shownDuty} note style={styles.band} />
            {breath && <Text style={styles.settingNote}>Inhale rises from the 20 % floor to this peak; exhale holds 20 %.</Text>}
          </Setting>

          {breath && (
            <>
              <Setting
                label="Respiratory rate"
                value={respiratoryRate === null ? 'Not set' : `${respiratoryRate} bpm`}
                note={respiratoryRate === null ? 'Required. Use a sourced rate; drag to set.' : undefined}
              >
                <Slider
                  {...RANGES.respiratoryRate}
                  value={respiratoryRate ?? BPM_RANGE.min}
                  onChange={setRespiratoryRate}
                  accessibilityLabel="Respiratory rate"
                />
              </Setting>
              <Setting label="I:E ratio" value={formatRatio(ieRatio)}>
                <Slider {...RANGES.ieRatio} value={ieRatio} onChange={setIeRatio} accessibilityLabel="I to E ratio" />
              </Setting>
              {limitation && <Text style={styles.limitation}>{limitation}</Text>}
            </>
          )}
        </ScrollView>
        <PrimaryButton
          label={editing ? 'Save changes' : 'Save simulator'}
          onPress={save}
          disabled={!valid}
          style={{ marginBottom: Math.max(insets.bottom, 20) + 36 }}
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
  content: { paddingHorizontal: 37, paddingBottom: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 33, marginBottom: 11 },
  mode: { marginTop: 26 },
  setting: { marginTop: 26 },
  settingHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  settingLabel: { ...font.bold, fontSize: fs(14), color: colors.strong },
  settingValue: { ...font.bold, fontSize: fs(15), color: colors.text },
  settingNote: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 6 },
  band: { marginTop: 10 },
  limitation: { ...font.regular, fontSize: fs(13), lineHeight: fs(18), color: colors.text, marginTop: 18, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.warning },
}));
