import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinkText, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { SineWave } from '../components/waves';
import { RootParams } from '../navigation/types';
import { useDevice } from '../state/DeviceContext';
import { supabaseConfigured } from '../lib/supabase';
import { AppMode } from '../types';
import { fs, colors, font, themedStyles } from '../theme';

// Welcome (frame 01) and Loading (frame 02) are one screen, so the wave never restarts:
// on Connect it eases into the slower "breathing" loading wave while the title and
// button cross-fade into the percentage and progress bar. Connect goes to the real device
// through Supabase; "Try demo mode" uses the built-in simulation instead.
export function WelcomeScreen({ navigation }: NativeStackScreenProps<RootParams, 'Welcome'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { status, progress, error, mode, connect, disconnect } = useDevice();
  const connecting = status === 'connecting' || status === 'connected';
  const failed = status === 'failed';
  const busy = connecting || failed;
  const pct = Math.round(progress * 100);

  const t = useRef(new Animated.Value(busy ? 1 : 0)).current; // 0 welcome, 1 loading
  useEffect(() => {
    Animated.timing(t, {
      toValue: busy ? 1 : 0,
      duration: 450,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [busy, t]);

  const start = async (m: AppMode) => {
    if (await connect(m)) {
      setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Main' }] }), 350);
    }
  };

  const welcomeStyle = {
    opacity: t.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }),
    transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }) }],
  };
  const loadingStyle = {
    opacity: t.interpolate({ inputRange: [0.4, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  };

  return (
    <Screen style={{ paddingTop: top, paddingBottom: Math.max(insets.bottom, 20) + 36 }}>
      <View style={styles.waveArea}>
        <SineWave
          height={260}
          amplitude={busy ? 92 : 110}
          wavelength={busy ? 205.7 : 180}
          speed={busy ? 90 : 70}
          breathe={connecting}
        />
      </View>

      <View style={styles.bottom}>
        <Animated.View style={[styles.layer, welcomeStyle]} pointerEvents={busy ? 'none' : 'auto'}>
          <Text style={styles.title} accessibilityRole="header">
            Connect your{'\n'}simulator
          </Text>
          <PrimaryButton label="Connect" onPress={() => start('live')} style={styles.button} />
          <View style={styles.demoLink}>
            <LinkText label="Try demo mode (simulated data)" size={15} color={colors.muted} onPress={() => start('demo')} />
          </View>
          {!supabaseConfigured && (
            <Text style={styles.configHint}>Supabase isn’t set up yet (.env missing), so only demo mode will work.</Text>
          )}
        </Animated.View>

        <Animated.View
          style={[styles.layer, styles.loading, loadingStyle]}
          pointerEvents={busy ? 'auto' : 'none'}
          accessibilityElementsHidden={!busy}
          importantForAccessibility={busy ? 'auto' : 'no-hide-descendants'}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.percent}>{failed ? 'Oops' : `${pct}%`}</Text>
          <Text style={styles.caption}>
            {failed ? "Couldn't reach your simulator" : mode === 'demo' ? 'Starting demo mode' : 'Connecting to your simulator'}
          </Text>
          {failed && error && <Text style={styles.error}>{error}</Text>}
          {failed ? (
            <View style={styles.failActions}>
              <PrimaryButton label="Try again" onPress={() => start(mode ?? 'live')} style={styles.retry} />
              <LinkText label="Back" color={colors.muted} onPress={disconnect} />
            </View>
          ) : (
            <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>
          )}
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  waveArea: { flex: 1, justifyContent: 'center' },
  // Both states share this slot, stacked; its height fits the taller (failed) state.
  bottom: { height: 300 },
  layer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  title: { ...font.bold, fontSize: fs(45), lineHeight: fs(69), color: colors.strong, marginLeft: 37 },
  button: { marginTop: 36 },
  demoLink: { alignItems: 'center', marginTop: 16 },
  configHint: { ...font.regular, fontSize: fs(13), color: colors.muted, textAlign: 'center', marginTop: 10, marginHorizontal: 37 },
  error: { ...font.regular, fontSize: fs(13), color: colors.muted, marginTop: 10 },
  loading: { paddingHorizontal: 37, paddingBottom: 18 },
  percent: { ...font.bold, fontSize: fs(56), color: colors.strong },
  caption: { ...font.regular, fontSize: fs(22), color: colors.loadingMuted, marginTop: 20 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.progressTrack, marginTop: 62, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.strong },
  failActions: { marginTop: 28, alignItems: 'center', gap: 18 },
  retry: { alignSelf: 'stretch', marginHorizontal: -13 },
}));
