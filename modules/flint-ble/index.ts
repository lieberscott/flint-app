import { requireNativeModule } from 'expo-modules-core';

type NativeFlintBle = {
  startAdvertising(serviceUuid: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  isAdvertisingSupported(): Promise<boolean>;
};

// Resolve the native module lazily, on first use, instead of at import time.
// That lets the JS bundle load where the native module isn't present (e.g. Expo
// Go) — the BLE functions only throw if you actually call them there. In a dev
// build this resolves normally.
let nativeModule: NativeFlintBle | null = null;
function getNative(): NativeFlintBle {
  if (!nativeModule) {
    nativeModule = requireNativeModule<NativeFlintBle>('FlintBle');
  }
  return nativeModule;
}

export function startAdvertising(serviceUuid: string): Promise<void> {
  return getNative().startAdvertising(serviceUuid);
}

export function stopAdvertising(): Promise<void> {
  return getNative().stopAdvertising();
}

export function isAdvertisingSupported(): Promise<boolean> {
  return getNative().isAdvertisingSupported();
}