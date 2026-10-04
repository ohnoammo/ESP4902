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

// Ranges chosen so the Figma example (550 mL / 20 bpm / 1:2) lands exactly where
// the frame draws each thumb.
const RANGES = {
  tidalVolume: { min: 200, max: 800, step: 10 },
  respiratoryRate: { min: 8, max: 40, step: 1 },
  ieRatio: { min: 1, max: 4, step: 0.5 },
};

export function NewSimulatorScreen({ navigation }: NativeStackScreenProps<HomeStackParams, 'NewSimulator'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { addSimulator } = useData();
  const [name, setName] = useState('');
  const [tidalVolume, setTidalVolume] = useState(500);
  const [respiratoryRate, setRespiratoryRate] = useState(15);
  const [ieRatio, setIeRatio] = useState(2);
  const valid = name.trim().length > 0;

  const save = () => {
    if (!valid) return;
    addSimulator({ name: name.trim(), tidalVolume, respiratoryRate, ieRatio });
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

          <Setting label="Tidal volume" value={`${tidalVolume} mL`}>
            <Slider {...RANGES.tidalVolume} value={tidalVolume} onChange={setTidalVolume} accessibilityLabel="Tidal volume" />
          </Setting>
          <Setting label="Respiratory rate" value={`${respiratoryRate} bpm`}>
            <Slider
              {...RANGES.respiratoryRate}
              value={respiratoryRate}
              onChange={setRespiratoryRate}
              accessibilityLabel="Respiratory rate"
            />
          </Setting>
          <Setting label="I:E ratio" value={formatRatio(ieRatio)}>
            <Slider {...RANGES.ieRatio} value={ieRatio} onChange={setIeRatio} accessibilityLabel="I to E ratio" />
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

function Setting({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingHead}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      {children}
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
}));
