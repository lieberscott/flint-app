// app/nearby.tsx
//
// The new entry screen, and the final wiring: it discovers a nearby flagged
// signal (BLE) or lets you flag one yourself, then routes into the courage
// screen with a REAL signalId — replacing the dev shim's throwaway. Eventually
// this becomes the app home, retiring the legacy map in index.tsx.
//
// Note: this imports the BLE layer, so it only runs in a dev build, not Expo Go.
// (app/signal.tsx stays BLE-free, so the courage screen alone is still testable
// in Expo Go.)
//
// Broadcasting lifecycle (v1): flagging starts the advertisement; it stops when
// you leave this screen (unmount). For someone who only joins, stopBroadcasting
// is a harmless no-op. Refinement for later: stop the instant the signal resolves.

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

export default function NearbyScreen() {
  const [ready, setReady] = useState(false);
  const [permissionOk, setPermissionOk] = useState<boolean | null>(null);
  const [nearby, setNearby] = useState<NearbySignal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopDiscovery = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureAnonymousSession();
      } catch {
        // ignore — flag/join will surface a clearer error if truly unauthed
      }
      const ok = await requestBlePermissions();
      if (cancelled) return;
      setPermissionOk(ok);
      setReady(true);
      if (ok) {
        stopDiscovery.current = startDiscovery(
          (s) =>
            setNearby((prev) => (!prev || (s.rssi ?? -999) > (prev.rssi ?? -999) ? s : prev)),
          (msg) => setError(msg),
        );
      }
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
    setError(null);
    try {
      const id = await createSignal();
      await startBroadcasting(id);
      router.push(`/signal?signalId=${id}`);
    } catch (e) {
      setError('Could not flag: ' + String(e));
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!nearby) return;
    setBusy(true);
    setError(null);
    try {
      await cosign(nearby.signalId);
      router.push(`/signal?signalId=${nearby.signalId}`);
    } catch (e) {
      setError('Could not join: ' + String(e));
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

  if (permissionOk === false) {
    return (
      <Screen>
        <Title>Bluetooth needed</Title>
        <Subtitle>
          Flint uses Bluetooth to sense nearby people bothered by the same audio. Enable it in
          Settings, then reopen this screen.
        </Subtitle>
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

      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  error: { color: '#fca5a5', fontSize: 13 },
});