import type { LatLng, Region } from 'react-native-maps';

import type { IncidentMember, MemberRole } from './types';

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type NearbyCluster = {
  incidentId: string;
  lat: number;
  lng: number;
  memberCount: number;
};

export type IncidentContext = {
  transitLine?: string;
  direction?: string;
  carNumber?: string;
};

export function markerColorForRole(role: MemberRole | 'self'): string {
  switch (role) {
    case 'self':
      return '#3b82f6';
    case 'confronter':
      return '#e94560';
    case 'partner':
      return '#64748b';
    default:
      return '#f59e0b';
  }
}

export function toCoordinate(lat: number | null, lng: number | null): MapCoordinate | null {
  if (lat == null || lng == null) {
    return null;
  }
  return { latitude: lat, longitude: lng };
}

export function membersWithCoordinates(
  members: IncidentMember[],
  userId: string | null,
): Array<{ member: IncidentMember; coordinate: MapCoordinate; isSelf: boolean }> {
  return members
    .map((member) => {
      const coordinate = toCoordinate(member.last_lat, member.last_lng);
      if (!coordinate) {
        return null;
      }
      return {
        member,
        coordinate,
        isSelf: member.user_id === userId,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
}

export function clusterCoordinates(clusters: NearbyCluster[]): MapCoordinate[] {
  return clusters.map((cluster) => ({
    latitude: cluster.lat,
    longitude: cluster.lng,
  }));
}

export function fitMapRegion(
  coordinates: MapCoordinate[],
  userCoordinate?: MapCoordinate | null,
): Region | null {
  const all = [...coordinates];
  if (userCoordinate) {
    all.push(userCoordinate);
  }
  if (all.length === 0) {
    return null;
  }

  if (all.length === 1) {
    return {
      ...all[0],
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  const lats = all.map((c) => c.latitude);
  const lngs = all.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latDelta = Math.max((maxLat - minLat) * 1.6, 0.008);
  const lngDelta = Math.max((maxLng - minLng) * 1.6, 0.008);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

export function latLngToMapCoordinate(lat: number, lng: number): LatLng {
  return { latitude: lat, longitude: lng };
}
