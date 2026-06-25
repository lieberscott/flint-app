import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';

import { ClusterMarker } from '@/components/ClusterMarker';
import { Button } from '@/components/controls';
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
  const [previewIncidentId, setPreviewIncidentId] = useState<string | null>(null);
  const [previewPoint, setPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const previewOpenedAt = useRef(0);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

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

  const previewCluster = previewIncidentId
    ? visibleClusters.find((cluster) => cluster.incidentId === previewIncidentId) ?? null
    : null;

  const dismissPreview = () => {
    setPreviewIncidentId(null);
    setPreviewPoint(null);
  };

  // Tapping the map dismisses the card — but ignore the tap that just opened it
  // (on some platforms a marker tap also fires the map's onPress).
  const handleMapPress = () => {
    if (Date.now() - previewOpenedAt.current > 300) {
      dismissPreview();
    }
  };

  // Anchor the preview card over the tapped dot using its on-screen position.
  const handleDotPress = async (cluster: NearbyCluster) => {
    previewOpenedAt.current = Date.now();
    setPreviewIncidentId(cluster.incidentId);
    setPreviewPoint(null);
    const fallback = { x: screenWidth / 2, y: 0 };
    if (!mapRef.current) {
      setPreviewPoint(fallback);
      return;
    }
    try {
      const point = await mapRef.current.pointForCoordinate({
        latitude: cluster.lat,
        longitude: cluster.lng,
      });
      setPreviewPoint(point);
    } catch {
      setPreviewPoint(fallback);
    }
  };

  // Position the card above the dot once we know its screen point; until then
  // (or if the lookup fails) fall back to a fixed spot so it always shows.
  const previewCardPosition = !previewPoint
    ? { top: 80, left: Math.max(8, (screenWidth - 230) / 2) }
    : {
        left: Math.max(8, Math.min(previewPoint.x - 115, screenWidth - 238)),
        ...(previewPoint.y < 180
          ? { top: previewPoint.y + 26 }
          : { bottom: screenHeight - previewPoint.y + 26 }),
      };

  useEffect(() => {
    if (!mapRef.current || userPanned || previewIncidentId) {
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
  }, [members, visibleClusters, userCoordinate, followUser, userPanned, previewIncidentId]);

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
        onPress={handleMapPress}
        onPanDrag={() => {
          setUserPanned(true);
          dismissPreview();
        }}>
        {userCoordinate && userId && (
          <MemberMarker
            coordinate={userCoordinate}
            role="bothered"
            isSelf
          />
        )}
        {memberMarkers}
        {visibleClusters.map((cluster) => (
          <ClusterMarker
            key={cluster.incidentId}
            cluster={cluster}
            onPress={() => handleDotPress(cluster)}
          />
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

      {previewCluster && previewPoint && (
        <View style={[styles.previewCard, previewCardPosition]}>
          <Text style={styles.previewDesc} numberOfLines={2}>
            {previewCluster.description || 'Loud audio nearby'}
          </Text>
          <Text style={styles.previewMeta}>
            {previewCluster.memberCount}{' '}
            {previewCluster.memberCount === 1 ? 'person' : 'people'} here
          </Text>
          <Button
            label="✓ Join"
            onPress={() => {
              onClusterPress?.(previewCluster.incidentId);
              dismissPreview();
            }}
          />
          <Button label="Close" onPress={dismissPreview} variant="secondary" />
        </View>
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
  previewCard: {
    position: 'absolute',
    width: 230,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  previewDesc: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  previewMeta: {
    color: '#94a3b8',
    fontSize: 12,
  },
});