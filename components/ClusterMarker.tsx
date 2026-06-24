import { StyleSheet, Text, View } from 'react-native';
import { Callout, Marker } from 'react-native-maps';

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
      tracksViewChanges={false}>
      <View style={styles.wrapper}>
        <View style={styles.dot} />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{cluster.memberCount}</Text>
        </View>
      </View>
      <Callout tooltip onPress={() => onPress?.(cluster.incidentId)}>
        <View style={styles.callout}>
          <Text style={styles.calloutTitle} numberOfLines={2}>
            {cluster.description || 'Loud audio nearby'}
          </Text>
          <View style={styles.calloutRow}>
            <Text style={styles.calloutMeta}>
              {cluster.memberCount} {cluster.memberCount === 1 ? 'person' : 'people'} here
            </Text>
            <View style={styles.joinChip}>
              <Text style={styles.joinChipText}>✓ Join</Text>
            </View>
          </View>
        </View>
      </Callout>
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
  callout: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#334155',
    maxWidth: 240,
    minWidth: 150,
  },
  calloutTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  calloutMeta: {
    color: '#94a3b8',
    fontSize: 12,
  },
  joinChip: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  joinChipText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});