import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const C = { ink: '#0E2321', surface: '#FFFFFF', optic: '#D6E94A', muted: '#B8C6C1', brick: '#E07A5F' };

// Shown in Safari after a Google sign-in started from the Home Screen app.
// The app signs itself in as soon as the player switches back to it.
export default function GoogleHandoffNotice({ done, error, onDismiss }) {
  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        {done ? (
          <>
            <Text style={styles.eyebrow}>SIGNED IN</Text>
            <Text style={styles.title}>Go back to Peakle</Text>
            <Text style={styles.body}>Open Peakle from your Home Screen. You'll be signed in automatically. You can close this Safari tab.</Text>
          </>
        ) : error ? (
          <>
            <Text style={styles.title}>Sign-in didn't finish</Text>
            <Text style={styles.error}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.button}><Text style={styles.buttonText}>Close</Text></Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={C.optic} />
            <Text style={styles.body}>Finishing Google sign-in…</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, position: Platform.OS === 'web' ? 'fixed' : 'absolute', zIndex: 1000, padding: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink },
  card: { width: '100%', maxWidth: 380, alignItems: 'center', gap: 12 },
  eyebrow: { color: C.optic, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: C.surface, fontSize: 24, lineHeight: 30, fontWeight: '900', textAlign: 'center' },
  body: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { color: C.brick, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  button: { marginTop: 8, minHeight: 48, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic },
  buttonText: { color: C.ink, fontSize: 14, fontWeight: '900' },
});
