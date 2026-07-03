// app/signal.tsx
//
// The courage screen — a live state machine driven by subscribeToSignal.
// Membership is your co-sign; the count reads as people BESIDES you. "Not me
// right now" flags you stepped-back but keeps you in; "Leave this group" removes
// you (emptying the group deletes it for all). On resolve, co-signers send the
// asker an emoji, which the asker actually sees.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Screen, Title, Subtitle, Card } from '@/components/ui';
import { Button, LoadingState } from '@/components/controls';
import {
  ASK_SCRIPT,
  BACKING_EMOJIS,
  addBacking,
  claimSignal,
  createSignal,
  leaveSignal,
  resolveSignal,
  setSteppedBack,
  subscribeToSignal,
  type SignalSnapshot,
} from '@/lib/signals';

// A simple human silhouette (head + shoulders), built from Views — no icon lib.
function PersonIcon() {
  return (
    <View style={styles.person}>
      <View style={styles.head} />
      <View style={styles.body} />
    </View>
  );
}

function Presence({ count }: { count: number }) {
  const shown = Math.min(count, 8);
  const overflow = count - shown;
  return (
    <View style={styles.people}>
      {Array.from({ length: shown }).map((_, i) => (
        <PersonIcon key={i} />
      ))}
      {overflow > 0 ? <Text style={styles.overflow}>+{overflow}</Text> : null}
    </View>
  );
}

