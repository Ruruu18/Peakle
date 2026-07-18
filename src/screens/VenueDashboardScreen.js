import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import VenueCourtManager from '../components/VenueCourtManager';
import ScrollView from '../components/FocusResetScrollView';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', teal: '#1C6B66',
  ink40: '#7C8983', line: '#DDE3DA',
};
let C = LIGHT_C;

export default function VenueDashboardScreen() {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <Text style={styles.eyebrow}>VENUE OPERATIONS</Text>
          <Text style={styles.title}>Venue & courts</Text>
          <Text style={styles.lead}>Manage the physical courts players can select and book.</Text>
        </View>
        <View style={styles.kitchen}><View style={styles.solid} /><View style={styles.dashed} /></View>
        <VenueCourtManager />
      </ScrollView>
    </SafeAreaView>
  );
}

const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F5EF' },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 },
  topbar: { minHeight: 76 },
  eyebrow: { color: '#7C8983', fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#0E2321', fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -.8 },
  lead: { marginTop: 4, color: '#7C8983', fontSize: 10, lineHeight: 15 },
  kitchen: { height: 7, marginTop: 14, marginBottom: 20 },
  solid: { height: 2, backgroundColor: '#0E2321' },
  dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#7C8983' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
