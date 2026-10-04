import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, Field, Icon, LinkText, OutlinePill, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { SegmentedToggle, SensorChips } from '../components/controls';
import { SensorPanel } from '../components/SensorPanel';
import { SessionsStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { fs, colors, heroSize, themedStyles, type } from '../theme';
import { Sample, SensorKey } from '../types';
import { formatRunMeta } from '../utils/format';
import { buildCsv, csvFileName, exportCsv } from '../utils/csv';
import * as svgs from '../assets/svgs';
import { themedSvgs } from '../assets/themedSvgs';

export function SessionScreen({ navigation, route }: NativeStackScreenProps<SessionsStackParams, 'Session'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { sessions, loadSamples, renameSession } = useData();
  const run = sessions.find((s) => s.id === route.params.id);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [sensor, setSensor] = useState<SensorKey>('temp');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSamples(route.params.id).then((s) => alive && setSamples(s));
    return () => {
      alive = false;
    };
  }, [route.params.id, loadSamples]);

  if (!run) {
    return (
      <Screen style={{ paddingTop: top + 11 }}>
        <BackButton label="Sessions" onPress={() => navigation.goBack()} />
        <Text style={[type.meta, { margin: 37 }]}>This run was deleted.</Text>
      </Screen>
    );
  }

  const startEdit = () => {
    setDraft(run.name);
    setEditing(true);
  };
  const saveName = () => {
    const name = draft.trim();
    if (name) renameSession(run.id, name);
    setEditing(false);
  };
  const onExport = async () => {
    if (!samples) return;
    setExporting(true);
    try {
      await exportCsv(csvFileName(run.name), buildCsv([{ meta: run, samples }]));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: top + 11, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {editing ? (
            // Frame 13: rename mode swaps the back link for Cancel and the title for a field.
            <>
              <View style={styles.cancelRow}>
                <LinkText label="Cancel" bold={false} size={15} color={colors.muted} onPress={() => setEditing(false)} />
              </View>
              <Field
                big
                value={draft}
                onChangeText={setDraft}
                autoFocus
                selectTextOnFocus
                onSubmitEditing={saveName}
                returnKeyType="done"
                maxLength={40}
                style={styles.nameField}
                accessibilityLabel="Run name"
              />
            </>
          ) : (
            <>
              <BackButton label="Sessions" onPress={() => navigation.goBack()} />
              <View style={styles.titleRow}>
                <Text style={[type.hero, { flex: 1, minWidth: 0, fontSize: heroSize(run.name) }]} numberOfLines={2} accessibilityRole="header">
                  {run.name}
                </Text>
                <OutlinePill label="Ask" accessibilityLabel="Ask about this run" onPress={() => navigation.navigate('Assistant', { runId: run.id })} />
                <Pressable
                  onPress={startEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Rename run"
                  style={({ pressed }) => pressed && { opacity: 0.7 }}
                >
                  <Icon xml={themedSvgs.editButton()} size={54} />
                </Pressable>
              </View>
            </>
          )}
          <Text style={[styles.meta, editing && { marginTop: 24 }]}>
            {formatRunMeta(run.startedAt, run.durationSec)}
          </Text>

          <View style={styles.body}>
            <SegmentedToggle
              options={[
                { key: 'graph', label: 'Graph' },
                { key: 'table', label: 'Table' },
              ]}
              value={view}
              onChange={setView}
            />
            <View style={styles.chips}>
              <SensorChips value={sensor} onChange={setSensor} />
            </View>
            <View style={styles.panel}>
              {samples && <SensorPanel samples={samples} sensor={sensor} view={view} duration={run.durationSec} />}
            </View>
          </View>
        </ScrollView>
        <PrimaryButton
          label={editing ? 'Save' : 'Export CSV'}
          onPress={editing ? saveName : onExport}
          disabled={editing ? !draft.trim() : !samples?.length}
          loading={exporting}
          style={{ marginBottom: Math.max(insets.bottom, 20) + 18 }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 37, paddingRight: 42, marginTop: 7 },
  cancelRow: { paddingLeft: 37, marginTop: -1, height: 30, justifyContent: 'center' },
  nameField: { marginHorizontal: 34, marginTop: 25 },
  meta: { ...type.meta, fontSize: fs(15), marginLeft: 37, marginTop: 2 },
  body: { marginHorizontal: 37, marginTop: 19 },
  chips: { marginTop: 20, marginRight: -24 },
  panel: { marginTop: 18 },
}));
