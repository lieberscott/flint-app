// components/LocationBanner.tsx
//
// Reassurance banner — shows the user their own address so they can confirm
// Flint has them in the right spot (Uber-style). Purely device-side via
// expo-location; on iOS the reverse geocoding uses Apple's service — free, no
// key, no Firebase. Degrades cleanly if permission is denied or no fix is found.

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; address: string }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

function formatAddress(a: Location.LocationGeocodedAddress): string {
  if (a.streetNumber && a.street) return `${a.streetNumber} ${a.street}`;
  if (a.name) return a.name;
  if (a.street) return a.street;
  if (a.city) return a.region ? `${a.city}, ${a.region}` : a.city;
  return 'Location found';
}

export function LocationBanner() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setState({ kind: 'denied' });
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const results = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (cancelled) return;
        if (results.length > 0) {
          setState({ kind: 'ready', address: formatAddress(results[0]) });
        } else {
          setState({ kind: 'unavailable' });
        }
      } catch {
        if (!cancelled) setState({ kind: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.banner}>
      <Text style={styles.pin}>📍</Text>
      <View style={styles.body}>
        {state.kind === 'loading' ? (
          <View style={styles.row}>
            <ActivityIndicator color="#94a3b8" size="small" />
            <Text style={styles.finding}>Finding your location…</Text>
          </View>
        ) : state.kind === 'ready' ? (
          <>
            <Text style={styles.label}>Your location</Text>
            <Text style={styles.address}>{state.address}</Text>
          </>
        ) : state.kind === 'denied' ? (
          <Text style={styles.muted}>
            Location off — turn it on in Settings to confirm Flint has you in the right spot.
          </Text>
        ) : (
          <Text style={styles.muted}>Couldn't pin your location right now.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1a1a2e',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  pin: { fontSize: 18 },
  body: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  finding: { color: '#94a3b8', fontSize: 14 },
  label: { color: '#64748b', fontSize: 12 },
  address: { color: '#fff', fontSize: 15, fontWeight: '600' },
  muted: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
});