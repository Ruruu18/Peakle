import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LEGAL_DOCUMENTS } from '../content/legalDocuments';
import { useTheme } from '../context/ThemeContext';

const LEGAL_BASE_URL = 'https://melbfzfuxrviybblipua.supabase.co/functions/v1/legal';
const PRIVACY_URL = (process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || `${LEGAL_BASE_URL}/privacy`).trim();
const TERMS_URL = (process.env.EXPO_PUBLIC_TERMS_URL || `${LEGAL_BASE_URL}/terms`).trim();

export default function LegalDocumentScreen({ navigation, route }) {
  const { isDark } = useTheme();
  const key = route.params?.documentKey === 'terms' ? 'terms' : 'privacy';
  const document = LEGAL_DOCUMENTS[key];
  const url = key === 'terms' ? TERMS_URL : PRIVACY_URL;
  const C = isDark
    ? { paper: '#102825', surface: '#17302D', ink: '#F3F5EF', muted: '#A7B8B2', line: '#29443F', teal: '#D6E94A' }
    : { paper: '#F3F5EF', surface: '#FFFFFF', ink: '#0E2321', muted: '#66756F', line: '#DDE3DA', teal: '#1C6B66' };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: C.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <View style={[styles.header, { borderBottomColor: C.line }]}>
        <Pressable accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={[styles.back, { backgroundColor: C.surface, borderColor: C.line }]}>
          <Ionicons name="arrow-back" size={20} color={C.ink} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={[styles.eyebrow, { color: C.muted }]}>PEAKLE LEGAL</Text>
          <Text style={[styles.title, { color: C.ink }]}>{document.title}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.date, { color: C.teal }]}>{document.effectiveDate}</Text>
        <Text style={[styles.intro, { color: C.ink }]}>{document.introduction}</Text>
        {document.sections.map((section) => (
          <View key={section.title} style={[styles.section, { backgroundColor: C.surface, borderColor: C.line }]}>
            <Text style={[styles.sectionTitle, { color: C.ink }]}>{section.title}</Text>
            <Text style={[styles.body, { color: C.muted }]}>{section.body}</Text>
          </View>
        ))}
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(url)} style={[styles.webButton, { borderColor: C.line, backgroundColor: C.surface }]}>
          <Ionicons name="open-outline" size={18} color={C.teal} />
          <Text style={[styles.webButtonText, { color: C.ink }]}>Open the public web version</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: { minHeight: 72, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  title: { marginTop: 2, fontSize: 23, fontWeight: '900' },
  content: { padding: 18, paddingBottom: 48 },
  date: { fontSize: 12, fontWeight: '800' },
  intro: { marginTop: 10, marginBottom: 14, fontSize: 15, lineHeight: 23, fontWeight: '600' },
  section: { marginTop: 10, padding: 16, borderWidth: 1, borderRadius: 18 },
  sectionTitle: { fontSize: 15, fontWeight: '900' },
  body: { marginTop: 7, fontSize: 13, lineHeight: 21 },
  webButton: { minHeight: 52, marginTop: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 16 },
  webButtonText: { fontSize: 13, fontWeight: '800' },
});
