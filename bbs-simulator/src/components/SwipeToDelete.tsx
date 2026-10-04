import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { fs, colors, font, themedStyles } from '../theme';
import { Icon } from './basics';
import * as svgs from '../assets/svgs';
import { themedSvgs } from '../assets/themedSvgs';

const ACTION_W = 98;
const ACTIONS_W = ACTION_W * 2;
const SLOP = 8;

// Tap to open, swipe left to reveal the Cancel / Delete panels from frame 14.
// Used for simulator cards; run rows have their own version that also supports dragging.
export function SwipeToDelete({
  open,
  onOpenChange,
  onPress,
  onDelete,
  label,
  style,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPress: () => void;
  onDelete: () => void;
  label: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const reveal = useRef(new Animated.Value(0)).current; // 0 closed, -ACTIONS_W open
  const [pressed, setPressed] = useState(false);
  const cb = useRef({ open, onOpenChange, onPress });
  cb.current = { open, onOpenChange, onPress };

  useEffect(() => {
    Animated.spring(reveal, { toValue: open ? -ACTIONS_W : 0, useNativeDriver: false, bounciness: 0 }).start();
  }, [open, reveal]);

  const responder = useRef(
    (() => {
      let mode: 'pending' | 'swipe' | 'scroll' = 'pending';
      let base = 0;
      const finish = (dx: number, vx: number, cancelled: boolean) => {
        setPressed(false);
        if (mode === 'swipe') {
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
        onPanResponderTerminationRequest: () => mode !== 'swipe',
        onPanResponderGrant: () => {
          mode = 'pending';
          base = cb.current.open ? -ACTIONS_W : 0;
          setPressed(true);
        },
        onPanResponderMove: (_, g) => {
          if (mode === 'pending' && (Math.abs(g.dx) > SLOP || Math.abs(g.dy) > SLOP)) {
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

  return (
    <View style={[styles.clip, style]}>
      <View
        {...responder.panHandlers}
        style={[styles.content, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens it. Swipe left to delete."
        accessibilityActions={[{ name: 'activate' }, { name: 'delete', label: 'Delete' }]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'delete' ? onDelete() : onPress())}
      >
        {children}
      </View>
      <Animated.View
        style={[styles.actions, { transform: [{ translateX: actionsX }] }]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
        <Pressable
          style={[styles.action, { backgroundColor: colors.swipeCancel }]}
          onPress={() => onOpenChange(false)}
          accessibilityRole="button"
          accessibilityLabel="Cancel delete"
        >
          <Icon xml={themedSvgs.swipeCancel()} size={13.8} />
          <Text style={[styles.actionText, { color: colors.muted }]}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.action, { backgroundColor: colors.danger }]}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete"
        >
          <Icon xml={svgs.swipeDelete} width={15.6} height={17.1} />
          <Text style={[styles.actionText, { color: colors.dangerText }]}>Delete</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = themedStyles(() => ({
  clip: { overflow: 'hidden' },
  content: { cursor: 'pointer' } as ViewStyle,
  actions: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  action: { width: ACTION_W, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 21, gap: 14 },
  actionText: { ...font.regular, fontSize: fs(12), alignSelf: 'center' },
}));
