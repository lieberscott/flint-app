// lib/proximity.ts
//
// Step 3: BLE proximity. Two halves:
//   - Discovery (scanning) via react-native-ble-plx.
//   - Broadcasting (advertising) via the local flint-ble native module.
//
// Rendezvous: BLE never carries the long signalId. A host advertises the Flint
// service UUID with a short token in its last segment, and writes
// rendezvous/{token} -> signalId here. A scanner reads the token off the
// advertisement, looks it up, and gets the signalId to subscribe/co-sign.
//
// Foreground only for v1: the scan is unfiltered (a per-signal UUID can't be
// filtered for), which iOS won't run in the background. RSSI is a rough near/far
// hint, never a precise position.

import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';
import { get, ref, remove, set } from 'firebase/database';
import { db } from './firebase';
import { startAdvertising as nativeStartAdvertising, stopAdvertising as nativeStopAdvertising } from '../modules/flint-ble';

// Fixed 24-hex prefix that marks an advertisement as Flint. The advertiser
// appends a 12-hex (48-bit) token to form the full service UUID; the scanner
// matches this prefix and slices the token back off.
export const FLINT_SERVICE_PREFIX = '0000f11n-7000-4000-8000-';

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

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

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
  // iOS prompts on first BLE use as long as the usage string is set in app.json.
  return true;
}

// ---------------------------------------------------------------------------
// Rendezvous (Firebase side — used by both halves)
// ---------------------------------------------------------------------------

// 12 hex chars = 48 bits of entropy, which fits the UUID's last segment.
export function makeToken(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export async function publishRendezvous(token: string, signalId: string): Promise<void> {
  await set(ref(db, `rendezvous/${token}`), signalId);
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

// ---------------------------------------------------------------------------
// Broadcasting (host side — advertise this signal to nearby devices)
// ---------------------------------------------------------------------------

let currentToken: string | null = null;

// Announce a signal: mint a token, map it to the signalId in Firebase, and
// advertise the token-bearing service UUID over BLE. Request permissions first.
export async function startBroadcasting(signalId: string): Promise<void> {
  await stopBroadcasting();
  const token = makeToken();
  currentToken = token;
  await publishRendezvous(token, signalId);
  await nativeStartAdvertising(FLINT_SERVICE_PREFIX + token);
}

export async function stopBroadcasting(): Promise<void> {
  try {
    await nativeStopAdvertising();
  } catch {
    // ignore — nothing was advertising
  }
  if (currentToken) {
    await clearRendezvous(currentToken).catch(() => {});
    currentToken = null;
  }
}

// ---------------------------------------------------------------------------
// Discovery (scanning side)
// ---------------------------------------------------------------------------

function extractToken(device: Device): string | null {
  for (const u of device.serviceUUIDs ?? []) {
    const lower = u.toLowerCase();
    if (lower.startsWith(FLINT_SERVICE_PREFIX)) {
      return lower.slice(FLINT_SERVICE_PREFIX.length);
    }
  }
  return null;
}

// Start scanning for nearby Flint signals. onFound fires once per distinct token
// as it resolves to a signalId. Returns a stop function — call it on unmount.
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
    // Null filter = scan everything, then match the Flint prefix ourselves,
    // because a per-signal UUID can't be filtered for. Foreground only.
    m.startDeviceScan(null, { allowDuplicates: false }, async (err, device) => {
      if (err) {
        onError?.(err.message);
        return;
      }
      if (!device) return;
      const token = extractToken(device);
      if (!token || seen.has(token)) return;
      seen.add(token);
      const signalId = await resolveSignalId(token);
      if (signalId) {
        onFound({ signalId, token, rssi: device.rssi ?? null });
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