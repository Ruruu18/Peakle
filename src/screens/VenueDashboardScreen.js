import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import VenueCourtManager from '../components/VenueCourtManager';
import ScrollView from '../components/FocusResetScrollView';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import Ionicons from '@expo/vector-icons/Ionicons';
import { createMobileStyleSheet } from '../utils/mobileStyles';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', teal: '#1C6B66',
  ink40: '#7C8983', line: '#DDE3DA',
};
let C = LIGHT_C;

export default function VenueDashboardScreen({ navigation }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <View style={styles.headerLeading}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to More" onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('More')} style={styles.backButton}><Ionicons name="arrow-back" size={20} color={C.ink} /></Pressable>
            <View style={styles.headerCopy}><Text style={styles.eyebrow}>VENUE OPERATIONS</Text><Text style={styles.h1}>Manage your venue</Text></View>
          </View>
        </View>
        <View style={styles.divider} />
        <VenueCourtManager />
      </ScrollView>
    </SafeAreaView>
  );
}

const lightStyles = createMobileStyleSheet({
  safe: { flex: 1, backgroundColor: '#F3F5EF' },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 },
  topbar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#7C8983', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  h1: { marginTop: 2, color: '#0E2321', fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -.7 },
  divider: { height: 1, marginTop: 18, marginBottom: 18, backgroundColor: '#DDE3DA' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
