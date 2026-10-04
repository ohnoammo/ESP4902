import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, LinkText, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { Slider } from '../components/controls';
import { HomeStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { formatRatio } from '../utils/format';
import { BPM_RANGE, DUTY_RANGE } from '../device';

// The ranges the database accepts for a start command (bpm 5–40, duty 0–100), in
// whole numbers. I:E is fixed at 1:1 by the current firmware, so its control is shown
// but disabled.
const RANGES = {
  respiratoryRate: { ...BPM_RANGE, step: 1 },
  duty: { ...DUTY_RANGE, step: 5 },
  ieRatio: { min: 1, max: 4, step: 0.5 },
};
const FIXED_IE = 1;

export function NewSimulatorScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'NewSimulator'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { addSimulator } = useData();
  const [name, setName] = useState('');
  const [respiratoryRate, setRespiratoryRate] = useState(15);
  const [duty, setDuty] = useState(60);
  const valid = name.trim().length > 0;

  const save = () => {
    if (!valid) return;
    addSimulator({ name: name.trim(), respiratoryRate, duty, ieRatio: FIXED_IE });
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
              New simulator
            </Text>
            <LinkText label="Cancel" bold={false} size={15} color={colors.muted} onPress={() => navigation.goBack()} />
          </View>

          <Text style={styles.fieldLabel}>Name</Text>
          <Field
            value={name}
            onChangeText={setName}
            placeholder="e.g. Athlete"
            autoFocus
            returnKeyType="done"
            maxLength={32}
            accessibilityLabel="Simulator name"
          />

          <Setting label="Respiratory rate" value={`${respiratoryRate} bpm`}>
            <Slider
              {...RANGES.respiratoryRate}
              value={respiratoryRate}
              onChange={setRespiratoryRate}
              accessibilityLabel="Respiratory rate"
            />
          </Setting>
          <Setting label="Blower power" value={`${duty} %`}>
            <Slider {...RANGES.duty} value={duty} onChange={setDuty} accessibilityLabel="Blower power" />
          </Setting>
          <Setting label="I:E ratio" value={formatRatio(FIXED_IE)} note="Fixed 1:1 in current firmware">
            <Slider {...RANGES.ieRatio} value={FIXED_IE} onChange={() => {}} disabled accessibilityLabel="I to E ratio, fixed 1:1 in current firmware" />
          </Setting>
        </ScrollView>
        <PrimaryButton
          label="Save simulator"
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
  setting: { marginTop: 30 },
  settingHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  settingLabel: { ...font.bold, fontSize: fs(14), color: colors.strong },
  settingValue: { ...font.bold, fontSize: fs(15), color: colors.text },
  settingNote: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 6 },
}));
