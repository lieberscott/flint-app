// app/signal.tsx
//
// Step 2: the courage screen — the heart of the new model.
//
// It's a small state machine driven entirely by subscribeToSignal. When another
// nearby person claims, YOUR screen reactively flips to "someone's on it" with
// no navigation. States: open (the courage beat) -> claimed (the script if you
// won the claim, "sit tight" if you didn't) -> resolved (handled + optional
// backing). The co-sign count and the "me" flags arrive already computed
// per-device, so nothing on this screen is ever visible to the person asked.

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Screen, Title, Subtitle, Card } from '@/components/ui';
import { Button, LoadingState } from '@/components/controls';
import {
  ASK_SCRIPT,
  addBacking,
  claimSignal,
  createSignal,
  resolveSignal,
  subscribeToSignal,
  type SignalSnapshot,
} from '@/lib/signals';

// Individuated but unlocatable: a dot per co-signer, nothing to match to a face.
function PresenceDots({ count }: { count: number }) {
  const shown = Math.min(count, 8);
  const overflow = count - shown;
  return (
    <View style={styles.dots}>
      {Array.from({ length: shown }).map((_, i) => (
        <View key={i} style={styles.dot} />
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
  const [claiming, setClaiming] = useState(false);
  const [backed, setBacked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  // DEV shim: opened with no signalId -> make a throwaway so the route works on
  // its own. Production always arrives with an id. The ref guard keeps React's
  // dev double-invoke from creating two.
  useEffect(() => {
    if (signalId || bootstrapped.current) return;
    bootstrapped.current = true;
    createSignal('test signal')
      .then(setSignalId)
      .catch(() =>
        setError(
          "Could not start a signal. If your rules still default-deny the signals/ path, that's the cause.",
        ),
      );
  }, [signalId]);

  // Live subscription. The callback re-renders the whole state machine.
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
    setClaiming(true);
    try {
      await claimSignal(signalId);
      // No navigation: the subscription flips us to the script or to "sit tight".
    } catch {
      setError('Could not claim this. Check your signals/ rules.');
    } finally {
      setClaiming(false);
    }
  }

  async function onDone() {
    if (!signalId) return;
    try {
      await resolveSignal(signalId);
    } catch {
      setError('Could not mark this done.');
    }
  }

  async function onBacking() {
    if (!signalId || backed) return;
    setBacked(true);
    try {
      await addBacking(signalId);
    } catch {
      setBacked(false);
    }
  }

  function leave() {
    router.back();
  }

  if (error) {
    return (
      <Screen>
        <Title>Something's off</Title>
        <Subtitle>{error}</Subtitle>
        <Button label="Back" variant="secondary" onPress={leave} />
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
        <Button label="Done" onPress={leave} />
      </Screen>
    );
  }

  if (signal.status === 'open') {
    const alone = signal.cosign_count <= 1;
    return (
      <Screen>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Loud audio flagged here</Text>
        </View>

        <View style={styles.hero}>
          <PresenceDots count={signal.cosign_count} />
          <Text style={styles.count}>
            {alone
              ? "Looks like it's just you here right now"
              : `${signal.cosign_count} people near you flagged this too`}
          </Text>
          <Text style={styles.privacy}>Only you can see this</Text>
        </View>

        <Text style={styles.reassure}>
          {alone
            ? "No one else has flagged it yet — you can still say something. Your call."
            : "You're not the only one. The car's with you."}
        </Text>

        <View style={styles.actions}>
          <Button
            label={claiming ? "One moment…" : "I'll ask"}
            onPress={onClaim}
            disabled={claiming}
          />
          <Button label="Not me right now" variant="secondary" onPress={leave} />
        </View>
        <Text style={styles.hint}>We'll hand you a calm line to say.</Text>
      </Screen>
    );
  }

  if (signal.status === 'claimed') {
    if (signal.claimed_by_me) {
      return (
        <Screen>
          <Title>You've got it</Title>
          <Subtitle>
            Say it once, calm, then you're done. One person, one reasonable ask.
          </Subtitle>
          <Card>
            <Text style={styles.script}>{ASK_SCRIPT}</Text>
          </Card>
          <Button label="Done" onPress={onDone} />
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
      </Screen>
    );
  }

  // status === 'resolved'
  const wasAsker = signal.claimed_by_me;
  return (
    <Screen>
      <View style={styles.center}>
        <Title>Handled</Title>
        <Text style={styles.note}>
          {wasAsker
            ? signal.backing_count > 0
              ? `${signal.backing_count} ${signal.backing_count === 1 ? 'person' : 'people'} had your back.`
              : 'Nicely done.'
            : 'Someone spoke up. That took some nerve.'}
        </Text>
      </View>
      {!wasAsker ? (
        <Button
          label={backed ? "Sent" : "Send a quiet “that took guts”"}
          variant="secondary"
          onPress={onBacking}
          disabled={backed}
        />
      ) : null}
      <Button label="Done" onPress={leave} />
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
  dots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    maxWidth: 240,
  },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#94a3b8' },
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
  hint: { color: '#64748b', fontSize: 13, textAlign: 'center' },

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
});