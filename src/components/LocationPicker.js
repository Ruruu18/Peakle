import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useUserLocation } from '../context/LocationContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;

export default function LocationPicker({ visible, onClose }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { userLocation, loading, error, useCurrentLocation, setManualLocation, clearError } = useUserLocation();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (visible) { setQuery(''); clearError(); }
  }, [visible, clearError]);

  const current = async () => { if (await useCurrentLocation()) onClose(); };
  const search = async () => { if (await setManualLocation(query)) onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.eyebrow}>YOUR SEARCH AREA</Text><Text style={styles.title}>Change location</Text></View><Pressable accessibilityLabel="Close location picker" onPress={onClose} style={styles.close}><Ionicons name="close" size={22} color={C.ink} /></Pressable></View>
          <View style={styles.current}><Ionicons name="location" size={20} color={C.teal} /><View style={styles.currentCopy}><Text style={styles.currentLabel}>CURRENTLY USING</Text><Text numberOfLines={1} style={styles.currentValue}>{userLocation.label}</Text></View>{userLocation.source === 'gps' && <Text style={styles.live}>LIVE</Text>}</View>
          <Pressable disabled={loading} onPress={current} style={({ pressed }) => [styles.gps, pressed && styles.pressed]}>{loading ? <ActivityIndicator color="#0E2321" /> : <Ionicons name="navigate" size={18} color="#0E2321" />}<View style={styles.gpsCopy}><Text style={styles.gpsTitle}>Use my exact location</Text><Text style={styles.gpsBody}>Uses your device GPS while the app is open.</Text></View></Pressable>
          <Text style={styles.or}>OR SEARCH ANYWHERE</Text>
          <View style={styles.search}><Ionicons name="search-outline" size={19} color={C.ink40} /><TextInput value={query} onChangeText={setQuery} onSubmitEditing={search} returnKeyType="search" autoCapitalize="words" placeholder="City, neighborhood, or address" placeholderTextColor={C.ink40} style={styles.input} /><Pressable disabled={loading || !query.trim()} onPress={search} style={[styles.go, (!query.trim() || loading) && styles.disabled]}><Ionicons name="arrow-forward" size={18} color="#0E2321" /></Pressable></View>
          {!!error && <View style={styles.error}><Ionicons name="alert-circle-outline" size={17} color={C.brick} /><Text style={styles.errorText}>{error}</Text></View>}
          <Text style={styles.privacy}>Your coordinates stay on this device unless you separately turn on Nearby Player visibility.</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const lightStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.45)' }, sheet: { paddingHorizontal: 20, paddingTop: 9, paddingBottom: 32, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: C.paper }, handle: { width: 38, height: 4, marginBottom: 16, alignSelf: 'center', borderRadius: 2, backgroundColor: C.line }, header: { flexDirection: 'row', alignItems: 'center' }, headerCopy: { flex: 1 }, eyebrow: { color: C.ink40, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, title: { color: C.ink, fontSize: 25, fontWeight: '800' }, close: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, current: { marginTop: 18, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: '#E5F0ED' }, currentCopy: { flex: 1 }, currentLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, currentValue: { marginTop: 2, color: C.ink, fontSize: 12, fontWeight: '800' }, live: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, overflow: 'hidden', color: C.teal, backgroundColor: C.surface, fontSize: 7, fontWeight: '900' }, gps: { minHeight: 68, marginTop: 10, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 14, backgroundColor: C.optic }, gpsCopy: { flex: 1 }, gpsTitle: { color: C.ink, fontSize: 12, fontWeight: '900' }, gpsBody: { marginTop: 2, color: '#3C4A45', fontSize: 9 }, or: { marginTop: 20, marginBottom: 7, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, search: { height: 52, paddingLeft: 13, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, input: { flex: 1, color: C.ink, fontSize: 13 }, go: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, disabled: { opacity: .4 }, error: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 6 }, errorText: { flex: 1, color: C.brick, fontSize: 9, lineHeight: 14 }, privacy: { marginTop: 16, color: C.ink40, textAlign: 'center', fontSize: 8, lineHeight: 12 }, pressed: { opacity: .78 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
