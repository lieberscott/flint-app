import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Input } from '@/components/controls';
import { Body, Subtitle, Title } from '@/components/ui';
import {
  CONFRONTER_SCRIPT,
  DIRECTIONS,
  PARTNER_SCRIPT,
  type IncidentMember,
  type IncidentStatus,
} from '@/lib/types';

export type SheetState = 'idle' | 'waiting' | 'roles' | 'ready' | 'go';

type Props = {
  state: SheetState;
  othersCount: number;
  status: IncidentStatus;
  myRole?: string;
  reporting: boolean;
  acting: boolean;
  showTransit: boolean;
  transitLine: string;
  direction: string;
  carNumber: string;
  confronterLabel: string;
  partnersCount: number;
  isConfronter: boolean;
  isPartner: boolean;
  onToggleTransit: () => void;
  onTransitLineChange: (value: string) => void;
  onDirectionChange: (value: string) => void;
  onCarNumberChange: (value: string) => void;
  onReport: () => void;
  onRole: (role: 'confronter' | 'partner') => void;
  onGo: () => void;
  onDone: () => void;
};

export function MapBottomSheet({
  state,
  othersCount,
  status,
  myRole,
  reporting,
  acting,
  showTransit,
  transitLine,
  direction,
  carNumber,
  confronterLabel,
  partnersCount,
  isConfronter,
  isPartner,
  onToggleTransit,
  onTransitLineChange,
  onDirectionChange,
  onCarNumberChange,
  onReport,
  onRole,
  onGo,
  onDone,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      {state === 'idle' && (
        <>
          <Title>Someone being loud?</Title>
          <Subtitle>
            Tap report to check in. Nearby dots show others bothered by loud audio in your area.
          </Subtitle>
          <Button
            disabled={reporting}
            label={reporting ? 'Checking in...' : 'Report nuisance'}
            onPress={onReport}
          />
          <Button
            label={showTransit ? 'Hide transit details' : 'On transit? Add details'}
            onPress={onToggleTransit}
            variant="secondary"
          />
          {showTransit && (
            <View style={styles.transitSection}>
              <Input
                label="Transit line (optional)"
                onChangeText={onTransitLineChange}
                placeholder="N, 4, M14A..."
                value={transitLine}
              />
              <Body>Direction (optional)</Body>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {DIRECTIONS.map((item) => (
                  <Button
                    key={item}
                    label={item}
                    onPress={() => onDirectionChange(item)}
                    variant={direction === item ? 'primary' : 'secondary'}
                  />
                ))}
              </ScrollView>
              <Input
                keyboardType="numeric"
                label="Car # (optional)"
                onChangeText={onCarNumberChange}
                placeholder="If visible"
                value={carNumber}
              />
            </View>
          )}
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
          {myRole && myRole !== 'bothered' && <Body>Your role: {myRole}</Body>}
        </>
      )}

      {state === 'roles' && (
        <>
          <Title>Choose a role</Title>
          <Body>When you are ready to speak up together.</Body>
          <Button label="I'll speak first" onPress={() => onRole('confronter')} />
          <Button label="I'll back them up" onPress={() => onRole('partner')} variant="secondary" />
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
          <Body>Confronter: {confronterLabel}</Body>
          <Body>Partners ready: {String(partnersCount)}</Body>
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
            label="Done"
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
  transitSection: {
    gap: 12,
  },
  chips: {
    gap: 8,
  },
  scroll: {
    maxHeight: 280,
  },
  scrollContent: {
    gap: 12,
    paddingBottom: 8,
  },
});
