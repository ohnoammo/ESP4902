import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Icon, LinkText, Screen, useTopInset } from '../components/basics';
import { DragCard, RunList, useRunDrag } from '../components/runs';
import { DeleteFolderDialog } from './SessionsScreen';
import { SessionsStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import * as svgs from '../assets/svgs';

const MOVE_OUT = '__all_runs__';

export function FolderScreen({ navigation, route }: NativeStackScreenProps<SessionsStackParams, 'Folder'>) {
  const top = useTopInset();
  const { folders, sessions, deleteSession, moveSession, reorderSessions, deleteFolder } = useData();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const folder = folders.find((f) => f.id === route.params.folderId);
  const runs = useMemo(() => sessions.filter((s) => s.folderId === route.params.folderId), [sessions, route.params.folderId]);

  const controller = useRunDrag({
    runs,
    onDropOnTarget: (runId) => moveSession(runId, null),
    onReorder: reorderSessions,
  });
  const { drag, contentRef, registerTarget } = controller;
  const dragged = drag ? runs.find((r) => r.id === drag.runId) : undefined;

  if (!folder) {
    return (
      <Screen style={{ paddingTop: top + 21, paddingHorizontal: 37 }}>
        <LinkText label="Back" color={colors.muted} onPress={() => navigation.popTo('Sessions')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={!drag} contentContainerStyle={{ paddingTop: top + 17, paddingBottom: 70 }}>
        <View ref={contentRef} collapsable={false}>
          <View style={styles.topRow}>
            {/* Fixed-size slot so the drop target can be measured before the pill renders. */}
            <View ref={registerTarget(MOVE_OUT)} collapsable={false} style={styles.backSlot}>
            {drag ? (
              // Frame 16: while dragging, the back arrow becomes the drop target for moving out.
              <View style={[styles.movePill, drag.hoverTarget === MOVE_OUT && styles.movePillHover]}>
                <Icon xml={svgs.moveOutArrow} width={9} height={13} style={styles.flip} />
                <Text style={styles.moveText}>Move to All runs</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => navigation.popTo('Sessions')}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Back to Sessions"
                style={styles.back}
              >
                <Icon xml={svgs.folderBack} width={14.25} height={24.5} style={styles.flip} />
              </Pressable>
            )}
            </View>
            <LinkText label="Delete folder" bold={false} size={15} color={colors.danger} onPress={() => setConfirmDelete(true)} />
          </View>

          <View style={styles.titleRow}>
            <Text style={[type.title, { flex: 1 }]} numberOfLines={1} accessibilityRole="header">
              {folder.name}
            </Text>
            {runs.length >= 2 && (
              <LinkText
                label="Compare"
                bold={false}
                onPress={() => navigation.navigate('CompareSelect', { folderId: folder.id })}
              />
            )}
          </View>
          {drag ? (
            <Text style={styles.dragHint}>Drag up to the arrow to move out</Text>
          ) : (
            <Text style={styles.count}>
              {runs.length} {runs.length === 1 ? 'run' : 'runs'}
            </Text>
          )}

          <View style={styles.list}>
            {runs.length === 0 ? (
              <Text style={[type.meta, styles.empty]}>
                This folder is empty. On Sessions, hold a run and drag it onto this folder.
              </Text>
            ) : (
              <RunList
                runs={runs}
                controller={controller}
                onOpen={(id) => navigation.navigate('Session', { id })}
                onDelete={deleteSession}
              />
            )}
          </View>

          {dragged && drag && <DragCard run={dragged} top={drag.cardTop} />}
        </View>
      </ScrollView>

      <DeleteFolderDialog
        folder={confirmDelete ? folder : null}
        count={runs.length}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          navigation.popTo('Sessions');
          deleteFolder(folder.id);
        }}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  topRow: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingRight: 36,
    marginTop: 30,
  },
  backSlot: { width: 160, height: 30, justifyContent: 'center', alignItems: 'flex-start' },
  back: { paddingLeft: 4, paddingVertical: 3 },
  flip: { transform: [{ rotate: '180deg' }] },
  movePill: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.card,
  },
  movePillHover: { backgroundColor: colors.accentTint },
  moveText: { ...font.bold, fontSize: fs(13), color: colors.accentText },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 37,
    paddingRight: 37,
    marginTop: 22,
  },
  count: { ...font.regular, fontSize: fs(15), color: colors.muted, marginLeft: 37, marginTop: 11 },
  dragHint: { ...font.regular, fontSize: fs(13), color: colors.accentText, marginLeft: 37, marginTop: 11, height: 18 },
  list: { marginTop: 11 },
  empty: { marginHorizontal: 37, marginTop: 20, lineHeight: fs(20) },
}));
