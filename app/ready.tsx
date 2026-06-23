import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ReadyScreen() {
  const params = useLocalSearchParams<{ incidentId?: string }>();
  const incidentId = typeof params.incidentId === 'string' ? params.incidentId : undefined;

  if (incidentId) {
    return <Redirect href={{ pathname: '/', params: { incidentId } }} />;
  }

  return <Redirect href="/" />;
}
