import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const C = { ink: '#0E2321', surface: '#FFFFFF', optic: '#D6E94A', muted: '#B8C6C1', brick: '#E07A5F' };

// Shown in Safari after a Google sign-in started from the Home Screen app.
// The player types this PIN into the app to finish signing in there.
export default function GoogleHandoffPin({ pin, error, onDismiss }) {
  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        {pin ? (
          <>
            <Text style={styles.eyebrow}>ALMOST DONE</Text>
            <Text style={styles.title}>Enter this code in the Peakle app</Text>
            <Text accessibilityLabel={`Code ${pin.split('').join(' ')}`} selectable style={styles.pin}>{pin}</Text>
            <Text style={styles.body}>Go back to Peakle on your Home Screen and type this code. It expires in 10 minutes.</Text>
            <Text style={styles.warning}>Only enter it in your own Peakle app. Never share it with anyone.</Text>
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
  pin: { marginVertical: 8, color: C.optic, fontSize: 44, fontWeight: '900', letterSpacing: 8, fontVariant: ['tabular-nums'] },
  body: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  warning: { color: C.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', opacity: 0.8 },
  error: { color: C.brick, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  button: { marginTop: 8, minHeight: 48, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic },
  buttonText: { color: C.ink, fontSize: 14, fontWeight: '900' },
});
