import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Input } from '@/components/controls';
import { Body, Subtitle, Title } from '@/components/ui';
import {
  CONFRONTER_SCRIPT,
  PARTNER_SCRIPT,
  type IncidentMember,
  type IncidentStatus,
} from '@/lib/types';

export type SheetState = 'idle' | 'waiting' | 'roles' | 'ready' | 'go';

type Props = {
  state: SheetState;
  othersCount: number;
  status: IncidentStatus;
  reporting: boolean;
  acting: boolean;
  description: string;
  members: IncidentMember[];
  userId: string | null;
  isConfronter: boolean;
  isPartner: boolean;
  onDescriptionChange: (value: string) => void;
  onReport: () => void;
  onRole: (role: 'confronter' | 'partner') => void;
  onGo: () => void;
  onDone: () => void;
};

const SHIRT_HEX: Record<string, string> = {
  black: '#111827',
  white: '#f8fafc',
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
};

function shirtHex(color?: string | null): string {
  return (color && SHIRT_HEX[color]) || '#64748b';
}

function roleLabel(role: string): string {
  if (role === 'confronter') return 'speaking first';
  if (role === 'partner') return 'backing up';
  return 'no role yet';
}

export function MapBottomSheet({
  state,
  othersCount,
  status,
  reporting,
  acting,
  description,
  members,
  userId,
  isConfronter,
  isPartner,
  onDescriptionChange,
  onReport,
  onRole,
  onGo,
  onDone,
}: Props) {
  const insets = useSafeAreaInsets();

  const roster = members.length > 0 && (
    <View style={styles.roster}>
      {members.map((member) => (
        <View key={member.user_id} style={styles.rosterRow}>
          <View style={[styles.swatch, { backgroundColor: shirtHex(member.profile?.shirt_color) }]} />
          <Text style={styles.rosterName}>
            {member.profile?.display_name || 'Someone'}
            {member.user_id === userId ? ' (you)' : ''}
          </Text>
          <Text style={styles.rosterRole}>{roleLabel(member.role)}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      {state === 'idle' && (
        <>
          <Title>Someone being loud?</Title>
          <Subtitle>
            Tap report to check in. Nearby dots show others bothered by loud audio in your area.
          </Subtitle>
          <Input
            label="Quick description (optional)"
            onChangeText={onDescriptionChange}
            placeholder="Green shirt, phone audio, inside Chipotle"
            value={description}
            maxLength={40}
          />
          <Button
            disabled={reporting}
            label={reporting ? 'Checking in...' : 'Report nuisance'}
            onPress={onReport}
          />
        </>
      )}

      {state === 'waiting' && (
        <>
          <Text style={styles.count}>{othersCount}</Text>
          <Body>
            {othersCount === 0
              ? 'No one else nearby yet. Stay on the map — others may join.'
              : othersCount === 1
                ? 'One other person nearby also bothered.'
                : `${othersCount} others nearby also bothered.`}
          </Body>
          <Body>Status: {status}</Body>
          {roster}
          <Button disabled={acting} label="Leave" onPress={onDone} variant="secondary" />
        </>
      )}

      {state === 'roles' && (
        <>
          <Title>Choose a role</Title>
          <Body>When you are ready to speak up together.</Body>
          <Button label="I'll speak first" onPress={() => onRole('confronter')} />
          <Button label="I'll back them up" onPress={() => onRole('partner')} variant="secondary" />
          {roster}
          <Button disabled={acting} label="Leave" onPress={onDone} variant="secondary" />
        </>
      )}

      {(state === 'ready' || state === 'go') && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Title>{state === 'go' ? 'Speak up now' : 'Ready together'}</Title>
          <Subtitle>
            {state === 'go'
              ? isPartner
                ? 'Back them up now with the line below.'
                : isConfronter
                  ? 'Say your line calmly and clearly.'
                  : 'The group is speaking up now.'
              : 'Review the script. The confronter starts when everyone is ready.'}
          </Subtitle>
          {roster}
          <Body>Confronter says:</Body>
          <Subtitle>{CONFRONTER_SCRIPT}</Subtitle>
          <Body>Partners say:</Body>
          <Subtitle>{PARTNER_SCRIPT}</Subtitle>
          {state === 'go' && isPartner && (
            <>
              <Title>Back them up now</Title>
              <Subtitle>{PARTNER_SCRIPT}</Subtitle>
            </>
          )}
          {state === 'ready' && isConfronter && (
            <Button disabled={acting} label={acting ? 'Starting...' : 'Go'} onPress={onGo} />
          )}
          <Button
            disabled={acting}
            label="Leave"
            onPress={onDone}
            variant={state === 'ready' && isConfronter ? 'secondary' : 'primary'}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
    borderTopWidth: 1,
    borderColor: '#334155',
    maxHeight: '45%',
  },
  count: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  roster: {
    gap: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#475569',
  },
  rosterName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  rosterRole: {
    color: '#94a3b8',
    fontSize: 13,
  },
  scroll: {
    maxHeight: 280,
  },
  scrollContent: {
    gap: 12,
    paddingBottom: 8,
  },
});