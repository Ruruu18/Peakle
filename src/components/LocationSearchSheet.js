import Modal from './ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PH_LOCATIONS, formatLocation, locationMatchesSearch, parseLocation } from '../data/phLocations';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED' };
let C = LIGHT_C;
const MAX_SUGGESTIONS = 4;

/**
 * One small sheet for every "where do you play" prompt: a GPS button and a
 * search box. Nothing is listed until the player types, and while typing the
 * GPS/current rows fold away so the few matches stay above the keyboard.
 *
 * onPick receives a PH_LOCATIONS entry or the raw typed text; onUseGps and
 * onPick resolve truthy when the sheet should close.
 */
export default function LocationSearchSheet({ visible, onClose, currentLabel, live = false, busy = false, error = '', onUseGps, onPick, forceLight = false }) {
  const { isDark } = useTheme();
  const dark = isDark && !forceLight;
  C = dark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = dark ? darkStyles : lightStyles;

  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const typed = query.trim();
  const searching = focused || Boolean(typed);
  const current = useMemo(() => parseLocation(currentLabel), [currentLabel]);

  const suggestions = useMemo(() => (
    typed ? PH_LOCATIONS.filter((location) => locationMatchesSearch(location, typed)).slice(0, MAX_SUGGESTIONS) : []
  ), [typed]);
  const exact = suggestions.find((location) => location.city.toLocaleLowerCase() === typed.toLocaleLowerCase());

  useEffect(() => {
    if (visible) { setQuery(''); setFocused(false); }
  }, [visible]);

  const pick = async (choice) => {
    if (busy) return;
    Keyboard.dismiss();
    if (await onPick(choice)) onClose();
  };
  const submitTyped = () => {
    if (!typed) return;
    pick(exact || (suggestions.length === 1 ? suggestions[0] : typed));
  };
  const useGps = async () => {
    if (busy) return;
    if (await onUseGps()) onClose();
  };
  const cancelSearch = () => {
    setQuery('');
    inputRef.current?.blur();
    Keyboard.dismiss();
  };

  const currentMeta = [current?.region, current?.country].filter(Boolean).join(' · ');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Android modals ignore adjustResize with a translucent status bar, so the
          keyboard would cover the search box; padding self-corrects when it doesn't. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={styles.flex}>
        <View {...webDialog('backdrop')} style={styles.backdrop}>
          <Pressable accessibilityLabel="Close location picker" style={styles.backdropDismiss} onPress={onClose} />
          <View {...webDialog('surface')} style={styles.sheet}>
            <View {...webDialog('handle')} style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Where do you play?</Text>
              <Pressable accessibilityLabel="Close location picker" hitSlop={8} onPress={onClose} style={styles.close}>
                <Ionicons name="close" size={20} color={C.ink} />
              </Pressable>
            </View>

            {!searching && (
              <>
                {current ? (
                  <View style={styles.current}>
                    <Ionicons name="location" size={15} color={C.teal} />
                    <Text numberOfLines={1} style={styles.currentText}>
                      <Text style={styles.currentCity}>{current.city}</Text>
                      {currentMeta ? `  ${currentMeta}` : ''}
                    </Text>
                    {live && <Text style={styles.live}>LIVE</Text>}
                  </View>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={useGps}
                  style={({ pressed }) => [styles.gps, (pressed || busy) && styles.pressed]}
                >
                  {busy ? <ActivityIndicator color="#0E2321" size="small" /> : <Ionicons name="navigate" size={18} color="#0E2321" />}
                  <Text style={styles.gpsTitle}>Use my current location</Text>
                </Pressable>
              </>
            )}

            <View style={[styles.search, focused && styles.searchFocused]}>
              <Ionicons name="search-outline" size={18} color={C.ink40} />
              <TextInput
                ref={inputRef}
                accessibilityLabel="Type your city or town"
                value={query}
                onChangeText={setQuery}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoCapitalize="words"
                autoCorrect={false}
                placeholder={searching ? 'Type your city or town' : 'Or type your city or town'}
                placeholderTextColor={C.ink40}
                returnKeyType="done"
                onSubmitEditing={submitTyped}
                style={styles.input}
              />
              {searching && (
                <Pressable accessibilityRole="button" hitSlop={6} onPress={cancelSearch} style={styles.cancel}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              )}
            </View>

            {Boolean(typed) && (
              <ScrollView style={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {suggestions.map((location, index) => (
                  <Pressable
                    key={`${location.city}-${location.region}`}
                    accessibilityLabel={`Use ${formatLocation(location)}`}
                    disabled={busy}
                    onPress={() => pick(location)}
                    style={({ pressed, hovered }) => [styles.row, index > 0 && styles.rowBorder, (pressed || hovered) && styles.rowPressed]}
                  >
                    <Ionicons name="location-outline" size={16} color={C.teal} />
                    <Text numberOfLines={1} style={styles.rowText}>
                      <Text style={styles.rowCity}>{location.city}</Text>
                      {`  ${location.region}`}
                    </Text>
                  </Pressable>
                ))}
                {!exact && (
                  <Pressable
                    accessibilityLabel={`Use ${typed}`}
                    disabled={busy}
                    onPress={() => pick(typed)}
                    style={({ pressed, hovered }) => [styles.row, suggestions.length > 0 && styles.rowBorder, (pressed || hovered) && styles.rowPressed]}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={C.teal} />
                    <Text numberOfLines={1} style={styles.rowText}>
                      Use <Text style={styles.rowCity}>“{typed}”</Text>
                    </Text>
                  </Pressable>
                )}
              </ScrollView>
            )}

            {busy && searching ? <ActivityIndicator style={styles.busy} color={C.teal} /> : null}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const lightStyles = createMobileStyleSheet({
  flex: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.48)' },
  backdropDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: { maxHeight: '85%', paddingHorizontal: 18, paddingTop: 9, paddingBottom: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: C.paper },
  handle: { width: 38, height: 4, marginBottom: 12, alignSelf: 'center', borderRadius: 2, backgroundColor: C.line },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title: { flex: 1, color: C.ink, fontSize: 20, fontWeight: '800' },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  current: { minHeight: 36, marginBottom: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 11, backgroundColor: C.tealWash },
  currentText: { flex: 1, color: C.ink40, fontSize: 11 },
  currentCity: { color: C.ink, fontWeight: '800' },
  live: { color: C.teal, fontSize: 7, fontWeight: '900' },
  gps: { minHeight: 52, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 14, backgroundColor: C.optic },
  gpsTitle: { color: '#0E2321', fontSize: 13, fontWeight: '900' },
  search: { minHeight: 50, paddingLeft: 13, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  searchFocused: { borderColor: C.teal },
  input: { flex: 1, minHeight: 48, color: C.ink, fontSize: 14, outlineStyle: 'none' },
  cancel: { height: 48, paddingHorizontal: 12, justifyContent: 'center' },
  cancelText: { color: C.teal, fontSize: 12, fontWeight: '800' },
  results: { maxHeight: 240, marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  row: { minHeight: 48, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  rowPressed: { backgroundColor: C.tealWash },
  rowText: { flex: 1, color: C.ink40, fontSize: 11 },
  rowCity: { color: C.ink, fontSize: 13, fontWeight: '800' },
  busy: { marginTop: 10 },
  error: { marginTop: 10, color: C.brick, fontSize: 10, lineHeight: 15 },
  pressed: { opacity: .78 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
