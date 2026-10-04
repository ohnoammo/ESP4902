import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton, Field, LinkText, Screen, useTopInset } from '../components/basics';
import { SessionsStackParams } from '../navigation/types';
import { useData } from '../state/DataContext';
import { fs, colors, font, themedStyles, type } from '../theme';
import { Sample } from '../types';
import { reply } from '../utils/assistant';

// No Figma frame: a chat built from the existing card, chip and field styles.
// Answers come from utils/assistant (rule-based, reads the saved runs only).
interface Message {
  role: 'user' | 'bot';
  text: string;
}

// Conversations outlive the screen (leaving and coming back, or a text-size remount) for as
// long as the app is open: one for the general chat, one per run it was opened from.
const history = new Map<string, Message[]>();
const MAX_MESSAGES = 60;

export function AssistantScreen({ navigation, route }: NativeStackScreenProps<SessionsStackParams, 'Assistant'>) {
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const { sessions, loadSamples } = useData();
  const focusId = route.params?.runId;
  const focus = sessions.find((s) => s.id === focusId);
  const [samples, setSamples] = useState<Record<string, Sample[]> | null>(null);
  const [draft, setDraft] = useState('');
  const historyKey = focusId ?? 'all';
  const greeting: Message = {
    role: 'bot',
    text: focus
      ? `Ask me about "${focus.name}" or any other saved run. I answer from their recorded readings.`
      : 'Ask me about your saved runs. I answer from their recorded readings.',
  };
  const [messages, setMessages] = useState<Message[]>(() => history.get(historyKey) ?? [greeting]);
  useEffect(() => {
    history.set(historyKey, messages);
  }, [historyKey, messages]);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(sessions.map((s) => loadSamples(s.id).then((rows) => [s.id, rows] as const))).then(
      (pairs) => alive && setSamples(Object.fromEntries(pairs))
    );
    return () => {
      alive = false;
    };
  }, [sessions, loadSamples]);

  const suggestions = focus
    ? ['Summarise this run', 'Anything unusual?', 'Compare with another run', 'Highest CO2 in this run']
    : ['Summarise my last run', 'Compare my last two runs', 'Which run had the highest CO2?', 'Anything unusual?'];
  const shown = sessions.length < 2 ? suggestions.filter((q) => !/compare/i.test(q)) : suggestions;

  const send = (text: string) => {
    const q = text.trim();
    if (!q || !samples) return;
    const answer = reply(q, { runs: sessions, samples, focusId });
    setMessages((prev) => [...prev, { role: 'user' as const, text: q }, { role: 'bot' as const, text: answer }].slice(-MAX_MESSAGES));
    setDraft('');
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingTop: top + 11 }}>
          <BackButton label={focus ? focus.name : 'Sessions'} onPress={() => navigation.goBack()} />
          <View style={styles.titleRow}>
            <Text style={type.hero} accessibilityRole="header">
              Assistant
            </Text>
            {messages.length > 1 && (
              <LinkText label="Clear" size={16} color={colors.muted} onPress={() => setMessages([greeting])} />
            )}
          </View>
        </View>

        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={styles.log}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          accessibilityLiveRegion="polite"
        >
          {messages.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === 'user' ? styles.user : styles.bot]}>
              <Text style={styles.msgText} selectable>
                {m.text}
              </Text>
            </View>
          ))}
          {!samples && <Text style={[type.meta, styles.loading]}>Loading your runs…</Text>}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}
        >
          {shown.map((q) => (
            <Pressable
              key={q}
              onPress={() => send(q)}
              disabled={!samples}
              accessibilityRole="button"
              accessibilityLabel={q}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.chipText}>{q}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={[styles.inputRow, { marginBottom: Math.max(insets.bottom, 20) + 8 }]}>
          <Field
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask about your runs"
            onSubmitEditing={() => send(draft)}
            returnKeyType="send"
            blurOnSubmit={false}
            maxLength={200}
            style={{ flex: 1, minWidth: 0 }}
            accessibilityLabel="Question"
          />
          <Pressable
            onPress={() => send(draft)}
            disabled={!draft.trim() || !samples}
            accessibilityRole="button"
            accessibilityLabel="Ask"
            style={({ pressed }) => [styles.send, (!draft.trim() || !samples) && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}
          >
            <Text style={type.button}>Ask</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 37, paddingRight: 31, marginBottom: 6 },
  log: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12, gap: 10 },
  bubble: { maxWidth: '88%', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12 },
  bot: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderBottomLeftRadius: 6 },
  user: { alignSelf: 'flex-end', backgroundColor: colors.accentTint, borderBottomRightRadius: 6 },
  msgText: { ...font.regular, fontSize: fs(15), lineHeight: fs(21), color: colors.text },
  loading: { alignSelf: 'center', marginTop: 8 },
  chipScroll: { flexGrow: 0 },
  chips: { paddingHorizontal: 24, gap: 8, paddingVertical: 8 },
  chip: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipText: { ...font.regular, fontSize: fs(14), color: colors.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 24, marginTop: 4 },
  send: { height: 48, borderRadius: 24, paddingHorizontal: 22, justifyContent: 'center', backgroundColor: colors.accent },
}));
