import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { FlintMap } from '@/components/FlintMap';
import { Button, LoadingState } from '@/components/controls';
import { MapBottomSheet, type SheetState } from '@/components/MapBottomSheet';
import { Body, Card, Screen, Subtitle, Title } from '@/components/ui';
import { ensureAnonymousSession, getCurrentUserId, getProfile } from '@/lib/auth';
import { isFirebaseConfigured } from '@/lib/firebase';
import type { NearbyCluster } from '@/lib/map';
import {
  leaveIncident,
  countOthers,
  getConfronter,
  getIncident,
  getIncidentMembers,
  isReadyGroup,
  joinIncident,
  pingIncident,
  reportNuisance,
  setMemberRole,
  subscribeToIncident,
  subscribeToNearbyIncidents,
  triggerGo,
} from '@/lib/incidents';
import {
  getCurrentLocationPing,
  requestLocationPermission,
  startLocationPingLoop,
  type LocationPing,
} from '@/lib/location';
import type { IncidentMember, IncidentStatus } from '@/lib/types';

function deriveSheetState(
  incidentId: string | null,
  status: IncidentStatus,
  members: IncidentMember[],
  userId: string | null,
): SheetState {
  if (!incidentId) return 'idle';
  if (status === 'go') return 'go';
  if (status === 'ready') return 'ready';

  const othersCount = userId ? countOthers(members, userId) : 0;
  const ready = isReadyGroup(members);
  if (othersCount >= 1 && !ready) return 'roles';
  return 'waiting';
}

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ incidentId?: string }>();
  const paramIncidentId = typeof params.incidentId === 'string' ? params.incidentId : null;

  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [acting, setActing] = useState(false);
  const [description, setDescription] = useState('');
  const [incidentId, setIncidentId] = useState<string | null>(paramIncidentId);
  const [members, setMembers] = useState<IncidentMember[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<IncidentStatus>('open');
  const [userPing, setUserPing] = useState<LocationPing | null>(null);
  const [nearbyClusters, setNearbyClusters] = useState<NearbyCluster[]>([]);
  const prevMembersRef = useRef<IncidentMember[]>([]);

  const userCoordinate = userPing
    ? { latitude: userPing.lat, longitude: userPing.lng }
    : null;

  const refreshIncident = useCallback(async (activeIncidentId: string) => {
    const [incident, nextMembers] = await Promise.all([
      getIncident(activeIncidentId),
      getIncidentMembers(activeIncidentId),
    ]);

    // Incident is gone (closed and cleaned up) or explicitly closed:
    // drop back to the map.
    if (!incident || incident.status === 'closed') {
      setIncidentId(null);
      setMembers([]);
      setStatus('open');
      prevMembersRef.current = [];
      return;
    }

    // If someone who was here is now gone, say so (but never about myself).
    const nextIds = new Set(nextMembers.map((m) => m.user_id));
    const left = prevMembersRef.current.filter(
      (m) => m.user_id !== userId && !nextIds.has(m.user_id),
    );
    if (left.length > 0) {
      const names = left.map((m) => m.profile?.display_name ?? 'Someone').join(', ');
      Alert.alert('Someone left', `${names} left the group.`);
    }
    prevMembersRef.current = nextMembers;

    setStatus(incident.status);
    setMembers(nextMembers);
  }, [userId]);

  useEffect(() => {
    if (paramIncidentId) {
      setIncidentId(paramIncidentId);
    }
  }, [paramIncidentId]);

  useEffect(() => {
    async function bootstrap() {
      if (!isFirebaseConfigured) {
        setLoading(false);
        return;
      }

      try {
        await ensureAnonymousSession();
        const id = await getCurrentUserId();
        if (!id) {
          throw new Error('Unable to start anonymous session');
        }

        const profile = await getProfile(id);
        if (!profile) {
          router.replace('/setup');
          return;
        }

        setUserId(id);
        const granted = await requestLocationPermission();
        if (granted) {
          const ping = await getCurrentLocationPing();
          setUserPing(ping);
        }
      } catch (error) {
        Alert.alert('Startup failed', error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, [router]);

  useEffect(() => {
    if (!incidentId) {
      return;
    }

    prevMembersRef.current = [];
    void refreshIncident(incidentId);
    const unsubscribeRealtime = subscribeToIncident(incidentId, () => {
      void refreshIncident(incidentId);
    });

    return unsubscribeRealtime;
  }, [incidentId, refreshIncident]);

  useEffect(() => {
    if (!userPing) {
      return;
    }

    const radius = incidentId ? 200 : 200;
    const unsubscribe = subscribeToNearbyIncidents(
      userPing.lat,
      userPing.lng,
      radius,
      setNearbyClusters,
    );

    return unsubscribe;
  }, [userPing?.lat, userPing?.lng, incidentId]);

  useEffect(() => {
    const intervalMs = incidentId ? 5000 : 10000;
    const stopPingLoop = startLocationPingLoop((ping) => {
      setUserPing(ping);

      if (!incidentId) {
        return;
      }

      void pingIncident(incidentId, ping.lat, ping.lng, ping.heading, ping.speed).catch(() => {
        // Ignore transient ping failures.
      });
    }, intervalMs);

    return stopPingLoop;
  }, [incidentId]);

  async function ensureLocation(): Promise<LocationPing | null> {
    const granted = await requestLocationPermission();
    if (!granted) {
      Alert.alert('Location required', 'Enable location to find nearby people bothered by loud audio.');
      return null;
    }

    const ping = await getCurrentLocationPing();
    setUserPing(ping);
    return ping;
  }

  async function handleReport() {
    setReporting(true);
    try {
      const ping = await ensureLocation();
      if (!ping) {
        return;
      }

      const result = await reportNuisance(
        ping.lat,
        ping.lng,
        ping.heading,
        ping.speed,
        description,
      );

      setIncidentId(result.incident_id);
      setStatus(result.status);
      setDescription('');
      await refreshIncident(result.incident_id);
    } catch (error) {
      Alert.alert('Report failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setReporting(false);
    }
  }

  async function handleJoinCluster(targetIncidentId: string) {
    if (incidentId) {
      return;
    }

    setReporting(true);
    try {
      const ping = await ensureLocation();
      if (!ping) {
        return;
      }

      const result = await joinIncident(
        targetIncidentId,
        ping.lat,
        ping.lng,
        ping.heading,
        ping.speed,
      );

      setIncidentId(result.incident_id);
      setStatus(result.status);
      await refreshIncident(result.incident_id);
    } catch (error) {
      Alert.alert('Unable to join', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setReporting(false);
    }
  }

  async function handleRole(role: 'confronter' | 'partner') {
    if (!incidentId) {
      return;
    }

    try {
      await setMemberRole(incidentId, role);
      await refreshIncident(incidentId);
    } catch (error) {
      Alert.alert('Role unavailable', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async function handleGo() {
    if (!incidentId) {
      return;
    }

    setActing(true);
    try {
      await triggerGo(incidentId);
      await refreshIncident(incidentId);
    } catch (error) {
      Alert.alert('Unable to start', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setActing(false);
    }
  }

  async function handleDone() {
    if (!incidentId) {
      return;
    }

    setActing(true);
    try {
      await leaveIncident(incidentId);
      setIncidentId(null);
      setMembers([]);
      setStatus('open');
    } catch (error) {
      Alert.alert('Unable to leave', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setActing(false);
    }
  }

  const sheetState = useMemo(
    () => deriveSheetState(incidentId, status, members, userId),
    [incidentId, status, members, userId],
  );

  const othersCount = userId ? countOthers(members, userId) : 0;
  const confronter = getConfronter(members);
  const isConfronter = confronter?.user_id === userId;
  const isPartner = members.some((member) => member.user_id === userId && member.role === 'partner');

  if (loading) {
    return <LoadingState message="Loading Flint..." />;
  }

  if (!isFirebaseConfigured) {
    return (
      <Screen>
        <Title>Configure Firebase</Title>
        <Subtitle>Add your Firebase config to lib/firebase.ts and restart Expo.</Subtitle>
      </Screen>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <Screen>
        <Title>Map view unavailable on web</Title>
        <Subtitle>Use Expo Go on iOS or Android for the live map experience.</Subtitle>
        <Card>
          <Body>Nearby reports: {nearbyClusters.length}</Body>
          {!incidentId ? (
            <Button
              disabled={reporting}
              label={reporting ? 'Checking in...' : 'Report nuisance'}
              onPress={handleReport}
            />
          ) : (
            <>
              <Body>Others nearby: {othersCount}</Body>
              <Body>Status: {status}</Body>
              {sheetState === 'roles' && (
                <>
                  <Button label="I'll speak first" onPress={() => handleRole('confronter')} />
                  <Button
                    label="I'll back them up"
                    onPress={() => handleRole('partner')}
                    variant="secondary"
                  />
                </>
              )}
              {(sheetState === 'ready' || sheetState === 'go') && isConfronter && sheetState === 'ready' && (
                <Button disabled={acting} label="Go" onPress={handleGo} />
              )}
              <Button disabled={acting} label="Leave" onPress={handleDone} />
            </>
          )}
        </Card>
      </Screen>
    );
  }

  return (
    <View style={styles.container}>
      <FlintMap
        userCoordinate={userCoordinate}
        members={members}
        userId={userId}
        nearbyClusters={nearbyClusters}
        excludeIncidentId={incidentId}
        onClusterPress={handleJoinCluster}
      />
      <MapBottomSheet
        state={sheetState}
        othersCount={othersCount}
        status={status}
        reporting={reporting}
        acting={acting}
        description={description}
        members={members}
        userId={userId}
        isConfronter={isConfronter}
        isPartner={isPartner}
        onDescriptionChange={setDescription}
        onReport={handleReport}
        onRole={handleRole}
        onGo={handleGo}
        onDone={handleDone}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#16213e',
  },
});