import Modal from '../components/ResponsiveModal';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { DEMO_MODE } from '../config/demoMode';
import { DEMO_BOOKING } from '../config/demoData';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import LocationPicker from '../components/LocationPicker';
import ScrollView from '../components/FocusResetScrollView';
import SectionList from '../components/FocusResetSectionList';
import useResponsiveWidth from '../hooks/useResponsiveWidth';
import { webLayout, webDialog } from '../utils/webLayout';
import { distanceInKm, formatDistance, useUserLocation } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { useOperations } from '../context/OperationsContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import {
  cancelBooking, cancelUnpaidBooking, createMultiCourtBooking, joinCourtWaitlist, listCourtAvailability, listMyBookingsPage,
  listTeams, listVenues, modifyBooking, quoteCourtBooking, startBookingCheckout,
} from '../services/database';
import * as Crypto from 'expo-crypto';
import { WebView } from '../components/CheckoutBrowser';
import { getAvailableMapProviders, openMapProvider } from '../services/externalMaps';
import { requireSupabase } from '../lib/supabase';
import { peekCachedData, readCachedData, withTimeout, writeCachedData } from '../lib/asyncData';
import { BOOKING_VENUES_CACHE_KEY, bookingsCacheKey } from '../lib/cacheKeys';
import ResilientImage from '../components/ResilientImage';
import { HeaderAvatar } from '../components/AccountMenu';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA',
};
let C = LIGHT_C;

function presentVenue(venue) {
  const courts = venue.courts || [];
  const prices = courts.map((item) => Number(item.hourly_price)).filter(Number.isFinite);
  return {
    id: venue.id, name: venue.name, area: venue.area, address: venue.address, latitude: venue.latitude, longitude: venue.longitude,
    rating: '—', reviews: 0, price: prices.length ? Math.min(...prices) : 0, courts: courts.length,
    available: courts.filter((item) => item.active).length, hours: `${venue.opens_at?.slice(0, 5)}–${venue.closes_at?.slice(0, 5)}`,
    type: venue.venue_type, color: venue.color || LIGHT_C.teal, brandImage: venue.brand_image_url || null, description: venue.description, amenities: venue.amenities || [], timeZone: venue.time_zone || 'Asia/Manila', cancellationCutoffMinutes: venue.cancellation_cutoff_minutes || 240,
    courtOptions: courts.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, environment: item.environment, surface: item.surface, image: item.image_url || null, price: Number(item.hourly_price), available: true, next: 'Check times' })),
  };
}

const TIMES = ['8:00 AM', '9:30 AM', '11:00 AM', '1:00 PM', '3:30 PM', '5:00 PM', '6:30 PM', '8:00 PM'];

function bookingTimeParts(value = '6:30 PM') {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return { hour: '6', minute: '30', period: 'PM' };
  return { hour: match[1], minute: match[2], period: match[3].toUpperCase() };
}

function customBookingTime(hourValue, minuteValue, period) {
  const hourText = String(hourValue).trim();
  const minuteText = String(minuteValue).trim();
  if (!/^\d{1,2}$/.test(hourText) || !/^\d{1,2}$/.test(minuteText)) return null;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59 || !['AM', 'PM'].includes(period)) return null;
  return `${hour}:${String(minute).padStart(2, '0')} ${period}`;
}

function manilaDateIso(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateFromIso(dateIso) {
  return new Date(`${dateIso}T12:00:00+08:00`);
}

function shiftBookingDate(dateIso, days) {
  const value = dateFromIso(dateIso);
  value.setUTCDate(value.getUTCDate() + days);
  return manilaDateIso(value);
}

function bookingDateOption(dateIso) {
  const value = dateFromIso(dateIso);
  return {
    iso: dateIso,
    day: value.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Manila' }).toUpperCase(),
    date: value.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Manila' }),
    full: value.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }),
  };
}

function bookingDateRange(startIso) {
  return Array.from({ length: 7 }, (_, offset) => bookingDateOption(shiftBookingDate(startIso, offset)));
}

function bookingRangeLabel(dates) {
  const start = dateFromIso(dates[0].iso);
  const end = dateFromIso(dates[dates.length - 1].iso);
  const startMonth = start.toLocaleDateString('en-US', { month: 'long', timeZone: 'Asia/Manila' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'long', timeZone: 'Asia/Manila' });
  const startYear = start.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Manila' });
  const endYear = end.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Manila' });
  if (startMonth === endMonth && startYear === endYear) return `${startMonth} ${startYear}`;
  if (startYear === endYear) return `${startMonth} – ${endMonth} ${endYear}`;
  return `${startMonth} ${startYear} – ${endMonth} ${endYear}`;
}

function useManilaToday() {
  const [todayIso, setTodayIso] = useState(() => manilaDateIso());
  useEffect(() => {
    let timer;
    const refresh = () => {
      const currentIso = manilaDateIso();
      setTodayIso(currentIso);
      const nextIso = shiftBookingDate(currentIso, 1);
      const nextMidnight = new Date(`${nextIso}T00:00:02+08:00`).getTime();
      timer = setTimeout(refresh, Math.max(1000, nextMidnight - Date.now()));
    };
    refresh();
    return () => clearTimeout(timer);
  }, []);
  return todayIso;
}

function bookingDates(dateIso, time, duration) {
  const [clock, period] = time.split(' ');
  const [rawHour, minute] = clock.split(':').map(Number);
  const hour = (rawHour % 12) + (period === 'PM' ? 12 : 0);
  const start = new Date(`${dateIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);
  return { start, end: new Date(start.getTime() + duration * 60_000) };
}

function timeLabel(date) {
  return date
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
    .replace(/\s*(AM|PM)$/i, ' $1');
}

const PAYMENT_STATUS_LABELS = {
  pay_at_venue: 'Pay at venue',
  awaiting_payment: 'Payment pending',
  paid: 'Paid',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
  failed: 'Payment failed',
};

function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || status;
}

async function waitForBookingPayment(bookingId, { attempts = 6, intervalMs = 2500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data } = await requireSupabase().from('bookings').select('*').eq('id', bookingId).maybeSingle();
    if (data && data.payment_status !== 'awaiting_payment') return data;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const { data } = await requireSupabase().from('bookings').select('*').eq('id', bookingId).maybeSingle();
  return data;
}

function bookingWindow(dateIso, time, duration) {
  const { start, end } = bookingDates(dateIso, time, duration);
  return `${timeLabel(start)} – ${timeLabel(end)}`;
}

function readableTextColor(backgroundColor) {
  const value = String(backgroundColor || '').replace('#', '');
  if (!/^[\da-f]{6}$/i.test(value)) return '#FFFFFF';
  const [red, green, blue] = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((part) => parseInt(part, 16));
  return (red * 299 + green * 587 + blue * 114) / 1000 > 155 ? LIGHT_C.ink : '#FFFFFF';
}

function Icon({ name, size = 20, color = C.ink }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function Header({ title = 'Explore courts', subtitle = null, onBack, action }) {
  const { userLocation } = useUserLocation();
  const { fontScale } = useWindowDimensions();
  const width = useResponsiveWidth();
  const [locationOpen, setLocationOpen] = useState(false);
  const compact = width <= 360 || fontScale > 1.15;
  const locationLabel = String(userLocation.label || 'Location').split(' · ')[0];
  const showDefaultLocation = action === undefined && !onBack;
  const headerAction = action === null || (action === undefined && !showDefaultLocation) ? null : action || (
    <Pressable
      accessibilityLabel={`Change search location. Current location: ${userLocation.label}`}
      hitSlop={compact ? 0 : 4}
      onPress={() => setLocationOpen(true)}
      style={compact ? styles.headerLocationButton : styles.headerLocationAction}
    >
      <Icon name="location" size={compact ? 19 : 15} color={C.teal} />
      {!compact ? <Text numberOfLines={1} style={styles.headerLocationText}>{locationLabel}</Text> : null}
      {!compact ? <Icon name="chevron-down" size={13} color={C.teal} /> : null}
    </Pressable>
  );
  return (
    <>
      <View style={[styles.header, compact && styles.headerCompact]}>
        {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Go back" hitSlop={6} onPress={onBack} style={styles.iconButton}><Icon name="arrow-back" /></Pressable>}
        <View style={styles.headerCopy}>{subtitle ? <Text numberOfLines={1} style={styles.eyebrow}>{subtitle}</Text> : null}<Text numberOfLines={1} style={[styles.h1, compact && styles.headerTitleCompact]}>{title}</Text></View>
        {headerAction}
        {!onBack ? <HeaderAvatar size={36} /> : null}
      </View>
      <View style={styles.headerCourtDivider}><View style={styles.headerCourtLine} /><View style={styles.headerCourtDash} /></View>
      <LocationPicker visible={locationOpen} onClose={() => setLocationOpen(false)} />
    </>
  );
}

function BookingTabs({ active, onChange }) {
  return (
    <View accessibilityRole="tablist" style={styles.bookingTabs}>
      {[{ id: 'find', label: 'Find courts', icon: 'search-outline' }, { id: 'bookings', label: 'My bookings', icon: 'ticket-outline' }].map((item) => {
        const selected = active === item.id;
        return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(item.id)} style={({ pressed }) => [styles.bookingTab, selected && styles.bookingTabActive, pressed && styles.pressed]}><Icon name={item.icon} size={16} color={selected ? '#000000' : C.ink40} /><Text style={[styles.bookingTabText, selected && styles.bookingTabTextActive]}>{item.label}</Text></Pressable>;
      })}
    </View>
  );
}

function CourtArt({ color, large = false, imageUrl = null, accessibilityLabel }) {
  return (
    <View style={[styles.courtArt, large && styles.courtArtLarge, { backgroundColor: color }]}>
      {imageUrl
        ? <ResilientImage uri={imageUrl} accessibilityLabel={accessibilityLabel} style={StyleSheet.absoluteFillObject} fallbackColor={color} />
        : <View style={styles.courtLines}><View style={styles.centerLine} /><View style={styles.crossLine} /><View style={[styles.crossLine, styles.crossLineTwo]} /></View>}
      <View style={styles.availableBadge}><View style={styles.availableDot} /><Text style={styles.availableText}>AVAILABLE TODAY</Text></View>
    </View>
  );
}

function PrimaryButton({ children, icon = 'arrow-forward', onPress, disabled = false }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primary, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.primaryText}>{children}</Text><Icon name={icon} size={18} color="#0E2321" />
    </Pressable>
  );
}

function MapOptionsSheet({ destination, onClose }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!destination) return undefined;
    let active = true;
    setLoading(true);
    getAvailableMapProviders()
      .then((items) => { if (active) setProviders(items); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [destination]);
  const chooseProvider = (provider) => {
    const selectedDestination = destination;
    onClose();
    openMapProvider(provider.id, selectedDestination);
  };
  return (
    <Modal visible={Boolean(destination)} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={styles.mapModal}>
        <Pressable accessibilityLabel="Close map options" onPress={onClose} style={styles.mapBackdrop} />
        <SafeAreaView {...webDialog('safe')} edges={['bottom']} style={styles.mapSheetSafe}>
          <View {...webDialog('surface')} accessibilityViewIsModal style={styles.mapSheet}>
            <View {...webDialog('handle')} style={styles.mapSheetHandle} />
            <View style={styles.mapSheetHeader}><View style={styles.mapSheetIcon}><Icon name="navigate" size={21} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.mapSheetEyebrow}>GET DIRECTIONS</Text><Text numberOfLines={1} style={styles.mapSheetTitle}>{destination?.name || 'Open venue'}</Text><Text numberOfLines={2} style={styles.mapSheetAddress}>{[destination?.address, destination?.area].filter(Boolean).join(' · ')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.mapSheetClose}><Icon name="close" size={20} color={C.ink70} /></Pressable></View>
            <Text style={styles.mapSheetPrompt}>Choose a navigation app</Text>
            {loading ? <View style={styles.mapSheetLoading}><ActivityIndicator color={C.teal} /><Text style={styles.bodySmall}>Checking installed maps…</Text></View> : providers.map((provider) => <Pressable key={provider.id} accessibilityRole="button" onPress={() => chooseProvider(provider)} style={({ pressed }) => [styles.mapProvider, pressed && styles.pressed]}><View style={styles.mapProviderIcon}><Icon name={provider.id === 'apple' ? 'logo-apple' : provider.id === 'google' ? 'logo-google' : provider.id === 'waze' ? 'car-sport-outline' : 'map-outline'} size={22} color={C.teal} /></View><View style={styles.flex}><Text style={styles.mapProviderName}>{provider.label}</Text><Text style={styles.mapProviderMeta}>{provider.id === 'system' ? 'Use your phone’s default maps app' : `Open directions in ${provider.label}`}</Text></View><Icon name="chevron-forward" size={18} color={C.ink40} /></Pressable>)}
            <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.mapCancelButton, pressed && styles.pressed]}><Text style={styles.mapCancelText}>Cancel</Text></Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const PAYMENT_METHODS = [
  { value: 'gcash', label: 'GCash', detail: 'Pay from your GCash wallet' },
  { value: 'paymaya', label: 'Maya', detail: 'Pay from your Maya wallet' },
  { value: 'card', label: 'Credit / debit card', detail: 'Visa, Mastercard, JCB' },
  { value: 'dob', label: 'Online banking', detail: 'Pay directly from your bank' },
];

const GCASH_PAYMENT_ICON = require('../../public/images/payments/gcash-icon.png');
const MAYA_PAYMENT_ICON = require('../../public/images/payments/maya-icon.png');

function PaymentMethodIcon({ type }) {
  if (type === 'gcash') return <Image accessibilityLabel="GCash" source={GCASH_PAYMENT_ICON} style={styles.paymentBrandIcon} />;
  if (type === 'paymaya') return <Image accessibilityLabel="Maya" source={MAYA_PAYMENT_ICON} style={styles.paymentBrandIcon} />;
  if (type === 'card') return <View accessibilityLabel="Credit or debit card" style={[styles.paymentIcon, styles.cardIcon]}><Icon name="card" size={21} color="#FFFFFF" /></View>;
  return <View accessibilityLabel="Online banking" style={[styles.paymentIcon, styles.bankIcon]}><Icon name="business" size={20} color="#FFFFFF" /></View>;
}

function checkoutResultFromUrl(url, bookingId) {
  if (!url || !bookingId || !String(url).startsWith(`peakle://booking/${bookingId}/payment-result`)) return null;
  const match = String(url).match(/[?&]status=([^&#]+)/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : 'unknown';
}

function PaymentCheckoutModal({ bookingId, onDone }) {
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const finishedRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    finishedRef.current = false;
    if (!bookingId) { setCheckoutUrl(null); setError(null); setLoading(false); }
  }, [bookingId]);

  const finish = useCallback((status) => {
    if (!bookingId || finishedRef.current) return;
    finishedRef.current = true;
    setCheckoutUrl(null);
    onDoneRef.current(status);
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) return undefined;
    const listener = Linking.addEventListener('url', ({ url }) => {
      const status = checkoutResultFromUrl(url, bookingId);
      if (status) finish(status);
    });
    return () => listener.remove();
  }, [bookingId, finish]);

  useEffect(() => {
    if (!bookingId || !checkoutUrl) return undefined;
    let active = true;
    const client = requireSupabase();
    const checkPayment = async () => {
      const { data } = await client.from('bookings').select('payment_status').eq('id', bookingId).maybeSingle();
      if (active && data?.payment_status === 'paid') finish('success');
    };
    checkPayment();
    const timer = setInterval(checkPayment, 2000);
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPayment();
    });
    const channel = client.channel(`booking-checkout-${bookingId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` }, (payload) => {
        if (payload.new?.payment_status === 'paid') finish('success');
      })
      .subscribe();
    return () => {
      active = false;
      clearInterval(timer);
      appStateListener.remove();
      client.removeChannel(channel);
    };
  }, [bookingId, checkoutUrl, finish]);

  const choose = async (value) => {
    setLoading(true); setError(null);
    try {
      const { checkout_url } = await startBookingCheckout(bookingId, value);
      setCheckoutUrl(checkout_url);
    } catch (err) {
      setError(err.message || 'Could not start checkout.');
    } finally {
      setLoading(false);
    }
  };

  const handleShouldStartLoad = (request) => {
    const url = request?.url || '';
    const status = checkoutResultFromUrl(url, bookingId);
    if (status) {
      finish(status);
      return false;
    }
    return true;
  };

  const handleNavigationChange = (state) => {
    const status = checkoutResultFromUrl(state?.url, bookingId);
    if (status) finish(status);
  };

  return (
    <Modal visible={Boolean(bookingId)} animationType="slide" transparent={true} statusBarTranslucent onRequestClose={() => finish('cancelled')}>
      {checkoutUrl ? (
        <SafeAreaView {...webDialog('page')} style={styles.checkoutSafe} edges={['top', 'bottom']}>
          <View style={styles.checkoutHeader}>
            <Text style={styles.checkoutTitle}>Secure checkout</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close checkout" onPress={() => finish('cancelled')} style={styles.mapSheetClose}><Icon name="close" size={20} color={C.ink70} /></Pressable>
          </View>
          <WebView
            source={{ uri: checkoutUrl }}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onNavigationStateChange={handleNavigationChange}
            startInLoadingState
            setSupportMultipleWindows={false}
            renderLoading={() => <View style={styles.checkoutLoading}><ActivityIndicator color={C.teal} /></View>}
            style={styles.checkoutWebview}
          />
        </SafeAreaView>
      ) : (
        <View {...webDialog('backdrop')} style={styles.mapModal}>
          <Pressable accessibilityLabel="Close checkout" onPress={() => finish('cancelled')} style={styles.mapBackdrop} />
          <SafeAreaView {...webDialog('safe')} edges={['bottom']} style={styles.mapSheetSafe}>
            <View {...webDialog('surface')} accessibilityViewIsModal style={styles.mapSheet}>
              <View {...webDialog('handle')} style={styles.mapSheetHandle} />
              <View style={[styles.checkoutHeader, { borderBottomWidth: 0, paddingHorizontal: 0 }]}>
                <Text style={styles.checkoutTitle}>Choose payment method</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close checkout" onPress={() => finish('cancelled')} style={styles.mapSheetClose}><Icon name="close" size={20} color={C.ink70} /></Pressable>
              </View>
              <View style={[styles.checkoutMethods, { paddingHorizontal: 0, paddingBottom: 20 }]}>
                {error ? <Text style={styles.checkoutError}>{error}</Text> : null}
                {loading ? <View style={styles.checkoutLoading}><ActivityIndicator color={C.teal} /></View> : PAYMENT_METHODS.map((item) => (
                  <Pressable key={item.value} accessibilityRole="button" onPress={() => choose(item.value)} style={({ pressed }) => [styles.mapProvider, pressed && styles.pressed]}>
                    <View style={styles.paymentIconFrame}><PaymentMethodIcon type={item.value} /></View>
                    <View style={styles.flex}><Text style={styles.mapProviderName}>{item.label}</Text><Text style={styles.mapProviderMeta}>{item.detail}</Text></View>
                    <Icon name="chevron-forward" size={18} color={C.ink40} />
                  </Pressable>
                ))}
              </View>
            </View>
          </SafeAreaView>
        </View>
      )}
    </Modal>
  );
}

