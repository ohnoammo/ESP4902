import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Field, LinkText, OutlinePill, PillButton, Screen, useTopInset } from '../components/basics';
import { Dialog, TextSizeButton } from '../components/controls';
import { DragCard, FolderCard, RunList, useRunDrag } from '../components/runs';
import { ActiveRunBanner } from '../components/ActiveRunBanner';
import { SessionsStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { Folder } from '../types';

export function SessionsScreen({ navigation }: NativeStackScreenProps<SessionsStackParams, 'Sessions'>) {
  const top = useTopInset();
  const { sessions, folders, addFolder, deleteFolder, deleteSession, moveSession, reorderSessions } = useData();
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);

  const loose = useMemo(() => sessions.filter((s) => !s.folderId), [sessions]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s) => s.folderId && m.set(s.folderId, (m.get(s.folderId) ?? 0) + 1));
    return m;
  }, [sessions]);

  const controller = useRunDrag({
    runs: loose,
    onDropOnTarget: (runId, folderId) => moveSession(runId, folderId),
    onReorder: reorderSessions,
  });
  const { drag, contentRef, registerTarget } = controller;
  const dragged = drag ? sessions.find((s) => s.id === drag.runId) : undefined;

  const createFolder = () => {
    const name = folderName.trim();
    if (!name) return;
    addFolder(name);
    setFolderName('');
    setNewFolderOpen(false);
  };

  const empty = sessions.length === 0 && folders.length === 0;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={!drag} contentContainerStyle={{ paddingTop: top + 47, paddingBottom: 70 }}>
        <View ref={contentRef} collapsable={false}>
          <View style={styles.titleRow}>
            <Text style={type.hero} accessibilityRole="header">
              Sessions
            </Text>
            <TextSizeButton />
          </View>
          {!drag && sessions.length >= 1 && (
            <View style={styles.actions}>
              <OutlinePill label="Ask" onPress={() => navigation.navigate('Assistant')} />
              {sessions.length >= 2 && (
                <OutlinePill label="Compare" onPress={() => navigation.navigate('CompareSelect', {})} />
              )}
            </View>
          )}
          <ActiveRunBanner />

          <View style={styles.sectionRow}>
            {drag ? (
              <Text style={styles.dragHint}>Drag to reorder, or onto a folder</Text>
            ) : (
              <>
                <Text style={type.label}>Folders</Text>
                <LinkText label="+ Add Folder" size={14} color={colors.muted} onPress={() => setNewFolderOpen(true)} />
              </>
            )}
          </View>

          {folders.length > 0 ? (
            <View style={styles.folders}>
              {folders.map((f) => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  count={counts.get(f.id) ?? 0}
                  state={!drag ? 'normal' : drag.hoverTarget === f.id ? 'hover' : 'dim'}
                  viewRef={registerTarget(f.id)}
                  onPress={() => navigation.navigate('Folder', { folderId: f.id })}
                  onLongPress={() => setFolderToDelete(f)}
                />
              ))}
            </View>
          ) : (
            <Text style={[type.meta, styles.emptyFolders]}>Group runs into folders to keep tests together.</Text>
          )}

          {!empty && <Text style={[type.meta, styles.allRuns]}>All runs (no folder)</Text>}
          {empty ? (
            <Text style={[type.meta, styles.empty]}>
              No runs yet. Start a simulator on the Home tab to record one.
            </Text>
          ) : loose.length === 0 && !drag ? (
            <Text style={[type.meta, styles.empty]}>Every run is in a folder.</Text>
          ) : null}

          <RunList
            runs={loose}
            controller={controller}
            onOpen={(id) => navigation.navigate('Session', { id })}
            onDelete={deleteSession}
          />

          {dragged && drag && <DragCard run={dragged} top={drag.cardTop} />}
        </View>
      </ScrollView>

      <Dialog visible={newFolderOpen} onRequestClose={() => setNewFolderOpen(false)}>
        <Text style={styles.dialogTitle}>New folder</Text>
        <Field
          value={folderName}
          onChangeText={setFolderName}
          placeholder="Folder name"
          autoFocus
          onSubmitEditing={createFolder}
          returnKeyType="done"
          maxLength={32}
          style={styles.dialogField}
          accessibilityLabel="Folder name"
        />
        <View style={styles.dialogActionsLeft}>
          <PillButton label="Cancel" kind="outline" onPress={() => setNewFolderOpen(false)} />
          <PillButton label="Create" kind="accent" width={88} onPress={createFolder} />
        </View>
      </Dialog>

      <DeleteFolderDialog
        folder={folderToDelete}
        count={folderToDelete ? counts.get(folderToDelete.id) ?? 0 : 0}
        onCancel={() => setFolderToDelete(null)}
        onConfirm={() => {
          if (folderToDelete) deleteFolder(folderToDelete.id);
          setFolderToDelete(null);
        }}
      />
    </Screen>
  );
}

export function DeleteFolderDialog({
  folder,
  count,
  onCancel,
  onConfirm,
}: {
  folder: Folder | null;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog visible={!!folder} onRequestClose={onCancel}>
      <Text style={styles.deleteTitle}>Delete folder?</Text>
      <Text style={styles.deleteName}>{folder?.name}</Text>
      <Text style={styles.deleteBody}>
        {count === 0
          ? 'It has no runs.'
          : `Its ${count} ${count === 1 ? 'run' : 'runs'} will move to\nAll runs.`}
      </Text>
      <View style={styles.dialogActionsCenter}>
        <PillButton label="Cancel" kind="outline" bold onPress={onCancel} />
        <PillButton label="Delete" kind="danger" bold width={88} onPress={onConfirm} />
      </View>
    </Dialog>
  );
}

const styles = themedStyles(() => ({
  actions: { flexDirection: 'row', gap: 12, paddingLeft: 37, marginTop: 14, marginBottom: 10 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 37,
    paddingRight: 24,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 17,
    marginHorizontal: 37,
    marginRight: 31,
    height: 17,
  },
  dragHint: { ...font.regular, fontSize: fs(13), color: colors.accentText },
  folders: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 9,
    marginTop: 16,
    marginHorizontal: 24,
  },
  emptyFolders: { marginTop: 12, marginHorizontal: 37 },
  allRuns: { marginTop: 29, marginLeft: 37 },
  empty: { marginTop: 29, marginHorizontal: 37, lineHeight: fs(20) },
  dialogTitle: { ...font.regular, fontSize: fs(17), color: colors.text, marginLeft: 12, marginTop: -1 },
  dialogField: { height: 40, borderRadius: 12, fontSize: fs(15), paddingHorizontal: 15, marginTop: 17 },
  dialogActionsLeft: { flexDirection: 'row', gap: 14, marginTop: 20 },
  deleteTitle: { ...font.bold, fontSize: fs(17), color: colors.text, textAlign: 'center', marginTop: 12 },
  deleteName: { ...font.regular, fontSize: fs(15), color: colors.text, textAlign: 'center', marginTop: 9 },
  deleteBody: { ...font.regular, fontSize: fs(13), lineHeight: fs(16), color: colors.muted, textAlign: 'center', marginTop: 7 },
  dialogActionsCenter: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 18, marginBottom: 12 },
}));
