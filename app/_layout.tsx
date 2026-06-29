import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#16213e' },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ title: 'Setup', headerBackVisible: false }} />
        <Stack.Screen name="ready" options={{ headerShown: false }} />
        <Stack.Screen name="signal" options={{ headerShown: false }} />
        <Stack.Screen name="nearby" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