export default function SignalScreen() {
  const params = useLocalSearchParams<{ signalId?: string }>();
  const initialId = typeof params.signalId === 'string' ? params.signalId : null;

  const [signalId, setSignalId] = useState<string | null>(initialId);
  const [signal, setSignal] = useState<SignalSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentEmoji, setSentEmoji] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (signalId) return;
    createSignal('test signal')
      .then(setSignalId)
      .catch(() =>
        setError("Could not start a signal. If your rules default-deny signals/, that's the cause."),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!signalId) return;
    const unsubscribe = subscribeToSignal(signalId, (next) => {
      setSignal(next);
      setLoaded(true);
    });
    return unsubscribe;
  }, [signalId]);

  async function onClaim() {
    if (!signalId) return;
    setBusy(true);
    try {
      await claimSignal(signalId);
    } catch {
      setError('Could not claim this.');
    } finally {
      setBusy(false);
    }
  }

  async function onStepBack(stepped: boolean) {
    if (!signalId) return;
    try {
      await setSteppedBack(signalId, stepped);
    } catch {
      setError('Could not update that.');
    }
  }

  async function onResolve() {
    if (!signalId) return;
    try {
      await resolveSignal(signalId);
    } catch {
      setError('Could not mark this done.');
    }
  }

  async function onLeave() {
    if (signalId) {
      try {
        await leaveSignal(signalId);
      } catch {
        // best-effort; still exit
      }
    }
    router.back();
  }

  async function onSendEmoji(emoji: string) {
    if (!signalId || sentEmoji) return;
    setSentEmoji(emoji);
    try {
      await addBacking(signalId, emoji);
    } catch {
      setSentEmoji(null);
    }
  }

  if (error) {
    return (
      <Screen>
        <Title>Something's off</Title>
        <Subtitle>{error}</Subtitle>
        <Button label="Back" variant="secondary" onPress={onLeave} />
      </Screen>
    );
  }

  if (!signalId || !loaded) {
    return (
      <Screen>
        <LoadingState message="Tuning in…" />
      </Screen>
    );
  }

  if (!signal) {
    return (
      <Screen>
        <View style={styles.center}>
          <Title>That wrapped up</Title>
          <Text style={styles.note}>Nothing more to do here.</Text>
        </View>
        <Button label="Done" onPress={onLeave} />
      </Screen>
    );
  }

  if (signal.status === 'open') {
    const others = signal.has_cosigned ? signal.cosign_count - 1 : signal.cosign_count;
    const countText =
      others <= 0
        ? "Looks like it's just you here right now"
        : others === 1
          ? '1 other person near you flagged this too'
          : `${others} other people near you flagged this too`;

    const steppedText =
      signal.stepped_back_count <= 0
        ? null
        : signal.i_stepped_back && signal.stepped_back_count === 1
          ? "You've stepped back — someone else can ask."
          : `${signal.stepped_back_count} ${
              signal.stepped_back_count === 1 ? 'person has' : 'people have'
            } stepped back.`;

    return (
      <Screen>
        <View style={styles.chip}>
          <Text style={styles.chipText}>
            {signal.descriptor ? signal.descriptor : 'Loud audio flagged here'}
          </Text>
        </View>

        <View style={styles.hero}>
          <Presence count={signal.cosign_count} />
          <Text style={styles.count}>{countText}</Text>
          <Text style={styles.privacy}>Only you can see this</Text>
        </View>

        <Text style={styles.reassure}>
          {others <= 0
            ? 'No one else has flagged it yet — you can still say something. Your call.'
            : "You're not the only one. The car's with you."}
        </Text>

        <View style={styles.actions}>
          <Button label={busy ? 'One moment…' : "I'll ask"} onPress={onClaim} disabled={busy} />
          {signal.i_stepped_back ? (
            <Button label="Actually, I might ask" variant="secondary" onPress={() => onStepBack(false)} />
          ) : (
            <Button label="Not me right now" variant="secondary" onPress={() => onStepBack(true)} />
          )}
        </View>

        {steppedText ? <Text style={styles.stepped}>{steppedText}</Text> : null}

        <Text style={styles.leave} onPress={onLeave}>
          Leave this group
        </Text>
      </Screen>
    );
  }

  if (signal.status === 'claimed') {
    if (signal.claimed_by_me) {
      return (
        <Screen>
          <Title>You've got it</Title>
          <Subtitle>Say it once, calm, then you're done. One person, one reasonable ask.</Subtitle>
          <Card>
            <Text style={styles.script}>{ASK_SCRIPT}</Text>
          </Card>
          <Button label="Done" onPress={onResolve} />
          <Text style={styles.leave} onPress={onLeave}>
            Leave this group
          </Text>
        </Screen>
      );
    }
    return (
      <Screen>
        <View style={styles.center}>
          <View style={styles.ring} />
          <Title>Someone's on it</Title>
          <Text style={styles.note}>You can sit tight. Someone nearby is handling it.</Text>
        </View>
        <Text style={styles.leave} onPress={onLeave}>
          Leave this group
        </Text>
      </Screen>
    );
  }

  // status === 'resolved'
  const wasAsker = signal.claimed_by_me;
  return (
    <Screen>
      <View style={styles.center}>
        <Title>Handled</Title>
        {wasAsker ? (
          <>
            {signal.backing_emojis.length > 0 ? (
              <Text style={styles.emojiRow}>{signal.backing_emojis.join(' ')}</Text>
            ) : null}
            <Text style={styles.note}>
              {signal.backing_count > 0
                ? `${signal.backing_count} ${signal.backing_count === 1 ? 'person' : 'people'} had your back.`
                : 'Nicely done.'}
            </Text>
          </>
        ) : (
          <Text style={styles.note}>Someone spoke up. Send them a thanks?</Text>
        )}
      </View>

      {!wasAsker ? (
        sentEmoji ? (
          <Text style={styles.sent}>Sent {sentEmoji}</Text>
        ) : (
          <View style={styles.emojiPicker}>
            {BACKING_EMOJIS.map((e) => (
              <Pressable key={e} onPress={() => onSendEmoji(e)} style={styles.emojiButton}>
                <Text style={styles.emojiButtonText}>{e}</Text>
              </Pressable>
            ))}
          </View>
        )
      ) : null}

      <Button label="Done" onPress={onLeave} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a2e',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipText: { color: '#cbd5e1', fontSize: 13 },

  hero: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  people: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 10,
    maxWidth: 240,
  },
  person: { width: 16, alignItems: 'center' },
  head: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#94a3b8', marginBottom: 1 },
  body: {
    width: 14,
    height: 9,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    backgroundColor: '#94a3b8',
  },
  overflow: { color: '#cbd5e1', fontSize: 14, marginLeft: 2 },
  count: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 28,
  },
  privacy: { color: '#64748b', fontSize: 13 },

  reassure: { color: '#e2e8f0', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  actions: { gap: 12 },
  stepped: { color: '#94a3b8', fontSize: 13, textAlign: 'center' },

  script: { color: '#fff', fontSize: 20, lineHeight: 28, fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  note: { color: '#cbd5e1', fontSize: 16, lineHeight: 22, textAlign: 'center' },
  ring: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#e94560',
    marginBottom: 4,
  },

  emojiRow: { fontSize: 40, textAlign: 'center' },
  emojiPicker: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  emojiButton: {
    backgroundColor: '#1a1a2e',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  emojiButtonText: { fontSize: 30 },
  sent: { color: '#cbd5e1', fontSize: 16, textAlign: 'center' },

  leave: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: 8,
  },
});