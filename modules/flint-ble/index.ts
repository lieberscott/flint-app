import { requireNativeModule } from 'expo-modules-core';

type NativeFlintBle = {
  startAdvertising(token: string, ttlMs: number): Promise<void>;
  stopAdvertising(): Promise<void>;
  isAdvertisingSupported(): Promise<boolean>;
};

// Resolve the native module lazily, on first use, so the JS bundle still loads
// where the native module is absent (e.g. Expo Go) — calls just throw there.
let nativeModule: NativeFlintBle | null = null;
function getNative(): NativeFlintBle {
  if (!nativeModule) {
    nativeModule = requireNativeModule<NativeFlintBle>('FlintBle');
  }
  return nativeModule;
}

// token is served over GATT; ttlMs is a native auto-stop so broadcasting caps
// out even while the app is backgrounded. The fixed service UUID is hardcoded natively.
export function startAdvertising(token: string, ttlMs: number): Promise<void> {
  return getNative().startAdvertising(token, ttlMs);
}

export function stopAdvertising(): Promise<void> {
  return getNative().stopAdvertising();
}

export function isAdvertisingSupported(): Promise<boolean> {
  return getNative().isAdvertisingSupported();
}