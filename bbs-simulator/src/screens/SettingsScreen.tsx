import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Icon, PillButton, Screen, useTopInset } from '../components/basics';
import { Dialog, SegmentedToggle, TextSizeButton } from '../components/controls';
import { ActiveRunBanner } from '../components/ActiveRunBanner';
import { DeviceStatusLine } from '../components/DeviceStatus';
import { useDevice } from '../state/DeviceContext';
import { useData } from '../state/DataContext';
import { useRun } from '../state/RunContext';
import { ThemeMode, useTheme } from '../state/ThemeContext';
import { fs, colors, font, TEXT_SCALE_LABELS, TEXT_SCALES, themedStyles, type } from '../theme';
import { formatTimeSgt } from '../utils/format';
import * as svgs from '../assets/svgs';

// Settings has no Figma frame; it is built from the same card and dialog pieces.

type Confirm = 'disconnect' | 'clear' | 'reset' | null;

export function SettingsScreen() {
  const top = useTopInset();
  const navigation = useNavigation<any>();
  const { mode: appMode, deviceStatus, disconnect } = useDevice();
  const demo = appMode === 'demo';
  const { sessions, clearAllSessions, resetSimulators } = useData();
  const { active, stop } = useRun();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const { mode, setMode, textScale, setTextScale } = useTheme();

  const copy: Record<Exclude<Confirm, null>, { title: string; body: string; action: string }> = {
    disconnect: {
      title: demo ? 'Leave demo mode?' : 'Disconnect?',
      body: active ? 'The current run will stop and be saved.' : demo ? 'Your demo runs stay saved.' : 'You can reconnect any time.',
      action: demo ? 'Leave' : 'Disconnect',
    },
    clear: {
      title: demo ? 'Delete all demo runs?' : 'Delete all sessions?',
      body: demo
        ? `${sessions.length} demo ${sessions.length === 1 ? 'run' : 'runs'} and their folders will be removed.`
        : `${sessions.length} ${sessions.length === 1 ? 'run' : 'runs'} will be archived (hidden) in Supabase and folders removed. Their readings are kept.`,
      action: 'Delete',
    },
    reset: { title: 'Restore simulators?', body: 'Custom simulators will be removed.', action: 'Restore' },
  };

  const onConfirm = async () => {
    const which = confirm;
    setConfirm(null);
    if (which === 'disconnect') {
      if (active) await stop();
      disconnect();
      navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Welcome' }] });
    } else if (which === 'clear') clearAllSessions();
    else if (which === 'reset') resetSimulators();
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top + 47, paddingBottom: 70 }}>
        <View style={styles.titleRow}>
          <Text style={type.hero} accessibilityRole="header">
            Settings
          </Text>
          <TextSizeButton />
        </View>
        <ActiveRunBanner />

        <Text style={[type.label, styles.section]}>Simulator</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{demo ? 'Demo device (simulated)' : `Device ${deviceStatus?.deviceId ?? 'sim01'}`}</Text>
          <DeviceStatusLine style={styles.cardStatus} />
          <Text style={styles.cardMeta}>
            {[
              deviceStatus?.firmware && `Firmware ${deviceStatus.firmware}`,
              deviceStatus?.wifiRssi != null && `Wi-Fi ${deviceStatus.wifiRssi} dBm`,
              deviceStatus?.lastSeen && `Last heartbeat ${formatTimeSgt(deviceStatus.lastSeen)} SGT`,
            ]
              .filter(Boolean)
              .join(' · ') || (demo ? 'Built-in simulation' : 'No heartbeat received yet')}
          </Text>
          <Text style={styles.cardMeta}>{demo ? 'Not connected to the real device.' : 'Live via Supabase'}</Text>
        </View>
        <Item label={demo ? 'Leave demo mode' : 'Disconnect'} danger onPress={() => setConfirm('disconnect')} />

        <Text style={[type.label, styles.section]}>Appearance</Text>
        <View style={styles.toggle}>
          <SegmentedToggle<ThemeMode>
            options={[
              { key: 'dark', label: 'Dark' },
              { key: 'light', label: 'Light' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </View>

        <Text style={[type.label, styles.section]}>Text size</Text>
        <View style={styles.toggle}>
          <SegmentedToggle<string>
            options={TEXT_SCALES.map((s, i) => ({ key: String(s), label: TEXT_SCALE_LABELS[i] }))}
            value={String(textScale)}
            onChange={(s) => setTextScale(Number(s))}
          />
        </View>

        <Text style={[type.label, styles.section]}>Data</Text>
        <Item label="Restore default simulators" onPress={() => setConfirm('reset')} />
        <Item label={demo ? 'Delete all demo runs' : 'Delete all sessions'} danger disabled={!sessions.length} onPress={() => setConfirm('clear')} />

        <Text style={styles.foot}>
          {demo
            ? 'Demo runs are saved on this phone, separately from real runs.'
            : 'Runs and readings are stored in Supabase. Deleting a run archives it. Folders and order are kept on this phone.'}
        </Text>
      </ScrollView>

      <Dialog visible={!!confirm} onRequestClose={() => setConfirm(null)}>
        {confirm && (
          <>
            <Text style={styles.dialogTitle}>{copy[confirm].title}</Text>
            <Text style={styles.dialogBody}>{copy[confirm].body}</Text>
            <View style={styles.dialogActions}>
              <PillButton label="Cancel" kind="outline" bold onPress={() => setConfirm(null)} />
              <PillButton
                label={copy[confirm].action}
                kind={confirm === 'reset' ? 'accent' : 'danger'}
                bold
                width={100}
                onPress={onConfirm}
              />
            </View>
          </>
        )}
      </Dialog>
    </Screen>
  );
}

function Item({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.8 }, disabled && { opacity: 0.4 }]}
    >
      <Text style={[styles.itemText, danger && { color: colors.danger }]}>{label}</Text>
      <Icon xml={svgs.rowChevron} size={26} />
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 37, paddingRight: 24 },
  section: { marginLeft: 37, marginTop: 30, marginBottom: 14 },
  toggle: { marginHorizontal: 24 },
  card: {
    marginHorizontal: 24,
    minHeight: 88,
    paddingVertical: 14,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 26,
  },
  cardStatus: { marginTop: 8 },
  cardTitle: { ...font.bold, fontSize: fs(18), color: colors.strong },
  cardMeta: { ...font.regular, fontSize: fs(14), color: colors.muted, marginTop: 5 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { ...font.bold, fontSize: fs(15), color: colors.success },
  item: {
    marginHorizontal: 24,
    marginTop: 12,
    minHeight: 64,
    paddingVertical: 10,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 26,
    paddingRight: 18,
  },
  itemText: { ...font.bold, fontSize: fs(16), color: colors.strong },
  foot: { ...font.regular, fontSize: fs(13), color: colors.muted, textAlign: 'center', marginTop: 32 },
  dialogTitle: { ...font.bold, fontSize: fs(17), color: colors.text, textAlign: 'center', marginTop: 12 },
  dialogBody: { ...font.regular, fontSize: fs(13), lineHeight: fs(17), color: colors.muted, textAlign: 'center', marginTop: 10 },
  dialogActions: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 20, marginBottom: 12 },
}));
