import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createManagedCourt, createManagedVenue, listManagedVenues, reviewManagedVenueApplication, updateManagedCourt, updateManagedVenueLocation } from '../services/database';
import { saveCourtImage, saveVenueBrandImage } from '../services/organizerMedia';
import { hasValidVenueCoordinates, resolveVenueCoordinates } from '../services/venueLocation';
import { requireSupabase } from '../lib/supabase';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import BookingRulesManager from './BookingRulesManager';
import OrganizerImagePicker from './OrganizerImagePicker';
import ResilientImage from './ResilientImage';

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
  const [brandImage, setBrandImage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (!visible) return;
    setName(''); setArea(''); setAddress(''); setGoogleMapsUrl(''); setDescription('');
    setVenueType('Indoor'); setOpensAt('06:00'); setClosesAt('22:00'); setBrandImage(''); setError(''); setSaving(false); setStep(1);
  }, [visible]);

  const validMapsLink = /^https:\/\/(?:www\.)?google\.[a-z.]+\/maps/i.test(googleMapsUrl.trim())
    || /^https:\/\/maps\.google\.[a-z.]+/i.test(googleMapsUrl.trim())
    || /^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(googleMapsUrl.trim());

  const continueToDetails = () => {
    if (name.trim().length < 2 || area.trim().length < 2 || address.trim().length < 5) { setError('Enter the venue name, city or area, and complete address.'); return; }
    if (!validMapsLink) { setError('Paste the venue’s Google Maps share link so Peakle can verify the location.'); return; }
    setError(''); setStep(2);
  };

  const save = async () => {
    if (name.trim().length < 2 || area.trim().length < 2 || address.trim().length < 5) { setError('Enter the venue name, city or area, and complete address.'); return; }
    if (!validMapsLink) { setError('Paste the venue’s Google Maps share link.'); return; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(opensAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closesAt) || opensAt === closesAt) { setError('Use 24-hour operating times such as 06:00 and 22:00.'); return; }
    setSaving(true); setError('');
    try {
      const coordinates = await resolveVenueCoordinates({ googleMapsUrl: googleMapsUrl.trim(), address: address.trim(), area: area.trim() });
      let created = await createManagedVenue({ name, area, address, googleMapsUrl, description, venueType, opensAt, closesAt, ...coordinates });
      if (brandImage) created = await saveVenueBrandImage(created.id, brandImage);
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
        <View style={styles.formHeader}><View><Text style={styles.eyebrow}>NEW VENUE · STEP {step} OF 2</Text><Text style={styles.formTitle}>{step === 1 ? 'Where is your venue?' : 'Set venue details'}</Text></View><Pressable accessibilityLabel="Close venue form" onPress={onClose} style={styles.closeButton}><Icon name="close" /></Pressable></View>
        <View style={styles.formProgress}><View style={styles.formProgressActive} /><View style={[styles.formProgressStep, step === 2 && styles.formProgressActive]} /></View>
        <ScrollView contentContainerStyle={[styles.formContent, { paddingBottom: Math.max(insets.bottom + 28, 44) }]} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {step === 1 ? <>
            <Text style={styles.applicationNotice}>We use the Google Maps location to protect players from incorrect or duplicate venue listings.</Text>
            <Text style={styles.inputLabel}>VENUE NAME</Text><TextInput value={name} onChangeText={setName} placeholder="e.g. Northside Pickle Club" placeholderTextColor={C.ink40} maxLength={100} style={styles.input} />
            <Text style={styles.inputLabel}>CITY OR AREA</Text><TextInput value={area} onChangeText={setArea} placeholder="e.g. Quezon City" placeholderTextColor={C.ink40} maxLength={100} style={styles.input} />
            <Text style={styles.inputLabel}>COMPLETE ADDRESS</Text><TextInput value={address} onChangeText={setAddress} placeholder="Building, street, barangay, city" placeholderTextColor={C.ink40} maxLength={200} style={styles.input} />
            <Text style={styles.inputLabel}>GOOGLE MAPS SHARE LINK</Text><View style={styles.mapInputRow}><TextInput autoCapitalize="none" autoCorrect={false} value={googleMapsUrl} onChangeText={setGoogleMapsUrl} placeholder="https://maps.app.goo.gl/…" placeholderTextColor={C.ink40} style={styles.mapInput} /><Pressable disabled={!validMapsLink} accessibilityLabel="Open Google Maps link" onPress={() => Linking.openURL(googleMapsUrl.trim())} style={[styles.mapTestButton, !validMapsLink && styles.disabled]}><Icon name="map-outline" size={18} color="#0E2321" /></Pressable></View><Text style={styles.fieldHelp}>Google Maps → open the venue → Share → Copy link.</Text>
          </> : <>
            <View style={styles.venueReview}><Icon name="location-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.venueReviewTitle}>{name}</Text><Text style={styles.venueReviewMeta}>{address} · {area}</Text></View><Pressable accessibilityLabel="Edit venue location" onPress={() => { setError(''); setStep(1); }}><Text style={styles.venueReviewEdit}>EDIT</Text></Pressable></View>
            <Text style={styles.inputLabel}>VENUE TYPE</Text><View style={styles.choiceRow}>{['Indoor', 'Outdoor', 'Mixed'].map((value) => <Pressable key={value} onPress={() => setVenueType(value)} style={[styles.choice, venueType === value && styles.choiceActive]}><Text style={[styles.choiceText, venueType === value && styles.choiceTextActive]}>{value}</Text></Pressable>)}</View>
            <Text style={styles.inputLabel}>NORMAL OPERATING HOURS</Text><View style={styles.hoursRow}><TextInput value={opensAt} onChangeText={setOpensAt} placeholder="06:00" placeholderTextColor={C.ink40} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, styles.hourInput]} /><Text style={styles.hoursTo}>TO</Text><TextInput value={closesAt} onChangeText={setClosesAt} placeholder="22:00" placeholderTextColor={C.ink40} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, styles.hourInput]} /></View><Text style={styles.fieldHelp}>Use 24-hour time. You can block special closures later.</Text>
            <Text style={styles.inputLabel}>PLAYER DESCRIPTION · OPTIONAL</Text><TextInput value={description} onChangeText={setDescription} placeholder="What should players know about the facility?" placeholderTextColor={C.ink40} multiline maxLength={500} style={[styles.input, styles.textarea]} />
            <Text style={styles.inputLabel}>BRAND OR VENUE IMAGE · OPTIONAL</Text>
            <OrganizerImagePicker value={brandImage} onChange={setBrandImage} onError={setError} title="Brand or venue image" detail="Use your logo, branded sign, or a recognizable venue photo." emptyIcon="business-outline" colors={C} />
          </>}
          {error ? <View style={styles.errorBox}><Icon name="alert-circle-outline" size={17} color={C.error} /><Text style={styles.errorText}>{error}</Text></View> : null}
          {step === 1 ? <Pressable onPress={continueToDetails} style={styles.saveButton}><Text style={styles.saveText}>Continue</Text><Icon name="arrow-forward" size={18} color="#0E2321" /></Pressable> : <View style={styles.formActions}><Pressable disabled={saving} onPress={() => { setError(''); setStep(1); }} style={styles.formBackButton}><Icon name="arrow-back" size={17} color={C.teal} /><Text style={styles.formBackText}>Back</Text></Pressable><Pressable disabled={saving} onPress={save} style={[styles.saveButton, styles.formSubmitButton, saving && styles.disabled]}>{saving ? <><ActivityIndicator color="#0E2321" /><Text style={styles.saveText}>Confirming…</Text></> : <><Text style={styles.saveText}>Submit venue</Text><Icon name="checkmark" size={18} color="#0E2321" /></>}</Pressable></View>}
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
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(court?.name || `Court ${(venue?.courts?.length || 0) + 1}`);
    setEnvironment(court?.environment || venue?.venue_type || 'Indoor');
    setSurface(court?.surface || 'Standard acrylic');
    setPrice(court?.hourly_price != null ? String(court.hourly_price) : '');
    setImage(court?.image_url || '');
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
      let saved = court
        ? await updateManagedCourt(court.id, { name, environment, surface, hourlyPrice })
        : await createManagedCourt({ venueId: venue.id, name: name.trim(), environment, surface: surface.trim(), hourlyPrice });
      if (image !== (court?.image_url || '')) saved = await saveCourtImage(venue.id, saved.id, image);
      onSaved(saved);
    } catch (reason) {
      setError(reason?.message || 'The court could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.modalBackdrop}>
        <View style={styles.formSheet}>
          <View style={styles.formHandle} />
          <View style={styles.formHeader}><View><Text style={styles.eyebrow}>{court ? 'EDIT COURT' : 'NEW COURT'}</Text><Text style={styles.formTitle}>{court ? `Edit ${court.name}` : 'Add a court'}</Text></View><Pressable accessibilityLabel="Close court form" onPress={onClose} style={styles.closeButton}><Icon name="close" /></Pressable></View>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.friendlyIntro}><View style={styles.friendlyIntroIcon}><Icon name="tennisball-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.friendlyIntroTitle}>{venue?.name}</Text><Text style={styles.friendlyIntroBody}>Set the basic details players need. You can edit these anytime.</Text></View></View>
            <Text style={styles.inputLabel}>COURT NAME</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Court 1" placeholderTextColor={C.ink40} maxLength={80} style={styles.input} />
            <Text style={styles.inputLabel}>ENVIRONMENT</Text>
            <View style={styles.choiceRow}>{['Indoor', 'Outdoor', 'Mixed'].map((value) => <Pressable key={value} onPress={() => setEnvironment(value)} style={[styles.choice, environment === value && styles.choiceActive]}><Text style={[styles.choiceText, environment === value && styles.choiceTextActive]}>{value}</Text></Pressable>)}</View>
            <Text style={styles.inputLabel}>COURT SURFACE</Text>
            <View style={styles.surfaceChoices}>{['Standard acrylic', 'Concrete', 'Wood', 'Synthetic'].map((value) => <Pressable key={value} onPress={() => setSurface(value)} style={[styles.surfaceChoice, surface === value && styles.surfaceChoiceActive]}><Icon name={surface === value ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={surface === value ? C.teal : C.ink40} /><Text style={[styles.surfaceChoiceText, surface === value && styles.surfaceChoiceTextActive]}>{value}</Text></Pressable>)}</View>
            <Text style={styles.inputLabel}>REGULAR HOURLY PRICE</Text>
            <View style={styles.priceInput}><Text style={styles.currency}>₱</Text><TextInput value={price} onChangeText={setPrice} placeholder="500" placeholderTextColor={C.ink40} keyboardType="decimal-pad" style={styles.priceField} /></View>
            <Text style={styles.fieldHelp}>This is the standard price players see. Special peak or promo prices are added separately.</Text>
            <Text style={styles.inputLabel}>COURT PHOTO · OPTIONAL</Text>
            <OrganizerImagePicker value={image} onChange={setImage} onError={setError} title="Court photo" detail="Show players this specific court before they book." emptyIcon="tennisball-outline" colors={C} />
            <View style={styles.publishNotice}><Icon name="eye-outline" size={17} color={C.teal} /><Text style={styles.publishNoticeText}>{court ? 'Saved changes appear immediately in player booking.' : 'This court will be visible to players after you add it. You can hide it anytime.'}</Text></View>
            {error ? <View style={styles.errorBox}><Icon name="alert-circle-outline" size={17} color={C.error} /><Text style={styles.errorText}>{error}</Text></View> : null}
            <Pressable disabled={saving} onPress={save} style={[styles.saveButton, saving && styles.disabled]}><Text style={styles.saveText}>{saving ? 'Saving…' : court ? 'Save changes' : 'Add court'}</Text><Icon name="checkmark" size={18} color="#0E2321" /></Pressable>
          </ScrollView>
        </View>
      </View>
      </KeyboardAvoidingView>
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
  const [brandImageBusy, setBrandImageBusy] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');

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
  const canManageBooking = ['owner', 'manager', 'admin'].includes(venue?.role);
  useEffect(() => { setActiveSection('overview'); }, [venue?.id]);

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

  const changeVenueBrandImage = async (uri) => {
    if (!venue || brandImageBusy) return;
    setBrandImageBusy(true);
    setError('');
    try {
      const updated = await saveVenueBrandImage(venue.id, uri);
      setVenues((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
    } catch (reason) {
      setError(reason?.message || 'The brand image could not be saved.');
    } finally {
      setBrandImageBusy(false);
    }
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
      <View style={styles.venueToolbar}>
        <ScrollView horizontal style={styles.venueChoiceScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.venueChoices}>
          <Pressable accessibilityRole="button" accessibilityLabel="Create another venue" onPress={() => setVenueFormOpen(true)} style={styles.newVenueButton}><Icon name="add" size={17} color={C.teal} /><Text style={styles.newVenueText}>New venue</Text></Pressable>
          {venues.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === venue.id }} onPress={() => setSelectedId(item.id)} style={[styles.venueChoice, item.id === venue.id && styles.venueChoiceActive]}><Text numberOfLines={1} style={[styles.venueChoiceText, item.id === venue.id && styles.venueChoiceTextActive]}>{item.name}</Text></Pressable>)}
        </ScrollView>
      </View>
      <View style={styles.venueHero}><View style={styles.venueHeroHead}><ResilientImage uri={venue.brand_image_url} accessibilityLabel={`${venue.name} brand image`} fallback={<Icon name="business" size={22} color="#0E2321" />} fallbackColor={C.optic} style={styles.venueIcon} /><View style={styles.flex}><Text style={styles.eyebrow}>{venue.role.toUpperCase()} ACCESS</Text><Text style={styles.venueName}>{venue.name}</Text><Text style={styles.venueArea}>{venue.area}</Text></View><View style={[styles.verified, venue.verification_status !== 'verified' && styles.pending]}><Icon name={venue.verification_status === 'verified' ? 'checkmark' : venue.verification_status === 'rejected' ? 'close' : 'time-outline'} size={12} color={venue.verification_status === 'verified' ? C.teal : C.brick} /><Text style={[styles.verifiedText, venue.verification_status !== 'verified' && styles.pendingText]}>{venue.verification_status === 'verified' ? 'VERIFIED' : venue.verification_status === 'rejected' ? 'REJECTED' : 'PENDING'}</Text></View></View><View style={styles.stats}><View style={styles.stat}><Text style={styles.statValue}>{venue.courts.length}</Text><Text style={styles.statLabel}>TOTAL</Text></View><View style={styles.stat}><Text style={styles.statValue}>{activeCount}</Text><Text style={styles.statLabel}>ACTIVE</Text></View><View style={styles.stat}><Text style={styles.statValue}>{venue.courts.length - activeCount}</Text><Text style={styles.statLabel}>HIDDEN</Text></View></View></View>
      {venue.verification_status !== 'verified' && <View style={styles.pendingNotice}><Icon name="shield-outline" color={C.brick} /><View style={styles.flex}><Text style={styles.pendingTitle}>{venue.verification_status === 'rejected' ? 'Application needs changes' : 'Pending verification'}</Text><Text style={styles.pendingBody}>{venue.verification_status === 'rejected' ? 'This venue remains private. Contact Peakle support before resubmitting corrected location details.' : 'You can prepare courts now. Players cannot see or book this venue until Peakle approves the submitted location.'}</Text></View>{venue.role === 'admin' && venue.verification_status !== 'rejected' ? <Pressable disabled={reviewingVenue} onPress={approveVenue} style={styles.approveVenueButton}>{reviewingVenue ? <ActivityIndicator color="#0E2321" /> : <Text style={styles.approveVenueText}>Approve</Text>}</Pressable> : null}</View>}
      {venue.verification_status === 'verified' && !hasValidVenueCoordinates(venue) ? <View style={styles.locationNotice}><Icon name="location-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.locationTitle}>Venue verified · map setup incomplete</Text><Text style={styles.locationBody}>Restore the precise coordinates from the submitted Google Maps link so players can open accurate directions in their preferred map app.</Text></View><Pressable disabled={repairingLocation} onPress={repairVenueLocation} style={styles.repairLocationButton}>{repairingLocation ? <ActivityIndicator color="#0E2321" /> : <Text style={styles.repairLocationText}>Repair map</Text>}</Pressable></View> : null}
      {error ? <View style={styles.errorBox}><Icon name="alert-circle-outline" size={17} color={C.error} /><Text style={styles.errorText}>{error}</Text></View> : null}
      <View accessibilityRole="tablist" style={styles.operationTabs}>{[
        ['overview', 'Overview', 'grid-outline'],
        ['courts', 'Courts', 'tennisball-outline'],
        ...(canManageBooking ? [['booking', 'Booking', 'calendar-outline']] : []),
      ].map(([value, label, icon]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: activeSection === value }} onPress={() => setActiveSection(value)} style={[styles.operationTab, activeSection === value && styles.operationTabActive]}><Icon name={icon} size={16} color={activeSection === value ? '#0E2321' : C.ink40} /><Text style={[styles.operationTabText, activeSection === value && styles.operationTabTextActive]}>{label}</Text></Pressable>)}</View>

      {activeSection === 'overview' ? <View>
        <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>QUICK START</Text><Text style={styles.sectionTitle}>What would you like to manage?</Text></View></View>
        <View style={brandImageBusy && styles.disabled}>
          <OrganizerImagePicker compact value={venue.brand_image_url || ''} onChange={changeVenueBrandImage} onError={setError} title="Venue brand image" detail="Add your logo, branded sign, or venue photo for players." emptyIcon="business-outline" colors={C} />
        </View>
        <View style={styles.operationGrid}>
          <Pressable onPress={() => setActiveSection('courts')} style={({ pressed }) => [styles.operationCard, pressed && styles.cardPressed]}><View style={styles.operationCardHead}><View style={styles.operationCardIcon}><Icon name="tennisball-outline" color={C.teal} /></View><View style={styles.countPill}><Text style={styles.countPillText}>{venue.courts.length}</Text></View></View><Text style={styles.operationCardTitle}>Courts</Text><Text style={styles.operationCardBody}>Names, hourly prices, surfaces, and player visibility.</Text><View style={styles.operationCardAction}><Text style={styles.operationCardActionText}>Manage courts</Text><Icon name="arrow-forward" size={14} color={C.teal} /></View></Pressable>
          {canManageBooking ? <Pressable onPress={() => setActiveSection('booking')} style={({ pressed }) => [styles.operationCard, pressed && styles.cardPressed]}><View style={styles.operationCardHead}><View style={styles.operationCardIcon}><Icon name="calendar-outline" color={C.teal} /></View><View style={styles.readyPill}><Text style={styles.readyPillText}>SETUP</Text></View></View><Text style={styles.operationCardTitle}>Booking</Text><Text style={styles.operationCardBody}>Special prices and time blocked for maintenance or events.</Text><View style={styles.operationCardAction}><Text style={styles.operationCardActionText}>Manage booking</Text><Icon name="arrow-forward" size={14} color={C.teal} /></View></Pressable> : null}
        </View>
        <View style={styles.playerViewCard}><View style={styles.playerViewIcon}><Icon name="eye-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.playerViewTitle}>What players can see</Text><Text style={styles.playerViewBody}>{venue.verification_status !== 'verified' ? 'Nothing yet—your venue stays private until verification is complete.' : activeCount ? `${activeCount} active ${activeCount === 1 ? 'court is' : 'courts are'} available for booking.` : 'Your venue is verified, but no courts are currently visible for booking.'}</Text></View><View style={[styles.visibilityDot, activeCount > 0 && venue.verification_status === 'verified' && styles.visibilityDotLive]} /></View>
        {venue.google_maps_url ? <Pressable onPress={() => Linking.openURL(venue.google_maps_url)} style={styles.mapsButton}><Icon name="map-outline" size={17} color={C.teal} /><View style={styles.flex}><Text style={styles.mapsButtonText}>Check venue location</Text><Text style={styles.mapsButtonMeta}>Open the player-facing Google Maps pin</Text></View><Icon name="open-outline" size={14} color={C.teal} /></Pressable> : null}
      </View> : null}

      {activeSection === 'courts' ? <View>
        <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>YOUR COURTS</Text><Text style={styles.sectionTitle}>{activeCount} available to players</Text></View><Pressable onPress={() => { setEditingCourt(null); setFormOpen(true); }} style={styles.addButton}><Icon name="add" size={17} color="#0E2321" /><Text style={styles.addText}>Add court</Text></Pressable></View>
        <View style={styles.courtList}>{venue.courts.length ? venue.courts.map((court, index) => <View key={court.id} style={[styles.courtRow, index > 0 && styles.rowBorder]}><ResilientImage uri={court.image_url} accessibilityLabel={`${court.name} photo`} fallback={<Icon name="tennisball-outline" color={court.active ? C.teal : C.ink40} />} fallbackColor={court.active ? C.tealWash : '#E7EBE7'} style={styles.courtIcon} /><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${court.name}`} style={styles.courtCopy} onPress={() => { setEditingCourt(court); setFormOpen(true); }}><View style={styles.courtNameRow}><Text style={styles.courtName}>{court.name}</Text><Text style={[styles.courtStatus, court.active && styles.courtStatusActive]}>{court.active ? 'VISIBLE' : 'HIDDEN'}</Text></View><Text style={styles.courtMeta}>{court.environment} · {court.surface}</Text><Text style={styles.courtPrice}>₱{Number(court.hourly_price).toLocaleString()} per hour</Text></Pressable><View style={styles.courtActions}><Pressable accessibilityLabel={`Edit ${court.name}`} onPress={() => { setEditingCourt(court); setFormOpen(true); }} style={styles.editButton}><Icon name="create-outline" size={17} color={C.teal} /></Pressable><Pressable disabled={busyId === court.id} accessibilityRole="switch" accessibilityLabel={`Show ${court.name} to players`} accessibilityState={{ checked: court.active }} onPress={() => toggleCourt(court)} style={[styles.toggle, court.active && styles.toggleOn]}>{busyId === court.id ? <ActivityIndicator size="small" color={court.active ? '#FFFFFF' : C.teal} /> : <View style={[styles.toggleKnob, court.active && styles.toggleKnobOn]} />}</Pressable></View></View>) : <View style={styles.emptyCourts}><Icon name="add-circle-outline" size={34} color={C.teal} /><Text style={styles.stateTitle}>Add your first court</Text><Text style={styles.stateBody}>Set its name and hourly price so players can book it.</Text><Pressable onPress={() => { setEditingCourt(null); setFormOpen(true); }} style={styles.emptyAddButton}><Text style={styles.addText}>Add court</Text></Pressable></View>}</View>
        <View style={styles.helpNote}><Icon name="information-circle-outline" size={17} color={C.teal} /><Text style={styles.helpText}>Turn a court off to hide it from players without deleting its setup.</Text></View>
      </View> : null}

      {activeSection === 'booking' && canManageBooking ? <BookingRulesManager venue={venue} /> : null}
      <CourtForm visible={formOpen} court={editingCourt} venue={venue} onClose={() => { setFormOpen(false); setEditingCourt(null); }} onSaved={replaceCourt} />
      <VenueForm visible={venueFormOpen} onClose={() => setVenueFormOpen(false)} onSaved={addVenue} />
    </View>
  );
}

const lightStyles = createMobileStyleSheet({
  flex: { flex: 1 }, eyebrow: { color: '#1C6B66', fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  stateCard: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 18, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, stateTitle: { color: '#0E2321', fontSize: 13, fontWeight: '900' }, stateBody: { marginTop: 4, color: '#7C8983', fontSize: 9 },
  accessCard: { padding: 20, alignItems: 'center', borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, accessIcon: { width: 54, height: 54, marginBottom: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 27, backgroundColor: '#E5F0ED' }, accessEyebrow: { color: '#1C6B66', fontSize: 8, fontWeight: '900', letterSpacing: 1 }, accessTitle: { marginTop: 5, color: '#0E2321', fontSize: 20, fontWeight: '900' }, accessBody: { marginTop: 8, color: '#3C4A45', fontSize: 10, lineHeight: 16, textAlign: 'center' }, accessNote: { marginTop: 15, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' }, accessNoteText: { flex: 1, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, createVenueButton: { minHeight: 50, alignSelf: 'stretch', marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: '#D6E94A' }, createVenueText: { color: '#0E2321', fontSize: 11, fontWeight: '900' },
  inlineError: { marginTop: 10, color: '#A63B2B', fontSize: 9, lineHeight: 13, textAlign: 'center' }, secondaryButton: { minHeight: 44, marginTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, secondaryText: { color: '#1C6B66', fontSize: 10, fontWeight: '900' },
  venueToolbar: { width: '100%' }, venueChoiceScroll: { width: '100%' }, venueChoices: { alignItems: 'center', gap: 7, paddingRight: 12 }, venueChoice: { maxWidth: 260, minHeight: 42, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, venueChoiceActive: { borderColor: '#1C6B66', backgroundColor: '#E5F0ED' }, venueChoiceText: { color: '#7C8983', fontSize: 9, fontWeight: '800' }, venueChoiceTextActive: { color: '#1C6B66' }, newVenueButton: { minHeight: 42, flexShrink: 0, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, newVenueText: { color: '#1C6B66', fontSize: 8, fontWeight: '900' },
  venueHero: { marginTop: 8, padding: 15, borderRadius: 19, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: '#0E2321' }, venueHeroHead: { flexDirection: 'row', alignItems: 'center', gap: 11 }, venueIcon: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#D6E94A' }, venueName: { marginTop: 3, color: '#FFFFFF', fontSize: 17, fontWeight: '900' }, venueArea: { marginTop: 3, color: 'rgba(255,255,255,.62)', fontSize: 8 }, verified: { paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 11, backgroundColor: '#E5F0ED' }, verifiedText: { color: '#1C6B66', fontSize: 6, fontWeight: '900' }, pending: { backgroundColor: '#F7EAE6' }, pendingText: { color: '#B6472E' }, stats: { marginTop: 15, paddingTop: 12, flexDirection: 'row', borderTopWidth: 1, borderColor: 'rgba(255,255,255,.15)' }, stat: { flex: 1, alignItems: 'center' }, statValue: { color: '#D6E94A', fontSize: 19, fontWeight: '900' }, statLabel: { marginTop: 2, color: 'rgba(255,255,255,.58)', fontSize: 6, fontWeight: '900', letterSpacing: .5 }, pendingNotice: { marginTop: 10, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, backgroundColor: '#F7EAE6' }, pendingTitle: { color: '#B6472E', fontSize: 9, fontWeight: '900' }, pendingBody: { marginTop: 3, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, approveVenueButton: { minWidth: 66, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#D6E94A' }, approveVenueText: { color: '#0E2321', fontSize: 8, fontWeight: '900' }, locationNotice: { marginTop: 10, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' }, locationTitle: { color: '#1C6B66', fontSize: 9, fontWeight: '900' }, locationBody: { marginTop: 3, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, repairLocationButton: { minWidth: 76, minHeight: 34, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#D6E94A' }, repairLocationText: { color: '#0E2321', fontSize: 8, fontWeight: '900' }, mapsButton: { minHeight: 58, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, mapsButtonText: { color: '#0E2321', fontSize: 9, fontWeight: '900' }, mapsButtonMeta: { marginTop: 3, color: '#7C8983', fontSize: 7 },
  operationTabs: { marginTop: 14, padding: 4, flexDirection: 'row', gap: 4, borderRadius: 14, backgroundColor: '#E5E9E3' }, operationTab: { minHeight: 44, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10 }, operationTabActive: { backgroundColor: '#D6E94A' }, operationTabText: { color: '#7C8983', fontSize: 8, fontWeight: '800' }, operationTabTextActive: { color: '#0E2321', fontWeight: '900' },
  sectionHead: { minHeight: 71, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { maxWidth: 245, marginTop: 3, color: '#0E2321', fontSize: 18, lineHeight: 23, fontWeight: '900' }, addButton: { minHeight: 40, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, backgroundColor: '#D6E94A' }, addText: { color: '#0E2321', fontSize: 9, fontWeight: '900' },
  operationGrid: { marginTop: 10, gap: 10 }, operationCard: { minHeight: 148, padding: 15, borderRadius: 18, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, cardPressed: { opacity: .78, transform: [{ scale: .99 }] }, operationCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, operationCardIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, countPill: { minWidth: 30, height: 25, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#D6E94A' }, countPillText: { color: '#0E2321', fontSize: 8, fontWeight: '900' }, readyPill: { minHeight: 25, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, readyPillText: { color: '#1C6B66', fontSize: 6, fontWeight: '900', letterSpacing: .5 }, operationCardTitle: { marginTop: 11, color: '#0E2321', fontSize: 14, fontWeight: '900' }, operationCardBody: { marginTop: 4, color: '#7C8983', fontSize: 8, lineHeight: 13 }, operationCardAction: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 5 }, operationCardActionText: { color: '#1C6B66', fontSize: 8, fontWeight: '900' },
  playerViewCard: { minHeight: 76, marginTop: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 15, backgroundColor: '#E5F0ED' }, playerViewIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#FFFFFF' }, playerViewTitle: { color: '#0E2321', fontSize: 10, fontWeight: '900' }, playerViewBody: { marginTop: 3, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, visibilityDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#B6472E' }, visibilityDotLive: { backgroundColor: '#1C6B66' },
  courtList: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, courtRow: { minHeight: 96, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, rowBorder: { borderTopWidth: 1, borderColor: '#DDE3DA' }, courtIcon: { width: 44, height: 55, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, courtIconInactive: { backgroundColor: '#E7EBE7' }, courtCopy: { flex: 1, minWidth: 0 }, courtNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, courtName: { maxWidth: 115, color: '#0E2321', fontSize: 11, fontWeight: '900' }, courtStatus: { paddingHorizontal: 5, paddingVertical: 3, borderRadius: 6, color: '#7C8983', backgroundColor: '#E7EBE7', fontSize: 5, fontWeight: '900' }, courtStatusActive: { color: '#1C6B66', backgroundColor: '#E5F0ED' }, courtMeta: { marginTop: 3, color: '#7C8983', fontSize: 7 }, courtPrice: { marginTop: 5, color: '#1C6B66', fontSize: 8, fontWeight: '900' }, courtActions: { alignItems: 'center', gap: 5 }, editButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, toggle: { width: 44, height: 26, padding: 3, alignItems: 'flex-start', justifyContent: 'center', borderRadius: 13, backgroundColor: '#DDE3DA' }, toggleOn: { backgroundColor: '#1C6B66' }, toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' }, toggleKnobOn: { transform: [{ translateX: 18 }] }, emptyCourts: { minHeight: 190, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' }, emptyAddButton: { minHeight: 44, marginTop: 13, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#D6E94A' }, helpNote: { marginTop: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 6 }, helpText: { flex: 1, color: '#7C8983', fontSize: 8, lineHeight: 12 },
  modalKeyboard: { flex: 1 }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.55)' }, formSheet: { maxHeight: '92%', paddingTop: 9, overflow: 'hidden', borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#F3F5EF' }, formHandle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: '#DDE3DA' }, formHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, formProgress: { height: 4, marginHorizontal: 20, marginBottom: 14, flexDirection: 'row', gap: 5 }, formProgressStep: { flex: 1, borderRadius: 2, backgroundColor: '#DDE3DA' }, formProgressActive: { flex: 1, borderRadius: 2, backgroundColor: '#1C6B66' }, formTitle: { marginTop: 3, color: '#0E2321', fontSize: 21, fontWeight: '900' }, closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#FFFFFF' }, formContent: { paddingHorizontal: 20, paddingBottom: 30 }, applicationNotice: { padding: 11, color: '#3C4A45', fontSize: 8, lineHeight: 13, borderRadius: 11, backgroundColor: '#E5F0ED' }, friendlyIntro: { minHeight: 72, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, backgroundColor: '#E5F0ED' }, friendlyIntroIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#FFFFFF' }, friendlyIntroTitle: { color: '#0E2321', fontSize: 10, fontWeight: '900' }, friendlyIntroBody: { marginTop: 3, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, venueReview: { minHeight: 66, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: '#E5F0ED' }, venueReviewTitle: { color: '#0E2321', fontSize: 10, fontWeight: '900' }, venueReviewMeta: { marginTop: 3, color: '#7C8983', fontSize: 7, lineHeight: 11 }, venueReviewEdit: { color: '#1C6B66', fontSize: 7, fontWeight: '900' }, inputLabel: { marginTop: 14, marginBottom: 6, color: '#7C8983', fontSize: 8, fontWeight: '900', letterSpacing: .7 }, input: { height: 50, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: '#DDE3DA', color: '#0E2321', backgroundColor: '#FFFFFF', fontSize: 11, fontWeight: '700' }, textarea: { minHeight: 88, paddingTop: 13, textAlignVertical: 'top' }, mapInputRow: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 7 }, mapInput: { height: 50, flex: 1, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: '#DDE3DA', color: '#0E2321', backgroundColor: '#FFFFFF', fontSize: 10 }, mapTestButton: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#D6E94A' }, fieldHelp: { marginTop: 5, color: '#7C8983', fontSize: 7, lineHeight: 11 }, choiceRow: { flexDirection: 'row', gap: 6 }, choice: { minHeight: 43, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, choiceActive: { borderColor: '#1C6B66', backgroundColor: '#E5F0ED' }, choiceText: { color: '#7C8983', fontSize: 9, fontWeight: '800' }, choiceTextActive: { color: '#1C6B66' }, surfaceChoices: { gap: 6 }, surfaceChoice: { minHeight: 42, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, surfaceChoiceActive: { borderColor: '#1C6B66', backgroundColor: '#E5F0ED' }, surfaceChoiceText: { color: '#7C8983', fontSize: 9, fontWeight: '800' }, surfaceChoiceTextActive: { color: '#1C6B66', fontWeight: '900' }, hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, hourInput: { flex: 1, textAlign: 'center' }, hoursTo: { color: '#7C8983', fontSize: 8, fontWeight: '900' }, priceInput: { height: 50, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, currency: { marginRight: 7, color: '#1C6B66', fontSize: 16, fontWeight: '900' }, priceField: { flex: 1, color: '#0E2321', fontSize: 12, fontWeight: '800' }, publishNotice: { minHeight: 53, marginTop: 13, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#E5F0ED' }, publishNoticeText: { flex: 1, color: '#3C4A45', fontSize: 8, lineHeight: 12 }, errorBox: { marginTop: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 11, backgroundColor: '#F7EAE6' }, errorText: { flex: 1, color: '#A63B2B', fontSize: 8, lineHeight: 12 }, formActions: { marginTop: 18, flexDirection: 'row', gap: 8 }, formBackButton: { minHeight: 52, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 14, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' }, formBackText: { color: '#1C6B66', fontSize: 9, fontWeight: '900' }, saveButton: { minHeight: 52, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: '#D6E94A' }, formSubmitButton: { flex: 1, marginTop: 0 }, saveText: { color: '#0E2321', fontSize: 11, fontWeight: '900' }, disabled: { opacity: .55 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
