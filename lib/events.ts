// lib/events.ts
//
// Append-only analytics log. Each meaningful action writes a tiny record to
// events/ in RTDB — never read by the app (write-only per the rules), only by
// the Admin-SDK export job. Best-effort: logging never blocks or breaks a user
// action. The anonymous, persistent `uid` powers unique-users / retention; a
// coarse ~1km geohash rides on 'created' only (never a precise address).

import { push, ref, serverTimestamp, set } from 'firebase/database';
import * as Location from 'expo-location';
import { auth, db } from './firebase';

export type EventType =
  | 'created'
  | 'joined'
  | 'claimed'
  | 'handed_back'
  | 'attempt'
  | 'resolved'
  | 'backing'
  | 'left';

type EventData = {
  signalId?: string;
  category?: string | null;
  geohash?: string | null;
};

export async function logEvent(type: EventType, data?: EventData): Promise<void> {
  try {
    await set(push(ref(db, 'events')), {
      type,
      at: serverTimestamp(),
      uid: auth.currentUser?.uid ?? null,
      signal_id: data?.signalId ?? null,
      category: data?.category ?? null,
      geohash: data?.geohash ?? null,
    });
  } catch {
    // analytics is best-effort — never surface to the user
  }
}

// --- coarse geohash (~1km, precision 6) ---

const GEOHASH_CHARS = '0123456789bcdefghjkmnpqrstuvwxyz';

function encodeGeohash(lat: number, lon: number, precision = 6): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let hash = '';
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        idx = idx * 2 + 1;
        lonMin = mid;
      } else {
        idx = idx * 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx = idx * 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += GEOHASH_CHARS[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

// Uses the LAST KNOWN location (instant, no fresh GPS fix) so it never blocks
// flagging. Returns null if permission isn't granted or nothing is cached.
export async function coarseGeohash(): Promise<string | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync();
    if (!pos) return null;
    return encodeGeohash(pos.coords.latitude, pos.coords.longitude, 6);
  } catch {
    return null;
  }
}