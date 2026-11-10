import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, Field, LinkText, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { SegmentedToggle, SensorChips } from '../components/controls';
import { SensorPanel } from '../components/SensorPanel';
import { RunDetailsCard } from '../components/RunDetailsCard';
import { SessionsStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { fs, colors, heroSize, themedStyles, type } from '../theme';
import { Sample, SensorKey } from '../types';
import { formatRunMeta } from '../utils/format';
import { buildCsv, csvFileName, exportCsv } from '../utils/csv';
import { eventsIn, useThermal } from '../state/ThermalContext';
import { useDevice } from '../state/DeviceContext';
import { fetchThermalEvents, mergeEvents } from '../device/thermalApi';
import { ThermalEvent } from '../thermal/events';
import { ThermalEventsCard } from '../components/ThermalEventsCard';

export function SessionScreen({ navigation, route }: NativeStackScreenProps<SessionsStackParams, 'Session'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { sessions, loadSamples, renameSession, updateDetails } = useData();
  const run = sessions.find((s) => s.id === route.params.id);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [sensor, setSensor] = useState<SensorKey>('blower');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { events: thermalEvents } = useThermal();
  const { mode } = useDevice();
  // Live runs: thermal events from any phone, from Supabase (merged with this phone's own).
  const [remoteEvents, setRemoteEvents] = useState<ThermalEvent[]>([]);
  const runWindow = run ? [run.startedAt, run.endedAt ?? Date.now()] : null;
  useEffect(() => {
    if (mode !== 'live' || !runWindow) return;
    let alive = true;
    fetchThermalEvents(runWindow[0], runWindow[1])
      .then((ev) => alive && setRemoteEvents(ev))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, run?.id, run?.endedAt]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    loadSamples(route.params.id)
      .then((s) => alive && setSamples(s))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [route.params.id, loadSamples]);

  if (!run) {
    return (
      <Screen style={{ paddingTop: top + 12 }}>
        <BackButton label="Sessions" onPress={() => navigation.goBack()} />
        <Text style={[type.meta, { margin: 40 }]}>This run was deleted.</Text>
      </Screen>
    );
  }

  const runEvents = mergeEvents(eventsIn(thermalEvents, run.startedAt, run.endedAt ?? Date.now()), remoteEvents);

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
      await exportCsv(csvFileName(run.name), buildCsv([{ meta: run, samples, events: runEvents }]));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: top + 12, paddingBottom: 24 }}
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
              <Text style={[type.hero, styles.title, { fontSize: heroSize(run.name) }]} numberOfLines={2} accessibilityRole="header">
                {run.name}
              </Text>
            </>
          )}
          <Text style={[styles.meta, editing && { marginTop: 24 }]}>
            {formatRunMeta(run)}
          </Text>
          {!editing && (
            <View style={styles.actions}>
              <PrimaryButton label="Ask about this run" icon="ask" variant="outline" onPress={() => navigation.navigate('Assistant', { runId: run.id })} style={styles.actionButton} />
              <PrimaryButton label="Rename" icon="rename" variant="outline" onPress={startEdit} style={styles.actionButton} />
            </View>
          )}

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
              {samples ? (
                <SensorPanel samples={samples} sensor={sensor} view={view} duration={run.durationSec} />
              ) : (
                <Text style={type.meta}>{loadError ? `Couldn't load the readings: ${loadError}` : 'Loading readings…'}</Text>
              )}
            </View>
            <ThermalEventsCard run={run} events={runEvents} />
            <RunDetailsCard run={run} onSave={(d) => updateDetails(run.id, d)} />
          </View>
        </ScrollView>
        <PrimaryButton
          label={editing ? 'Save' : 'Export CSV'}
          icon={editing ? 'check' : 'export'}
          onPress={editing ? saveName : onExport}
          disabled={editing ? !draft.trim() : !samples?.length}
          loading={exporting}
          style={{ marginBottom: Math.max(insets.bottom, 20) + 16 }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  actions: { flexDirection: 'row', gap: 12, marginHorizontal: 24, marginTop: 16 },
  actionButton: { flex: 1, marginHorizontal: 0 },
  title: { marginHorizontal: 40, marginTop: 8 },
  cancelRow: { paddingLeft: 40, marginTop: -1, height: 30, justifyContent: 'center' },
  nameField: { marginHorizontal: 32, marginTop: 24 },
  meta: { ...type.meta, fontSize: fs(15), marginLeft: 40, marginTop: 2 },
  body: { marginHorizontal: 40, marginTop: 16 },
  chips: { marginTop: 24 },
  panel: { marginTop: 16 },
}));