function CourtCard({ court, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.courtCard, pressed && styles.pressed]}>
      <CourtArt color={court.color} imageUrl={court.brandImage} accessibilityLabel={`${court.name} venue image`} />
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}><Text style={styles.cardTitle}>{court.name}</Text><Text style={styles.price}>₱{court.price}<Text style={styles.perHour}>/hr</Text></Text></View>
        <View style={styles.meta}><Icon name="location-outline" size={14} color={C.ink40} /><Text style={styles.metaText}>{court.area} · {court.distance}</Text></View>
        <View style={styles.tags}><Text style={[styles.tag, styles.rating]}>★ {court.rating}</Text><Text style={styles.tag}>{court.type}</Text><Text style={styles.tag}>{court.courts} courts</Text></View>
      </View>
    </Pressable>
  );
}

function Discovery({ courts, loading, error, onRetry, onSelect, onShowBookings, onShowEvents }) {
  const { userLocation } = useUserLocation();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const hasQuery = Boolean(query.trim());
  const filtered = useMemo(() => courts.map((court) => {
    const distanceKm = distanceInKm(userLocation, court);
    return {
      ...court,
      distanceKm,
      distance: formatDistance(distanceKm),
    };
  }).filter((court) => {
    const matchesQuery = `${court.name} ${court.area}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'All' || court.type === filter || (filter === 'Nearby' && court.distanceKm <= 25);
    return matchesQuery && matchesFilter;
  }).sort((a, b) => (a.distanceKm ?? Number.MAX_VALUE) - (b.distanceKm ?? Number.MAX_VALUE)), [courts, filter, query, userLocation]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRetry} tintColor={C.teal} colors={[C.teal]} progressBackgroundColor={C.surface} />}>
      <Header />
      <BookingTabs active="find" onChange={(value) => value === 'bookings' && onShowBookings()} />
      <Pressable accessibilityRole="button" onPress={onShowEvents} style={({ pressed }) => [styles.eventEntry, pressed && styles.pressed]}><View style={styles.eventEntryIcon}><Icon name="trophy-outline" size={20} color={C.teal} /></View><View style={styles.eventEntryCopy}><Text style={styles.eventEntryEyebrow}>EVENTS & PROGRAMS</Text><Text style={styles.eventEntryTitle}>Leagues, tournaments and clinics</Text><Text style={styles.eventEntryMeta}>Discover competitive events and register for venue programs.</Text></View><Icon name="chevron-forward" color={C.teal} /></Pressable>
      <View style={styles.search}><Icon name="search-outline" color={C.ink40} /><TextInput value={query} onChangeText={setQuery} placeholder="Court or neighborhood" placeholderTextColor={C.ink40} returnKeyType="search" style={styles.searchInput} />{hasQuery && <Pressable accessibilityRole="button" accessibilityLabel="Clear court search" hitSlop={8} onPress={() => setQuery('')} style={styles.clearSearchButton}><Icon name="close" size={18} color={C.ink70} /></Pressable>}</View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {['All', 'Indoor', 'Outdoor', 'Nearby'].map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)} style={({ pressed }) => [styles.filterChip, filter === item && styles.filterChipActive, pressed && styles.pressed]}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}</Text></Pressable>)}
      </ScrollView>
      <View style={styles.resultsHead}><View style={styles.resultsCopy}><Text style={styles.eyebrow}>NEAREST TO {userLocation.label.toUpperCase()}</Text><Text style={styles.h2}>{filtered.length} {filtered.length === 1 ? 'court' : 'courts'} available</Text></View><View style={styles.mapLink}><Icon name="navigate-outline" size={16} color={C.teal} /><Text style={styles.mapText}>Distance</Text></View></View>
      {loading && !courts.length && <View style={styles.loadState}><ActivityIndicator color={C.teal} /><Text style={styles.emptyText}>Finding available courts…</Text></View>}
      {!loading && error && !courts.length && <View style={styles.empty}><Icon name="cloud-offline-outline" size={32} color={C.ink40} /><Text style={styles.emptyTitle}>Courts could not load</Text><Text style={styles.emptyText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View>}
      <View {...webLayout('court-grid')}>{filtered.map((court) => <CourtCard key={court.id} court={court} onPress={() => onSelect(court)} />)}</View>
      {!loading && !error && !filtered.length && <View style={styles.empty}><Icon name="search-outline" size={32} color={C.ink40} /><Text style={styles.emptyTitle}>No courts found</Text><Text style={styles.emptyText}>Try another neighborhood or clear the selected filter.</Text><Pressable accessibilityRole="button" onPress={() => { setQuery(''); setFilter('All'); }} style={styles.retryButton}><Text style={styles.retryText}>Clear filters</Text></Pressable></View>}
    </ScrollView>
  );
}

function reservationDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, timeZone: 'Asia/Manila' });
}

function reservationStatus(status) {
  const values = {
    confirmed: { label: 'Confirmed', backgroundColor: '#E5F0ED', color: LIGHT_C.teal },
    pending: { label: 'Pending', backgroundColor: '#F1F4D3', color: LIGHT_C.ink70 },
    completed: { label: 'Completed', backgroundColor: '#E9ECE7', color: LIGHT_C.ink70 },
    cancelled: { label: 'Cancelled', backgroundColor: '#F5E4DF', color: LIGHT_C.brick },
    no_show: { label: 'No show', backgroundColor: '#F5E4DF', color: LIGHT_C.brick },
  };
  return values[status] || { label: status || 'Booked', backgroundColor: '#E9ECE7', color: LIGHT_C.ink70 };
}

function ReservationCard({ booking, onOpenMaps, onCancel, onModify, onPay, isPast = false, onPress, showPastActions = false, onViewLastMatch }) {
  const showFull = !isPast;
  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  const venue = booking.venues || {};
  const court = booking.courts || {};
  const ended = Number.isFinite(end.getTime()) && end.getTime() <= Date.now();
  const effectiveStatus = ended && ['pending', 'confirmed'].includes(booking.status) ? 'completed' : booking.status;
  const awaitingPayment = booking.payment_status === 'awaiting_payment' && booking.status === 'pending';
  const status = awaitingPayment
    ? { label: 'Payment due', backgroundColor: '#FFF1C9', color: '#835A00' }
    : reservationStatus(effectiveStatus);
  const venueName = venue.name || 'Court reservation';
  const canManage = ['pending', 'confirmed'].includes(booking.status) && start.getTime() > Date.now();
  const reference = booking.reference || String(booking.id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Pickleball at ${venueName}`)}&dates=${start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}/${end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}&location=${encodeURIComponent(venue.address || '')}`;
  const shareBooking = () => Share.share({
    title: `Pickleball at ${venueName}`,
    message: `Pickleball at ${venueName}${court.name ? ` (${court.name})` : ''} on ${reservationDate(start)}, ${timeLabel(start)}–${timeLabel(end)}.`,
  });
  return (
    <View style={styles.reservationCard}>
      <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.reservationTop, { backgroundColor: venue.color || C.teal }, pressed && { transform: [{ scale: 0.985 }] }]}>
        {({ pressed }) => (
          <>
            <View style={styles.reservationMark}><Image source={require('../../public/images/ball.png')} style={{width: 21, height: 21, tintColor: '#000000'}} /></View>
            <View style={styles.reservationTitleCopy}><Text numberOfLines={1} style={styles.reservationVenue}>{venueName}</Text><Text numberOfLines={1} style={styles.reservationCourt}>{[court.name, venue.area].filter(Boolean).join(' · ') || 'Court details unavailable'}</Text></View>
            <View style={[styles.statusPill, { backgroundColor: status.backgroundColor }]}><Text style={[styles.statusText, { color: status.color }]}>{status.label.toUpperCase()}</Text></View>
            {isPast && <View style={styles.reservationExpandIcon}><Icon name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" /></View>}
            {pressed && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: 0.1 }]} />}
          </>
        )}
      </Pressable>
      {showFull ? (
        <View style={styles.reservationBody}>
          <View style={styles.reservationSchedule}><View style={styles.reservationDateBox}><Text style={styles.reservationMonth}>{start.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Manila' }).toUpperCase()}</Text><Text style={styles.reservationDay}>{start.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Manila' })}</Text></View><View style={styles.reservationWhen}><Text style={styles.reservationDateLabel}>{reservationDate(start)}</Text><Text style={styles.reservationTime}>{timeLabel(start)}–{timeLabel(end)}</Text><Text style={styles.reservationZone}>{venue.time_zone || 'ASIA/MANILA'} · REF {reference}</Text></View><View style={styles.reservationPrice}><Text style={styles.barLabel}>TOTAL</Text><Text style={styles.reservationAmount}>₱{Number(booking.amount || 0).toLocaleString('en-PH')}</Text><Text style={styles.paymentLabel}>{paymentStatusLabel(booking.payment_status)}</Text><Text style={styles.refundLabel}>{booking.refund_status && booking.refund_status !== 'not_applicable' ? `Refund: ${booking.refund_status.replace('_', ' ')}` : 'No refund due'}</Text></View></View>
          {awaitingPayment ? <View style={styles.paymentDueNotice}><Icon name="time-outline" size={18} color="#835A00" /><View style={styles.flex}><Text style={styles.paymentDueTitle}>Payment required</Text><Text style={styles.paymentDueText}>This court is only on hold and is not confirmed until payment succeeds.</Text></View></View> : <View style={styles.reservationActions}><Pressable accessibilityRole="button" onPress={() => onOpenMaps(venue)} style={({ pressed }) => [styles.reservationAction, pressed && styles.pressed]}><Icon name="navigate-outline" size={16} color={C.teal} /><Text style={styles.reservationActionText}>Maps</Text></Pressable><View style={styles.actionDivider} />{showPastActions ? <Pressable accessibilityRole="button" onPress={onViewLastMatch} style={({ pressed }) => [styles.reservationAction, pressed && styles.pressed]}><Icon name="stats-chart-outline" size={16} color={C.teal} /><Text style={styles.reservationActionText}>Last match</Text></Pressable> : <Pressable accessibilityRole="link" onPress={() => Linking.openURL(calendarUrl)} style={({ pressed }) => [styles.reservationAction, pressed && styles.pressed]}><Icon name="calendar-outline" size={16} color={C.teal} /><Text style={styles.reservationActionText}>Calendar</Text></Pressable>}<View style={styles.actionDivider} /><Pressable onPress={shareBooking} style={({ pressed }) => [styles.reservationAction, pressed && styles.pressed]}><Icon name="share-social-outline" size={16} color={C.teal} /><Text style={styles.reservationActionText}>Share</Text></Pressable></View>}
          {awaitingPayment ? <View style={styles.pendingPaymentActions}><Pressable disabled={!canManage} accessibilityRole="button" accessibilityState={{ disabled: !canManage }} onPress={() => onPay(booking)} style={[styles.payNowButton, !canManage && styles.disabled]}><Icon name="wallet-outline" size={16} color="#0E2321" /><Text style={styles.payNowText}>{canManage ? 'Pay now' : 'Payment expired'}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onCancel(booking)} style={styles.pendingCancelButton}><Icon name="close-circle-outline" size={16} color={C.brick} /><Text style={styles.pendingCancelText}>Cancel</Text></Pressable></View> : canManage && <View style={styles.manageActions}><Pressable onPress={() => onModify(booking)} style={styles.manageButton}><Icon name="calendar-number-outline" size={15} color={C.teal} /><Text style={styles.manageText}>Change time</Text></Pressable><Pressable onPress={() => onCancel(booking)} style={[styles.manageButton, styles.cancelButton]}><Icon name="close-circle-outline" size={15} color={C.brick} /><Text style={[styles.manageText, styles.cancelText]}>Cancel booking</Text></Pressable></View>}
        </View>
      ) : (
        <Pressable onPress={onPress} disabled={!onPress} style={styles.reservationCompactBody}>
          <View>
            <Text style={styles.reservationCompactDate}>{reservationDate(start)}</Text>
            <Text style={styles.reservationCompactTime}>{timeLabel(start)}–{timeLabel(end)}</Text>
          </View>
          <Text style={styles.reservationCompactTotal}>₱{Number(booking.amount || 0).toLocaleString('en-PH')}</Text>
        </Pressable>
      )}
    </View>
  );
}

function MyBookings({ bookings, loading, loadingMore, hasMoreHistory, error, onRetry, onLoadMore, onFindCourts, onOpenMaps, onCancel, onModify, onPay, onViewLastMatch }) {
  const [clock, setClock] = useState(() => Date.now());
  const [selectedPastBooking, setSelectedPastBooking] = useState(null);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const sections = useMemo(() => {
    const awaitingPayment = [];
    const upcoming = [];
    const history = [];
    bookings.forEach((item) => {
      const endsAt = Date.parse(item.ends_at);
      const activeStatus = item.status === 'pending' || item.status === 'confirmed';
      if (item.status === 'pending' && item.payment_status === 'awaiting_payment') awaitingPayment.push(item);
      else if (activeStatus && Number.isFinite(endsAt) && endsAt > clock) upcoming.push(item);
      else history.push(item);
    });
    const startsAt = (item) => Date.parse(item.starts_at) || 0;
    upcoming.sort((a, b) => startsAt(a) - startsAt(b));
    history.sort((a, b) => startsAt(b) - startsAt(a));
    return [
      awaitingPayment.length ? { key: 'payment', eyebrow: 'ACTION REQUIRED', title: 'Awaiting payment', data: awaitingPayment } : null,
      upcoming.length ? { key: 'upcoming', eyebrow: 'UPCOMING', title: 'Ready to play', data: upcoming } : null,
      history.length ? { key: 'history', eyebrow: 'HISTORY', title: 'Past reservations', data: history } : null,
    ].filter(Boolean);
  }, [bookings, clock]);
  return (
    <View style={styles.flex}>
      <SectionList
        style={styles.flex}
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, section }) => <ReservationCard booking={item} onOpenMaps={onOpenMaps} onCancel={onCancel} onModify={onModify} onPay={onPay} isPast={section.key === 'history'} onPress={section.key === 'history' ? () => setSelectedPastBooking(item) : undefined} />}
        renderSectionHeader={({ section }) => <View style={styles.bookingSectionHead}><View><Text style={styles.eyebrow}>{section.eyebrow}</Text><Text style={styles.h2}>{section.title}</Text></View><Text style={styles.bookingCount}>{section.data.length}</Text></View>}
        ListHeaderComponent={<><Header title="My bookings" subtitle="YOUR RESERVATIONS" action={null} /><BookingTabs active="bookings" onChange={(value) => value === 'find' && onFindCourts()} />{error && bookings.length > 0 && <View style={styles.bookingWarning}><Icon name="cloud-offline-outline" size={17} color={C.brick} /><Text style={styles.bookingWarningText}>Could not refresh. Showing your last loaded bookings.</Text></View>}</>}
        ListEmptyComponent={loading ? <View style={styles.loadState}><ActivityIndicator color={C.teal} /><Text style={styles.emptyText}>Loading your bookings…</Text></View> : error ? <View style={styles.empty}><Icon name="cloud-offline-outline" size={32} color={C.ink40} /><Text style={styles.emptyTitle}>Bookings could not load</Text><Text style={styles.emptyText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View> : <View style={styles.empty}><Icon name="ticket-outline" size={34} color={C.ink40} /><Text style={styles.emptyTitle}>No bookings yet</Text><Text style={styles.emptyText}>Your confirmed court reservations will appear here.</Text><Pressable accessibilityRole="button" onPress={onFindCourts} style={styles.retryButton}><Text style={styles.retryText}>Find a court</Text></Pressable></View>}
        ListFooterComponent={loadingMore ? <View style={styles.bookingListFooter}><ActivityIndicator color={C.teal} /><Text style={styles.emptyText}>Loading older bookings…</Text></View> : null}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshing={loading}
        onRefresh={onRetry}
        stickySectionHeadersEnabled={false}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        onEndReached={hasMoreHistory && !loadingMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.35}
      />
      <Modal visible={Boolean(selectedPastBooking)} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'} onRequestClose={() => setSelectedPastBooking(null)}>
        <SafeAreaView {...webDialog('page')} style={styles.pastBookingModalSafe}>
          <View style={styles.pastBookingModalHead}>
            <View style={styles.flex}><Text style={styles.eyebrow}>RESERVATION HISTORY</Text><Text style={styles.pastBookingModalTitle}>Booking details</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close booking details" onPress={() => setSelectedPastBooking(null)} style={({ pressed }) => [styles.pastBookingModalClose, pressed && styles.pressed]}><Icon name="close" size={21} color={C.ink} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pastBookingModalScroll}>
            <View style={styles.pastBookingModalIntro}><View style={styles.pastBookingModalIntroIcon}><Icon name="checkmark-done" size={22} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.pastBookingModalIntroTitle}>Past reservation</Text><Text style={styles.bodySmall}>This court booking has ended. Your reservation details and actions are available below.</Text></View></View>
            {selectedPastBooking && <ReservationCard booking={selectedPastBooking} showPastActions onViewLastMatch={() => { setSelectedPastBooking(null); setTimeout(onViewLastMatch, 250); }} onOpenMaps={(destination) => { setSelectedPastBooking(null); setTimeout(() => onOpenMaps(destination), 250); }} onCancel={onCancel} onModify={onModify} />}
            <Pressable accessibilityRole="button" onPress={() => setSelectedPastBooking(null)} style={({ pressed }) => [styles.pastBookingDone, pressed && styles.pressed]}><Text style={styles.pastBookingDoneText}>Done</Text></Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function CourtDetail({ court, onBack, onBook, onOpenMaps }) {
  const [saved, setSaved] = useState(false);
  const [selectedCourt, setSelectedCourt] = useState(() => court.courtOptions.find((item) => item.available));
  useEffect(() => {
    setSelectedCourt(court.courtOptions.find((item) => item.available));
  }, [court.id]);
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Header title="Court details" subtitle="PICK YOUR COURT" onBack={onBack} />
      <CourtArt color={court.color} large imageUrl={selectedCourt?.image || court.brandImage} accessibilityLabel={`${selectedCourt?.name || court.name} photo`} />
      <View style={styles.detailTop}><View style={styles.detailName}><Text style={styles.h2}>{court.name}</Text><Text style={styles.body}>{court.area} · {court.distance}</Text></View><Pressable accessibilityLabel={saved ? 'Remove saved court' : 'Save court'} onPress={() => setSaved((value) => !value)} style={[styles.iconButton, saved && styles.savedButton]}><Icon name={saved ? 'bookmark' : 'bookmark-outline'} color={saved ? C.teal : C.ink} /></Pressable></View>
      <View style={styles.ratingRow}><View style={styles.ratingBadge}><Text style={styles.ratingBig}>{court.rating}</Text><Text style={styles.ratingCaption}>★ · {court.reviews} reviews</Text></View><View style={styles.detailStat}><Text style={styles.detailNumber}>{court.courts}</Text><Text style={styles.detailLabel}>COURTS</Text></View><View style={styles.detailStat}><Text style={styles.detailNumber}>{court.available}</Text><Text style={styles.detailLabel}>OPEN NOW</Text></View></View>
      <Text style={styles.courtDescription}>{court.description}</Text>
      <View style={styles.venueFacts}><View style={styles.venueFact}><Icon name="location-outline" size={18} color={C.teal} /><View style={styles.venueFactCopy}><Text style={styles.venueFactLabel}>ADDRESS</Text><Text style={styles.venueFactValue}>{court.address}</Text></View></View><View style={styles.venueFact}><Icon name="time-outline" size={18} color={C.teal} /><View style={styles.venueFactCopy}><Text style={styles.venueFactLabel}>TODAY'S HOURS</Text><Text style={styles.venueFactValue}>{court.hours}</Text></View></View></View>
      <Pressable accessibilityRole="button" onPress={() => onOpenMaps(court)} style={({ pressed }) => [styles.directionsButton, pressed && styles.pressed]}><Icon name="navigate-outline" size={18} color={C.teal} /><Text style={styles.directionsText}>Open in Maps</Text><Icon name="open-outline" size={15} color={C.teal} /></Pressable>
      <View style={styles.sectionLine} />
      <View style={styles.courtChoiceHead}><View><Text style={styles.eyebrow}>SELECT A COURT</Text><Text style={styles.courtChoiceTitle}>{court.courts} {court.courts === 1 ? 'court' : 'courts'} at this venue</Text></View><Text style={styles.courtChoiceCount}>{court.available} available</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.courtOptions}>
        {court.courtOptions.map((option) => {
          const active = selectedCourt?.id === option.id;
          return <Pressable key={option.id} disabled={!option.available} accessibilityState={{ selected: active, disabled: !option.available }} onPress={() => setSelectedCourt(option)} style={({ pressed }) => [styles.courtOption, active && styles.courtOptionActive, !option.available && styles.courtOptionUnavailable, pressed && styles.pressed]}>{option.image ? <ResilientImage uri={option.image} accessibilityLabel={`${option.name} photo`} style={styles.courtOptionImage} /> : null}<View style={styles.courtOptionHead}><Text style={[styles.courtOptionName, active && styles.courtOptionNameActive]}>{option.name}</Text>{active && <Icon name="checkmark-circle" size={17} color={C.teal} />}</View><Text style={styles.courtOptionMeta}>{option.environment} · {option.surface}</Text><Text style={[styles.courtOptionStatus, !option.available && styles.courtOptionStatusBusy]}>{option.next}</Text><Text style={styles.courtOptionPrice}>₱{option.price}<Text style={styles.perHour}>/hr</Text></Text></Pressable>;
        })}
      </ScrollView>
      <View style={styles.sectionLine} />
      <Text style={styles.eyebrow}>WHAT'S HERE</Text><View style={styles.amenities}>{court.amenities.map((item, index) => <View key={item} style={styles.amenity}><Icon name={['snow-outline', 'car-outline', 'cafe-outline'][index] || 'checkmark-circle-outline'} size={19} color={C.teal} /><Text style={styles.amenityText}>{item}</Text></View>)}</View>
      <View style={styles.infoCard}><Icon name="information-circle-outline" color={C.teal} /><View style={styles.infoCopy}><Text style={styles.infoTitle}>Free cancellation</Text><Text style={styles.bodySmall}>Cancel up to {Math.round((court.cancellationCutoffMinutes || 240) / 60)} hours before your booking.</Text></View></View>
      <View style={styles.bookBar}><View><Text style={styles.barLabel}>{selectedCourt?.name.toUpperCase()}</Text><Text style={styles.barPrice}>₱{selectedCourt?.price || court.price}<Text style={styles.perHour}> / hour</Text></Text></View><PrimaryButton disabled={!selectedCourt} onPress={() => onBook(selectedCourt)}>Choose a time</PrimaryButton></View>
    </ScrollView>
  );
}

function Setup({ court, courtOption, teams, onBack, onConfirm, onWaitlist, existingBooking, saving, availabilityVersion = 0 }) {
  const existingStart = existingBooking ? new Date(existingBooking.starts_at) : null;
  const existingEnd = existingBooking ? new Date(existingBooking.ends_at) : null;
  const initialTime = existingStart ? timeLabel(existingStart) : '6:30 PM';
  const initialTimeParts = bookingTimeParts(initialTime);
  const todayIso = useManilaToday();
  const existingIso = existingStart ? manilaDateIso(existingStart) : null;
  const initialDateIso = existingIso && existingIso >= todayIso ? existingIso : todayIso;
  const [visibleStartIso, setVisibleStartIso] = useState(initialDateIso);
  const [selectedDateIso, setSelectedDateIso] = useState(initialDateIso);
  const [time, setTime] = useState(initialTime);
  const [customTimeMode, setCustomTimeMode] = useState(!TIMES.includes(initialTime));
  const [customHour, setCustomHour] = useState(initialTimeParts.hour);
  const [customMinute, setCustomMinute] = useState(initialTimeParts.minute);
  const [customPeriod, setCustomPeriod] = useState(initialTimeParts.period);
  const [duration, setDuration] = useState(existingStart ? Math.round((existingEnd - existingStart) / 60_000) : 60);
  const [inviteTeam, setInviteTeam] = useState(teams.length > 0);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id || null);
  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [selectedCourtIds, setSelectedCourtIds] = useState([courtOption.id]);
  const [promoCode, setPromoCode] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const scheduleScopeRef = useRef('');
  const calendarDates = useMemo(() => bookingDateRange(visibleStartIso), [visibleStartIso]);
  const selectedDate = useMemo(() => bookingDateOption(selectedDateIso), [selectedDateIso]);
  const customTime = customBookingTime(customHour, customMinute, customPeriod);
  const selectedTime = customTimeMode ? customTime : time;
  const canShowPreviousWeek = visibleStartIso > todayIso;
  const total = quote?.total ?? court.courtOptions.filter((item) => selectedCourtIds.includes(item.id)).reduce((sum, item) => sum + item.price * duration / 60, 0);
  const reservedWindow = selectedTime ? bookingWindow(selectedDateIso, selectedTime, duration) : 'Enter a valid custom time';
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || null;
  const changeCalendarWeek = (direction) => {
    const requestedStart = shiftBookingDate(visibleStartIso, direction * 7);
    const nextStart = requestedStart < todayIso ? todayIso : requestedStart;
    setVisibleStartIso(nextStart);
    setSelectedDateIso(nextStart);
  };
  useEffect(() => {
    if (visibleStartIso < todayIso) setVisibleStartIso(todayIso);
    if (selectedDateIso < todayIso) setSelectedDateIso(todayIso);
  }, [selectedDateIso, todayIso, visibleStartIso]);
  useEffect(() => {
    if (!teams.length) {
      setInviteTeam(false);
      setSelectedTeamId(null);
    } else if (!teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id);
    }
  }, [teams, selectedTeamId]);
  useEffect(() => {
    let active = true;
    const scheduleScope = `${court.id}:${selectedDateIso}`;
    if (scheduleScopeRef.current !== scheduleScope) setSchedule([]);
    scheduleScopeRef.current = scheduleScope;
    setScheduleLoading(true);
    withTimeout(
      listCourtAvailability(court.courtOptions.map((item) => item.id), selectedDateIso),
      10000,
      'Court availability took too long to refresh.',
    )
      .then((rows) => active && setSchedule(rows))
      .catch(() => {})
      .finally(() => active && setScheduleLoading(false));
    return () => { active = false; };
  }, [availabilityVersion, court.courtOptions, court.id, selectedDateIso]);
  const conflicts = (slot, courtId) => {
    const [clock, period] = slot.split(' ');
    const [rawHour, minute] = clock.split(':').map(Number);
    const hour = (rawHour % 12) + (period === 'PM' ? 12 : 0);
    const start = new Date(`${selectedDateIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);
    const end = new Date(start.getTime() + duration * 60000);
    return schedule.some((item) => item.court_id === courtId && item.id !== existingBooking?.id && start < new Date(item.ends_at) && end > new Date(item.starts_at));
  };
  const hasStarted = (slot) => bookingDates(selectedDateIso, slot, duration).start.getTime() <= Date.now();
  const selectedTimePast = Boolean(selectedTime && hasStarted(selectedTime));
  const selectedTimeBooked = Boolean(selectedTime && selectedCourtIds.some((id) => conflicts(selectedTime, id)));
  const selectedTimeUnavailable = !selectedTime || selectedTimeBooked || selectedTimePast;
  useEffect(() => {
    setQuote(null); setQuoteError(''); setQuoteLoading(false);
    if (!selectedTime || scheduleLoading || selectedTimeUnavailable || !selectedCourtIds.length) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      setQuoteLoading(true);
      quoteCourtBooking({ courtIds: selectedCourtIds, dateIso: selectedDateIso, time: selectedTime, duration, promoCode })
        .then((value) => { if (active) setQuote(value); })
        .catch((reason) => { if (active) setQuoteError(reason.message || 'Price could not be confirmed.'); })
        .finally(() => { if (active) setQuoteLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [duration, promoCode, quoteVersion, scheduleLoading, selectedCourtIds, selectedDateIso, selectedTime, selectedTimeUnavailable]);
  useEffect(() => {
    if (!quote?.expires_at) return undefined;
    const delay = Math.max(1000, new Date(quote.expires_at).getTime() - Date.now() - 5000);
    const timer = setTimeout(() => setQuoteVersion((value) => value + 1), delay);
    return () => clearTimeout(timer);
  }, [quote?.expires_at]);
  const toggleCourt = (id) => setSelectedCourtIds((current) => current.includes(id)
    ? (current.length === 1 ? current : current.filter((value) => value !== id))
    : [...current, id]);
  const confirm = () => onConfirm({
    date: selectedDate.full, dateIso: selectedDateIso, time: selectedTime, duration, total,
    inviteTeam: inviteTeam && Boolean(selectedTeam), teamId: inviteTeam ? selectedTeam?.id : null,
    teamName: inviteTeam ? selectedTeam?.name : null, courtOption,
    courtOptions: court.courtOptions.filter((item) => selectedCourtIds.includes(item.id)), quote,
  });
  return (
    <View style={styles.setupScreen}><ScrollView contentContainerStyle={[styles.content, styles.setupContent]} showsVerticalScrollIndicator={false}>
      <Header title="Finish setup" subtitle="BOOKING DETAILS" onBack={onBack} />
      <View style={styles.compactCourt}><View style={[styles.compactSwatch, { backgroundColor: court.color }]}><Image source={require('../../public/images/ball.png')} style={{width: 22, height: 22, tintColor: '#000000'}} /></View><View style={styles.compactCopy}><Text style={styles.compactName}>{existingBooking ? 'Change reservation' : court.name}</Text><Text style={styles.bodySmall}>{selectedCourtIds.length} court{selectedCourtIds.length === 1 ? '' : 's'} selected · {court.timeZone || 'Asia/Manila'}</Text></View><Text style={styles.compactPrice}>₱{total.toLocaleString()}</Text></View>
      {!existingBooking && <><Text style={styles.sectionLabel}>COURTS · SELECT MORE THAN ONE</Text><View style={styles.multiCourtGrid}>{court.courtOptions.map((option) => { const selected = selectedCourtIds.includes(option.id); return <Pressable key={option.id} accessibilityState={{ selected }} onPress={() => toggleCourt(option.id)} style={[styles.multiCourt, selected && styles.multiCourtActive]}><Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={selected ? C.teal : C.ink40} /><View style={styles.flex}><Text style={styles.multiCourtName}>{option.name}</Text><Text style={styles.multiCourtPrice}>₱{option.price}/hr</Text></View></Pressable>; })}</View></>}
      <Text style={styles.sectionLabel}>CHOOSE A DATE</Text>
      <View style={styles.calendarCard}>
        <View style={styles.calendarHeader}>
          <View style={styles.calendarCopy}><Text style={styles.calendarMonth}>{bookingRangeLabel(calendarDates)}</Text><Text numberOfLines={1} style={styles.calendarSelected}>{selectedDate.full}</Text></View>
          <View style={styles.calendarNav}>
            <Pressable accessibilityRole="button" accessibilityLabel="Show previous week" accessibilityState={{ disabled: !canShowPreviousWeek }} disabled={!canShowPreviousWeek} onPress={() => changeCalendarWeek(-1)} style={({ pressed }) => [styles.calendarNavButton, !canShowPreviousWeek && styles.calendarNavDisabled, pressed && styles.pressed]}><Icon name="chevron-back" size={17} color={C.teal} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Show next week" onPress={() => changeCalendarWeek(1)} style={({ pressed }) => [styles.calendarNavButton, pressed && styles.pressed]}><Icon name="chevron-forward" size={17} color={C.teal} /></Pressable>
          </View>
        </View>
        <View style={styles.dateRow}>{calendarDates.map((item) => { const active = selectedDateIso === item.iso; const isToday = item.iso === todayIso; return <Pressable key={item.iso} accessibilityRole="button" accessibilityLabel={`${item.full}${isToday ? ', today' : ''}`} accessibilityState={{ selected: active }} onPress={() => setSelectedDateIso(item.iso)} style={({ pressed }) => [styles.date, active && styles.dateActive, pressed && styles.pressed]}><Text style={[styles.dateDay, active && styles.dateTextActive]}>{item.day}</Text><Text style={[styles.dateNumber, active && styles.dateTextActive]}>{item.date}</Text><View style={[styles.dateDot, isToday && styles.dateDotToday, active && isToday && styles.dateDotTodayActive]} /></Pressable>; })}</View>
      </View>
      <View style={styles.sectionHead}><Text style={styles.sectionLabel}>AVAILABLE TIMES</Text><View style={styles.availabilityMeta}>{scheduleLoading && <ActivityIndicator size="small" color={C.teal} />}<Text style={styles.timeZone}>{scheduleLoading ? 'Checking courts…' : 'Asia/Manila'}</Text></View></View>
      <View style={styles.timeGrid}>{TIMES.map((item) => { const past = hasStarted(item); const booked = selectedCourtIds.some((id) => conflicts(item, id)); const unavailable = past || booked; const active = !customTimeMode && time === item; return <Pressable key={item} disabled={past} accessibilityState={{ disabled: past, selected: active }} onPress={() => { setTime(item); setCustomTimeMode(false); }} style={[styles.time, active && styles.timeActive, unavailable && styles.timeBooked]}><Text style={[styles.timeText, active && styles.timeTextActive, unavailable && styles.timeTextBooked]}>{item}</Text>{unavailable && <Text style={styles.bookedText}>{past ? 'PAST' : 'FULL · WAITLIST'}</Text>}</Pressable>; })}</View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: customTimeMode, selected: customTimeMode }} onPress={() => setCustomTimeMode(true)} style={[styles.customTimeToggle, customTimeMode && styles.customTimeToggleActive]}><View style={styles.customTimeIcon}><Icon name="time-outline" size={19} color={C.teal} /></View><View style={styles.flex}><Text style={styles.customTimeTitle}>Enter a custom start time</Text><Text style={styles.customTimeMeta}>{customTimeMode && customTime ? `${customTime} selected` : 'Choose any minute within the venue’s operating hours'}</Text></View><Icon name={customTimeMode ? 'checkmark-circle' : 'chevron-forward'} size={18} color={customTimeMode ? C.teal : C.ink40} /></Pressable>
      {customTimeMode && <View style={styles.customTimeCard}><Text style={styles.customTimeFieldLabel}>CUSTOM START TIME</Text><View style={styles.customTimeControls}><View style={styles.customTimeField}><TextInput accessibilityLabel="Custom booking hour" value={customHour} onChangeText={(value) => setCustomHour(value.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} selectTextOnFocus placeholder="6" placeholderTextColor={C.ink40} style={styles.customTimeInput} /><Text style={styles.customTimeUnit}>HOUR</Text></View><Text style={styles.customTimeColon}>:</Text><View style={styles.customTimeField}><TextInput accessibilityLabel="Custom booking minute" value={customMinute} onChangeText={(value) => setCustomMinute(value.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} selectTextOnFocus placeholder="30" placeholderTextColor={C.ink40} style={styles.customTimeInput} /><Text style={styles.customTimeUnit}>MINUTE</Text></View><View accessibilityRole="radiogroup" style={styles.customPeriod}>{['AM', 'PM'].map((period) => <Pressable key={period} accessibilityRole="radio" accessibilityState={{ checked: customPeriod === period }} onPress={() => setCustomPeriod(period)} style={[styles.customPeriodOption, customPeriod === period && styles.customPeriodOptionActive]}><Text style={[styles.customPeriodText, customPeriod === period && styles.customPeriodTextActive]}>{period}</Text></Pressable>)}</View></View>{!customTime ? <Text accessibilityRole="alert" style={styles.customTimeError}>Enter an hour from 1–12 and minutes from 00–59.</Text> : <Text style={styles.customTimeHint}>Availability and price will be checked for {customTime}.</Text>}</View>}
      <Text style={styles.sectionLabel}>DURATION</Text><View style={styles.segment}>{[60, 90, 120].map((value) => <Pressable key={value} onPress={() => setDuration(value)} style={[styles.segmentItem, duration === value && styles.segmentActive]}><Text style={[styles.segmentText, duration === value && styles.segmentTextActive]}>{value === 60 ? '1 hour' : value === 90 ? '1.5 hours' : '2 hours'}</Text></Pressable>)}</View>
      <View style={styles.infoCard}><Icon name="time-outline" color={C.teal} /><View style={styles.infoCopy}><Text style={styles.infoTitle}>Reserved {reservedWindow}</Text><Text style={styles.bodySmall}>{selectedTime ? `Your court time ends at ${timeLabel(bookingDates(selectedDateIso, selectedTime, duration).end)}. If your game is unfinished, you may add 30 minutes only when the next slot is free. Additional venue charges apply.` : 'Enter a valid custom start time to check availability and calculate the reservation.'}</Text></View></View>
      <Pressable disabled={!teams.length} accessibilityRole="switch" accessibilityState={{ checked: inviteTeam }} onPress={() => setInviteTeam(!inviteTeam)} style={[styles.inviteRow, !teams.length && styles.inviteRowDisabled]}><View style={styles.inviteIcon}><Icon name="people-outline" color={C.teal} /></View><View style={styles.inviteCopy}><Text style={styles.inviteTitle}>{teams.length ? 'Invite your team' : 'No joined team yet'}</Text><Text style={styles.bodySmall}>{teams.length ? `Share this booking with ${selectedTeam?.name || 'your team'}.` : 'Join or create a team to share bookings with teammates.'}</Text></View>{teams.length > 0 && <View style={[styles.toggle, inviteTeam && styles.toggleOn]}><View style={[styles.toggleKnob, inviteTeam && styles.toggleKnobOn]} /></View>}</Pressable>
      {inviteTeam && teams.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamChoices}>{teams.map((team) => { const active = team.id === selectedTeamId; return <Pressable key={team.id} accessibilityState={{ selected: active }} onPress={() => setSelectedTeamId(team.id)} style={[styles.teamChoice, active && styles.teamChoiceActive]}><Icon name={active ? 'checkmark-circle' : 'people-outline'} size={15} color={active ? C.surface : C.teal} /><Text numberOfLines={1} style={[styles.teamChoiceText, active && styles.teamChoiceTextActive]}>{team.name}</Text></Pressable>; })}</ScrollView>}
      <Text style={styles.sectionLabel}>PROMO CODE</Text><TextInput autoCapitalize="characters" value={promoCode} onChangeText={setPromoCode} placeholder="Optional" placeholderTextColor={C.ink40} style={styles.promoInput} />
      <View style={styles.summary}><Text style={styles.summaryTitle}>Price-locked summary</Text><View style={styles.summaryRow}><Text style={styles.body}>Courts</Text><Text style={styles.summaryValue}>{court.courtOptions.filter((item) => selectedCourtIds.includes(item.id)).map((item) => item.name).join(', ')}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Date</Text><Text style={styles.summaryValue}>{selectedDate.full}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Time</Text><Text style={styles.summaryValue}>{reservedWindow} · {duration} min</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Court subtotal</Text><Text style={styles.summaryValue}>₱{Number(quote?.subtotal ?? total).toLocaleString()}</Text></View>{quote?.breakdown?.lines?.filter((line) => line.ruleName).map((line) => <View key={line.courtId} style={styles.summaryRow}><Text style={styles.body}>{line.ruleName}</Text><Text style={styles.summaryValue}>₱{Number(line.amount).toLocaleString()}</Text></View>)}<View style={styles.summaryRow}><Text style={styles.body}>Pricing adjustment</Text><Text style={styles.summaryValue}>₱{Math.max(0, Number(quote?.total || 0) - Number(quote?.subtotal || 0) + Number(quote?.discount_amount || 0)).toLocaleString()}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Discounts</Text><Text style={styles.summaryValue}>− ₱{Number(quote?.discount_amount || 0).toLocaleString()}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Fees</Text><Text style={styles.summaryValue}>₱{Number(quote?.fee_amount || 0).toLocaleString()}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Payment</Text><Text style={styles.summaryValue}>Pay online</Text></View><View style={styles.sectionLine} /><View style={styles.summaryRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.total}>₱{total.toLocaleString()}</Text></View>{quote && <Text style={styles.quoteExpiry}>Price locked until {timeLabel(new Date(quote.expires_at))}</Text>}{quoteLoading && <ActivityIndicator size="small" color={C.teal} />}{quoteError ? <Text style={styles.quoteError}>{quoteError}</Text> : null}</View>
    </ScrollView><View style={styles.bookingStickyBar}><View style={styles.bookingStickySummary}><Text style={styles.bookingStickyLabel}>{selectedDate.day} {selectedDate.date} · {reservedWindow}</Text><Text style={styles.bookingStickyValue}>₱{total.toLocaleString()}</Text><Text numberOfLines={1} style={styles.bookingStickyMeta}>{selectedCourtIds.length} court{selectedCourtIds.length === 1 ? '' : 's'} · Pay online</Text></View>{selectedTimeBooked && selectedCourtIds.length === 1 && !scheduleLoading ? <PrimaryButton disabled={saving} icon="notifications-outline" onPress={() => onWaitlist({ courtId: selectedCourtIds[0], dateIso: selectedDateIso, time: selectedTime, duration })}>Join waitlist</PrimaryButton> : <PrimaryButton disabled={scheduleLoading || selectedTimeUnavailable || !quote || quoteLoading || saving} icon="checkmark" onPress={confirm}>{saving ? 'Securing…' : scheduleLoading ? 'Checking…' : !selectedTime ? 'Enter time' : selectedTimePast ? 'Choose time' : existingBooking ? 'Save change' : 'Confirm'}</PrimaryButton>}</View></View>
  );
}

function Success({ court, booking, onDone }) {
  const ticketColor = court.color || LIGHT_C.teal;
  const ticketTextColor = readableTextColor(ticketColor);
  const bookingReference = booking.reference || String(booking.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || 'CONFIRMED';
  const bookedCourts = booking.courtOptions?.length ? booking.courtOptions : [booking.courtOption];
  const courtNames = bookedCourts.filter(Boolean).map((item) => item.name).join(', ');
  const { start, end } = bookingDates(booking.dateIso, booking.time, booking.duration);
  const paymentMethodNames = { gcash: 'GCash', paymaya: 'Maya', card: 'Card', dob: 'Online bank' };
  const paidOnline = booking.checkout_completed || booking.payment_status === 'paid';
  const paymentCopy = paidOnline ? (paymentMethodNames[booking.payment_method] || 'Paid online') : paymentStatusLabel(booking.payment_status || 'pay_at_venue');
  const calendarUrl = () => {
    const { start, end } = bookingDates(booking.dateIso, booking.time, booking.duration);
    const stamp = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}00`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Pickleball at ${court.name}`)}&dates=${stamp(start)}/${stamp(end)}&details=${encodeURIComponent(`${courtNames} · ${booking.duration} minutes · ₱${booking.total.toLocaleString()}`)}&location=${encodeURIComponent(court.address)}`;
  };
  const shareBooking = () => Share.share({
    title: `Pickleball at ${court.name}`,
    message: `Join me for pickleball at ${court.name} (${courtNames}) on ${booking.date}, ${bookingWindow(booking.dateIso, booking.time, booking.duration)}.`,
  });
  return (
    <ScrollView contentContainerStyle={[styles.content, styles.successContent]} showsVerticalScrollIndicator={false}>
      <View style={styles.successHero}><View style={styles.successIcon}><Icon name="checkmark" size={32} color="#0E2321" /></View><Text style={styles.eyebrow}>BOOKING CONFIRMED</Text><Text style={styles.successTitle}>Court booked.</Text><Text style={styles.successLead}>Your reservation at {court.name} is ready.</Text></View>
      <View style={styles.ticket}>
        <View style={[styles.ticketTop, { backgroundColor: ticketColor }]}>
          <View style={styles.ticketTopRow}><View style={[styles.ticketStatus, { backgroundColor: ticketTextColor === LIGHT_C.ink ? 'rgba(14,35,33,0.12)' : 'rgba(255,255,255,0.18)' }]}><Icon name="checkmark-circle" size={14} color={ticketTextColor} /><Text style={[styles.ticketStatusText, { color: ticketTextColor }]}>CONFIRMED</Text></View><Text style={[styles.ticketReference, { color: ticketTextColor }]}>REF {bookingReference}</Text></View>
          <Text numberOfLines={1} style={[styles.ticketVenue, { color: ticketTextColor }]}>{court.name}</Text>
          <Text style={[styles.ticketCourt, { color: ticketTextColor }]}>{courtNames}</Text>
          <Text style={[styles.ticketCourtMeta, { color: ticketTextColor }]}>{bookedCourts.length} court{bookedCourts.length === 1 ? '' : 's'} · {booking.status || 'confirmed'}</Text>
        </View>
        <View style={styles.ticketBody}>
          <View style={styles.ticketWhen}><View style={styles.ticketWhenIcon}><Icon name="calendar-outline" size={20} color={C.teal} /></View><View style={styles.ticketWhenCopy}><Text style={styles.barLabel}>DATE &amp; TIME</Text><Text style={styles.ticketDate}>{booking.date}</Text><Text style={styles.ticketTime}>{timeLabel(start)} – {timeLabel(end)}</Text><Text style={styles.ticketTimezone}>ASIA/MANILA</Text></View></View>
          <View style={styles.ticketDivider} />
          <View style={styles.ticketDetails}>
            <View style={styles.ticketDetail}><Text style={styles.barLabel}>DURATION</Text><Text style={styles.ticketValue}>{booking.duration} min</Text></View>
            <View style={[styles.ticketDetail, styles.ticketDetailMiddle]}><Text style={styles.barLabel}>PAYMENT</Text><Text style={styles.ticketValue}>{paymentCopy}</Text></View>
            <View style={[styles.ticketDetail, styles.ticketDetailRight]}><Text style={styles.barLabel}>TOTAL</Text><Text style={styles.ticketValue}>₱{booking.total.toLocaleString()}</Text></View>
          </View>
        </View>
      </View>
      <View style={styles.infoCard}><Icon name="information-circle-outline" color={C.teal} /><View style={styles.infoCopy}><Text style={styles.infoTitle}>Court-time policy</Text><Text style={styles.bodySmall}>Please finish by {timeLabel(bookingDates(booking.dateIso, booking.time, booking.duration).end)}. Near the end, Peakle will offer a 30-minute extension if the court remains available.</Text></View></View>
      {booking.inviteTeam && <View style={styles.shared}><Icon name="people" color={C.teal} /><Text style={styles.sharedText}>{booking.teamName} has been invited.</Text></View>}
      <View style={styles.successActions}><Pressable accessibilityRole="link" onPress={() => Linking.openURL(calendarUrl())} style={({ pressed }) => [styles.calendarButton, pressed && styles.pressed]}><Icon name="calendar-outline" size={18} color={C.teal} /><Text style={styles.calendarText}>Add to calendar</Text></Pressable><Pressable accessibilityRole="button" onPress={shareBooking} style={({ pressed }) => [styles.calendarButton, pressed && styles.pressed]}><Icon name="share-social-outline" size={18} color={C.teal} /><Text style={styles.calendarText}>Share</Text></Pressable></View>
      <View style={styles.successDone}><PrimaryButton icon="home-outline" onPress={onDone}>Done</PrimaryButton></View>
    </ScrollView>
  );
}

export default function BookScreen({ route, navigation }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { userLocation } = useUserLocation();
  const { user } = useAuth();
  const { reportRealtime } = useOperations();
  const userBookingsCacheKey = bookingsCacheKey(user?.id || 'guest');
  const [venues, setVenues] = useState(() => peekCachedData(BOOKING_VENUES_CACHE_KEY) || []);
  const [venuesLoading, setVenuesLoading] = useState(() => peekCachedData(BOOKING_VENUES_CACHE_KEY) === null);
  const [venuesLoaded, setVenuesLoaded] = useState(() => peekCachedData(BOOKING_VENUES_CACHE_KEY) !== null);
  const [venuesError, setVenuesError] = useState('');
  const [venuesRequest, setVenuesRequest] = useState(0);
  const [bookings, setBookings] = useState(() => peekCachedData(userBookingsCacheKey) || []);
  const [bookingsLoading, setBookingsLoading] = useState(() => peekCachedData(userBookingsCacheKey) === null);
  const [bookingsLoadingMore, setBookingsLoadingMore] = useState(false);
  const [bookingsHistoryPage, setBookingsHistoryPage] = useState(0);
  const [hasMoreBookingHistory, setHasMoreBookingHistory] = useState(false);
  const [bookingsError, setBookingsError] = useState('');
  const [bookingsRequest, setBookingsRequest] = useState(0);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [joinedTeams, setJoinedTeams] = useState([]);
  const [rootView, setRootView] = useState('find');
  const [step, setStep] = useState('discover');
  const [court, setCourt] = useState(null);
  const [courtOption, setCourtOption] = useState(null);
  const [booking, setBooking] = useState(null);
  const [mapDestination, setMapDestination] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null);
  const [cancelAlert, setCancelAlert] = useState(null);
  const [savingBooking, setSavingBooking] = useState(false);
  const [checkoutBookingId, setCheckoutBookingId] = useState(null);
  const checkoutResolveRef = useRef(null);
  const completedCheckoutRef = useRef(null);
  const bookingRequestKey = useRef(null);
  const [openedFromHome, setOpenedFromHome] = useState(false);
  const venuesRef = useRef(venues);
  const bookingsRef = useRef(bookings);
  const realtimeRefreshTimer = useRef(null);
  useEffect(() => { venuesRef.current = venues; }, [venues]);
  useEffect(() => { bookingsRef.current = bookings; }, [bookings]);

  // Demo tour: browse -> court detail -> price-locked setup -> booking
  // confirmed, on a timer, bypassing the real checkout network calls.
  useFocusEffect(useCallback(() => {
    if (!DEMO_MODE) return undefined;
    let cancelled = false;
    const timers = [];
    timers.push(setTimeout(() => {
      if (cancelled) return;
      const venue = venuesRef.current[0];
      if (!venue) return;
      setRootView('find');
      setStep('discover');
      setCourt(null);
      setCourtOption(null);
      setBooking(null);
      setEditingBooking(null);
      const option = venue.courtOptions?.[0] || null;
      timers.push(setTimeout(() => { if (!cancelled) { setCourt(venue); setStep('detail'); } }, 3000));
      timers.push(setTimeout(() => { if (!cancelled) { setCourtOption(option); setStep('setup'); } }, 7000));
      timers.push(setTimeout(() => {
        if (cancelled) return;
        setBooking({ ...DEMO_BOOKING, courtOption: option });
        setStep('success');
      }, 11500));
    }, 800));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, []));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    (async () => {
      const cached = await readCachedData(BOOKING_VENUES_CACHE_KEY);
      if (!active) return;
      if (cached !== null && !venuesRef.current.length) {
        setVenues(cached);
        setVenuesLoaded(true);
      }
      setVenuesLoading(cached === null && !venuesRef.current.length);
      setVenuesError('');
      try {
        const rows = await listVenues({ signal: controller.signal });
        if (!active) return;
        const nextVenues = rows.map(presentVenue);
        setVenues(nextVenues);
        setVenuesLoaded(true);
        writeCachedData(BOOKING_VENUES_CACHE_KEY, nextVenues);
      } catch (error) {
        if (!active) return;
        setVenuesError(controller.signal.aborted ? 'The request took too long. Showing the last saved courts.' : (error.message || 'Check your connection and try again.'));
      } finally {
        clearTimeout(timeout);
        if (active) setVenuesLoading(false);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [venuesRequest]);
  useEffect(() => {
    listTeams().then((teams) => setJoinedTeams(teams.filter((team) => team.role))).catch(() => setJoinedTeams([]));
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      const cached = await readCachedData(userBookingsCacheKey);
      if (!active) return;
      if (cached !== null && !bookingsRef.current.length) setBookings(cached);
      setBookingsLoading(cached === null && !bookingsRef.current.length);
      setBookingsLoadingMore(false);
      setBookingsError('');
      try {
        const result = await withTimeout(
          listMyBookingsPage({ signal: controller.signal }),
          12000,
          'Bookings took too long to refresh.',
        );
        if (!active) return;
        const nextBookings = result.bookings || [];
        setBookings(nextBookings);
        setBookingsHistoryPage(0);
        setHasMoreBookingHistory(result.hasMoreHistory);
        writeCachedData(userBookingsCacheKey, nextBookings);
      } catch (error) {
        if (active) setBookingsError(`${error.message || 'Check your connection and try again.'}${bookingsRef.current.length ? ' Showing your last saved bookings.' : ''}`);
      } finally {
        if (active) setBookingsLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [bookingsRequest, userBookingsCacheKey]);
  useEffect(() => navigation.addListener('focus', () => setBookingsRequest((request) => request + 1)), [navigation]);
  useEffect(() => {
    if (!route.params?.findCourtsToken) return;
    setRootView('find');
    setStep('discover');
    setCourt(null);
    setCourtOption(null);
    setBooking(null);
    setEditingBooking(null);
    setOpenedFromHome(false);
    navigation.setParams({ findCourtsToken: undefined });
  }, [route.params?.findCourtsToken, navigation]);
  useEffect(() => {
    const client = requireSupabase();
    let active = true;
    let availabilityChannel = null;
    const channel = client.channel('booking-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${user.id}` }, () => {
        clearTimeout(realtimeRefreshTimer.current);
        realtimeRefreshTimer.current = setTimeout(() => setBookingsRequest((value) => value + 1), 180);
        setAvailabilityVersion((value) => value + 1);
      })
      .subscribe((status) => reportRealtime(`bookings-${user.id}`, status));
    client.from('court_availability_events').select('scope').limit(1).then(({ error }) => {
      if (!active || error) return;
      availabilityChannel = client.channel(`court-availability-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'court_availability_events' }, () => setAvailabilityVersion((value) => value + 1))
        .subscribe((status) => reportRealtime(`court-availability-${user.id}`, status));
    });
    return () => {
      active = false;
      clearTimeout(realtimeRefreshTimer.current);
      client.removeChannel(channel);
      reportRealtime(`bookings-${user.id}`, 'REMOVE');
      if (availabilityChannel) {
        client.removeChannel(availabilityChannel);
        reportRealtime(`court-availability-${user.id}`, 'REMOVE');
      }
    };
  }, [reportRealtime, user.id]);
  const selectCourt = (selected) => { setCourt(selected); setCourtOption(null); setStep('detail'); };
  const activeCourt = useMemo(() => {
    if (!court) return null;
    const distanceKm = distanceInKm(userLocation, court);
    return {
      ...court,
      distanceKm,
      distance: formatDistance(distanceKm),
    };
  }, [court, userLocation]);
  useEffect(() => {
    const id = route.params?.courtId;
    if (!id || !venuesLoaded) return;
    const selected = venues.find((item) => item.id === id);
    if (selected) { setRootView('find'); setCourt(selected); setCourtOption(null); setStep('detail'); setOpenedFromHome(route.params?.from === 'Home'); }
    navigation.setParams({ courtId: undefined, from: undefined });
  }, [route.params?.courtId, route.params?.from, navigation, venues, venuesLoaded]);
  const backFromDetail = () => {
    setStep('discover');
    setCourt(null);
    if (openedFromHome) { setOpenedFromHome(false); navigation.navigate('Home'); }
  };
  const runInAppCheckout = (bookingId) => new Promise((resolve) => {
    checkoutResolveRef.current = resolve;
    setCheckoutBookingId(bookingId);
  });
  const handleCheckoutDone = (status) => {
    if (status === 'success') completedCheckoutRef.current = checkoutBookingId;
    setCheckoutBookingId(null);
    const resolve = checkoutResolveRef.current;
    checkoutResolveRef.current = null;
    if (resolve) resolve(status);
  };
  const showPersistedBookingConfirmation = useCallback((data) => {
    const startsAt = new Date(data.starts_at);
    const endsAt = new Date(data.ends_at);
    const returnedCourtOption = {
      id: data.courts?.id || data.court_id,
      name: data.courts?.name || 'Court',
      environment: data.courts?.environment,
      surface: data.courts?.surface,
      price: Number(data.courts?.hourly_price || data.amount || 0),
    };
    setCourt({
      id: data.venue_id,
      name: data.venues?.name || 'Venue',
      area: data.venues?.area,
      address: data.venues?.address || '',
      color: data.venues?.color || LIGHT_C.teal,
      timeZone: data.venues?.time_zone || 'Asia/Manila',
      courtOptions: [returnedCourtOption],
    });
    setBooking({
      ...data,
      date: reservationDate(startsAt),
      dateIso: manilaDateIso(startsAt),
      time: timeLabel(startsAt),
      duration: Math.max(1, Math.round((endsAt - startsAt) / 60_000)),
      total: Number(data.amount || 0),
      courtOption: returnedCourtOption,
      courtOptions: [returnedCourtOption],
      status: 'confirmed',
      checkout_completed: true,
    });
    setStep('success');
  }, []);
  useEffect(() => {
    const returnedBookingId = route.params?.paymentBookingId;
    if (!returnedBookingId) return undefined;
    const returnedStatus = String(route.params?.status || 'unknown').toLowerCase();
    if (returnedStatus === 'success' && returnedBookingId === completedCheckoutRef.current) {
      navigation.setParams({ paymentBookingId: undefined, status: undefined });
      return undefined;
    }
    if (returnedBookingId === checkoutBookingId && checkoutResolveRef.current) {
      handleCheckoutDone(returnedStatus);
      navigation.setParams({ paymentBookingId: undefined, status: undefined });
      return undefined;
    }
    if (returnedStatus !== 'success') {
      setRootView('bookings');
      setStep('discover');
      setBookingsRequest((request) => request + 1);
      navigation.setParams({ paymentBookingId: undefined, status: undefined });
      return undefined;
    }
    let active = true;
    (async () => {
      const { data } = await requireSupabase()
        .from('bookings')
        .select('*, venues(name, area, address, color, time_zone), courts(id, name, environment, surface, hourly_price)')
        .eq('id', returnedBookingId)
        .maybeSingle();
      if (!active) return;
      if (!data) {
        setRootView('bookings');
        setStep('discover');
        setBookingsRequest((request) => request + 1);
      } else {
        showPersistedBookingConfirmation(data);
      }
      navigation.setParams({ paymentBookingId: undefined, status: undefined });
    })();
    return () => { active = false; };
  }, [checkoutBookingId, navigation, route.params?.paymentBookingId, route.params?.status, showPersistedBookingConfirmation]);
  const confirmBooking = async (value) => {
    if (savingBooking || !value.quote) return;
    setSavingBooking(true);
    try {
      if (editingBooking) {
        const saved = await modifyBooking({ bookingId: editingBooking.id, quoteId: value.quote.id, expectedRevision: editingBooking.revision || 1 });
        setBooking({ ...value, ...saved, courtOptions: value.courtOptions, status: saved.status || 'confirmed' });
        setEditingBooking(null);
      } else {
        if (bookingRequestKey.current?.quoteId !== value.quote.id) {
          bookingRequestKey.current = { quoteId: value.quote.id, key: Crypto.randomUUID() };
        }
        const result = await createMultiCourtBooking({
          quoteId: value.quote.id, inviteTeam: value.inviteTeam, teamId: value.teamId,
          idempotencyKey: bookingRequestKey.current.key,
        });
        let saved = result.bookings[0] || {};
        bookingRequestKey.current = null;
        if (saved.payment_status === 'awaiting_payment' && saved.id) {
          try {
            const checkoutStatus = await runInAppCheckout(saved.id);
            if (checkoutStatus !== 'success') {
              setBookingsRequest((request) => request + 1);
              setRootView('bookings');
              setStep('discover');
              setCourt(null);
              setCourtOption(null);
              Alert.alert('Payment not completed', 'Your booking was not confirmed. You can review its payment status in My Bookings.');
              return;
            }
            const refreshed = await waitForBookingPayment(saved.id, { attempts: 1, intervalMs: 0 });
            if (refreshed) saved = refreshed;
            saved = { ...saved, status: 'confirmed', checkout_completed: true };
          } catch (checkoutError) {
            Alert.alert('Payment not completed', checkoutError.message || 'You can finish paying from My Bookings.');
          }
        }
        setBooking({ ...value, ...saved, courtOptions: value.courtOptions, status: saved.status || 'confirmed' });
      }
      setBookingsRequest((request) => request + 1);
      setStep('success');
    } catch (error) {
      Alert.alert('Booking not saved', error.message || 'Please check your connection and try again.');
    } finally {
      setSavingBooking(false);
    }
  };
  const waitlist = async (details) => {
    setSavingBooking(true);
    try {
      await joinCourtWaitlist(details);
      Alert.alert('Waitlist joined', 'Peakle will notify you when this court opens. The offer is held for 15 minutes.');
    } catch (error) {
      Alert.alert('Waitlist not saved', error.message || 'Please try again.');
    } finally { setSavingBooking(false); }
  };
  const resumeReservationPayment = async (reservation) => {
    if (!reservation?.id || checkoutBookingId) return;
    try {
      const checkoutStatus = await runInAppCheckout(reservation.id);
      if (checkoutStatus !== 'success') {
        setBookingsRequest((value) => value + 1);
        return;
      }
      const refreshed = await waitForBookingPayment(reservation.id, { attempts: 5, intervalMs: 1000 });
      showPersistedBookingConfirmation({ ...reservation, ...(refreshed || {}) });
      setBookingsRequest((value) => value + 1);
    } catch (error) {
      Alert.alert('Could not continue payment', error.message || 'Please check your connection and try again.');
    }
  };
  const cancelReservation = (reservation) => {
    const unpaid = reservation.payment_status === 'awaiting_payment' && reservation.status === 'pending';
    setCancelAlert({ reservation, unpaid });
  };
  const changeReservation = (reservation) => {
    const selectedVenue = venues.find((item) => item.id === reservation.venue_id);
    const selectedOption = selectedVenue?.courtOptions.find((item) => item.id === reservation.court_id);
    if (!selectedVenue || !selectedOption) { Alert.alert('Court unavailable', 'Refresh venues and try again.'); return; }
    setCourt(selectedVenue); setCourtOption(selectedOption); setEditingBooking(reservation); setStep('setup');
  };
  const loadOlderBookings = async () => {
    if (bookingsLoading || bookingsLoadingMore || !hasMoreBookingHistory) return;
    const nextPage = bookingsHistoryPage + 1;
    setBookingsLoadingMore(true);
    try {
      const result = await listMyBookingsPage({ historyPage: nextPage });
      setBookings((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...(result.bookings || []).filter((item) => !seen.has(item.id))];
      });
      setBookingsHistoryPage(nextPage);
      setHasMoreBookingHistory(result.hasMoreHistory);
    } catch (error) {
      setBookingsError(error.message || 'Older bookings could not be loaded.');
    } finally {
      setBookingsLoadingMore(false);
    }
  };
  const finishBookingSuccess = () => {
    const returnToPlay = Boolean(route.params?.returnToPlay);
    setRootView('bookings');
    setStep('discover');
    setCourt(null);
    setCourtOption(null);
    setBooking(null);
    setEditingBooking(null);
    setOpenedFromHome(false);
    if (returnToPlay) {
      navigation.setParams({ returnToPlay: undefined, findCourtsToken: undefined });
      navigation.navigate('Play');
    }
  };
  const openMaps = (destination) => setMapDestination(destination);
  return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />{step === 'discover' && rootView === 'find' && <Discovery courts={venues} loading={venuesLoading} error={venuesError} onRetry={() => setVenuesRequest((value) => value + 1)} onShowBookings={() => setRootView('bookings')} onShowEvents={() => navigation.navigate('Pickleball', { openTab: 'Compete', ownerTab: 'Book' })} onSelect={(selected) => { setOpenedFromHome(false); setEditingBooking(null); selectCourt(selected); }} />}{step === 'discover' && rootView === 'bookings' && <MyBookings bookings={bookings} loading={bookingsLoading} loadingMore={bookingsLoadingMore} hasMoreHistory={hasMoreBookingHistory} error={bookingsError} onRetry={() => setBookingsRequest((value) => value + 1)} onLoadMore={loadOlderBookings} onFindCourts={() => setRootView('find')} onOpenMaps={openMaps} onCancel={cancelReservation} onModify={changeReservation} onPay={resumeReservationPayment} onViewLastMatch={() => navigation.navigate('Profile', { openTab: 'Matches', openTabToken: Date.now(), openMatchId: 'latest' })} />}{step === 'detail' && activeCourt && <CourtDetail court={activeCourt} onBack={backFromDetail} onBook={(option) => { setCourtOption(option); setEditingBooking(null); setStep('setup'); }} onOpenMaps={openMaps} />}{step === 'setup' && activeCourt && courtOption && <Setup court={activeCourt} courtOption={courtOption} teams={joinedTeams} existingBooking={editingBooking} saving={savingBooking} availabilityVersion={availabilityVersion} onBack={() => { setEditingBooking(null); setStep(editingBooking ? 'discover' : 'detail'); }} onConfirm={confirmBooking} onWaitlist={waitlist} />}{step === 'success' && activeCourt && booking && <Success court={activeCourt} booking={booking} onDone={finishBookingSuccess} />}<MapOptionsSheet destination={mapDestination} onClose={() => setMapDestination(null)} /><PaymentCheckoutModal bookingId={checkoutBookingId} onDone={handleCheckoutDone} /><Modal visible={Boolean(cancelAlert)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setCancelAlert(null)}><View {...webDialog('backdrop')} style={styles.alertOverlay}><View {...webDialog('surface')} style={styles.alertCard}><Text style={styles.alertTitle}>{cancelAlert?.unpaid ? 'Cancel this payment hold?' : 'Cancel this booking?'}</Text><Text style={styles.alertMessage}>{cancelAlert?.unpaid ? 'No payment was collected. The court will be released immediately.' : 'The court will be released and the next waitlisted player may be notified.'}</Text><View style={styles.alertActions}><Pressable accessibilityRole="button" onPress={() => setCancelAlert(null)} style={({ pressed }) => [styles.alertButton, styles.alertKeep, pressed && styles.pressed]}><Text style={styles.alertKeepText}>Keep booking</Text></Pressable><Pressable accessibilityRole="button" onPress={async () => { const { reservation, unpaid } = cancelAlert; setCancelAlert(null); try { if (unpaid) await cancelUnpaidBooking(reservation.id, reservation.revision || 1); else await cancelBooking(reservation.id, reservation.revision || 1, 'Cancelled by player'); setBookingsRequest((value) => value + 1); } catch (error) { Alert.alert('Could not cancel', error.message || 'Please try again.'); } }} style={({ pressed }) => [styles.alertButton, styles.alertCancel, pressed && styles.pressed]}><Text style={styles.alertCancelText}>{cancelAlert?.unpaid ? 'Release court' : 'Cancel booking'}</Text></Pressable></View></View></View></Modal></SafeAreaView>;
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const lightStyles = createMobileStyleSheet({
  safe: { flex: 1, backgroundColor: C.paper }, flex: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 126 }, setupScreen: { flex: 1 }, setupContent: { paddingBottom: 28 }, bookingStickyBar: { paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, bookingStickySummary: { width: 122, flexShrink: 0 }, bookingStickyLabel: { color: C.ink40, fontSize: 8, fontWeight: '800' }, bookingStickyValue: { marginTop: 2, color: C.ink, fontSize: 19, fontWeight: '900' }, bookingStickyMeta: { marginTop: 1, color: C.ink40, fontSize: 7 },
  pastBookingModalSafe: { flex: 1, backgroundColor: C.paper }, pastBookingModalHead: { minHeight: 76, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: C.line, backgroundColor: C.surface }, pastBookingModalTitle: { marginTop: 1, color: C.ink, fontSize: 24, lineHeight: 30, fontWeight: '900', letterSpacing: -.5 }, pastBookingModalClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, pastBookingModalScroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 36 }, pastBookingModalIntro: { marginBottom: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, backgroundColor: '#E5F0ED' }, pastBookingModalIntroIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.optic }, pastBookingModalIntroTitle: { marginBottom: 3, color: C.ink, fontSize: 13, fontWeight: '900' }, pastBookingDone: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.ink }, pastBookingDoneText: { color: C.surface, fontSize: 13, fontWeight: '900' },
  mapModal: { flex: 1, justifyContent: 'flex-end' }, mapBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,18,17,0.58)' }, mapSheetSafe: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28 }, mapSheet: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: C.surface }, mapSheetHandle: { width: 42, height: 5, marginBottom: 18, alignSelf: 'center', borderRadius: 3, backgroundColor: C.line }, mapSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, mapSheetIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.optic }, mapSheetEyebrow: { color: C.teal, fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 1 }, mapSheetTitle: { marginTop: 1, color: C.ink, fontSize: 18, lineHeight: 23, fontWeight: '900' }, mapSheetAddress: { marginTop: 2, color: C.ink40, fontSize: 10, lineHeight: 14 }, mapSheetClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: C.paper }, mapSheetPrompt: { marginTop: 22, marginBottom: 8, color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: .8 }, mapSheetLoading: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, mapProvider: { minHeight: 66, marginBottom: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, mapProviderIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.surface }, mapProviderName: { color: C.ink, fontSize: 13, fontWeight: '900' }, mapProviderMeta: { marginTop: 2, color: C.ink40, fontSize: 9 }, mapCancelButton: { minHeight: 48, marginTop: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.ink }, mapCancelText: { color: C.surface, fontSize: 12, fontWeight: '900' }, checkoutSafe: { flex: 1, backgroundColor: C.surface }, checkoutHeader: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line }, checkoutTitle: { color: C.ink, fontSize: 15, fontWeight: '900' }, checkoutWebview: { flex: 1 }, checkoutLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }, checkoutMethods: { padding: 16 }, checkoutError: { marginBottom: 12, color: C.brick, fontSize: 11, fontWeight: '700' }, paymentIconFrame: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 11, backgroundColor: C.surface }, paymentBrandIcon: { width: 34, height: 34, borderRadius: 9 }, paymentIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, cardIcon: { backgroundColor: '#2354A2' }, bankIcon: { backgroundColor: '#6844B8' },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }, headerCompact: { gap: 8 }, headerCopy: { flex: 1, minWidth: 0 }, headerTitleCompact: { fontSize: 20, lineHeight: 25, letterSpacing: -0.35 }, eyebrow: { marginBottom: 1, color: C.ink40, fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: .9 }, h1: { color: C.ink, fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -0.45 }, h2: { color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerCourtDivider: { height: 7, marginTop: 9, marginBottom: 14 }, headerCourtLine: { height: 2, backgroundColor: C.ink }, headerCourtDash: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 },
  headerLocationAction: { maxWidth: '48%', minHeight: 40, paddingLeft: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }, headerLocationButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, headerLocationText: { flexShrink: 1, color: C.teal, fontSize: 10, fontWeight: '800' }, iconButton: { width: 40, height: 40, flexShrink: 0, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  bookingTabs: { marginBottom: 16, padding: 4, flexDirection: 'row', gap: 4, borderRadius: 14, backgroundColor: '#E7EBE6' }, bookingTab: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11 }, bookingTabActive: { backgroundColor: C.optic }, bookingTabText: { color: C.ink40, fontSize: 11, fontWeight: '800' }, bookingTabTextActive: { color: '#000000' }, eventEntry: { minHeight: 76, marginBottom: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface }, eventEntryIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, eventEntryCopy: { flex: 1, minWidth: 0 }, eventEntryEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, eventEntryTitle: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, eventEntryMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  search: { height: 52, paddingLeft: 15, paddingRight: 6, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, searchInput: { flex: 1, marginLeft: 9, color: C.ink, fontSize: 14, letterSpacing: 0 }, clearSearchButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper },
  filterRow: { gap: 8, paddingVertical: 14 }, filterChip: { minHeight: 36, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, filterChipActive: { backgroundColor: C.ink, borderColor: C.ink }, filterText: { color: C.ink70, fontSize: 11, fontWeight: '700' }, filterTextActive: { color: C.paper }, resultsHead: { marginTop: 6, marginBottom: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }, resultsCopy: { flex: 1 }, mapLink: { minHeight: 40, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }, mapText: { color: C.teal, fontSize: 10, fontWeight: '800' },
  loadState: { paddingVertical: 70, alignItems: 'center', gap: 12 }, retryButton: { minHeight: 42, marginTop: 18, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic }, retryText: { color: C.ink, fontSize: 11, fontWeight: '800' },
  bookingWarning: { marginBottom: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#F7EAE6' }, bookingWarningText: { flex: 1, color: C.brick, fontSize: 10, fontWeight: '700' }, bookingSectionHead: { marginTop: 10, marginBottom: 13, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, bookingCount: { minWidth: 28, height: 28, paddingHorizontal: 8, overflow: 'hidden', borderRadius: 14, color: C.teal, backgroundColor: '#E5F0ED', fontSize: 11, lineHeight: 28, fontWeight: '900', textAlign: 'center' }, bookingListFooter: { paddingVertical: 22, alignItems: 'center', gap: 8 },
  reservationCard: { marginBottom: 16, overflow: 'hidden', borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, reservationTop: { minHeight: 76, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, reservationMark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(14,35,33,0.25)' }, reservationTitleCopy: { flex: 1 }, reservationVenue: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' }, reservationCourt: { marginTop: 3, color: 'rgba(255,255,255,0.72)', fontSize: 9, fontWeight: '700' }, statusPill: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 }, statusText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.65 }, reservationExpandIcon: { marginLeft: 2, alignItems: 'center', justifyContent: 'center' }, reservationBody: { paddingHorizontal: 14 }, reservationCompactBody: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, reservationCompactDate: { color: C.ink, fontSize: 12, fontWeight: '800' }, reservationCompactTime: { marginTop: 1, color: C.ink70, fontSize: 11, fontWeight: '700' }, reservationCompactTotal: { color: C.ink, fontSize: 15, fontWeight: '900' }, reservationSchedule: { minHeight: 102, flexDirection: 'row', alignItems: 'center', gap: 11 }, reservationDateBox: { width: 50, height: 59, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.paper }, reservationMonth: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 }, reservationDay: { marginTop: 1, color: C.ink, fontSize: 23, lineHeight: 25, fontWeight: '900' }, reservationWhen: { flex: 1 }, reservationDateLabel: { color: C.ink, fontSize: 12, fontWeight: '800' }, reservationTime: { marginTop: 3, color: C.ink70, fontSize: 11, fontWeight: '700' }, reservationZone: { marginTop: 4, color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: 0.6 }, reservationPrice: { alignItems: 'flex-end' }, reservationAmount: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '900' }, paymentLabel: { marginTop: 2, color: C.ink40, fontSize: 7 }, refundLabel: { marginTop: 2, color: C.ink40, fontSize: 6 }, reservationActions: { minHeight: 48, flexDirection: 'row', borderTopWidth: 1, borderColor: C.line }, reservationAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, reservationActionText: { color: C.teal, fontSize: 9, fontWeight: '800' }, actionDivider: { width: 1, marginVertical: 10, backgroundColor: C.line }, manageActions: { paddingVertical: 10, flexDirection: 'row', gap: 8, borderTopWidth: 1, borderColor: C.line }, manageButton: { minHeight: 38, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, backgroundColor: '#E5F0ED' }, cancelButton: { backgroundColor: '#F7EAE6' }, manageText: { color: C.teal, fontSize: 9, fontWeight: '900' }, cancelText: { color: C.brick }, paymentDueNotice: { marginBottom: 10, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#FFF1C9' }, paymentDueTitle: { color: '#674600', fontSize: 10, fontWeight: '900' }, paymentDueText: { marginTop: 2, color: '#835A00', fontSize: 8, lineHeight: 12 }, pendingPaymentActions: { paddingBottom: 12, flexDirection: 'row', gap: 8 }, payNowButton: { minHeight: 44, flex: 1.45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, backgroundColor: C.optic }, payNowText: { color: '#0E2321', fontSize: 11, fontWeight: '900' }, pendingCancelButton: { minHeight: 44, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, backgroundColor: '#F7EAE6' }, pendingCancelText: { color: C.brick, fontSize: 10, fontWeight: '900' },
  courtCard: { marginBottom: 14, overflow: 'hidden', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, courtArt: { height: 132, overflow: 'hidden' }, courtArtLarge: { height: 215, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }, courtLines: { position: 'absolute', left: '16%', right: '16%', top: 17, bottom: -35, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', transform: [{ perspective: 260 }, { rotateX: '35deg' }] }, centerLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, backgroundColor: 'rgba(255,255,255,0.55)' }, crossLine: { position: 'absolute', left: 0, right: 0, top: '30%', height: 2, backgroundColor: 'rgba(255,255,255,0.55)' }, crossLineTwo: { top: '72%' }, availableBadge: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 7, backgroundColor: 'rgba(14,35,33,0.82)' }, availableDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.optic }, availableText: { color: C.surface, fontSize: 8, fontWeight: '800', letterSpacing: .7 },
  cardBody: { padding: 14 }, cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, cardTitle: { flex: 1, color: C.ink, fontSize: 17, fontWeight: '800' }, price: { color: C.teal, fontSize: 16, fontWeight: '800' }, perHour: { color: C.ink40, fontSize: 9, fontWeight: '500' }, meta: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }, metaText: { color: C.ink40, fontSize: 11 }, tags: { marginTop: 11, flexDirection: 'row', gap: 6 }, tag: { paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden', borderRadius: 7, color: C.ink70, backgroundColor: C.paper, fontSize: 9, fontWeight: '800' }, rating: { color: C.teal }, pressed: { opacity: .78, transform: [{ scale: .985 }] }, empty: { paddingVertical: 70, alignItems: 'center' }, emptyTitle: { marginTop: 12, color: C.ink, fontSize: 18, fontWeight: '800' }, emptyText: { marginTop: 5, color: C.ink40, fontSize: 12 },
  detailTop: { marginTop: 18, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, detailName: { flex: 1 }, savedButton: { borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, body: { color: C.ink70, fontSize: 13, lineHeight: 19 }, bodySmall: { color: C.ink40, fontSize: 11, lineHeight: 16 }, ratingRow: { marginTop: 18, padding: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface }, ratingBadge: { flex: 1.5 }, ratingBig: { color: C.ink, fontSize: 25, lineHeight: 27, fontWeight: '800' }, ratingCaption: { marginTop: 2, color: C.teal, fontSize: 9, fontWeight: '800' }, detailStat: { flex: 1, alignItems: 'center', borderLeftWidth: 1, borderColor: C.line }, detailNumber: { color: C.ink, fontSize: 17, fontWeight: '800' }, detailLabel: { marginTop: 2, color: C.ink40, fontSize: 8, fontWeight: '800', letterSpacing: .7 }, courtDescription: { marginTop: 16, color: C.ink70, fontSize: 12, lineHeight: 18 }, venueFacts: { marginTop: 14, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, venueFact: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderColor: C.line }, venueFactCopy: { flex: 1 }, venueFactLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, venueFactValue: { marginTop: 3, color: C.ink, fontSize: 10, fontWeight: '700' }, directionsButton: { minHeight: 45, marginTop: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, directionsText: { color: C.teal, fontSize: 10, fontWeight: '800' }, courtChoiceHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }, courtChoiceTitle: { marginTop: 2, color: C.ink, fontSize: 17, fontWeight: '800' }, courtChoiceCount: { color: C.teal, fontSize: 9, fontWeight: '800' }, courtOptions: { gap: 9, paddingTop: 11, paddingRight: 20 }, courtOption: { width: 164, minHeight: 128, padding: 12, overflow: 'hidden', borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, courtOptionActive: { borderWidth: 2, borderColor: C.teal, backgroundColor: '#F6FAF8' }, courtOptionUnavailable: { opacity: .52, backgroundColor: '#E9ECE7' }, courtOptionImage: { height: 76, marginHorizontal: -12, marginTop: -12, marginBottom: 10 }, courtOptionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, courtOptionName: { color: C.ink, fontSize: 12, fontWeight: '800' }, courtOptionNameActive: { color: C.teal }, courtOptionMeta: { minHeight: 27, marginTop: 5, color: C.ink40, fontSize: 8, lineHeight: 12 }, courtOptionStatus: { marginTop: 5, color: C.teal, fontSize: 8, fontWeight: '800' }, courtOptionStatusBusy: { color: C.brick }, courtOptionPrice: { marginTop: 'auto', color: C.ink, fontSize: 15, fontWeight: '900' }, sectionLine: { marginVertical: 20, height: 1, backgroundColor: C.line }, amenities: { marginTop: 11, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, amenity: { width: '48%', minHeight: 48, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, amenityText: { flex: 1, color: C.ink70, fontSize: 11, fontWeight: '700' }, infoCard: { marginTop: 18, padding: 14, flexDirection: 'row', gap: 10, borderRadius: 14, backgroundColor: '#E5F0ED' }, infoCopy: { flex: 1 }, infoTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, bookBar: { marginTop: 22, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, barLabel: { color: C.ink40, fontSize: 8, fontWeight: '800', letterSpacing: .8 }, barPrice: { color: C.ink, fontSize: 19, fontWeight: '800' },
  primary: { minHeight: 52, paddingHorizontal: 18, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: C.optic }, primaryText: { color: C.ink, fontSize: 13, fontWeight: '800' }, disabled: { opacity: .4 }, compactCourt: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface }, compactSwatch: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, compactCopy: { flex: 1 }, compactName: { color: C.ink, fontSize: 13, fontWeight: '800' }, compactPrice: { color: C.teal, fontSize: 11, fontWeight: '800' }, sectionLabel: { marginTop: 24, marginBottom: 10, color: C.ink, fontSize: 10, fontWeight: '800', letterSpacing: .9 }, multiCourtGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, multiCourt: { width: '48.7%', minHeight: 58, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, multiCourtActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, multiCourtName: { color: C.ink, fontSize: 10, fontWeight: '900' }, multiCourtPrice: { marginTop: 2, color: C.ink40, fontSize: 8 }, calendarCard: { padding: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, calendarHeader: { minHeight: 44, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, calendarCopy: { flex: 1 }, calendarMonth: { color: C.ink, fontSize: 13, fontWeight: '900' }, calendarSelected: { marginTop: 2, color: C.ink40, fontSize: 9, fontWeight: '600' }, calendarNav: { flexDirection: 'row', gap: 6 }, calendarNavButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, calendarNavDisabled: { opacity: .35 }, dateRow: { flexDirection: 'row', gap: 4 }, date: { minWidth: 0, height: 68, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, dateActive: { backgroundColor: C.ink, borderColor: C.ink }, dateDay: { color: C.ink40, fontSize: 7, fontWeight: '900' }, dateNumber: { marginTop: 3, color: C.ink, fontSize: 18, lineHeight: 21, fontWeight: '900' }, dateTextActive: { color: C.paper }, dateDot: { width: 4, height: 4, marginTop: 5, borderRadius: 2, backgroundColor: 'transparent' }, dateDotToday: { backgroundColor: C.teal }, dateDotTodayActive: { backgroundColor: C.optic }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, availabilityMeta: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 5 }, timeZone: { color: C.ink40, fontSize: 9 }, timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, time: { width: '48.7%', height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, timeActive: { borderColor: C.optic, backgroundColor: C.optic }, timeBooked: { backgroundColor: '#E9ECE7' }, timeText: { color: C.ink, fontSize: 11, fontWeight: '800' }, timeTextActive: { color: C.ink }, timeTextBooked: { color: C.ink40 }, bookedText: { color: C.ink40, fontSize: 6, fontWeight: '800', letterSpacing: .6 }, customTimeToggle: { minHeight: 62, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, customTimeToggleActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, customTimeIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, customTimeTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, customTimeMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 11 }, customTimeCard: { marginTop: 8, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, customTimeFieldLabel: { marginBottom: 9, color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, customTimeControls: { flexDirection: 'row', alignItems: 'center', gap: 7 }, customTimeField: { width: 66, minHeight: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, customTimeInput: { width: '100%', padding: 0, color: C.ink, textAlign: 'center', fontSize: 21, lineHeight: 25, fontWeight: '900' }, customTimeUnit: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .6 }, customTimeColon: { color: C.ink, fontSize: 22, fontWeight: '900' }, customPeriod: { height: 62, flex: 1, padding: 4, flexDirection: 'row', alignItems: 'stretch', borderRadius: 11, backgroundColor: '#E7EBE6' }, customPeriodOption: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }, customPeriodOptionActive: { backgroundColor: C.ink }, customPeriodText: { color: C.ink40, fontSize: 11, fontWeight: '900' }, customPeriodTextActive: { color: C.surface }, customTimeHint: { marginTop: 9, color: C.teal, fontSize: 8, fontWeight: '700' }, customTimeError: { marginTop: 9, color: C.brick, fontSize: 8, fontWeight: '700' }, segment: { padding: 4, flexDirection: 'row', borderRadius: 12, backgroundColor: '#E7EBE6' }, segmentItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, segmentActive: { backgroundColor: C.optic, ...shadow }, segmentText: { color: C.ink40, fontSize: 11, fontWeight: '700' }, segmentTextActive: { color: C.ink }, inviteRow: { marginTop: 18, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, inviteRowDisabled: { opacity: .65 }, inviteIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#E5F0ED' }, inviteCopy: { flex: 1 }, inviteTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, toggle: { width: 43, height: 25, padding: 3, borderRadius: 13, backgroundColor: C.line }, toggleOn: { backgroundColor: C.optic }, toggleKnob: { width: 19, height: 19, borderRadius: 10, backgroundColor: C.surface }, toggleKnobOn: { alignSelf: 'flex-end' }, teamChoices: { gap: 8, paddingTop: 9, paddingRight: 20 }, teamChoice: { maxWidth: 180, minHeight: 36, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, teamChoiceActive: { borderColor: C.teal, backgroundColor: C.teal }, teamChoiceText: { flexShrink: 1, color: C.teal, fontSize: 10, fontWeight: '800' }, teamChoiceTextActive: { color: C.surface }, promoInput: { minHeight: 48, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: C.line, color: C.ink, backgroundColor: C.surface, fontSize: 11, fontWeight: '800' }, summary: { marginVertical: 18, padding: 16, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, summaryTitle: { marginBottom: 13, color: C.ink, fontSize: 16, fontWeight: '800' }, summaryRow: { marginVertical: 5, flexDirection: 'row', justifyContent: 'space-between', gap: 15 }, summaryValue: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '700', textAlign: 'right' }, totalLabel: { color: C.ink, fontSize: 15, fontWeight: '800' }, total: { color: C.ink, fontSize: 20, fontWeight: '800' }, quoteExpiry: { marginTop: 9, color: C.teal, fontSize: 8, fontWeight: '900', textAlign: 'right' }, quoteError: { marginTop: 9, color: C.brick, fontSize: 8, lineHeight: 12 }, terms: { marginTop: 9, color: C.ink40, textAlign: 'center', fontSize: 9 },
  successContent: { alignItems: 'stretch', paddingTop: 28, paddingBottom: 38 }, successHero: { alignItems: 'center' }, successIcon: { width: 66, height: 66, marginBottom: 14, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, successTitle: { marginTop: 3, color: C.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -.8, textAlign: 'center' }, successLead: { maxWidth: 310, marginTop: 5, color: C.ink40, fontSize: 12, lineHeight: 18, textAlign: 'center' }, ticket: { width: '100%', marginTop: 22, overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, ticketTop: { padding: 17 }, ticketTopRow: { marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, ticketStatus: { minHeight: 28, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14 }, ticketStatusText: { fontSize: 8, fontWeight: '900', letterSpacing: .7 }, ticketReference: { flexShrink: 1, fontSize: 8, fontWeight: '900', letterSpacing: .8, opacity: .76 }, ticketVenue: { fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: .8, opacity: .72, textTransform: 'uppercase' }, ticketCourt: { marginTop: 3, fontSize: 21, lineHeight: 27, fontWeight: '900' }, ticketCourtMeta: { marginTop: 2, fontSize: 10, lineHeight: 15, fontWeight: '600', opacity: .72 }, ticketBody: { padding: 17, backgroundColor: C.surface }, ticketWhen: { flexDirection: 'row', alignItems: 'center', gap: 12 }, ticketWhenIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.paper }, ticketWhenCopy: { flex: 1 }, ticketDate: { marginTop: 3, color: C.ink, fontSize: 15, lineHeight: 20, fontWeight: '900' }, ticketTime: { marginTop: 1, color: C.ink70, fontSize: 13, lineHeight: 18, fontWeight: '800' }, ticketTimezone: { marginTop: 3, color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, ticketDivider: { marginVertical: 16, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.line }, ticketDetails: { flexDirection: 'row', alignItems: 'flex-start' }, ticketDetail: { flex: 1 }, ticketDetailMiddle: { paddingLeft: 12, borderLeftWidth: 1, borderColor: C.line }, ticketDetailRight: { paddingLeft: 12, alignItems: 'flex-end', borderLeftWidth: 1, borderColor: C.line }, ticketValue: { marginTop: 4, color: C.ink, fontSize: 12, lineHeight: 17, fontWeight: '800' }, ticketTotal: { marginTop: 2, color: C.ink, fontSize: 18, lineHeight: 22, fontWeight: '900' }, shared: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, sharedText: { color: C.teal, fontSize: 11, fontWeight: '700' }, successActions: { width: '100%', marginTop: 14, flexDirection: 'row', gap: 10 }, calendarButton: { minHeight: 50, flex: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, calendarText: { color: C.teal, fontSize: 10, fontWeight: '800' }, successDone: { width: '100%', marginTop: 10, flexDirection: 'row' },
  alertOverlay: { flex: 1, backgroundColor: 'rgba(4,18,17,0.58)', alignItems: 'center', justifyContent: 'center', padding: 24 }, alertCard: { width: '100%', maxWidth: 320, padding: 20, borderRadius: 24, backgroundColor: '#E5F0ED', ...shadow }, alertTitle: { color: C.ink, fontSize: 18, fontWeight: '900', textAlign: 'center' }, alertMessage: { marginTop: 8, color: C.ink70, fontSize: 13, lineHeight: 18, textAlign: 'center' }, alertActions: { marginTop: 24, flexDirection: 'row', gap: 10 }, alertButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, alertKeep: { backgroundColor: '#BFD8D2' }, alertKeepText: { color: C.ink, fontSize: 12, fontWeight: '900' }, alertCancel: { backgroundColor: '#F7EAE6' }, alertCancelText: { color: C.brick, fontSize: 12, fontWeight: '900' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
