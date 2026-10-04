import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, LinkText, PrimaryButton, Screen, useTopInset } from '../components/basics';
import { RunText } from '../components/runs';
import { SessionsStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { colors, themedStyles, type } from '../theme';
import * as svgs from '../assets/svgs';
import { MAX_COMPARE } from './CompareScreen';

export function CompareSelectScreen({ navigation, route }: NativeStackScreenProps<SessionsStackParams, 'CompareSelect'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { sessions } = useData();
  const folderId = route.params?.folderId;
  const runs = folderId ? sessions.filter((s) => s.folderId === folderId) : sessions;
  const [picked, setPicked] = useState<string[]>([]);

  const full = picked.length >= MAX_COMPARE;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_COMPARE ? p : [...p, id]));

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top + 17, paddingBottom: 24 }}>
        <View style={styles.header}>
          <Text style={type.heading} accessibilityRole="header">
            Select runs
          </Text>
          <LinkText label="Cancel" bold={false} size={15} color={colors.muted} onPress={() => navigation.goBack()} />
        </View>
        <Text style={styles.hint}>
          {full ? `Up to ${MAX_COMPARE} runs at a time` : `Pick 2 to ${MAX_COMPARE} runs to compare`}
        </Text>
        <View style={styles.list}>
          {runs.map((run) => {
            const on = picked.includes(run.id);
            const locked = full && !on;
            return (
              <Pressable
                key={run.id}
                onPress={() => toggle(run.id)}
                disabled={locked}
                accessibilityRole="checkbox"
                accessibilityLabel={run.name}
                accessibilityState={{ checked: on, disabled: locked }}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }, locked && { opacity: 0.4 }]}
              >
                <Icon xml={on ? svgs.radioOn : svgs.radioOff} size={16} style={styles.radio} />
                <View style={{ flex: 1 }}>
                  <RunText run={run} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <PrimaryButton
        label={picked.length < 2 ? 'Compare runs' : `Compare ${picked.length} runs`}
        disabled={picked.length < 2}
        onPress={() => navigation.replace('Compare', { ids: picked })}
        style={{ marginBottom: Math.max(insets.bottom, 20) + 36 }}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 37 },
  hint: { ...type.meta, marginTop: 8, marginHorizontal: 37 },
  list: { marginTop: 24, marginHorizontal: 37 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 18,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.dividerDim,
  },
  radio: { marginRight: 11, marginTop: -12 },
}));
