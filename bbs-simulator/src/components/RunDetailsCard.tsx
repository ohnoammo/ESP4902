import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { RunDetails, SessionMeta } from '../types';
import { fs, colors, font, themedStyles } from '../theme';
import { formatRatio, formatTimeSgt } from '../utils/format';
import { Field, LinkText, PillButton } from './basics';
import { Dialog } from './controls';

// The run's test notes (headform, mask, notes: editable) and its recorded facts
// (settings, firmware, how it ended).
export function RunDetailsCard({ run, onSave }: { run: SessionMeta; onSave: (d: RunDetails) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RunDetails>(run);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = () => {
    setDraft({ headform: run.headform, mask: run.mask, notes: run.notes });
    setError(null);
    setOpen(true);
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ headform: draft.headform || null, mask: draft.mask || null, notes: draft.notes || null });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const sim = run.simulator;
  const ended =
    run.endedAt === null
      ? 'Still recording'
      : `${formatTimeSgt(run.startedAt)}–${formatTimeSgt(run.endedAt)} SGT · ${run.endedBy === 'device' ? 'device stopped' : 'stopped in app'}`;
  const rows: [string, string | null][] = [
    ['Headform', run.headform],
    ['Mask', run.mask],
    ['Notes', run.notes],
    ['Settings', `${sim.respiratoryRate} bpm · blower ${sim.duty} % · I:E ${formatRatio(sim.ieRatio)}`],
    ['Firmware', run.firmware],
    ['Time', ended],
  ];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Test details</Text>
        <LinkText label="Edit" size={15} onPress={edit} />
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row} accessible accessibilityLabel={`${label}: ${value ?? 'not set'}`}>
          <Text style={styles.label}>{label}</Text>
          <Text style={[styles.value, !value && styles.empty]}>{value ?? '–'}</Text>
        </View>
      ))}

      <Dialog visible={open} onRequestClose={() => setOpen(false)}>
        <Text style={styles.dialogTitle}>Test details</Text>
        <View style={styles.fields}>
          <Field
            value={draft.headform ?? ''}
            onChangeText={(v) => setDraft((d) => ({ ...d, headform: v }))}
            placeholder="Headform"
            maxLength={80}
            accessibilityLabel="Headform"
          />
          <Field
            value={draft.mask ?? ''}
            onChangeText={(v) => setDraft((d) => ({ ...d, mask: v }))}
            placeholder="Mask"
            maxLength={80}
            accessibilityLabel="Mask"
          />
          <Field
            value={draft.notes ?? ''}
            onChangeText={(v) => setDraft((d) => ({ ...d, notes: v }))}
            placeholder="Notes"
            multiline
            maxLength={500}
            style={styles.notes}
            accessibilityLabel="Notes"
          />
        </View>
        {error && <Text style={styles.error}>Couldn’t save: {error}</Text>}
        <View style={styles.actions}>
          <PillButton label="Cancel" kind="outline" onPress={() => setOpen(false)} />
          <PillButton label={saving ? 'Saving…' : 'Save'} kind="accent" bold width={92} onPress={save} />
        </View>
      </Dialog>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: {
    marginTop: 26,
    padding: 18,
    paddingLeft: 20,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 10,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  title: { ...font.bold, fontSize: fs(16), color: colors.strong },
  row: { flexDirection: 'row', gap: 12 },
  label: { ...font.regular, fontSize: fs(14), color: colors.muted, width: 84 },
  value: { ...font.regular, flex: 1, fontSize: fs(14), lineHeight: fs(19), color: colors.text },
  empty: { color: colors.muted },
  dialogTitle: { ...font.bold, fontSize: fs(17), color: colors.text, textAlign: 'center', marginTop: 8 },
  fields: { gap: 10, marginTop: 14 },
  notes: { height: undefined, minHeight: 72, paddingTop: 12, textAlignVertical: 'top' },
  error: { ...font.regular, fontSize: fs(13), color: colors.danger, marginTop: 10 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 18, marginBottom: 6 },
}));
