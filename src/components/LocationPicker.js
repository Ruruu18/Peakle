import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useUserLocation } from '../context/LocationContext';
import { PH_LOCATIONS, formatLocation, locationMatchesSearch, parseLocation } from '../data/phLocations';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;

export default function LocationPicker({ visible, onClose }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { userLocation, loading, error, useCurrentLocation, setManualLocation, clearError } = useUserLocation();
  const [query, setQuery] = useState('');
  const parsedLocation = useMemo(
    () => userLocation.source === 'default' ? null : parseLocation(userLocation.label),
    [userLocation.label, userLocation.source],
  );
  const suggestions = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase();
    if (!clean) return PH_LOCATIONS.slice(0, 5);
    return PH_LOCATIONS.filter((location) => locationMatchesSearch(location, clean)).slice(0, 6);
  }, [query]);

  useEffect(() => {
    if (visible) {
      setQuery('');
      clearError();
    }
  }, [visible, clearError]);

  const useGpsLocation = async () => {
    if (await useCurrentLocation()) onClose();
  };

  const selectLocation = async (location) => {
    const searchValue = formatLocation(location);
    if (await setManualLocation(searchValue, formatLocation(location))) onClose();
  };

  const locationMeta = [parsedLocation?.region, parsedLocation?.country].filter(Boolean).join(' · ');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close location picker" style={styles.backdropDismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>YOUR SEARCH AREA</Text>
              <Text style={styles.title}>Change location</Text>
            </View>
            <Pressable accessibilityLabel="Close location picker" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={22} color={C.ink} />
            </Pressable>
          </View>

          <View style={styles.current}>
            <View style={styles.currentIcon}>
              <Ionicons name="location" size={20} color={C.teal} />
            </View>
            <View style={styles.currentCopy}>
              <Text style={styles.currentLabel}>CURRENTLY USING</Text>
              <Text numberOfLines={1} style={styles.currentCity}>{parsedLocation?.city || 'Your area'}</Text>
              {!!locationMeta && <Text numberOfLines={1} style={styles.currentMeta}>{locationMeta}</Text>}
            </View>
            {userLocation.source === 'gps' && <Text style={styles.live}>LIVE</Text>}
          </View>

          <Pressable disabled={loading} onPress={useGpsLocation} style={({ pressed }) => [styles.gps, pressed && styles.pressed, loading && styles.disabled]}>
            {loading ? <ActivityIndicator color="#0E2321" /> : <Ionicons name="navigate" size={19} color="#0E2321" />}
            <View style={styles.gpsCopy}>
              <Text style={styles.gpsTitle}>Use my exact location</Text>
              <Text style={styles.gpsBody}>Automatically detects your city, region, and country.</Text>
            </View>
          </Pressable>

          <Text style={styles.or}>{query.trim() ? 'SEARCH RESULTS' : 'POPULAR LOCATIONS'}</Text>
          <View style={styles.search}>
            <Ionicons name="search-outline" size={19} color={C.ink40} />
            <TextInput
              accessibilityLabel="Search city or region"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="words"
              autoCorrect={false}
              placeholder="Search city or region"
              placeholderTextColor={C.ink40}
              style={styles.input}
            />
            {!!query && (
              <Pressable accessibilityLabel="Clear location search" onPress={() => setQuery('')} style={styles.clear}>
                <Ionicons name="close-circle" size={19} color={C.ink40} />
              </Pressable>
            )}
          </View>

          <ScrollView style={styles.resultsScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {suggestions.length ? (
              <View style={styles.results}>
                {suggestions.map((location, index) => {
                  const isActive = parsedLocation?.city === location.city && parsedLocation?.region === location.region;
                  return (
                    <Pressable
                      accessibilityLabel={`Use ${formatLocation(location)}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isActive, disabled: loading }}
                      disabled={loading}
                      key={`${location.city}-${location.region}`}
                      onPress={() => selectLocation(location)}
                      style={({ pressed, hovered }) => [
                        styles.resultRow,
                        index > 0 && styles.resultBorder,
                        isActive && styles.resultActive,
                        (pressed || hovered) && styles.resultHovered,
                      ]}
                    >
                      <View style={[styles.resultIcon, isActive && styles.resultIconActive]}>
                        <Ionicons name="location-outline" size={17} color={C.teal} />
                      </View>
                      <View style={styles.resultCopy}>
                        <Text style={styles.resultCity}>{location.city}</Text>
                        <Text style={styles.resultMeta}>{location.region} · {location.country}</Text>
                      </View>
                      {isActive
                        ? <Ionicons name="checkmark-circle" size={19} color={C.teal} />
                        : <Ionicons name="chevron-forward" size={16} color={C.ink40} />}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="location-outline" size={22} color={C.ink40} />
                <Text style={styles.emptyTitle}>No matching city or region</Text>
                <Text style={styles.emptyBody}>Try a nearby city or a Philippine region.</Text>
              </View>
            )}
          </ScrollView>

          {!!error && (
            <View style={styles.error}>
              <Ionicons name="alert-circle-outline" size={17} color={C.brick} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          <Text style={styles.privacy}>Distances are estimates from this search area.</Text>
        </View>
      </View>
    </Modal>
  );
}

const lightStyles = createMobileStyleSheet({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.48)' },
  backdropDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: { maxHeight: '90%', paddingHorizontal: 20, paddingTop: 9, paddingBottom: 28, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: C.paper },
  handle: { width: 38, height: 4, marginBottom: 16, alignSelf: 'center', borderRadius: 2, backgroundColor: C.line },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: C.ink40, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  title: { color: C.ink, fontSize: 25, fontWeight: '800' },
  close: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  current: { minHeight: 72, marginTop: 18, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, backgroundColor: '#E5F0ED' },
  currentIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  currentCopy: { flex: 1 },
  currentLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 },
  currentCity: { marginTop: 2, color: C.ink, fontSize: 14, fontWeight: '800' },
  currentMeta: { marginTop: 1, color: C.ink40, fontSize: 9 },
  live: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, overflow: 'hidden', color: C.teal, backgroundColor: C.surface, fontSize: 7, fontWeight: '900' },
  gps: { minHeight: 68, marginTop: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 15, backgroundColor: C.optic },
  gpsCopy: { flex: 1 },
  gpsTitle: { color: '#0E2321', fontSize: 12, fontWeight: '900' },
  gpsBody: { marginTop: 2, color: '#3C4A45', fontSize: 9 },
  or: { marginTop: 18, marginBottom: 8, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  search: { minHeight: 52, paddingLeft: 13, paddingRight: 5, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  input: { flex: 1, minHeight: 50, color: C.ink, fontSize: 13 },
  clear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  resultsScroll: { maxHeight: 280, marginTop: 10 },
  results: { overflow: 'hidden', borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  resultRow: { minHeight: 58, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  resultActive: { backgroundColor: '#E5F0ED' },
  resultHovered: { backgroundColor: '#E5F0ED' },
  resultIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' },
  resultIconActive: { backgroundColor: C.optic },
  resultCopy: { flex: 1 },
  resultCity: { color: C.ink, fontSize: 13, fontWeight: '800' },
  resultMeta: { marginTop: 2, color: C.ink40, fontSize: 9 },
  empty: { minHeight: 108, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  emptyTitle: { marginTop: 6, color: C.ink, fontSize: 11, fontWeight: '800' },
  emptyBody: { marginTop: 2, color: C.ink40, fontSize: 9 },
  disabled: { opacity: .55 },
  error: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  errorText: { flex: 1, color: C.brick, fontSize: 9, lineHeight: 14 },
  privacy: { marginTop: 13, color: C.ink40, textAlign: 'center', fontSize: 8, lineHeight: 12 },
  pressed: { opacity: .78 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
