import * as Location from 'expo-location';

export type LocationPing = {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
};

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === Location.PermissionStatus.GRANTED;
}

export async function getCurrentLocationPing(): Promise<LocationPing> {
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    heading: position.coords.heading ?? null,
    speed: position.coords.speed ?? null,
  };
}

export function startLocationPingLoop(
  onPing: (ping: LocationPing) => void,
  intervalMs = 5000,
): () => void {
  let active = true;

  const tick = async () => {
    if (!active) {
      return;
    }

    try {
      const ping = await getCurrentLocationPing();
      onPing(ping);
    } catch {
      // Location unavailable; skip this tick.
    }
  };

  void tick();
  const interval = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    active = false;
    clearInterval(interval);
  };
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let isLng = true;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = (ch << 1) + 1;
        minLng = mid;
      } else {
        ch = (ch << 1) + 0;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = (ch << 1) + 1;
        minLat = mid;
      } else {
        ch = (ch << 1) + 0;
        maxLat = mid;
      }
    }

    isLng = !isLng;
    bit += 1;

    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}
