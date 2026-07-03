// lib/proximity.ts
//
// BLE proximity — fixed-UUID + GATT design.
//
// Every Flint device advertises ONE fixed service UUID, so iOS can discover it
// even while the advertiser is backgrounded. The per-signal token lives in a
// GATT characteristic: a scanner sees the fixed UUID, connects, reads the token,
// disconnects, then resolves token -> signalId via Firebase (rendezvous/{token}).
//
// Discovery is foreground-only. It reports EVERY nearby Flint host (multiple
// nuisances can coexist) and re-reads each device periodically so it catches new
// nuisances and hosts that re-flag. Broadcasting runs in the background on iOS;
// Android background broadcasting still needs a foreground service. Broadcasting
// auto-stops after BROADCAST_TTL_MS via a native timer.

import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';
import { get, onDisconnect, ref, remove, set } from 'firebase/database';
import { db } from './firebase';
import {
  startAdvertising as nativeStartAdvertising,
  stopAdvertising as nativeStopAdvertising,
} from '../modules/flint-ble';

// Fixed identifiers — MUST match the UUIDs hardcoded in the native module.
export const FLINT_SERVICE_UUID = '8a7f1e00-1f1a-4c2b-9d4e-000000000001';
export const FLINT_TOKEN_CHAR_UUID = '8a7f1e00-1f1a-4c2b-9d4e-000000000002';

// Broadcast auto-stop, enforced natively so it holds while backgrounded.
export const BROADCAST_TTL_MS = 10 * 60 * 1000;

// How often we'll re-read a given device's GATT token (to catch re-flags).
const READ_THROTTLE_MS = 15 * 1000;

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
      // fall through
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

// Start scanning. onFound fires for every nearby Flint signal, and again when a
// device is re-read (throttled), so the caller should dedupe by signalId. Returns
// a stop function.
export function startDiscovery(
  onFound: (nearby: NearbySignal) => void,
  onError?: (message: string) => void,
): () => void {
  const m = getManager();
  const lastRead = new Map<string, number>();
  let scanning = false;

  const startScan = () => {
    if (scanning) return;
    scanning = true;
    // allowDuplicates so we keep hearing devices and can re-read them; we filter
    // on the fixed Flint UUID (required for iOS + backgrounded-advertiser reach).
    m.startDeviceScan([FLINT_SERVICE_UUID], { allowDuplicates: true }, async (err, device) => {
      if (err) {
        onError?.(err.message);
        return;
      }
      if (!device) return;

      const now = Date.now();
      const last = lastRead.get(device.id) ?? 0;
      if (now - last < READ_THROTTLE_MS) return; // don't hammer the same device
      lastRead.set(device.id, now);

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
        lastRead.delete(device.id); // let a failed read retry sooner
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