// app/index.tsx
//
// Home — the new entry point. Discovers a nearby flagged signal (BLE) or lets
// you flag one yourself, then routes into the courage screen with a real
// signalId. This replaced the legacy map home.
//
// BLE only works in a dev build, so in Expo Go discovery/flagging won't function
// — the screen degrades to a clear notice instead of crashing. To exercise the
// courage screen in Expo Go meanwhile, temporarily add this as the first line of
// the component body:  return <Redirect href="/signal" />;
// (import { Redirect } from 'expo-router') and remove it once you're on the dev build.

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Screen, Title, Subtitle, Card } from '@/components/ui';
import { Button, LoadingState } from '@/components/controls';
import { ensureAnonymousSession } from '@/lib/auth';
import { cosign, createSignal } from '@/lib/signals';
import {
  requestBlePermissions,
  startDiscovery,
  startBroadcasting,
  stopBroadcasting,
  type NearbySignal,
} from '@/lib/proximity';

export default function HomeScreen() {
  const [ready, setReady] = useState(false);
  const [nearby, setNearby] = useState<NearbySignal | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stopDiscovery = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureAnonymousSession();
      } catch {
        // ignore — flag/join will surface a clearer error if truly unauthed
      }
      try {
        const ok = await requestBlePermissions();
        if (cancelled) return;
        if (!ok) {
          setNotice('Bluetooth permission is off. Enable it in Settings to find people nearby.');
        } else {
          stopDiscovery.current = startDiscovery(
            (s) => setNearby((prev) => (!prev || (s.rssi ?? -999) > (prev.rssi ?? -999) ? s : prev)),
            (msg) => setNotice(msg),
          );
        }
      } catch {
        // Native BLE module missing — almost always Expo Go rather than a dev build.
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

  async function flag() {
    setBusy(true);
    setNotice(null);
    try {
      const id = await createSignal();
      await startBroadcasting(id);
      router.push(`/signal?signalId=${id}`);
    } catch (e) {
      setNotice('Could not flag: ' + String(e));
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!nearby) return;
    setBusy(true);
    setNotice(null);
    try {
      await cosign(nearby.signalId);
      router.push(`/signal?signalId=${nearby.signalId}`);
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

  return (
    <Screen>
      <Title>Flint</Title>

      {nearby ? (
        <Card>
          <Text style={styles.cardTitle}>Someone nearby flagged loud audio</Text>
          <Text style={styles.cardNote}>You're not the only one noticing it.</Text>
          <Button label={busy ? 'One moment…' : 'Join them'} onPress={join} disabled={busy} />
        </Card>
      ) : (
        <View style={styles.listening}>
          <Text style={styles.listeningText}>Listening for anything flagged nearby…</Text>
        </View>
      )}

      <View style={styles.spacer} />

      <Subtitle>Hearing loud audio no one's flagged yet?</Subtitle>
      <Button label={busy ? 'One moment…' : 'Flag loud audio'} onPress={flag} disabled={busy} />

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
});