import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Modal from './ResponsiveModal';
import AppIcon from './AppIcon';
import ScrollView from './FocusResetScrollView';
import { webDialog } from '../utils/webLayout';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { cleanCourtText, COURT_TEXT_LIMIT, courtKey, customCourt, matchesCourtQuery } from '../services/playCourts';

function CourtOption({ court, active, onPress, styles, palette }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${court.name}${court.detail ? `, ${court.detail}` : ''}`} onPress={onPress} style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}>
      <View style={[styles.thumb, { backgroundColor: court.color || LIGHT_CONTENT_COLORS.teal }]}><View style={styles.thumbLine} /><AppIcon name={court.source === 'listed' ? 'tennisball-outline' : 'location-outline'} size={18} color="#FFFFFF" /></View>
      <View style={styles.optionCopy}><Text numberOfLines={1} style={styles.optionName}>{court.name}</Text><Text numberOfLines={1} style={styles.optionDetail}>{court.detail}</Text></View>
      <AppIcon name={active ? 'checkmark-circle' : 'chevron-forward'} size={20} color={active ? palette.teal : palette.ink40} />
    </Pressable>
  );
}

// Court booking is paused for the beta, so any court works: a recent one or
// one the player types in. Peakle's bookable venues stay hidden until booking returns.
export default function CourtPickerSheet({ visible, selected, recentCourts = [], defaultArea = '', onSelect, onClose }) {
  const { isDark } = useTheme();
  const styles = isDark ? darkStyles : lightStyles;
  const palette = isDark ? DARK_CONTENT_COLORS : LIGHT_CONTENT_COLORS;
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', courtName: '', area: '' });
  const sheetHeight = Math.min(640, Math.floor((windowHeight - insets.top - insets.bottom) * 0.86));

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setAdding(false);
  }, [visible]);

  const cleanQuery = cleanCourtText(query);
  const recent = recentCourts.filter((court) => matchesCourtQuery(court, query));
  const draftCourt = customCourt(draft);
  const openAddForm = () => {
    setDraft({ name: cleanQuery, courtName: '', area: defaultArea || '' });
    setAdding(true);
  };
  const updateDraft = (field) => (value) => setDraft((current) => ({ ...current, [field]: value.slice(0, COURT_TEXT_LIMIT) }));
  const isSelected = (court) => Boolean(selected) && courtKey(selected) === courtKey(court);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable {...webDialog('backdrop')} accessibilityLabel="Close court picker" style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={onClose}>
        <Pressable {...webDialog('surface')} accessibilityRole="dialog" testID="court-picker-sheet" style={[styles.sheet, { height: sheetHeight }]} onPress={(event) => event.stopPropagation()}>
          <View {...webDialog('handle')} style={styles.handle} />
          <View style={styles.head}>
            <View style={styles.flex}><Text style={styles.eyebrow}>{adding ? 'ADD YOUR COURT' : 'PLAY ANYWHERE'}</Text><Text style={styles.title}>{adding ? 'Where are you playing?' : 'Choose a court'}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={adding ? 'Back to courts' : 'Close'} onPress={adding ? () => setAdding(false) : onClose} style={styles.close}><AppIcon name={adding ? 'arrow-back' : 'close'} size={20} color={palette.ink} /></Pressable>
          </View>
          {adding ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.lead}>Name the venue or spot. It’s saved with your game and in your recent courts.</Text>
              <Text style={styles.fieldLabel}>COURT OR VENUE NAME</Text>
              <TextInput autoFocus value={draft.name} onChangeText={updateDraft('name')} placeholder="e.g. Barangay San Antonio Covered Court" placeholderTextColor={palette.ink40} maxLength={COURT_TEXT_LIMIT} returnKeyType="next" style={styles.field} />
              <View style={styles.fieldRow}>
                <View style={styles.flex}><Text style={styles.fieldLabel}>COURT (OPTIONAL)</Text><TextInput value={draft.courtName} onChangeText={updateDraft('courtName')} placeholder="Court 2" placeholderTextColor={palette.ink40} maxLength={COURT_TEXT_LIMIT} style={styles.field} /></View>
                <View style={styles.flex}><Text style={styles.fieldLabel}>AREA (OPTIONAL)</Text><TextInput value={draft.area} onChangeText={updateDraft('area')} placeholder="Pasig" placeholderTextColor={palette.ink40} maxLength={COURT_TEXT_LIMIT} style={styles.field} /></View>
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !draftCourt }} disabled={!draftCourt} onPress={() => onSelect(draftCourt)} style={({ pressed }) => [styles.useButton, !draftCourt && styles.disabled, pressed && draftCourt && styles.pressed]}>
                <AppIcon name="checkmark" size={17} color="#0E2321" /><Text style={styles.useButtonText}>Use this court</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <>
              <View style={styles.search}><AppIcon name="search-outline" size={18} color={palette.ink40} /><TextInput value={query} onChangeText={setQuery} placeholder="Search or type a court name" placeholderTextColor={palette.ink40} returnKeyType="done" onSubmitEditing={() => { if (cleanQuery && !recent.length) openAddForm(); }} style={styles.searchInput} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear court search" hitSlop={8} onPress={() => setQuery('')}><AppIcon name="close" size={17} color={palette.ink40} /></Pressable> : null}</View>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
                <Pressable accessibilityRole="button" onPress={openAddForm} style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}>
                  <View style={styles.addIcon}><AppIcon name="add" size={20} color="#0E2321" /></View>
                  <View style={styles.optionCopy}><Text numberOfLines={1} style={styles.optionName}>{cleanQuery ? `Add “${cleanQuery}”` : 'Add a court'}</Text><Text numberOfLines={1} style={styles.optionDetail}>Any venue, club or public court</Text></View>
                  <AppIcon name="chevron-forward" size={20} color={palette.teal} />
                </Pressable>
                {recent.length ? <Text style={styles.groupLabel}>RECENT</Text> : null}
                {recent.map((court) => <CourtOption key={`recent-${courtKey(court)}`} court={court} active={isSelected(court)} onPress={() => onSelect(court)} styles={styles} palette={palette} />)}
                {!recent.length ? <Text style={styles.emptyText}>{cleanQuery ? 'No saved courts match. Add it as a new court above.' : 'Courts you play on will show up here for next time.'}</Text> : null}
              </ScrollView>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const C = LIGHT_CONTENT_COLORS;
const lightStyles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  backdrop: { flex: 1, paddingHorizontal: 16, paddingTop: 16, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.7)' },
  sheet: { width: '100%', maxWidth: 420, minHeight: 220, padding: 16, overflow: 'hidden', borderRadius: 24, backgroundColor: C.paper },
  handle: { alignSelf: 'center', width: 38, height: 4, marginBottom: 10, borderRadius: 2, backgroundColor: C.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyebrow: { color: C.ink40, fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: .9 },
  title: { color: C.ink, fontSize: 22, fontWeight: '800' },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: C.surface },
  lead: { marginTop: 4, color: C.ink40, fontSize: 11, lineHeight: 16 },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingBottom: 8 },
  search: { minHeight: 46, marginTop: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 10, color: C.ink, fontSize: 13, fontWeight: '600' },
  addRow: { minHeight: 64, marginTop: 10, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: C.teal, backgroundColor: C.surface },
  addIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.optic },
  groupLabel: { marginTop: 16, marginBottom: 1, color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: .9 },
  emptyText: { marginTop: 16, paddingHorizontal: 6, color: C.ink40, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  option: { minHeight: 66, marginTop: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  optionActive: { borderColor: C.teal, backgroundColor: C.tealWash },
  thumb: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 10 },
  thumbLine: { position: 'absolute', left: 6, right: 6, top: '50%', height: 1, backgroundColor: 'rgba(255,255,255,.58)' },
  optionCopy: { flex: 1, minWidth: 0 },
  optionName: { color: C.ink, fontSize: 13, fontWeight: '800' },
  optionDetail: { marginTop: 3, color: C.ink40, fontSize: 11 },
  fieldLabel: { marginTop: 14, marginBottom: 6, color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: .8 },
  field: { minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 13, fontWeight: '600' },
  fieldRow: { flexDirection: 'row', gap: 8 },
  useButton: { minHeight: 50, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic },
  useButtonText: { color: '#0E2321', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: .45 },
  pressed: { opacity: .78 },
});
// Text on the lime button keeps dark ink in dark mode.
const darkStyles = { ...createDarkStyleSheet(lightStyles), ...StyleSheet.create({ useButtonText: { color: '#0E2321' } }) };
