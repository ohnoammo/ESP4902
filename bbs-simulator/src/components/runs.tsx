import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';
import { fs, colors, font, inset, themedStyles } from '../theme';
import { Folder, SessionMeta } from '../types';
import { formatRunMeta } from '../utils/format';
import { Icon } from './basics';
import * as svgs from '../assets/svgs';
import { themedSvgs } from '../assets/themedSvgs';

const ACTION_W = 98;
const ACTIONS_W = ACTION_W * 2;
const LONG_PRESS_MS = 380;
const SLOP = 8;

export function RunText({ run }: { run: SessionMeta }) {
  return (
    <>
      <Text style={rowStyles.name} numberOfLines={1}>
        {run.name}
      </Text>
      <Text style={rowStyles.meta}>{formatRunMeta(run)}</Text>
    </>
  );
}

// A run in a list. Tap opens it, swipe left reveals Cancel/Delete (frame 14),
// press-and-hold picks it up for dragging (frames 15/16).
export function RunRow({
  run,
  open,
  hidden,
  dimmed,
  onOpenChange,
  onPress,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
  rowRef,
}: {
  run: SessionMeta;
  open: boolean;
  hidden?: boolean;
  dimmed?: boolean;
  onOpenChange: (open: boolean) => void;
  onPress: () => void;
  onDelete: () => void;
  onDragStart: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
  rowRef: (v: View | null) => void;
}) {
  const reveal = useRef(new Animated.Value(0)).current; // 0 closed, -ACTIONS_W open
  const [pressed, setPressed] = useState(false);
  const cb = useRef({ open, onOpenChange, onPress, onDragStart, onDragMove, onDragEnd });
  cb.current = { open, onOpenChange, onPress, onDragStart, onDragMove, onDragEnd };

  useEffect(() => {
    Animated.spring(reveal, { toValue: open ? -ACTIONS_W : 0, useNativeDriver: false, bounciness: 0 }).start();
  }, [open, reveal]);

  const responder = useRef(
    (() => {
      let mode: 'pending' | 'swipe' | 'drag' | 'scroll' = 'pending';
      let timer: ReturnType<typeof setTimeout> | undefined;
      let base = 0;

      const finish = (dx: number, vx: number, cancelled: boolean) => {
        clearTimeout(timer);
        setPressed(false);
        if (mode === 'drag') cb.current.onDragEnd();
        else if (mode === 'swipe') {
          const x = Math.min(0, Math.max(-ACTIONS_W, base + dx));
          const shouldOpen = x < -ACTIONS_W / 2.5 || vx < -0.4;
          cb.current.onOpenChange(shouldOpen);
          Animated.spring(reveal, { toValue: shouldOpen ? -ACTIONS_W : 0, useNativeDriver: false, bounciness: 0 }).start();
        } else if (mode === 'pending' && !cancelled) {
          if (cb.current.open) cb.current.onOpenChange(false);
          else cb.current.onPress();
        }
        mode = 'pending';
      };

      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => mode === 'pending' || mode === 'scroll',
        onPanResponderGrant: (e) => {
          mode = 'pending';
          base = cb.current.open ? -ACTIONS_W : 0;
          setPressed(true);
          const { pageX, pageY } = e.nativeEvent;
          timer = setTimeout(() => {
            if (mode !== 'pending') return;
            mode = 'drag';
            setPressed(false);
            if (cb.current.open) cb.current.onOpenChange(false);
            cb.current.onDragStart(pageX, pageY);
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (_, g) => {
          if (mode === 'drag') return cb.current.onDragMove(g.moveX, g.moveY);
          if (mode === 'pending' && (Math.abs(g.dx) > SLOP || Math.abs(g.dy) > SLOP)) {
            clearTimeout(timer);
            setPressed(false);
            mode = Math.abs(g.dx) > Math.abs(g.dy) ? 'swipe' : 'scroll';
          }
          if (mode === 'swipe') reveal.setValue(Math.min(0, Math.max(-ACTIONS_W, base + g.dx)));
        },
        onPanResponderRelease: (_, g) => finish(g.dx, g.vx, false),
        onPanResponderTerminate: (_, g) => finish(g.dx, g.vx, true),
      });
    })()
  ).current;

  const actionsX = reveal.interpolate({ inputRange: [-ACTIONS_W, 0], outputRange: [0, ACTIONS_W] });

  // While dragged the row collapses but keeps the same element tree mounted,
  // because its content view owns the active gesture.
  return (
    <View ref={rowRef} style={[rowStyles.row, dimmed && rowStyles.dimmed, hidden && rowStyles.hidden]}>
      <View
        {...responder.panHandlers}
        style={[rowStyles.content, pressed && rowStyles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${run.name}, ${formatRunMeta(run)}`}
        accessibilityHint="Opens the run. Swipe left to delete, hold to drag."
        accessibilityActions={[{ name: 'activate' }, { name: 'delete', label: 'Delete run' }]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'delete' ? onDelete() : onPress())}
      >
        <View style={rowStyles.textCol}>
          <RunText run={run} />
        </View>
        <Icon xml={svgs.rowChevron} size={26} style={rowStyles.chevron} />
      </View>
      <View style={rowStyles.divider} />
      <Animated.View
        style={[rowStyles.actions, { transform: [{ translateX: actionsX }] }]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        {...({ 'aria-hidden': !open } as object)}
      >
        <Pressable
          style={[rowStyles.action, { backgroundColor: colors.swipeCancel }]}
          onPress={() => onOpenChange(false)}
          accessibilityRole="button"
          accessibilityLabel="Cancel delete"
        >
          <Icon xml={themedSvgs.swipeCancel()} size={13.8} />
          <Text style={[rowStyles.actionText, { color: colors.muted }]}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[rowStyles.action, { backgroundColor: colors.danger }]}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${run.name}`}
        >
          <Icon xml={svgs.swipeDelete} width={15.6} height={17.1} />
          <Text style={[rowStyles.actionText, { color: colors.dangerText }]}>Delete</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// The lifted card that follows the finger while dragging.
export function DragCard({ run, top }: { run: SessionMeta; top: number }) {
  return (
    <View pointerEvents="none" style={[rowStyles.dragCard, { top }]}>
      <RunText run={run} />
    </View>
  );
}

export function DropPlaceholder() {
  return (
    <View style={rowStyles.placeholder}>
      <Text style={[font.bold, { fontSize: fs(13), color: colors.accentText }]}>Drop here</Text>
    </View>
  );
}

export const ROW_HEIGHT = 77;

const rowStyles = themedStyles(() => ({
  row: { height: ROW_HEIGHT, overflow: 'hidden' },
  hidden: { height: 0, opacity: 0 },
  dimmed: { opacity: 0.3 },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: inset.text,
    paddingRight: inset.text,
    backgroundColor: colors.background,
    cursor: 'pointer',
  } as any,
  pressed: { backgroundColor: colors.pressed },
  textCol: { flex: 1, paddingTop: 2 },
  chevron: { marginRight: -1 },
  name: { ...font.regular, fontSize: fs(16), color: colors.text },
  meta: { ...font.regular, fontSize: fs(14), color: colors.muted, marginTop: 7 },
  divider: { height: 1, backgroundColor: colors.divider, marginHorizontal: inset.text },
  actions: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  action: { width: ACTION_W, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 21, gap: 14 },
  actionText: { ...font.regular, fontSize: fs(12), alignSelf: 'center' },
  dragCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 74,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    justifyContent: 'center',
    zIndex: 50,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  placeholder: {
    height: 56,
    marginHorizontal: inset.text,
    marginVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function measure(v: View | null | undefined): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!v) return resolve(null);
    v.measureInWindow((x, y, w, h) => resolve({ x, y, w, h }));
  });
}

export interface DragState {
  runId: string;
  cardTop: number; // relative to the content container
  hoverTarget: string | null;
  insertIndex: number;
}

// Shared drag bookkeeping for the Sessions and Folder screens. Rows and drop targets
// register their views; everything is measured once when the drag starts (scrolling
// is locked during a drag, so the measurements stay valid).
export function useRunDrag({
  runs,
  onDropOnTarget,
  onReorder,
}: {
  runs: SessionMeta[];
  onDropOnTarget: (runId: string, target: string) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const contentRef = useRef<View>(null);
  const rowRefs = useRef(new Map<string, View | null>());
  const targetRefs = useRef(new Map<string, View | null>());
  const geo = useRef<{
    content: Rect;
    grabOffset: number;
    others: { id: string; mid: number }[];
    targets: { key: string; rect: Rect }[];
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const registerRow = useCallback((id: string) => (v: View | null) => void rowRefs.current.set(id, v), []);
  const registerTarget = useCallback((key: string) => (v: View | null) => void targetRefs.current.set(key, v), []);

  const compute = (runId: string, x: number, y: number): DragState | null => {
    const g = geo.current;
    if (!g) return null;
    const hit = g.targets.find(
      ({ rect: r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
    );
    return {
      runId,
      cardTop: y - g.grabOffset - g.content.y,
      hoverTarget: hit?.key ?? null,
      insertIndex: g.others.filter((o) => o.mid < y).length,
    };
  };

  const start = async (runId: string, x: number, y: number) => {
    const [content, row] = await Promise.all([measure(contentRef.current), measure(rowRefs.current.get(runId))]);
    if (!content || !row) return;
    const others = await Promise.all(
      runs
        .filter((r) => r.id !== runId)
        .map(async (r) => {
          const m = await measure(rowRefs.current.get(r.id));
          return { id: r.id, mid: m ? m.y + m.h / 2 : Infinity };
        })
    );
    const targets = (
      await Promise.all(
        [...targetRefs.current.entries()].map(async ([key, v]) => ({ key, rect: await measure(v) }))
      )
    ).filter((t): t is { key: string; rect: Rect } => !!t.rect);
    geo.current = { content, grabOffset: y - row.y, others, targets };
    setDrag(compute(runId, x, y));
  };

  const move = (runId: string, x: number, y: number) => {
    if (geo.current) setDrag(compute(runId, x, y));
  };

  const end = () => {
    const d = dragRef.current;
    geo.current = null;
    setDrag(null);
    if (!d) return;
    if (d.hoverTarget) return onDropOnTarget(d.runId, d.hoverTarget);
    const others = runs.filter((r) => r.id !== d.runId).map((r) => r.id);
    others.splice(d.insertIndex, 0, d.runId);
    if (others.join() !== runs.map((r) => r.id).join()) onReorder(others);
  };

  return { drag, contentRef, registerRow, registerTarget, start, move, end };
}

// A list of RunRows wired to a useRunDrag controller, with the "Drop here" slot.
export function RunList({
  runs,
  controller,
  onOpen,
  onDelete,
}: {
  runs: SessionMeta[];
  controller: ReturnType<typeof useRunDrag>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { drag, registerRow, start, move, end } = controller;
  const [openRow, setOpenRow] = useState<string | null>(null);
  const showSlot = !!drag && !drag.hoverTarget;
  let othersSeen = 0;
  return (
    <View>
      {runs.map((run) => {
        const isDragged = drag?.runId === run.id;
        const slotHere = showSlot && !isDragged && othersSeen === drag!.insertIndex;
        if (!isDragged) othersSeen++;
        return (
          <React.Fragment key={run.id}>
            {slotHere && <DropPlaceholder />}
            <RunRow
              run={run}
              open={openRow === run.id}
              hidden={isDragged}
              dimmed={!!drag}
              rowRef={registerRow(run.id)}
              onOpenChange={(o) => setOpenRow(o ? run.id : null)}
              onPress={() => onOpen(run.id)}
              onDelete={() => {
                setOpenRow(null);
                onDelete(run.id);
              }}
              onDragStart={(x, y) => start(run.id, x, y)}
              onDragMove={(x, y) => move(run.id, x, y)}
              onDragEnd={end}
            />
          </React.Fragment>
        );
      })}
      {showSlot && drag!.insertIndex >= runs.length - 1 && <DropPlaceholder />}
    </View>
  );
}

// Folder tile from the Sessions frame; `state` covers the drag-hover styling of frame 15.
export function FolderCard({
  folder,
  count,
  state,
  onPress,
  onLongPress,
  viewRef,
}: {
  folder: Folder;
  count: number;
  state: 'normal' | 'hover' | 'dim';
  onPress: () => void;
  onLongPress: () => void;
  viewRef: (v: View | null) => void;
}) {
  return (
    <Pressable
      ref={viewRef}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      accessibilityRole="button"
      accessibilityLabel={`${folder.name} folder, ${count} ${count === 1 ? 'run' : 'runs'}`}
      accessibilityHint="Opens the folder. Hold to delete it."
      style={({ pressed }) => [
        folderStyles.card,
        state === 'hover' && folderStyles.hover,
        state === 'dim' && folderStyles.dim,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Icon xml={themedSvgs.folder()} size={42} />
      <Text style={folderStyles.name} numberOfLines={1}>
        {folder.name}
      </Text>
      <Text style={folderStyles.count}>
        {count} {count === 1 ? 'run' : 'runs'}
      </Text>
    </Pressable>
  );
}

const folderStyles = themedStyles(() => ({
  card: {
    width: '48.6%',
    height: 124,
    borderRadius: 30,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingLeft: 22,
    paddingRight: 12,
    paddingTop: 16,
  },
  hover: { borderColor: colors.accent },
  dim: { backgroundColor: colors.folderDim },
  name: { ...font.bold, fontSize: fs(15), color: colors.text, marginTop: 9 },
  count: { ...font.regular, fontSize: fs(14), color: colors.muted, marginTop: 4 },
}));
