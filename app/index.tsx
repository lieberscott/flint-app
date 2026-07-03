// app/index.tsx
//
// Home — discovers ALL nearby flagged signals (BLE) and shows them as a live,
// stacked list, each with its description and member count. You join whichever
// one is yours, or flag a new one (which stacks alongside the others). Each card
// is live-subscribed, so it updates its count and disappears when that nuisance
// resolves or empties.
//
// BLE only works in a dev build; in Expo Go it degrades to a notice.

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Screen, Title, Subtitle, Card } from '@/components/ui';
import { Button, Input, LoadingState } from '@/components/controls';
import { ensureAnonymousSession } from '@/lib/auth';
import { cosign, createSignal, subscribeToSignal, type SignalSnapshot } from '@/lib/signals';
import {
  requestBlePermissions,
  startDiscovery,
  startBroadcasting,
  stopBroadcasting,
} from '@/lib/proximity';

const PRESETS = [
  'Phone audio, no headphones',
  'Loud phone call',
  'Loud music',
  'Whistling',
];

export default function HomeScreen() {
  const [ready, setReady] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [snaps, setSnaps] = useState<Record<string, SignalSnapshot>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);
  const [desc, setDesc] = useState('');

  const stopDiscovery = useRef<(() => void) | null>(null);
  const unsubs = useRef<Record<string, () => void>>({});
  const rssiById = useRef<Record<string, number>>({});

  // Discover nearby signals.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureAnonymousSession();
      } catch {
        // ignore
      }
      try {
        const ok = await requestBlePermissions();
        if (cancelled) return;
        if (!ok) {
          setNotice('Bluetooth permission is off. Enable it in Settings to find people nearby.');
        } else {
          stopDiscovery.current = startDiscovery(
            (s) => {
              rssiById.current[s.signalId] = s.rssi ?? -999;
              setIds((cur) => (cur.includes(s.signalId) ? cur : [...cur, s.signalId]));
            },
            (msg) => setNotice(msg),
          );
        }
      } catch {
        if (!cancelled) {
          setNotice('Bluetooth needs the dev build on a real device — discovery and flagging are inactive here.');
        }
      }
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      stopDiscovery.current?.();
      stopDiscovery.current = null;
      stopBroadcasting();
    };
  }, []);

  // Keep one live subscription per discovered id; drop dead ones.
  useEffect(() => {
    for (const id of ids) {
      if (unsubs.current[id]) continue;
      unsubs.current[id] = subscribeToSignal(id, (snap) => {
        const dead = !snap || snap.status === 'resolved' || snap.cosign_count === 0;
        if (dead) {
          unsubs.current[id]?.();
          delete unsubs.current[id];
          delete rssiById.current[id];
          setSnaps((cur) => {
            const next = { ...cur };
            delete next[id];
            return next;
          });
          setIds((cur) => cur.filter((x) => x !== id));
        } else {
          setSnaps((cur) => ({ ...cur, [id]: snap }));
        }
      });
    }
  }, [ids]);

  // Tear down all subscriptions on unmount.
  useEffect(() => {
    return () => {
      Object.values(unsubs.current).forEach((u) => u());
      unsubs.current = {};
    };
  }, []);

  async function confirmFlag() {
    setBusy(true);
    setNotice(null);
    try {
      const id = await createSignal(desc.trim() || undefined);
      await startBroadcasting(id);
      setDescribing(false);
      setDesc('');
      router.push(`/signal?signalId=${id}`);
    } catch (e) {
      setNotice('Could not flag: ' + String(e));
    } finally {
      setBusy(false);
    }
  }

  async function join(id: string) {
    setBusy(true);
    setNotice(null);
    try {
      await cosign(id);
      router.push(`/signal?signalId=${id}`);
    } catch (e) {
      setNotice('Could not join: ' + String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <Screen>
        <LoadingState message="Getting ready…" />
      </Screen>
    );
  }

  if (describing) {
    return (
      <Screen>
        <Title>What's the noise?</Title>
        <View style={styles.chips}>
          {PRESETS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setDesc(p)}
              style={[styles.chip, desc === p && styles.chipActive]}>
              <Text style={[styles.chipText, desc === p && styles.chipTextActive]}>{p}</Text>
            </Pressable>
          ))}
        </View>
        <Input
          label="Or describe it"
          value={desc}
          onChangeText={setDesc}
          placeholder="e.g. loud video on speaker"
          maxLength={60}
        />
        <Button label={busy ? 'One moment…' : 'Flag it'} onPress={confirmFlag} disabled={busy} />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => {
            setDescribing(false);
            setDesc('');
          }}
        />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </Screen>
    );
  }

  const live = ids
    .map((id) => snaps[id])
    .filter(
      (s): s is SignalSnapshot =>
        !!s && !s.has_cosigned && s.status !== 'resolved' && s.cosign_count > 0,
    )
    .sort((a, b) => (rssiById.current[b.id] ?? -999) - (rssiById.current[a.id] ?? -999));

  return (
    <Screen>
      <Title>Flint</Title>

      {live.length > 0 ? (
        live.map((s) => (
          <Card key={s.id}>
            <Text style={styles.cardTitle}>
              {s.descriptor ? s.descriptor : 'Loud audio flagged nearby'}
            </Text>
            <Text style={styles.cardNote}>
              {s.cosign_count} {s.cosign_count === 1 ? 'person' : 'people'} flagged this.
            </Text>
            <Button label={busy ? 'One moment…' : 'Join them'} onPress={() => join(s.id)} disabled={busy} />
          </Card>
        ))
      ) : (
        <View style={styles.listening}>
          <Text style={styles.listeningText}>Listening for anything flagged nearby…</Text>
        </View>
      )}

      <View style={styles.spacer} />

      <Subtitle>Hearing something no one's flagged yet?</Subtitle>
      <Button label="Flag loud audio" onPress={() => setDescribing(true)} disabled={busy} />

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  cardNote: { color: '#cbd5e1', fontSize: 14 },
  listening: {
    borderColor: '#334155',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  listeningText: { color: '#94a3b8', fontSize: 14 },
  spacer: { height: 8 },
  notice: { color: '#fca5a5', fontSize: 13 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#1a1a2e',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#cbd5e1', fontSize: 13 },
  chipTextActive: { color: '#fff' },
});