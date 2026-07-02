// lib/proximity.ts
//
// BLE proximity — fixed-UUID + GATT design.
//
// Every Flint device advertises ONE fixed service UUID, so iOS can discover it
// even while the advertiser is backgrounded. The per-signal token lives in a
// GATT characteristic: a scanner sees the fixed UUID, connects, reads the token,
// disconnects, then resolves token -> signalId via Firebase (rendezvous/{token}).
//
// Discovery is foreground-only for now. Broadcasting runs in the background on
// iOS (peripheral background mode); Android background broadcasting still needs
// a foreground service (next step). Broadcasting auto-stops after BROADCAST_TTL_MS
// via a NATIVE timer, so it caps out even while the app is backgrounded.

import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';
import { get, onDisconnect, ref, remove, set } from 'firebase/database';
import { db } from './firebase';
import {
  startAdvertising as nativeStartAdvertising,
  stopAdvertising as nativeStopAdvertising,
} from '../modules/flint-ble';

// Fixed identifiers — these MUST match the UUIDs hardcoded in the native module
// (ios/FlintBleModule.swift and android/.../FlintBleModule.kt).
export const FLINT_SERVICE_UUID = '8a7f1e00-1f1a-4c2b-9d4e-000000000001';
export const FLINT_TOKEN_CHAR_UUID = '8a7f1e00-1f1a-4c2b-9d4e-000000000002';

// How long a host keeps broadcasting before auto-stopping. Enforced natively so
// it holds even when the app is backgrounded and JS is frozen.
export const BROADCAST_TTL_MS = 10 * 60 * 1000;

export type NearbySignal = {
  signalId: string;
  token: string;
  rssi: number | null;
};

let manager: BleManager | null = null;
function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

// --- permissions ---
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const sdk = Platform.Version as number;
    const perms =
      sdk >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const granted = await PermissionsAndroid.requestMultiple(perms);
    return Object.values(granted).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  return true;
}

// --- rendezvous (Firebase) ---
export function makeToken(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
export async function publishRendezvous(token: string, signalId: string): Promise<void> {
  const r = ref(db, `rendezvous/${token}`);
  await set(r, signalId);
  // Safety net: if this client drops (app killed, network lost), Firebase clears
  // the stale token for us.
  onDisconnect(r).remove();
}
export async function clearRendezvous(token: string): Promise<void> {
  await remove(ref(db, `rendezvous/${token}`));
}
async function resolveSignalId(token: string): Promise<string | null> {
  try {
    const snap = await get(ref(db, `rendezvous/${token}`));
    const val = snap.val();
    return typeof val === 'string' ? val : null;
  } catch {
    return null;
  }
}

// --- broadcasting (host) ---
let currentToken: string | null = null;

export async function startBroadcasting(signalId: string): Promise<void> {
  await stopBroadcasting();
  const token = makeToken();
  currentToken = token;
  await publishRendezvous(token, signalId);
  // Native advertises the fixed UUID, serves this token over GATT, and auto-stops
  // itself after BROADCAST_TTL_MS (survives backgrounding, unlike a JS timer).
  await nativeStartAdvertising(token, BROADCAST_TTL_MS);
}

export async function stopBroadcasting(): Promise<void> {
  try {
    await nativeStopAdvertising();
  } catch {
    // nothing was advertising
  }
  if (currentToken) {
    await clearRendezvous(currentToken).catch(() => {});
    currentToken = null;
  }
}

// --- discovery (scan + GATT read) ---
function base64ToUtf8(b64: string): string {
  const g = globalThis as any;
  if (typeof g.atob === 'function') {
    try {
      return g.atob(b64);
    } catch {
      // fall through to manual decode
    }
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/=+$/, '');
  let out = '';
  let bits = 0;
  let val = 0;
  for (const c of clean) {
    const idx = chars.indexOf(c);
    if (idx === -1) continue;
    val = (val << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((val >> bits) & 0xff);
    }
  }
  return out;
}

export function startDiscovery(
  onFound: (nearby: NearbySignal) => void,
  onError?: (message: string) => void,
): () => void {
  const m = getManager();
  const seen = new Set<string>();
  let scanning = false;

  const startScan = () => {
    if (scanning) return;
    scanning = true;
    // Filter on the fixed Flint UUID — required for iOS to honor the scan and to
    // discover backgrounded iOS advertisers.
    m.startDeviceScan([FLINT_SERVICE_UUID], { allowDuplicates: false }, async (err, device) => {
      if (err) {
        onError?.(err.message);
        return;
      }
      if (!device || seen.has(device.id)) return;
      seen.add(device.id);
      try {
        const connected = await device.connect();
        await connected.discoverAllServicesAndCharacteristics();
        const ch = await connected.readCharacteristicForService(
          FLINT_SERVICE_UUID,
          FLINT_TOKEN_CHAR_UUID,
        );
        await connected.cancelConnection();
        const token = ch.value ? base64ToUtf8(ch.value) : '';
        if (!token) return;
        const signalId = await resolveSignalId(token);
        if (signalId) onFound({ signalId, token, rssi: device.rssi ?? null });
      } catch {
        // A failed connect/read just means skip this device; allow a later retry.
        seen.delete(device.id);
      }
    });
  };

  const sub = m.onStateChange((state) => {
    if (state === State.PoweredOn) startScan();
    else if (state === State.PoweredOff) onError?.('Bluetooth is off.');
  }, true);

  return () => {
    sub.remove();
    if (scanning) {
      m.stopDeviceScan();
      scanning = false;
    }
  };
}