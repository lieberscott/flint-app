import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { markerColorForRole } from '@/lib/map';
import type { MemberRole } from '@/lib/types';

type Props = {
  coordinate: { latitude: number; longitude: number };
  role: MemberRole | 'self';
  isSelf?: boolean;
};

export function MemberMarker({ coordinate, role, isSelf }: Props) {
  const color = markerColorForRole(isSelf ? 'self' : role);

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <View style={styles.wrapper}>
        {isSelf && <View style={[styles.ring, { borderColor: color }]} />}
        <View style={[styles.dot, { backgroundColor: color }]} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    opacity: 0.6,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
