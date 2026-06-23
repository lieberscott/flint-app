import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';

import { Button, Input, LoadingState } from '@/components/controls';
import { Body, Card, Screen, Subtitle, Title } from '@/components/ui';
import { ensureAnonymousSession, getCurrentUserId, getProfile, saveProfile } from '@/lib/auth';
import { isFirebaseConfigured } from '@/lib/firebase';
import { requestLocationPermission } from '@/lib/location';
import { SHIRT_COLORS } from '@/lib/types';

export default function SetupScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [shirtColor, setShirtColor] = useState<string | null>(null);

  useEffect(() => {
    async function bootstrap() {
      if (!isFirebaseConfigured) {
        setLoading(false);
        return;
      }

      try {
        await ensureAnonymousSession();
        const userId = await getCurrentUserId();
        if (!userId) {
          throw new Error('Unable to start anonymous session');
        }

        const profile = await getProfile(userId);
        if (profile) {
          router.replace('/');
          return;
        }
      } catch (error) {
        Alert.alert('Setup failed', error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, [router]);

  async function handleSave() {
    if (!displayName.trim()) {
      Alert.alert('Name required', 'Enter your first name so partners can recognize you.');
      return;
    }

    setSaving(true);
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        Alert.alert(
          'Location required',
          'Flint needs location access to match you with nearby people.',
        );
        return;
      }

      const userId = await getCurrentUserId();
      if (!userId) {
        throw new Error('Not signed in');
      }

      await saveProfile(userId, displayName, shirtColor);
      router.replace('/');
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingState message="Starting Flint..." />;
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

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Title>Welcome to Flint</Title>
        <Subtitle>
          We only use your first name and optional shirt color so partners nearby can spot you if
          needed.
        </Subtitle>

        <Card>
          <Input
            label="First name"
            onChangeText={setDisplayName}
            placeholder="Alex"
            value={displayName}
          />

          <Body>Shirt color (optional)</Body>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {SHIRT_COLORS.map((color) => {
              const selected = shirtColor === color;
              return (
                <Button
                  key={color}
                  label={color}
                  onPress={() => setShirtColor(selected ? null : color)}
                  variant={selected ? 'primary' : 'secondary'}
                />
              );
            })}
          </ScrollView>
        </Card>

        <Card>
          <Body>
            Location is used while you report a nuisance, to match you with nearby people. Sessions
            expire after 10 minutes.
          </Body>
        </Card>

        <Button disabled={saving} label={saving ? 'Saving...' : 'Continue'} onPress={handleSave} />
      </Screen>
    </ScrollView>
  );
}
