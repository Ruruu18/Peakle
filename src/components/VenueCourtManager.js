import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createManagedCourt, createManagedVenue, listManagedVenues, reviewManagedVenueApplication, updateManagedCourt, updateManagedVenueLocation } from '../services/database';
import { hasValidVenueCoordinates, resolveVenueCoordinates } from '../services/venueLocation';
import { requireSupabase } from '../lib/supabase';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import BookingRulesManager from './BookingRulesManager';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66',
  brick: '#B6472E', error: '#A63B2B', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED',
};
let C = LIGHT_C;

function Icon({ name, size = 20, color = C.ink }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function VenueForm({ visible, onClose, onSaved }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [description, setDescription] = useState('');
  const [venueType, setVenueType] = useState('Indoor');
  const [opensAt, setOpensAt] = useState('06:00');
  const [closesAt, setClosesAt] = useState('22:00');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(''); setArea(''); setAddress(''); setGoogleMapsUrl(''); setDescription('');
    setVenueType('Indoor'); setOpensAt('06:00'); setClosesAt('22:00'); setError(''); setSaving(false);
  }, [visible]);

  const validMapsLink = /^https:\/\/(?:www\.)?google\.[a-z.]+\/maps/i.test(googleMapsUrl.trim())
    || /^https:\/\/maps\.google\.[a-z.]+/i.test(googleMapsUrl.trim())
    || /^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(googleMapsUrl.trim());

  const save = async () => {
    if (name.trim().length < 2 || area.trim().length < 2 || address.trim().length < 5) { setError('Enter the venue name, city or area, and complete address.'); return; }
    if (!validMapsLink) { setError('Paste the venue’s Google Maps share link.'); return; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(opensAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closesAt) || opensAt === closesAt) { setError('Use 24-hour operating times such as 06:00 and 22:00.'); return; }
    setSaving(true); setError('');
    try {
      const coordinates = await resolveVenueCoordinates({ googleMapsUrl: googleMapsUrl.trim(), address: address.trim(), area: area.trim() });
      const created = await createManagedVenue({ name, area, address, googleMapsUrl, description, venueType, opensAt, closesAt, ...coordinates });
      onSaved({ ...created, role: 'owner', courts: [] });
    } catch (reason) {
      setError(reason?.message || 'The venue application could not be created.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.modalBackdrop}><View style={styles.formSheet}><View style={styles.formHandle} />
        <View style={styles.formHeader}><View><Text style={styles.eyebrow}>VENUE APPLICATION</Text><Text style={styles.formTitle}>Create a venue</Text></View><Pressable accessibilityLabel="Close venue form" onPress={onClose} style={styles.closeButton}><Icon name="close" /></Pressable></View>
        <ScrollView contentContainerStyle={[styles.formContent, { paddingBottom: Math.max(insets.bottom + 28, 44) }]} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.applicationNotice}>Your venue stays private while Peakle verifies its location. You can prepare the court inventory after submitting.</Text>
          <Text style={styles.inputLabel}>VENUE NAME</Text><TextInput value={name} onChangeText={setName} placeholder="e.g. Northside Pickle Club" placeholderTextColor={C.ink40} maxLength={100} style={styles.input} />
          <Text style={styles.inputLabel}>CITY OR AREA</Text><TextInput value={area} onChangeText={setArea} placeholder="e.g. Quezon City" placeholderTextColor={C.ink40} maxLength={100} style={styles.input} />
          <Text style={styles.inputLabel}>COMPLETE ADDRESS</Text><TextInput value={address} onChangeText={setAddress} placeholder="Building, street, barangay, city" placeholderTextColor={C.ink40} maxLength={200} style={styles.input} />
          <Text style={styles.inputLabel}>GOOGLE MAPS SHARE LINK</Text><View style={styles.mapInputRow}><TextInput autoCapitalize="none" autoCorrect={false} value={googleMapsUrl} onChangeText={setGoogleMapsUrl} placeholder="https://maps.app.goo.gl/…" placeholderTextColor={C.ink40} style={styles.mapInput} /><Pressable disabled={!validMapsLink} accessibilityLabel="Open Google Maps link" onPress={() => Linking.openURL(googleMapsUrl.trim())} style={[styles.mapTestButton, !validMapsLink && styles.disabled]}><Icon name="map-outline" size={18} color="#0E2321" /></Pressable></View><Text style={styles.fieldHelp}>In Google Maps, open the venue, tap Share, then copy and paste the link.</Text>
          <Text style={styles.inputLabel}>VENUE TYPE</Text><View style={styles.choiceRow}>{['Indoor', 'Outdoor', 'Mixed'].map((value) => <Pressable key={value} onPress={() => setVenueType(value)} style={[styles.choice, venueType === value && styles.choiceActive]}><Text style={[styles.choiceText, venueType === value && styles.choiceTextActive]}>{value}</Text></Pressable>)}</View>
          <Text style={styles.inputLabel}>OPERATING HOURS</Text><View style={styles.hoursRow}><TextInput value={opensAt} onChangeText={setOpensAt} placeholder="06:00" placeholderTextColor={C.ink40} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, styles.hourInput]} /><Text style={styles.hoursTo}>TO</Text><TextInput value={closesAt} onChangeText={setClosesAt} placeholder="22:00" placeholderTextColor={C.ink40} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, styles.hourInput]} /></View>
          <Text style={styles.inputLabel}>DESCRIPTION</Text><TextInput value={description} onChangeText={setDescription} placeholder="Tell players about the facility" placeholderTextColor={C.ink40} multiline maxLength={500} style={[styles.input, styles.textarea]} />
          {error ? <View style={styles.errorBox}><Icon name="alert-circle-outline" size={17} color={C.error} /><Text style={styles.errorText}>{error}</Text></View> : null}
          <Pressable disabled={saving} onPress={save} style={[styles.saveButton, saving && styles.disabled]}>{saving ? <><ActivityIndicator color="#0E2321" /><Text style={styles.saveText}>Confirming location…</Text></> : <><Text style={styles.saveText}>Submit venue</Text><Icon name="arrow-forward" size={18} color="#0E2321" /></>}</Pressable>
        </ScrollView>
      </View></View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CourtForm({ court, venue, visible, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState('Indoor');
  const [surface, setSurface] = useState('Standard acrylic');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(court?.name || '');
    setEnvironment(court?.environment || venue?.venue_type || 'Indoor');
    setSurface(court?.surface || 'Standard acrylic');
    setPrice(court?.hourly_price != null ? String(court.hourly_price) : '');
    setError('');
    setSaving(false);
  }, [court, venue, visible]);

  const save = async () => {
    const hourlyPrice = Number(price);
    if (name.trim().length < 2) { setError('Enter a court name.'); return; }
    if (surface.trim().length < 2) { setError('Enter the court surface.'); return; }
    if (price.trim() === '' || !Number.isFinite(hourlyPrice) || hourlyPrice < 0) { setError('Enter a valid non-negative hourly price.'); return; }
    setSaving(true);
    setError('');
    try {
      const saved = court
        ? await updateManagedCourt(court.id, { name, environment, surface, hourlyPrice })
        : await createManagedCourt({ venueId: venue.id, name: name.trim(), environment, surface: surface.trim(), hourlyPrice });
      onSaved(saved);
    } catch (reason) {
      setError(reason?.message || 'The court could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.formSheet}>
          <View style={styles.formHandle} />
          <View style={styles.formHeader}><View><Text style={styles.eyebrow}>{court ? 'EDIT COURT' : 'NEW COURT'}</Text><Text style={styles.formTitle}>{court ? court.name : venue?.name}</Text></View><Pressable accessibilityLabel="Close court form" onPress={onClose} style={styles.closeButton}><Icon name="close" /></Pressable></View>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.inputLabel}>COURT NAME</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Court 1" placeholderTextColor={C.ink40} maxLength={80} style={styles.input} />
            <Text style={styles.inputLabel}>ENVIRONMENT</Text>
            <View style={styles.choiceRow}>{['Indoor', 'Outdoor', 'Mixed'].map((value) => <Pressable key={value} onPress={() => setEnvironment(value)} style={[styles.choice, environment === value && styles.choiceActive]}><Text style={[styles.choiceText, environment === value && styles.choiceTextActive]}>{value}</Text></Pressable>)}</View>
            <Text style={styles.inputLabel}>SURFACE</Text>
            <TextInput value={surface} onChangeText={setSurface} placeholder="Standard acrylic" placeholderTextColor={C.ink40} maxLength={80} style={styles.input} />
            <Text style={styles.inputLabel}>HOURLY PRICE (PHP)</Text>
            <View style={styles.priceInput}><Text style={styles.currency}>₱</Text><TextInput value={price} onChangeText={setPrice} placeholder="500" placeholderTextColor={C.ink40} keyboardType="decimal-pad" style={styles.priceField} /></View>
            {error ? <View style={styles.errorBox}><Icon name="alert-circle-outline" size={17} color={C.error} /><Text style={styles.errorText}>{error}</Text></View> : null}
            <Pressable disabled={saving} onPress={save} style={[styles.saveButton, saving && styles.disabled]}><Text style={styles.saveText}>{saving ? 'Saving…' : court ? 'Save changes' : 'Add court'}</Text><Icon name="checkmark" size={18} color="#0E2321" /></Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function VenueCourtManager() {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const [venues, setVenues] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editingCourt, setEditingCourt] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [venueFormOpen, setVenueFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [reviewingVenue, setReviewingVenue] = useState(false);
  const [repairingLocation, setRepairingLocation] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const managed = await listManagedVenues();
      const repaired = await Promise.all(managed.map(async (item) => {
        if (item.verification_status !== 'verified' || hasValidVenueCoordinates(item) || !item.google_maps_url) return item;
        try {
          const coordinates = await resolveVenueCoordinates({
            googleMapsUrl: item.google_maps_url,
            address: item.address,
            area: item.area,
          });
          const updated = await updateManagedVenueLocation(item.id, coordinates);
          return { ...item, ...updated };
        } catch {
          return item;
        }
      }));
      setVenues(repaired);
      setSelectedId((current) => repaired.some((venue) => venue.id === current) ? current : repaired[0]?.id || null);
    } catch (reason) {
      setError(reason?.message || 'Venue access could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const client = requireSupabase();
    const channel = client.channel('managed-venue-status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'venues' }, ({ new: updated }) => {
        setVenues((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      })
      .subscribe();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      appStateSubscription.remove();
      client.removeChannel(channel);
    };
  }, [load]);
  const venue = useMemo(() => venues.find((item) => item.id === selectedId) || venues[0], [selectedId, venues]);
  const activeCount = venue?.courts.filter((court) => court.active).length || 0;

  const replaceCourt = (saved) => {
    setVenues((current) => current.map((item) => item.id !== saved.venue_id ? item : {
      ...item,
      courts: [...item.courts.filter((court) => court.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }));
    setFormOpen(false);
    setEditingCourt(null);
  };

  const addVenue = async (created) => {
    setVenueFormOpen(false);
    await load();
    setSelectedId(created.id);
  };

  const approveVenue = async () => {
    setReviewingVenue(true); setError('');
    try {
      await reviewManagedVenueApplication(venue.id, true);
      await load();
    } catch (reason) {
      setError(reason?.message || 'The venue could not be approved.');
    } finally {
      setReviewingVenue(false);
    }
  };

  const repairVenueLocation = async () => {
    setRepairingLocation(true); setError('');
    try {
      const coordinates = await resolveVenueCoordinates({
        googleMapsUrl: venue.google_maps_url,
        address: venue.address,
        area: venue.area,
      });
      const updated = await updateManagedVenueLocation(venue.id, coordinates);
      setVenues((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
    } catch (reason) {
      setError(reason?.message || 'The verified venue location could not be updated.');
    } finally {
      setRepairingLocation(false);
    }
  };

  const toggleCourt = async (court) => {
    setBusyId(court.id);
    setError('');
    try { replaceCourt(await updateManagedCourt(court.id, { active: !court.active })); }
    catch (reason) { setError(reason?.message || 'Court availability could not be updated.'); }
    finally { setBusyId(null); }
  };

  if (loading) return <View style={styles.stateCard}><ActivityIndicator color={C.teal} /><Text style={styles.stateTitle}>Loading venue access…</Text></View>;
  if (!venues.length) return (
    <View>
      <View style={styles.accessCard}><View style={styles.accessIcon}><Icon name="business-outline" size={27} color={C.teal} /></View><Text style={styles.accessEyebrow}>VENUE ACCESS</Text><Text style={styles.accessTitle}>Create your venue</Text><Text style={styles.accessBody}>Submit the real location with its Google Maps link. It remains private until a Peakle admin verifies it.</Text><View style={styles.accessNote}><Icon name="shield-checkmark-outline" size={18} color={C.teal} /><Text style={styles.accessNoteText}>Unverified venues never appear in player booking or public search.</Text></View><Pressable onPress={() => setVenueFormOpen(true)} style={styles.createVenueButton}><Text style={styles.createVenueText}>Create venue</Text><Icon name="arrow-forward" size={18} color="#0E2321" /></Pressable></View>
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      <Pressable onPress={load} style={styles.secondaryButton}><Icon name="refresh" size={17} color={C.teal} /><Text style={styles.secondaryText}>Check access again</Text></Pressable>
      <VenueForm visible={venueFormOpen} onClose={() => setVenueFormOpen(false)} onSaved={addVenue} />
    </View>
  );

  return (
    <View>
      <View style={styles.venueToolbar}>{venues.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.venueChoices}>{venues.map((item) => <Pressable key={item.id} onPress={() => setSelectedId(item.id)} style={[styles.venueChoice, item.id === venue.id && styles.venueChoiceActive]}><Text style={[styles.venueChoiceText, item.id === venue.id && styles.venueChoiceTextActive]}>{item.name}</Text></Pressable>)}</ScrollView> : <View style={styles.flex} />}<Pressable accessibilityLabel="Create another venue" onPress={() => setVenueFormOpen(true)} style={styles.newVenueButton}><Icon name="add" size={16} color={C.teal} /><Text style={styles.newVenueText}>New venue</Text></Pressable></View>
      <View style={styles.venueHero}><View style={styles.venueHeroHead}><View style={styles.venueIcon}><Icon name="business" size={22} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.eyebrow}>{venue.role.toUpperCase()} ACCESS</Text><Text style={styles.venueName}>{venue.name}</Text><Text style={styles.venueArea}>{venue.area}</Text></View><View style={[styles.verified, venue.verification_status !== 'verified' && styles.pending]}><Icon name={venue.verification_status === 'verified' ? 'checkmark' : venue.verification_status === 'rejected' ? 'close' : 'time-outline'} size={12} color={venue.verification_status === 'verified' ? C.teal : C.brick} /><Text style={[styles.verifiedText, venue.verification_status !== 'verified' && styles.pendingText]}>{venue.verification_status === 'verified' ? 'VERIFIED' : venue.verification_status === 'rejected' ? 'REJECTED' : 'PENDING'}</Text></View></View><View style={styles.stats}><View style={styles.stat}><Text style={styles.statValue}>{venue.courts.length}</Text><Text style={styles.statLabel}>TOTAL</Text></View><View style={styles.stat}><Text style={styles.statValue}>{activeCount}</Text><Text style={styles.statLabel}>ACTIVE</Text></View><View style={styles.stat}><Text style={styles.statValue}>{venue.courts.length - activeCount}</Text><Text style={styles.statLabel}>HIDDEN</Text></View></View></View>
      {venue.verification_status !== 'verified' && <View style={styles.pendingNotice}><Icon name="shield-outline" color={C.brick} /><View style={styles.flex}><Text style={styles.pendingTitle}>{venue.verification_status === 'rejected' ? 'Application needs changes' : 'Pending verification'}</Text><Text style={styles.pendingBody}>{venue.verification_status === 'rejected' ? 'This venue remains private. Contact Peakle support before resubmitting corrected location details.' : 'You can prepare courts now. Players cannot see or book this venue until Peakle approves the submitted location.'}</Text></View>{venue.role === 'admin' && venue.verification_status !== 'rejected' ? <Pressable disabled={reviewingVenue} onPress={approveVenue} style={styles.approveVenueButton}>{reviewingVenue ? <ActivityIndicator color="#0E2321" /> : <Text style={styles.approveVenueText}>Approve</Text>}</Pressable> : null}</View>}
      {venue.verification_status === 'verified' && !hasValidVenueCoordinates(venue) ? <View style={styles.locationNotice}><Icon name="location-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.locationTitle}>Venue verified · map setup incomplete</Text><Text style={styles.locationBody}>Restore the precise coordinates from the submitted Google Maps link so players can open accurate directions in their preferred map app.</Text></View><Pressable disabled={repairingLocation} onPress={repairVenueLocation} style={styles.repairLocationButton}>{repairingLocation ? <ActivityIndicator color="#0E2321" /> : <Text style={styles.repairLocationText}>Repair map</Text>}</Pressable></View> : null}
      {venue.google_maps_url ? <Pressable onPress={() => Linking.openURL(venue.google_maps_url)} style={styles.mapsButton}><Icon name="map-outline" size={17} color={C.teal} /><Text style={styles.mapsButtonText}>Open venue in Google Maps</Text><Icon name="open-outline" size={14} color={C.teal} /></Pressable> : null}
      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>COURT INVENTORY</Text><Text style={styles.sectionTitle}>Physical courts</Text></View><Pressable onPress={() => { setEditingCourt(null); setFormOpen(true); }} style={styles.addButton}><Icon name="add" size={17} color="#0E2321" /><Text style={styles.addText}>Add court</Text></Pressable></View>
      {error ? <View style={styles.errorBox}><Icon name="alert-circle-outline" size={17} color={C.error} /><Text style={styles.errorText}>{error}</Text></View> : null}
      <View style={styles.courtList}>{venue.courts.length ? venue.courts.map((court, index) => <View key={court.id} style={[styles.courtRow, index > 0 && styles.rowBorder]}><View style={[styles.courtIcon, !court.active && styles.courtIconInactive]}><Icon name="tennisball-outline" color={court.active ? C.teal : C.ink40} /></View><Pressable style={styles.courtCopy} onPress={() => { setEditingCourt(court); setFormOpen(true); }}><Text style={styles.courtName}>{court.name}</Text><Text style={styles.courtMeta}>{court.environment} · {court.surface}</Text><Text style={styles.courtPrice}>₱{Number(court.hourly_price).toLocaleString()} / hour</Text></Pressable><View style={styles.courtActions}><Pressable accessibilityLabel={`Edit ${court.name}`} onPress={() => { setEditingCourt(court); setFormOpen(true); }} style={styles.editButton}><Icon name="create-outline" size={17} color={C.teal} /></Pressable><Pressable disabled={busyId === court.id} accessibilityRole="switch" accessibilityLabel={`${court.name} active`} accessibilityState={{ checked: court.active }} onPress={() => toggleCourt(court)} style={[styles.toggle, court.active && styles.toggleOn]}><View style={[styles.toggleKnob, court.active && styles.toggleKnobOn]} /></Pressable></View></View>) : <View style={styles.emptyCourts}><Icon name="add-circle-outline" size={34} color={C.teal} /><Text style={styles.stateTitle}>No courts added</Text><Text style={styles.stateBody}>Add the first bookable court for this venue.</Text></View>}</View>
      <View style={styles.helpNote}><Icon name="information-circle-outline" size={17} color={C.teal} /><Text style={styles.helpText}>Inactive courts remain in your dashboard but disappear from booking and match selection.</Text></View>
      {['owner', 'manager', 'admin'].includes(venue.role) && <BookingRulesManager venue={venue} />}
      <CourtForm visible={formOpen} court={editingCourt} venue={venue} onClose={() => { setFormOpen(false); setEditingCourt(null); }} onSaved={replaceCourt} />
      <VenueForm visible={venueFormOpen} onClose={() => setVenueFormOpen(false)} onSaved={addVenue} />
    </View>
  );
}

const lightStyles = StyleSheet.create({
  flex: { flex: 1 }, eyebrow: { color: '#1C6B66', fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  stateCard: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 18, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, stateTitle: { color: '#0E2321', fontSize: 13, fontWeight: '900' }, stateBody: { marginTop: 4, color: '#7C8983', fontSize: 9 },
  accessCard: { padding: 20, alignItems: 'center', borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, accessIcon: { width: 54, height: 54, marginBottom: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 27, backgroundColor: '#E5F0ED' }, accessEyebrow: { color: '#1C6B66', fontSize: 8, fontWeight: '900', letterSpacing: 1 }, accessTitle: { marginTop: 5, color: '#0E2321', fontSize: 20, fontWeight: '900' }, accessBody: { marginTop: 8, color: '#3C4A45', fontSize: 10, lineHeight: 16, textAlign: 'center' }, accessNote: { marginTop: 15, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' }, accessNoteText: { flex: 1, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, createVenueButton: { minHeight: 50, alignSelf: 'stretch', marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: '#D6E94A' }, createVenueText: { color: '#0E2321', fontSize: 11, fontWeight: '900' },
  inlineError: { marginTop: 10, color: '#A63B2B', fontSize: 9, lineHeight: 13, textAlign: 'center' }, secondaryButton: { minHeight: 44, marginTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, secondaryText: { color: '#1C6B66', fontSize: 10, fontWeight: '900' },
  venueToolbar: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8 }, venueChoices: { gap: 7, paddingRight: 5 }, venueChoice: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 15, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, venueChoiceActive: { borderColor: '#1C6B66', backgroundColor: '#E5F0ED' }, venueChoiceText: { color: '#7C8983', fontSize: 9, fontWeight: '800' }, venueChoiceTextActive: { color: '#1C6B66' }, newVenueButton: { minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 11, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, newVenueText: { color: '#1C6B66', fontSize: 8, fontWeight: '900' },
  venueHero: { marginTop: 8, padding: 15, borderRadius: 19, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: '#0E2321' }, venueHeroHead: { flexDirection: 'row', alignItems: 'center', gap: 11 }, venueIcon: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#D6E94A' }, venueName: { marginTop: 3, color: '#FFFFFF', fontSize: 17, fontWeight: '900' }, venueArea: { marginTop: 3, color: 'rgba(255,255,255,.62)', fontSize: 8 }, verified: { paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 11, backgroundColor: '#E5F0ED' }, verifiedText: { color: '#1C6B66', fontSize: 6, fontWeight: '900' }, pending: { backgroundColor: '#F7EAE6' }, pendingText: { color: '#B6472E' }, stats: { marginTop: 15, paddingTop: 12, flexDirection: 'row', borderTopWidth: 1, borderColor: 'rgba(255,255,255,.15)' }, stat: { flex: 1, alignItems: 'center' }, statValue: { color: '#D6E94A', fontSize: 19, fontWeight: '900' }, statLabel: { marginTop: 2, color: 'rgba(255,255,255,.58)', fontSize: 6, fontWeight: '900', letterSpacing: .5 }, pendingNotice: { marginTop: 10, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, backgroundColor: '#F7EAE6' }, pendingTitle: { color: '#B6472E', fontSize: 9, fontWeight: '900' }, pendingBody: { marginTop: 3, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, approveVenueButton: { minWidth: 66, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#D6E94A' }, approveVenueText: { color: '#0E2321', fontSize: 8, fontWeight: '900' }, locationNotice: { marginTop: 10, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' }, locationTitle: { color: '#1C6B66', fontSize: 9, fontWeight: '900' }, locationBody: { marginTop: 3, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, repairLocationButton: { minWidth: 76, minHeight: 34, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#D6E94A' }, repairLocationText: { color: '#0E2321', fontSize: 8, fontWeight: '900' }, mapsButton: { minHeight: 43, marginTop: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, mapsButtonText: { color: '#1C6B66', fontSize: 9, fontWeight: '900' },
  sectionHead: { minHeight: 71, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { marginTop: 3, color: '#0E2321', fontSize: 18, fontWeight: '900' }, addButton: { minHeight: 38, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, backgroundColor: '#D6E94A' }, addText: { color: '#0E2321', fontSize: 9, fontWeight: '900' },
  courtList: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, courtRow: { minHeight: 83, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, rowBorder: { borderTopWidth: 1, borderColor: '#DDE3DA' }, courtIcon: { width: 44, height: 51, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, courtIconInactive: { backgroundColor: '#E7EBE7' }, courtCopy: { flex: 1, minWidth: 0 }, courtName: { color: '#0E2321', fontSize: 11, fontWeight: '900' }, courtMeta: { marginTop: 3, color: '#7C8983', fontSize: 7 }, courtPrice: { marginTop: 5, color: '#1C6B66', fontSize: 8, fontWeight: '900' }, courtActions: { alignItems: 'center', gap: 7 }, editButton: { width: 31, height: 27, alignItems: 'center', justifyContent: 'center' }, toggle: { width: 39, height: 23, padding: 3, borderRadius: 12, backgroundColor: '#DDE3DA' }, toggleOn: { backgroundColor: '#1C6B66' }, toggleKnob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' }, toggleKnobOn: { marginLeft: 16 }, emptyCourts: { minHeight: 150, alignItems: 'center', justifyContent: 'center' }, helpNote: { marginTop: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 6 }, helpText: { flex: 1, color: '#7C8983', fontSize: 8, lineHeight: 12 },
  modalKeyboard: { flex: 1 }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.55)' }, formSheet: { maxHeight: '92%', paddingTop: 9, overflow: 'hidden', borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#F3F5EF' }, formHandle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: '#DDE3DA' }, formHeader: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, formTitle: { marginTop: 3, color: '#0E2321', fontSize: 21, fontWeight: '900' }, closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#FFFFFF' }, formContent: { paddingHorizontal: 20, paddingBottom: 30 }, applicationNotice: { padding: 11, color: '#3C4A45', fontSize: 8, lineHeight: 13, borderRadius: 11, backgroundColor: '#E5F0ED' }, inputLabel: { marginTop: 14, marginBottom: 6, color: '#7C8983', fontSize: 8, fontWeight: '900', letterSpacing: .7 }, input: { height: 50, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: '#DDE3DA', color: '#0E2321', backgroundColor: '#FFFFFF', fontSize: 11, fontWeight: '700' }, textarea: { minHeight: 88, paddingTop: 13, textAlignVertical: 'top' }, mapInputRow: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 7 }, mapInput: { height: 50, flex: 1, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: '#DDE3DA', color: '#0E2321', backgroundColor: '#FFFFFF', fontSize: 10 }, mapTestButton: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#D6E94A' }, fieldHelp: { marginTop: 5, color: '#7C8983', fontSize: 7, lineHeight: 11 }, choiceRow: { flexDirection: 'row', gap: 6 }, choice: { minHeight: 43, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, choiceActive: { borderColor: '#1C6B66', backgroundColor: '#E5F0ED' }, choiceText: { color: '#7C8983', fontSize: 9, fontWeight: '800' }, choiceTextActive: { color: '#1C6B66' }, hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, hourInput: { flex: 1, textAlign: 'center' }, hoursTo: { color: '#7C8983', fontSize: 8, fontWeight: '900' }, priceInput: { height: 50, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, currency: { marginRight: 7, color: '#1C6B66', fontSize: 16, fontWeight: '900' }, priceField: { flex: 1, color: '#0E2321', fontSize: 12, fontWeight: '800' }, errorBox: { marginTop: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 11, backgroundColor: '#F7EAE6' }, errorText: { flex: 1, color: '#A63B2B', fontSize: 8, lineHeight: 12 }, saveButton: { minHeight: 52, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: '#D6E94A' }, saveText: { color: '#0E2321', fontSize: 11, fontWeight: '900' }, disabled: { opacity: .55 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
