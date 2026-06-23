import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';

import { ClusterMarker } from '@/components/ClusterMarker';
import { MemberMarker } from '@/components/MemberMarker';
import { fitMapRegion, type MapCoordinate, type NearbyCluster } from '@/lib/map';
import type { IncidentMember } from '@/lib/types';

type Props = {
  userCoordinate: MapCoordinate | null;
  members: IncidentMember[];
  userId: string | null;
  nearbyClusters: NearbyCluster[];
  excludeIncidentId?: string | null;
  onClusterPress?: (incidentId: string) => void;
  followUser?: boolean;
};

export function FlintMap({
  userCoordinate,
  members,
  userId,
  nearbyClusters,
  excludeIncidentId,
  onClusterPress,
  followUser = true,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const [userPanned, setUserPanned] = useState(false);

  const memberMarkers = members
    .filter((member) => member.user_id !== userId)
    .map((member) => {
      if (member.last_lat == null || member.last_lng == null) {
        return null;
      }
      return (
        <MemberMarker
          key={member.user_id}
          coordinate={{ latitude: member.last_lat, longitude: member.last_lng }}
          role={member.role}
        />
      );
    });

  const visibleClusters = nearbyClusters.filter(
    (cluster) => cluster.incidentId !== excludeIncidentId,
  );

  useEffect(() => {
    if (!mapRef.current || userPanned) {
      return;
    }

    const memberCoords = members
      .map((m) =>
        m.last_lat != null && m.last_lng != null
          ? { latitude: m.last_lat, longitude: m.last_lng }
          : null,
      )
      .filter((c): c is MapCoordinate => c != null);

    const clusterCoords = visibleClusters.map((c) => ({
      latitude: c.lat,
      longitude: c.lng,
    }));

    const region = fitMapRegion([...memberCoords, ...clusterCoords], userCoordinate);
    if (region) {
      mapRef.current.animateToRegion(region, 400);
    } else if (followUser && userCoordinate) {
      mapRef.current.animateToRegion(
        {
          ...userCoordinate,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        400,
      );
    }
  }, [members, visibleClusters, userCoordinate, followUser, userPanned]);

  const initialRegion: Region = userCoordinate
    ? { ...userCoordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : {
        latitude: 40.7128,
        longitude: -74.006,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsMyLocationButton={false}
        onPanDrag={() => setUserPanned(true)}>
        {userCoordinate && userId && (
          <MemberMarker
            coordinate={userCoordinate}
            role="bothered"
            isSelf
          />
        )}
        {memberMarkers}
        {visibleClusters.map((cluster) => (
          <ClusterMarker key={cluster.incidentId} cluster={cluster} onPress={onClusterPress} />
        ))}
      </MapView>

      {userPanned && userCoordinate && (
        <Pressable
          style={styles.recenter}
          onPress={() => {
            setUserPanned(false);
            mapRef.current?.animateToRegion(
              {
                ...userCoordinate,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              },
              400,
            );
          }}>
          <Text style={styles.recenterText}>Recenter</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  recenter: {
    position: 'absolute',
    top: 56,
    right: 16,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  recenterText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
