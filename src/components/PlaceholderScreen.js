import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

const colors = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', ink40: '#7C8983', line: '#DDE3DA',
};

export default function PlaceholderScreen({ eyebrow, title, description, icon, action, onAction }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.brand}>Peakle</Text>
        <View style={styles.ball} />
      </View>
      <View style={styles.line}><View style={styles.solid} /><View style={styles.dashed} /></View>
      <View style={styles.content}>
        <View style={styles.iconWrap}><Ionicons name={icon} size={38} color={colors.ink} /></View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <Pressable disabled={!onAction} onPress={onAction} style={({ pressed }) => [styles.button, !onAction && styles.buttonDisabled, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>{action}</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.ink} />
        </Pressable>
        <Text style={styles.note}>This screen is scaffolded and ready for the next build pass.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: { marginHorizontal: 22, marginTop: 18, position: 'relative' },
  brand: { color: colors.ink, fontSize: 27, fontWeight: '800', letterSpacing: -1 },
  ball: { position: 'absolute', left: 29, top: -3, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.optic },
  line: { height: 7, marginHorizontal: 22, marginTop: 22 }, solid: { height: 2, backgroundColor: colors.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.ink40 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, paddingBottom: 50 },
  iconWrap: { width: 82, height: 82, marginBottom: 24, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  eyebrow: { marginBottom: 6, color: colors.teal, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 31, lineHeight: 38, fontWeight: '800', textAlign: 'center', letterSpacing: -0.7 },
  description: { maxWidth: 330, marginTop: 10, color: colors.ink40, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minWidth: 210, minHeight: 52, marginTop: 26, paddingHorizontal: 18, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: colors.optic },
  buttonText: { color: colors.ink, fontSize: 14, fontWeight: '800' }, buttonDisabled: { opacity: .45 }, pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  note: { marginTop: 13, color: colors.ink40, fontSize: 10 },
});
