// app/faq.tsx — how Flint works, in plain terms.

import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen, Title } from '@/components/ui';

function Item({ q, a }: { q: string; a: string }) {
  return (
    <View style={styles.item}>
      <Text style={styles.q}>{q}</Text>
      <Text style={styles.a}>{a}</Text>
    </View>
  );
}

export default function FaqScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Title>How Flint works</Title>

        <Item
          q="What is Flint?"
          a="When something's too loud in a shared space, you flag it. Flint uses Bluetooth to find other people nearby who are bothered too, so you can see you're not the only one — and one person can make a single, calm ask."
        />
        <Item
          q="Who can see me?"
          a="Only you see the count and the little people icons. The person making the noise sees nothing at all, and nothing is public. Your location is never shared."
        />
        <Item
          q="Why does it show my address?"
          a="Just so you can confirm Flint has placed you in the right spot. It stays on your screen — it's never sent anywhere or stored."
        />
        <Item
          q="Do I have to be the one to ask?"
          a={'No. Tap "Not me right now" to stay in the group without volunteering — anyone can tap "I\'ll ask," and only one person ever does.'}
        />
        <Item
          q="How long am I discoverable?"
          a="Only while you're in an active group, and it stops after about 10 minutes or when you leave. Flint isn't an always-on beacon."
        />

        {Platform.OS === 'android' ? (
          <Item
            q="I'm on Android — anything different?"
            a="Yes: on Android you're only discoverable while the app is open. Keep Flint in the foreground to be found by people nearby."
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 20, paddingBottom: 24 },
  item: { gap: 6 },
  q: { color: '#fff', fontSize: 17, fontWeight: '700' },
  a: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
});