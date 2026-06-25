import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { NearbyCluster } from '@/lib/map';

type Props = {
  cluster: NearbyCluster;
  onPress?: (incidentId: string) => void;
};

export function ClusterMarker({ cluster, onPress }: Props) {
  return (
    <Marker
      coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      onPress={() => onPress?.(cluster.incidentId)}>
      <Pressable style={styles.wrapper} onPress={() => onPress?.(cluster.incidentId)}>
        <View style={styles.dot} />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{cluster.memberCount}</Text>
        </View>
      </Pressable>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#94a3b8',
    borderWidth: 2,
    borderColor: '#fff',
    opacity: 0.85,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});