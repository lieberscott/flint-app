// app/index.tsx
//
// Home — discovers ALL nearby flagged signals (BLE) and shows them as a live,
// scrollable, stacked list. Broadcasting is owned by the courage screen (tied to
// active membership); the home only scans. Includes a location banner, a short
// explainer + FAQ link, and (on Android only) a foreground-discoverability note.
//
// BLE only works in a dev build; in Expo Go it degrades to a notice.
//
// Assumes components/LocationBanner.tsx exists and expo-location is installed.

import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Screen, Title, Subtitle, Card } from '@/components/ui';
import { Button, Input, LoadingState } from '@/components/controls';
import { LocationBanner } from '@/components/LocationBanner';
import { ensureAnonymousSession } from '@/lib/auth';
import {
  cosign,
  createSignal,
  isStale,
  removeSignal,
  subscribeToSignal,
  type SignalSnapshot,
} from '@/lib/signals';
import { requestBlePermissions, startDiscovery, isBluetoothOn } from '@/lib/proximity';
import { logEvent, coarseGeohash } from '@/lib/events';

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
            (msg) =>
              setNotice((prev) =>
                msg === null ? (prev && prev.startsWith('Bluetooth') ? null : prev) : msg,
              ),
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
    };
  }, []);

  // On returning to the foreground, clear a stale "Bluetooth is off" if the user
  // turned it on while we were backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active') return;
      if (await isBluetoothOn()) {
        setNotice((prev) => (prev && prev.startsWith('Bluetooth') ? null : prev));
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    for (const id of ids) {
      if (unsubs.current[id]) continue;
      unsubs.current[id] = subscribeToSignal(id, (snap) => {
        const stale = !!snap && isStale(snap);
        if (stale) removeSignal(id).catch(() => {});
        const dead = !snap || snap.status === 'resolved' || snap.cosign_count === 0 || stale;
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
      const category = desc.trim() || null;
      coarseGeohash()
        .then((geohash) => logEvent('created', { signalId: id, category, geohash }))
        .catch(() => {});
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
      logEvent('joined', { signalId: id }).catch(() => {});
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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Title>Flint</Title>

        <LocationBanner />

        <Text style={styles.explainer}>
          Flint uses Bluetooth to connect you with nearby people bothered by the same noise.{' '}
          <Text style={styles.link} onPress={() => router.push('/faq')}>
            How it works
          </Text>
        </Text>

        {Platform.OS === 'android' ? (
          <Text style={styles.androidNote}>
            On Android, you're only discoverable while the app is open.
          </Text>
        ) : null}

        {live.length > 0 ? (
          live.map((s) => (
            <Card key={s.id}>
              <Text style={styles.cardTitle}>
                {s.descriptor ? s.descriptor : 'Loud audio flagged nearby'}
              </Text>
              <Text style={styles.cardNote}>
                {s.cosign_count} {s.cosign_count === 1 ? 'person' : 'people'} flagged this.
              </Text>
              <Button
                label={busy ? 'One moment…' : 'Join them'}
                onPress={() => join(s.id)}
                disabled={busy}
              />
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
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { gap: 16, paddingBottom: 24 },

  explainer: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  link: { color: '#e94560', textDecorationLine: 'underline' },
  androidNote: { color: '#64748b', fontSize: 12, lineHeight: 16 },

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