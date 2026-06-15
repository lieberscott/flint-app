import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { Button, LoadingState } from '@/components/controls';
import { Body, Card, Screen, Subtitle, Title } from '@/components/ui';
import { getCurrentUserId } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/firebase';
import {
  closeIncident,
  countPartners,
  getConfronter,
  getIncident,
  getIncidentMembers,
  subscribeToIncident,
  triggerGo,
} from '@/lib/incidents';
import { CONFRONTER_SCRIPT, PARTNER_SCRIPT, type Incident, type IncidentMember } from '@/lib/types';

export default function ReadyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ incidentId?: string }>();
  const incidentId = typeof params.incidentId === 'string' ? params.incidentId : null;

  const [loading, setLoading] = useState(true);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [members, setMembers] = useState<IncidentMember[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    if (!incidentId) {
      return;
    }

    const [nextIncident, nextMembers, currentUserId] = await Promise.all([
      getIncident(incidentId),
      getIncidentMembers(incidentId),
      getCurrentUserId(),
    ]);

    setIncident(nextIncident);
    setMembers(nextMembers);
    setUserId(currentUserId);

    if (nextIncident?.status === 'closed') {
      router.replace('/');
    }
  }, [incidentId, router]);

  useEffect(() => {
    if (!incidentId || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    void refresh().finally(() => setLoading(false));
    const unsubscribe = subscribeToIncident(incidentId, () => {
      void refresh();
    });

    return unsubscribe;
  }, [incidentId, refresh]);

  async function handleGo() {
    if (!incidentId) {
      return;
    }

    setActing(true);
    try {
      await triggerGo(incidentId);
      await refresh();
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
      await closeIncident(incidentId);
      router.replace('/');
    } catch (error) {
      Alert.alert('Unable to close', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setActing(false);
    }
  }

  if (!incidentId) {
    return (
      <Screen>
        <Title>Missing session</Title>
        <Subtitle>Return home and report a nuisance to start a group.</Subtitle>
        <Button label="Back home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (loading) {
    return <LoadingState message="Loading group..." />;
  }

  const confronter = getConfronter(members);
  const partners = countPartners(members);
  const isConfronter = confronter?.user_id === userId;
  const isPartner = members.some((member) => member.user_id === userId && member.role === 'partner');
  const goSignal = incident?.status === 'go';

  const confronterLabel = confronter?.profile
    ? `${confronter.profile.display_name}${
        confronter.profile.shirt_color ? ` (${confronter.profile.shirt_color} shirt)` : ''
      }`
    : 'your confronter';

  return (
    <Screen>
      <Title>{goSignal ? 'Speak up now' : 'Ready together'}</Title>
      <Subtitle>
        {goSignal
          ? isPartner
            ? 'Back them up now with the line below.'
            : isConfronter
              ? 'Say your line calmly and clearly.'
              : 'The group is speaking up now.'
          : 'Review the script below. The confronter starts when everyone is ready.'}
      </Subtitle>

      <Card>
        <Body>Confronter: {confronterLabel}</Body>
        <Body>Partners ready: {String(partners)}</Body>
      </Card>

      <Card>
        <Body>Confronter says:</Body>
        <Subtitle>{CONFRONTER_SCRIPT}</Subtitle>
        <Body>Partners say:</Body>
        <Subtitle>{PARTNER_SCRIPT}</Subtitle>
      </Card>

      {goSignal && isPartner && (
        <Card>
          <Title>Back them up now</Title>
          <Subtitle>{PARTNER_SCRIPT}</Subtitle>
        </Card>
      )}

      {isConfronter && !goSignal && (
        <Button disabled={acting} label={acting ? 'Starting...' : 'Go'} onPress={handleGo} />
      )}

      <Button
        disabled={acting}
        label="Done"
        onPress={handleDone}
        variant={isConfronter && !goSignal ? 'secondary' : 'primary'}
      />
    </Screen>
  );
}
