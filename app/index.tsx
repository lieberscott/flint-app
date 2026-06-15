import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';

import { Button, Input, LoadingState } from '@/components/controls';
import { Body, Card, Screen, Subtitle, Title } from '@/components/ui';
import { ensureAnonymousSession, getCurrentUserId, getProfile } from '@/lib/auth';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  countOthers,
  getIncident,
  getIncidentMembers,
  isReadyGroup,
  pingIncident,
  reportNuisance,
  setMemberRole,
  subscribeToIncident,
} from '@/lib/incidents';
import { getCurrentLocationPing, requestLocationPermission, startLocationPingLoop } from '@/lib/location';
import { DIRECTIONS, type IncidentMember } from '@/lib/types';

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [transitLine, setTransitLine] = useState('');
  const [direction, setDirection] = useState<string>(DIRECTIONS[0]);
  const [carNumber, setCarNumber] = useState('');
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [members, setMembers] = useState<IncidentMember[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('open');

  const refreshIncident = useCallback(async (activeIncidentId: string) => {
    const [incident, nextMembers] = await Promise.all([
      getIncident(activeIncidentId),
      getIncidentMembers(activeIncidentId),
    ]);

    if (incident) {
      setStatus(incident.status);
      if (incident.status === 'ready' || incident.status === 'go') {
        router.push({ pathname: '/ready', params: { incidentId: activeIncidentId } });
      }
    }

    setMembers(nextMembers);
  }, [router]);

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

    void refreshIncident(incidentId);
    const unsubscribeRealtime = subscribeToIncident(incidentId, () => {
      void refreshIncident(incidentId);
    });

    return unsubscribeRealtime;
  }, [incidentId, refreshIncident]);

  useEffect(() => {
    if (!incidentId || !transitLine) {
      return;
    }

    const stopPingLoop = startLocationPingLoop((ping) => {
      void pingIncident(
        incidentId,
        transitLine,
        direction,
        ping.lat,
        ping.lng,
        ping.heading,
        ping.speed,
        carNumber || null,
      ).catch(() => {
        // Ignore transient ping failures.
      });
    });

    return stopPingLoop;
  }, [incidentId, transitLine, direction, carNumber]);

  async function handleReport() {
    if (!transitLine.trim()) {
      Alert.alert('Line required', 'Enter the transit line you are on.');
      return;
    }

    setReporting(true);
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        Alert.alert('Location required', 'Enable location to find riders on the same train.');
        return;
      }

      const ping = await getCurrentLocationPing();
      const result = await reportNuisance(
        transitLine,
        direction,
        ping.lat,
        ping.lng,
        ping.heading,
        ping.speed,
        carNumber || null,
      );

      setIncidentId(result.incident_id);
      setStatus(result.status);
      await refreshIncident(result.incident_id);
    } catch (error) {
      Alert.alert('Report failed', error instanceof Error ? error.message : 'Unknown error');
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

  if (loading) {
    return <LoadingState message="Loading Flint..." />;
  }

  if (!isFirebaseConfigured) {
  return (
    <Screen>
      <Title>Configure Firebase</Title>
      <Subtitle>
        Add your Firebase config to lib/firebase.ts and restart Expo.
      </Subtitle>
    </Screen>
  );
}

  const othersCount = userId ? countOthers(members, userId) : 0;
  const myMembership = members.find((member) => member.user_id === userId);
  const canChooseRole = Boolean(incidentId && othersCount >= 1);
  const ready = isReadyGroup(members);

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Title>Someone being loud?</Title>
        <Subtitle>
          Log in here if someone near you is playing music or videos without headphones. If others
          on the same train join, you can speak up together.
        </Subtitle>

        <Card>
          <Input
            label="Transit line"
            onChangeText={setTransitLine}
            placeholder="N, 4, M14A..."
            value={transitLine}
          />

          <Body>Direction</Body>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {DIRECTIONS.map((item) => (
              <Button
                key={item}
                label={item}
                onPress={() => setDirection(item)}
                variant={direction === item ? 'primary' : 'secondary'}
              />
            ))}
          </ScrollView>

          <Input
            keyboardType="numeric"
            label="Car # (optional)"
            onChangeText={setCarNumber}
            placeholder="If visible on the door"
            value={carNumber}
          />
        </Card>

        {!incidentId ? (
          <Button
            disabled={reporting}
            label={reporting ? 'Finding nearby riders...' : 'Someone near me is being loud'}
            onPress={handleReport}
          />
        ) : (
          <Card>
            <Text style={{ color: '#fff', fontSize: 32, fontWeight: '700' }}>{othersCount}</Text>
            <Body>
              {othersCount === 0
                ? 'No one else nearby yet. Stay on this screen — others may join.'
                : othersCount === 1
                  ? 'Other rider nearby also bothered.'
                  : `${othersCount} others nearby also bothered.`}
            </Body>
            <Body>Status: {status}</Body>
            {myMembership?.role !== 'bothered' && (
              <Body>Your role: {myMembership?.role ?? 'bothered'}</Body>
            )}
          </Card>
        )}

        {canChooseRole && !ready && (
          <Card>
            <Body>Choose a role when you are ready to speak up together.</Body>
            <Button label="I'll speak first" onPress={() => handleRole('confronter')} />
            <Button label="I'll back them up" onPress={() => handleRole('partner')} variant="secondary" />
          </Card>
        )}

        {ready && incidentId && (
          <Button
            label="Group is ready — continue"
            onPress={() => router.push({ pathname: '/ready', params: { incidentId } })}
          />
        )}
      </Screen>
    </ScrollView>
  );
}
