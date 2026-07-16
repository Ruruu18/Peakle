import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import LocationPicker from '../components/LocationPicker';
import { distanceInKm, formatDistance, useUserLocation } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import {
  cancelBooking, createMultiCourtBooking, joinCourtWaitlist, listCourtAvailability, listMyBookings,
  listTeams, listVenues, modifyBooking, quoteCourtBooking,
} from '../services/database';
import * as Crypto from 'expo-crypto';
import { showExternalMapOptions } from '../services/externalMaps';
import { requireSupabase } from '../lib/supabase';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA',
};
let C = LIGHT_C;

const DATES = Array.from({ length: 7 }, (_, offset) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  const iso = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return { day: value.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(), date: String(value.getDate()), full: value.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), iso };
});
const TIMES = ['8:00 AM', '9:30 AM', '11:00 AM', '1:00 PM', '3:30 PM', '5:00 PM', '6:30 PM', '8:00 PM'];

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

function Header({ title = 'Book a court', subtitle = 'FIND YOUR NEXT GAME', onBack, action }) {
  const { userLocation } = useUserLocation();
  const [locationOpen, setLocationOpen] = useState(false);
  return (
    <>
      <View style={styles.header}>
        {onBack && <Pressable accessibilityLabel="Go back" onPress={onBack} style={styles.iconButton}><Icon name="arrow-back" /></Pressable>}
        <View style={styles.headerCopy}><Text style={styles.eyebrow}>{subtitle}</Text><Text style={styles.h1}>{title}</Text></View>
        {action || <Pressable accessibilityLabel="Change search location" onPress={() => setLocationOpen(true)} style={styles.locationChip}><Icon name="location" size={14} color={C.teal} /><Text numberOfLines={1} style={styles.locationText}>{userLocation.label}</Text><Icon name="chevron-down" size={12} color={C.teal} /></Pressable>}
      </View>
      <View style={styles.kitchen}><View style={styles.solid} /><View style={styles.dashed} /></View>
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

function CourtArt({ color, large = false }) {
  return (
    <View style={[styles.courtArt, large && styles.courtArtLarge, { backgroundColor: color }]}>
      <View style={styles.courtLines}><View style={styles.centerLine} /><View style={styles.crossLine} /><View style={[styles.crossLine, styles.crossLineTwo]} /></View>
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

function CourtCard({ court, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.courtCard, pressed && styles.pressed]}>
      <CourtArt color={court.color} />
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}><Text style={styles.cardTitle}>{court.name}</Text><Text style={styles.price}>₱{court.price}<Text style={styles.perHour}>/hr</Text></Text></View>
        <View style={styles.meta}><Icon name="location-outline" size={14} color={C.ink40} /><Text style={styles.metaText}>{court.area} · {court.distance}</Text></View>
        <View style={styles.tags}><Text style={[styles.tag, styles.rating]}>★ {court.rating}</Text><Text style={styles.tag}>{court.type}</Text><Text style={styles.tag}>{court.courts} courts</Text></View>
      </View>
    </Pressable>
  );
}

function Discovery({ courts, loading, error, onRetry, onSelect, onShowBookings }) {
  const { userLocation } = useUserLocation();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const hasQuery = Boolean(query.trim());
  const filtered = useMemo(() => courts.map((court) => {
    const distanceKm = distanceInKm(userLocation, court);
    return { ...court, distanceKm, distance: formatDistance(distanceKm) };
  }).filter((court) => {
    const matchesQuery = `${court.name} ${court.area}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'All' || court.type === filter || (filter === 'Nearby' && court.distanceKm <= 25);
    return matchesQuery && matchesFilter;
  }).sort((a, b) => a.distanceKm - b.distanceKm), [courts, query, filter, userLocation]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Header />
      <BookingTabs active="find" onChange={(value) => value === 'bookings' && onShowBookings()} />
      <View style={styles.search}><Icon name="search-outline" color={C.ink40} /><TextInput value={query} onChangeText={setQuery} placeholder="Court or neighborhood" placeholderTextColor={C.ink40} returnKeyType="search" style={styles.searchInput} />{hasQuery && <Pressable accessibilityRole="button" accessibilityLabel="Clear court search" hitSlop={8} onPress={() => setQuery('')} style={styles.clearSearchButton}><Icon name="close" size={18} color={C.ink70} /></Pressable>}</View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {['All', 'Indoor', 'Outdoor', 'Nearby'].map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)} style={({ pressed }) => [styles.filterChip, filter === item && styles.filterChipActive, pressed && styles.pressed]}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}</Text></Pressable>)}
      </ScrollView>
      <View style={styles.resultsHead}><View style={styles.resultsCopy}><Text style={styles.eyebrow}>NEAREST TO {userLocation.label.toUpperCase()}</Text><Text style={styles.h2}>{filtered.length} courts available</Text></View><View style={styles.mapLink}><Icon name="navigate-outline" size={16} color={C.teal} /><Text style={styles.mapText}>By distance</Text></View></View>
      {loading && !courts.length && <View style={styles.loadState}><ActivityIndicator color={C.teal} /><Text style={styles.emptyText}>Finding available courts…</Text></View>}
      {!loading && error && !courts.length && <View style={styles.empty}><Icon name="cloud-offline-outline" size={32} color={C.ink40} /><Text style={styles.emptyTitle}>Courts could not load</Text><Text style={styles.emptyText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View>}
      {filtered.map((court) => <CourtCard key={court.id} court={court} onPress={() => onSelect(court)} />)}
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

function ReservationCard({ booking, onOpenMaps, onCancel, onModify }) {
  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  const venue = booking.venues || {};
  const court = booking.courts || {};
  const status = reservationStatus(booking.status);
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
      <View style={[styles.reservationTop, { backgroundColor: venue.color || C.teal }]}>
        <View style={styles.reservationMark}><Icon name="tennisball-outline" size={21} color="#FFFFFF" /></View>
        <View style={styles.reservationTitleCopy}><Text numberOfLines={1} style={styles.reservationVenue}>{venueName}</Text><Text numberOfLines={1} style={styles.reservationCourt}>{[court.name, venue.area].filter(Boolean).join(' · ') || 'Court details unavailable'}</Text></View>
        <View style={[styles.statusPill, { backgroundColor: status.backgroundColor }]}><Text style={[styles.statusText, { color: status.color }]}>{status.label.toUpperCase()}</Text></View>
      </View>
      <View style={styles.reservationBody}>
        <View style={styles.reservationSchedule}><View style={styles.reservationDateBox}><Text style={styles.reservationMonth}>{start.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Manila' }).toUpperCase()}</Text><Text style={styles.reservationDay}>{start.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Manila' })}</Text></View><View style={styles.reservationWhen}><Text style={styles.reservationDateLabel}>{reservationDate(start)}</Text><Text style={styles.reservationTime}>{timeLabel(start)}–{timeLabel(end)}</Text><Text style={styles.reservationZone}>{venue.time_zone || 'ASIA/MANILA'} · REF {reference}</Text></View><View style={styles.reservationPrice}><Text style={styles.barLabel}>TOTAL</Text><Text style={styles.reservationAmount}>₱{Number(booking.amount || 0).toLocaleString('en-PH')}</Text><Text style={styles.paymentLabel}>{booking.payment_status === 'pay_at_venue' ? 'Pay at venue' : booking.payment_status}</Text><Text style={styles.refundLabel}>{booking.refund_status && booking.refund_status !== 'not_applicable' ? `Refund: ${booking.refund_status.replace('_', ' ')}` : 'No refund due'}</Text></View></View>
        <View style={styles.reservationActions}><Pressable accessibilityRole="button" onPress={() => onOpenMaps(venue)} style={({ pressed }) => [styles.reservationAction, pressed && styles.pressed]}><Icon name="navigate-outline" size={16} color={C.teal} /><Text style={styles.reservationActionText}>Maps</Text></Pressable><View style={styles.actionDivider} /><Pressable accessibilityRole="link" onPress={() => Linking.openURL(calendarUrl)} style={({ pressed }) => [styles.reservationAction, pressed && styles.pressed]}><Icon name="calendar-outline" size={16} color={C.teal} /><Text style={styles.reservationActionText}>Calendar</Text></Pressable><View style={styles.actionDivider} /><Pressable onPress={shareBooking} style={({ pressed }) => [styles.reservationAction, pressed && styles.pressed]}><Icon name="share-social-outline" size={16} color={C.teal} /><Text style={styles.reservationActionText}>Share</Text></Pressable></View>
        {canManage && <View style={styles.manageActions}><Pressable onPress={() => onModify(booking)} style={styles.manageButton}><Icon name="calendar-number-outline" size={15} color={C.teal} /><Text style={styles.manageText}>Change time</Text></Pressable><Pressable onPress={() => onCancel(booking)} style={[styles.manageButton, styles.cancelButton]}><Icon name="close-circle-outline" size={15} color={C.brick} /><Text style={[styles.manageText, styles.cancelText]}>Cancel booking</Text></Pressable></View>}
      </View>
    </View>
  );
}

function MyBookings({ bookings, loading, error, onRetry, onFindCourts, onOpenMaps, onCancel, onModify }) {
  const { upcoming, history } = useMemo(() => {
    const now = Date.now();
    const future = bookings.filter((item) => ['pending', 'confirmed'].includes(item.status) && new Date(item.ends_at).getTime() > now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const previous = bookings.filter((item) => !future.includes(item)).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
    return { upcoming: future, history: previous };
  }, [bookings]);
  const refreshAction = <Pressable accessibilityLabel="Refresh bookings" disabled={loading} onPress={onRetry} style={styles.iconButton}>{loading ? <ActivityIndicator size="small" color={C.teal} /> : <Icon name="refresh" color={C.teal} />}</Pressable>;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Header title="My bookings" subtitle="YOUR RESERVATIONS" action={refreshAction} />
      <BookingTabs active="bookings" onChange={(value) => value === 'find' && onFindCourts()} />
      {loading && !bookings.length && <View style={styles.loadState}><ActivityIndicator color={C.teal} /><Text style={styles.emptyText}>Loading your bookings…</Text></View>}
      {!loading && error && !bookings.length && <View style={styles.empty}><Icon name="cloud-offline-outline" size={32} color={C.ink40} /><Text style={styles.emptyTitle}>Bookings could not load</Text><Text style={styles.emptyText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View>}
      {!loading && !error && !bookings.length && <View style={styles.empty}><Icon name="ticket-outline" size={34} color={C.ink40} /><Text style={styles.emptyTitle}>No bookings yet</Text><Text style={styles.emptyText}>Your confirmed court reservations will appear here.</Text><Pressable accessibilityRole="button" onPress={onFindCourts} style={styles.retryButton}><Text style={styles.retryText}>Find a court</Text></Pressable></View>}
      {error && bookings.length > 0 && <View style={styles.bookingWarning}><Icon name="cloud-offline-outline" size={17} color={C.brick} /><Text style={styles.bookingWarningText}>Could not refresh. Showing your last loaded bookings.</Text></View>}
      {upcoming.length > 0 && <><View style={styles.bookingSectionHead}><View><Text style={styles.eyebrow}>UPCOMING</Text><Text style={styles.h2}>Ready to play</Text></View><Text style={styles.bookingCount}>{upcoming.length}</Text></View>{upcoming.map((item) => <ReservationCard key={item.id} booking={item} onOpenMaps={onOpenMaps} onCancel={onCancel} onModify={onModify} />)}</>}
      {history.length > 0 && <><View style={styles.bookingSectionHead}><View><Text style={styles.eyebrow}>HISTORY</Text><Text style={styles.h2}>Past reservations</Text></View><Text style={styles.bookingCount}>{history.length}</Text></View>{history.map((item) => <ReservationCard key={item.id} booking={item} onOpenMaps={onOpenMaps} onCancel={onCancel} onModify={onModify} />)}</>}
    </ScrollView>
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
      <CourtArt color={court.color} large />
      <View style={styles.detailTop}><View style={styles.detailName}><Text style={styles.h2}>{court.name}</Text><Text style={styles.body}>{court.area} · {court.distance} away</Text></View><Pressable accessibilityLabel={saved ? 'Remove saved court' : 'Save court'} onPress={() => setSaved((value) => !value)} style={[styles.iconButton, saved && styles.savedButton]}><Icon name={saved ? 'bookmark' : 'bookmark-outline'} color={saved ? C.teal : C.ink} /></Pressable></View>
      <View style={styles.ratingRow}><View style={styles.ratingBadge}><Text style={styles.ratingBig}>{court.rating}</Text><Text style={styles.ratingCaption}>★ · {court.reviews} reviews</Text></View><View style={styles.detailStat}><Text style={styles.detailNumber}>{court.courts}</Text><Text style={styles.detailLabel}>COURTS</Text></View><View style={styles.detailStat}><Text style={styles.detailNumber}>{court.available}</Text><Text style={styles.detailLabel}>OPEN NOW</Text></View></View>
      <Text style={styles.courtDescription}>{court.description}</Text>
      <View style={styles.venueFacts}><View style={styles.venueFact}><Icon name="location-outline" size={18} color={C.teal} /><View style={styles.venueFactCopy}><Text style={styles.venueFactLabel}>ADDRESS</Text><Text style={styles.venueFactValue}>{court.address}</Text></View></View><View style={styles.venueFact}><Icon name="time-outline" size={18} color={C.teal} /><View style={styles.venueFactCopy}><Text style={styles.venueFactLabel}>TODAY'S HOURS</Text><Text style={styles.venueFactValue}>{court.hours}</Text></View></View></View>
      <Pressable accessibilityRole="button" onPress={() => onOpenMaps(court)} style={({ pressed }) => [styles.directionsButton, pressed && styles.pressed]}><Icon name="navigate-outline" size={18} color={C.teal} /><Text style={styles.directionsText}>Open in Maps</Text><Icon name="open-outline" size={15} color={C.teal} /></Pressable>
      <View style={styles.sectionLine} />
      <View style={styles.courtChoiceHead}><View><Text style={styles.eyebrow}>SELECT A COURT</Text><Text style={styles.courtChoiceTitle}>{court.courts} courts at this venue</Text></View><Text style={styles.courtChoiceCount}>{court.available} available</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.courtOptions}>
        {court.courtOptions.map((option) => {
          const active = selectedCourt?.id === option.id;
          return <Pressable key={option.id} disabled={!option.available} accessibilityState={{ selected: active, disabled: !option.available }} onPress={() => setSelectedCourt(option)} style={({ pressed }) => [styles.courtOption, active && styles.courtOptionActive, !option.available && styles.courtOptionUnavailable, pressed && styles.pressed]}><View style={styles.courtOptionHead}><Text style={[styles.courtOptionName, active && styles.courtOptionNameActive]}>{option.name}</Text>{active && <Icon name="checkmark-circle" size={17} color={C.teal} />}</View><Text style={styles.courtOptionMeta}>{option.environment} · {option.surface}</Text><Text style={[styles.courtOptionStatus, !option.available && styles.courtOptionStatusBusy]}>{option.next}</Text><Text style={styles.courtOptionPrice}>₱{option.price}<Text style={styles.perHour}>/hr</Text></Text></Pressable>;
        })}
      </ScrollView>
      <View style={styles.sectionLine} />
      <Text style={styles.eyebrow}>WHAT'S HERE</Text><View style={styles.amenities}>{court.amenities.map((item, index) => <View key={item} style={styles.amenity}><Icon name={['snow-outline', 'car-outline', 'cafe-outline'][index] || 'checkmark-circle-outline'} size={19} color={C.teal} /><Text style={styles.amenityText}>{item}</Text></View>)}</View>
      <View style={styles.infoCard}><Icon name="information-circle-outline" color={C.teal} /><View style={styles.infoCopy}><Text style={styles.infoTitle}>Free cancellation</Text><Text style={styles.bodySmall}>Cancel up to {Math.round((court.cancellationCutoffMinutes || 240) / 60)} hours before your booking.</Text></View></View>
      <View style={styles.bookBar}><View><Text style={styles.barLabel}>{selectedCourt?.name.toUpperCase()}</Text><Text style={styles.barPrice}>₱{selectedCourt?.price || court.price}<Text style={styles.perHour}> / hour</Text></Text></View><PrimaryButton disabled={!selectedCourt} onPress={() => onBook(selectedCourt)}>Choose a time</PrimaryButton></View>
    </ScrollView>
  );
}

function Setup({ court, courtOption, teams, onBack, onConfirm, onWaitlist, existingBooking, saving }) {
  const existingStart = existingBooking ? new Date(existingBooking.starts_at) : null;
  const existingEnd = existingBooking ? new Date(existingBooking.ends_at) : null;
  const existingIso = existingStart ? `${existingStart.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })}` : null;
  const initialDateIndex = Math.max(0, DATES.findIndex((item) => item.iso === existingIso));
  const [dateIndex, setDateIndex] = useState(initialDateIndex);
  const [time, setTime] = useState(existingStart ? timeLabel(existingStart) : '6:30 PM');
  const [duration, setDuration] = useState(existingStart ? Math.round((existingEnd - existingStart) / 60_000) : 60);
  const [inviteTeam, setInviteTeam] = useState(teams.length > 0);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id || null);
  const [schedule, setSchedule] = useState([]);
  const [selectedCourtIds, setSelectedCourtIds] = useState([courtOption.id]);
  const [promoCode, setPromoCode] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const total = quote?.total ?? court.courtOptions.filter((item) => selectedCourtIds.includes(item.id)).reduce((sum, item) => sum + item.price * duration / 60, 0);
  const reservedWindow = bookingWindow(DATES[dateIndex].iso, time, duration);
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || null;
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
    listCourtAvailability(court.courtOptions.map((item) => item.id), DATES[dateIndex].iso)
      .then((rows) => active && setSchedule(rows)).catch(() => active && setSchedule([]));
    return () => { active = false; };
  }, [court.courtOptions, dateIndex]);
  const conflicts = (slot, courtId) => {
    const [clock, period] = slot.split(' ');
    const [rawHour, minute] = clock.split(':').map(Number);
    const hour = (rawHour % 12) + (period === 'PM' ? 12 : 0);
    const start = new Date(`${DATES[dateIndex].iso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);
    const end = new Date(start.getTime() + duration * 60000);
    return schedule.some((item) => item.court_id === courtId && item.id !== existingBooking?.id && start < new Date(item.ends_at) && end > new Date(item.starts_at));
  };
  const hasStarted = (slot) => bookingDates(DATES[dateIndex].iso, slot, duration).start.getTime() <= Date.now();
  const selectedTimeUnavailable = selectedCourtIds.some((id) => conflicts(time, id)) || hasStarted(time);
  useEffect(() => {
    setQuote(null); setQuoteError('');
    if (selectedTimeUnavailable || !selectedCourtIds.length) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      setQuoteLoading(true);
      quoteCourtBooking({ courtIds: selectedCourtIds, dateIso: DATES[dateIndex].iso, time, duration, promoCode })
        .then((value) => { if (active) setQuote(value); })
        .catch((reason) => { if (active) setQuoteError(reason.message || 'Price could not be confirmed.'); })
        .finally(() => { if (active) setQuoteLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [dateIndex, duration, promoCode, quoteVersion, selectedCourtIds, selectedTimeUnavailable, time]);
  useEffect(() => {
    if (!quote?.expires_at) return undefined;
    const delay = Math.max(1000, new Date(quote.expires_at).getTime() - Date.now() - 5000);
    const timer = setTimeout(() => setQuoteVersion((value) => value + 1), delay);
    return () => clearTimeout(timer);
  }, [quote?.expires_at]);
  const toggleCourt = (id) => setSelectedCourtIds((current) => current.includes(id)
    ? (current.length === 1 ? current : current.filter((value) => value !== id))
    : [...current, id]);
  const unavailableReason = schedule.find((item) => selectedCourtIds.includes(item.court_id) && conflicts(time, item.court_id))?.reason;
  const confirm = () => onConfirm({
    date: DATES[dateIndex].full, dateIso: DATES[dateIndex].iso, time, duration, total,
    inviteTeam: inviteTeam && Boolean(selectedTeam), teamId: inviteTeam ? selectedTeam?.id : null,
    teamName: inviteTeam ? selectedTeam?.name : null, courtOption,
    courtOptions: court.courtOptions.filter((item) => selectedCourtIds.includes(item.id)), quote,
  });
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Header title="Finish setup" subtitle="BOOKING DETAILS" onBack={onBack} />
      <View style={styles.compactCourt}><View style={[styles.compactSwatch, { backgroundColor: court.color }]}><Icon name="tennisball-outline" color={C.surface} /></View><View style={styles.compactCopy}><Text style={styles.compactName}>{existingBooking ? 'Change reservation' : court.name}</Text><Text style={styles.bodySmall}>{selectedCourtIds.length} court{selectedCourtIds.length === 1 ? '' : 's'} selected · {court.timeZone || 'Asia/Manila'}</Text></View><Text style={styles.compactPrice}>₱{total.toLocaleString()}</Text></View>
      {!existingBooking && <><Text style={styles.sectionLabel}>COURTS · SELECT MORE THAN ONE</Text><View style={styles.multiCourtGrid}>{court.courtOptions.map((option) => { const selected = selectedCourtIds.includes(option.id); return <Pressable key={option.id} accessibilityState={{ selected }} onPress={() => toggleCourt(option.id)} style={[styles.multiCourt, selected && styles.multiCourtActive]}><Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={selected ? C.teal : C.ink40} /><View style={styles.flex}><Text style={styles.multiCourtName}>{option.name}</Text><Text style={styles.multiCourtPrice}>₱{option.price}/hr</Text></View></Pressable>; })}</View></>}
      <Text style={styles.sectionLabel}>CHOOSE A DATE</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>{DATES.map((item, index) => <Pressable key={item.date} onPress={() => setDateIndex(index)} style={[styles.date, dateIndex === index && styles.dateActive]}><Text style={[styles.dateDay, dateIndex === index && styles.dateTextActive]}>{item.day}</Text><Text style={[styles.dateNumber, dateIndex === index && styles.dateTextActive]}>{item.date}</Text></Pressable>)}</ScrollView>
      <View style={styles.sectionHead}><Text style={styles.sectionLabel}>AVAILABLE TIMES</Text><Text style={styles.timeZone}>Asia/Manila</Text></View>
      <View style={styles.timeGrid}>{TIMES.map((item) => { const past = hasStarted(item); const booked = selectedCourtIds.some((id) => conflicts(item, id)); const unavailable = past || booked; return <Pressable key={item} disabled={past} accessibilityState={{ disabled: past, selected: time === item }} onPress={() => setTime(item)} style={[styles.time, time === item && styles.timeActive, unavailable && styles.timeBooked]}><Text style={[styles.timeText, time === item && styles.timeTextActive, unavailable && styles.timeTextBooked]}>{item}</Text>{unavailable && <Text style={styles.bookedText}>{past ? 'PAST' : 'FULL · WAITLIST'}</Text>}</Pressable>; })}</View>
      <Text style={styles.sectionLabel}>DURATION</Text><View style={styles.segment}>{[60, 90, 120].map((value) => <Pressable key={value} onPress={() => setDuration(value)} style={[styles.segmentItem, duration === value && styles.segmentActive]}><Text style={[styles.segmentText, duration === value && styles.segmentTextActive]}>{value === 60 ? '1 hour' : value === 90 ? '1.5 hours' : '2 hours'}</Text></Pressable>)}</View>
      <View style={styles.infoCard}><Icon name="time-outline" color={C.teal} /><View style={styles.infoCopy}><Text style={styles.infoTitle}>Reserved {reservedWindow}</Text><Text style={styles.bodySmall}>Your court time ends at {timeLabel(bookingDates(DATES[dateIndex].iso, time, duration).end)}. If your game is unfinished, you may add 30 minutes only when the next slot is free. Additional venue charges apply.</Text></View></View>
      <Pressable disabled={!teams.length} accessibilityRole="switch" accessibilityState={{ checked: inviteTeam }} onPress={() => setInviteTeam(!inviteTeam)} style={[styles.inviteRow, !teams.length && styles.inviteRowDisabled]}><View style={styles.inviteIcon}><Icon name="people-outline" color={C.teal} /></View><View style={styles.inviteCopy}><Text style={styles.inviteTitle}>{teams.length ? 'Invite your team' : 'No joined team yet'}</Text><Text style={styles.bodySmall}>{teams.length ? `Share this booking with ${selectedTeam?.name || 'your team'}.` : 'Join or create a team to share bookings with teammates.'}</Text></View>{teams.length > 0 && <View style={[styles.toggle, inviteTeam && styles.toggleOn]}><View style={[styles.toggleKnob, inviteTeam && styles.toggleKnobOn]} /></View>}</Pressable>
      {inviteTeam && teams.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamChoices}>{teams.map((team) => { const active = team.id === selectedTeamId; return <Pressable key={team.id} accessibilityState={{ selected: active }} onPress={() => setSelectedTeamId(team.id)} style={[styles.teamChoice, active && styles.teamChoiceActive]}><Icon name={active ? 'checkmark-circle' : 'people-outline'} size={15} color={active ? C.surface : C.teal} /><Text numberOfLines={1} style={[styles.teamChoiceText, active && styles.teamChoiceTextActive]}>{team.name}</Text></Pressable>; })}</ScrollView>}
      <Text style={styles.sectionLabel}>PROMO CODE</Text><TextInput autoCapitalize="characters" value={promoCode} onChangeText={setPromoCode} placeholder="Optional" placeholderTextColor={C.ink40} style={styles.promoInput} />
      <View style={styles.summary}><Text style={styles.summaryTitle}>Price-locked summary</Text><View style={styles.summaryRow}><Text style={styles.body}>Courts</Text><Text style={styles.summaryValue}>{court.courtOptions.filter((item) => selectedCourtIds.includes(item.id)).map((item) => item.name).join(', ')}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Date</Text><Text style={styles.summaryValue}>{DATES[dateIndex].full}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Time</Text><Text style={styles.summaryValue}>{reservedWindow} · {duration} min</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Court subtotal</Text><Text style={styles.summaryValue}>₱{Number(quote?.subtotal ?? total).toLocaleString()}</Text></View>{quote?.breakdown?.lines?.filter((line) => line.ruleName).map((line) => <View key={line.courtId} style={styles.summaryRow}><Text style={styles.body}>{line.ruleName}</Text><Text style={styles.summaryValue}>₱{Number(line.amount).toLocaleString()}</Text></View>)}<View style={styles.summaryRow}><Text style={styles.body}>Pricing adjustment</Text><Text style={styles.summaryValue}>₱{Math.max(0, Number(quote?.total || 0) - Number(quote?.subtotal || 0) + Number(quote?.discount_amount || 0)).toLocaleString()}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Discounts</Text><Text style={styles.summaryValue}>− ₱{Number(quote?.discount_amount || 0).toLocaleString()}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Fees</Text><Text style={styles.summaryValue}>₱{Number(quote?.fee_amount || 0).toLocaleString()}</Text></View><View style={styles.summaryRow}><Text style={styles.body}>Payment</Text><Text style={styles.summaryValue}>Pay at venue</Text></View><View style={styles.sectionLine} /><View style={styles.summaryRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.total}>₱{total.toLocaleString()}</Text></View>{quote && <Text style={styles.quoteExpiry}>Price locked until {timeLabel(new Date(quote.expires_at))}</Text>}{quoteLoading && <ActivityIndicator size="small" color={C.teal} />}{quoteError ? <Text style={styles.quoteError}>{quoteError}</Text> : null}</View>
      {selectedTimeUnavailable && selectedCourtIds.length === 1 ? <PrimaryButton disabled={saving} icon="notifications-outline" onPress={() => onWaitlist({ courtId: selectedCourtIds[0], dateIso: DATES[dateIndex].iso, time, duration })}>Join waitlist · {unavailableReason || 'Fully booked'}</PrimaryButton> : <PrimaryButton disabled={selectedTimeUnavailable || !quote || quoteLoading || saving} icon="checkmark" onPress={confirm}>{saving ? 'Securing every court…' : `${existingBooking ? 'Save change' : 'Confirm booking'} · ₱${total.toLocaleString()}`}</PrimaryButton>}
      <Text style={styles.terms}>No charge today. Payment is collected at the venue.</Text>
    </ScrollView>
  );
}

function Success({ court, booking, onDone }) {
  const ticketColor = court.color || LIGHT_C.teal;
  const ticketTextColor = readableTextColor(ticketColor);
  const bookingReference = booking.reference || String(booking.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || 'CONFIRMED';
  const bookedCourts = booking.courtOptions?.length ? booking.courtOptions : [booking.courtOption];
  const courtNames = bookedCourts.filter(Boolean).map((item) => item.name).join(', ');
  const { start, end } = bookingDates(booking.dateIso, booking.time, booking.duration);
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
      <View style={styles.successHero}><View style={styles.successIcon}><Icon name="checkmark" size={32} /></View><Text style={styles.eyebrow}>BOOKING CONFIRMED</Text><Text style={styles.successTitle}>Court booked.</Text><Text style={styles.successLead}>Your reservation at {court.name} is ready.</Text></View>
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
            <View style={[styles.ticketDetail, styles.ticketDetailMiddle]}><Text style={styles.barLabel}>PAYMENT</Text><Text style={styles.ticketValue}>At venue</Text></View>
            <View style={[styles.ticketDetail, styles.ticketDetailRight]}><Text style={styles.barLabel}>TOTAL</Text><Text style={styles.ticketTotal}>₱{booking.total.toLocaleString()}</Text></View>
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
  const [venues, setVenues] = useState([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venuesLoaded, setVenuesLoaded] = useState(false);
  const [venuesError, setVenuesError] = useState('');
  const [venuesRequest, setVenuesRequest] = useState(0);
  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState('');
  const [bookingsRequest, setBookingsRequest] = useState(0);
  const [joinedTeams, setJoinedTeams] = useState([]);
  const [rootView, setRootView] = useState('find');
  const [step, setStep] = useState('discover');
  const [court, setCourt] = useState(null);
  const [courtOption, setCourtOption] = useState(null);
  const [booking, setBooking] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null);
  const [savingBooking, setSavingBooking] = useState(false);
  const bookingRequestKey = useRef(null);
  const [openedFromHome, setOpenedFromHome] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    setVenuesLoading(true);
    setVenuesLoaded(false);
    setVenuesError('');
    listVenues({ signal: controller.signal }).then((rows) => {
      if (!active) return;
      setVenues(rows.map((venue) => {
        const courts = venue.courts || [];
        const prices = courts.map((item) => Number(item.hourly_price)).filter(Number.isFinite);
        return {
          id: venue.id, name: venue.name, area: venue.area, address: venue.address, latitude: venue.latitude, longitude: venue.longitude,
          rating: '—', reviews: 0, price: prices.length ? Math.min(...prices) : 0, courts: courts.length,
          available: courts.filter((item) => item.active).length, hours: `${venue.opens_at?.slice(0, 5)}–${venue.closes_at?.slice(0, 5)}`,
          type: venue.venue_type, color: venue.color || C.teal, description: venue.description, amenities: venue.amenities || [], timeZone: venue.time_zone || 'Asia/Manila', cancellationCutoffMinutes: venue.cancellation_cutoff_minutes || 240,
          courtOptions: courts.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, environment: item.environment, surface: item.surface, price: Number(item.hourly_price), available: true, next: 'Check times' })),
        };
      }));
      setVenuesLoaded(true);
    }).catch((error) => {
      if (!active) return;
      setVenuesError(controller.signal.aborted ? 'The request took too long. Check your connection and try again.' : (error.message || 'Check your connection and try again.'));
    }).finally(() => {
      clearTimeout(timeout);
      if (active) setVenuesLoading(false);
    });
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
    setBookingsLoading(true);
    setBookingsError('');
    listMyBookings().then((rows) => {
      if (active) setBookings(rows || []);
    }).catch((error) => {
      if (active) setBookingsError(error.message || 'Check your connection and try again.');
    }).finally(() => {
      if (active) setBookingsLoading(false);
    });
    return () => { active = false; };
  }, [bookingsRequest]);
  useEffect(() => navigation.addListener('focus', () => setBookingsRequest((request) => request + 1)), [navigation]);
  useEffect(() => {
    const client = requireSupabase();
    const channel = client.channel('booking-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => setBookingsRequest((value) => value + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'court_blackouts' }, () => setVenuesRequest((value) => value + 1))
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, []);
  const selectCourt = (selected) => { setCourt(selected); setCourtOption(null); setStep('detail'); };
  const activeCourt = useMemo(() => court ? { ...court, distanceKm: distanceInKm(userLocation, court), distance: formatDistance(distanceInKm(userLocation, court)) } : null, [court, userLocation]);
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
  const confirmBooking = async (value) => {
    if (savingBooking || !value.quote) return;
    setSavingBooking(true);
    try {
      if (editingBooking) {
        const saved = await modifyBooking({ bookingId: editingBooking.id, quoteId: value.quote.id, expectedRevision: editingBooking.revision || 1 });
        setBooking({ ...value, ...saved, courtOptions: value.courtOptions, status: saved.status || 'confirmed' });
        setEditingBooking(null);
      } else {
        bookingRequestKey.current ||= Crypto.randomUUID();
        const result = await createMultiCourtBooking({
          quoteId: value.quote.id, inviteTeam: value.inviteTeam, teamId: value.teamId,
          idempotencyKey: bookingRequestKey.current,
        });
        const saved = result.bookings[0] || {};
        setBooking({ ...value, ...saved, courtOptions: value.courtOptions, status: saved.status || 'confirmed' });
        bookingRequestKey.current = null;
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
  const cancelReservation = (reservation) => Alert.alert('Cancel this booking?', 'The court will be released and the next waitlisted player may be notified.', [
    { text: 'Keep booking', style: 'cancel' },
    { text: 'Cancel booking', style: 'destructive', onPress: async () => {
      try { await cancelBooking(reservation.id, reservation.revision || 1, 'Cancelled by player'); setBookingsRequest((value) => value + 1); }
      catch (error) { Alert.alert('Could not cancel', error.message || 'Please try again.'); }
    } },
  ]);
  const changeReservation = (reservation) => {
    const selectedVenue = venues.find((item) => item.id === reservation.venue_id);
    const selectedOption = selectedVenue?.courtOptions.find((item) => item.id === reservation.court_id);
    if (!selectedVenue || !selectedOption) { Alert.alert('Court unavailable', 'Refresh venues and try again.'); return; }
    setCourt(selectedVenue); setCourtOption(selectedOption); setEditingBooking(reservation); setStep('setup');
  };
  const openMaps = (destination) => showExternalMapOptions(destination);
  return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />{step === 'discover' && rootView === 'find' && <Discovery courts={venues} loading={venuesLoading} error={venuesError} onRetry={() => setVenuesRequest((value) => value + 1)} onShowBookings={() => setRootView('bookings')} onSelect={(selected) => { setOpenedFromHome(false); setEditingBooking(null); selectCourt(selected); }} />}{step === 'discover' && rootView === 'bookings' && <MyBookings bookings={bookings} loading={bookingsLoading} error={bookingsError} onRetry={() => setBookingsRequest((value) => value + 1)} onFindCourts={() => setRootView('find')} onOpenMaps={openMaps} onCancel={cancelReservation} onModify={changeReservation} />}{step === 'detail' && activeCourt && <CourtDetail court={activeCourt} onBack={backFromDetail} onBook={(option) => { setCourtOption(option); setEditingBooking(null); setStep('setup'); }} onOpenMaps={openMaps} />}{step === 'setup' && activeCourt && courtOption && <Setup court={activeCourt} courtOption={courtOption} teams={joinedTeams} existingBooking={editingBooking} saving={savingBooking} onBack={() => { setEditingBooking(null); setStep(editingBooking ? 'discover' : 'detail'); }} onConfirm={confirmBooking} onWaitlist={waitlist} />}{step === 'success' && activeCourt && booking && <Success court={activeCourt} booking={booking} onDone={() => { setRootView('bookings'); setStep('discover'); setCourt(null); setCourtOption(null); setBooking(null); setEditingBooking(null); setOpenedFromHome(false); }} />}</SafeAreaView>;
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper }, flex: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 42 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }, headerCopy: { flex: 1 }, eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 29, lineHeight: 35, fontWeight: '800', letterSpacing: -0.8 }, h2: { color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  locationChip: { maxWidth: '44%', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, locationText: { flexShrink: 1, color: C.teal, fontSize: 10, fontWeight: '800' }, iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  bookingTabs: { marginBottom: 16, padding: 4, flexDirection: 'row', gap: 4, borderRadius: 14, backgroundColor: '#E7EBE6' }, bookingTab: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11 }, bookingTabActive: { backgroundColor: C.optic }, bookingTabText: { color: C.ink40, fontSize: 11, fontWeight: '800' }, bookingTabTextActive: { color: '#000000' },
  kitchen: { height: 7, marginTop: 18, marginBottom: 23 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, search: { height: 52, paddingLeft: 15, paddingRight: 6, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, searchInput: { flex: 1, marginLeft: 9, color: C.ink, fontSize: 14 }, clearSearchButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper },
  filterRow: { gap: 8, paddingVertical: 14 }, filterChip: { minHeight: 36, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, filterChipActive: { backgroundColor: C.ink, borderColor: C.ink }, filterText: { color: C.ink70, fontSize: 11, fontWeight: '700' }, filterTextActive: { color: C.paper }, resultsHead: { marginTop: 6, marginBottom: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }, resultsCopy: { flex: 1 }, mapLink: { minHeight: 40, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }, mapText: { color: C.teal, fontSize: 10, fontWeight: '800' },
  loadState: { paddingVertical: 70, alignItems: 'center', gap: 12 }, retryButton: { minHeight: 42, marginTop: 18, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic }, retryText: { color: C.ink, fontSize: 11, fontWeight: '800' },
  bookingWarning: { marginBottom: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#F7EAE6' }, bookingWarningText: { flex: 1, color: C.brick, fontSize: 10, fontWeight: '700' }, bookingSectionHead: { marginTop: 10, marginBottom: 13, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, bookingCount: { minWidth: 28, height: 28, paddingHorizontal: 8, overflow: 'hidden', borderRadius: 14, color: C.teal, backgroundColor: '#E5F0ED', fontSize: 11, lineHeight: 28, fontWeight: '900', textAlign: 'center' },
  reservationCard: { marginBottom: 16, overflow: 'hidden', borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, reservationTop: { minHeight: 76, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, reservationMark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(14,35,33,0.25)' }, reservationTitleCopy: { flex: 1 }, reservationVenue: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' }, reservationCourt: { marginTop: 3, color: 'rgba(255,255,255,0.72)', fontSize: 9, fontWeight: '700' }, statusPill: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 }, statusText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.65 }, reservationBody: { paddingHorizontal: 14 }, reservationSchedule: { minHeight: 102, flexDirection: 'row', alignItems: 'center', gap: 11 }, reservationDateBox: { width: 50, height: 59, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.paper }, reservationMonth: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 }, reservationDay: { marginTop: 1, color: C.ink, fontSize: 23, lineHeight: 25, fontWeight: '900' }, reservationWhen: { flex: 1 }, reservationDateLabel: { color: C.ink, fontSize: 12, fontWeight: '800' }, reservationTime: { marginTop: 3, color: C.ink70, fontSize: 11, fontWeight: '700' }, reservationZone: { marginTop: 4, color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: 0.6 }, reservationPrice: { alignItems: 'flex-end' }, reservationAmount: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '900' }, paymentLabel: { marginTop: 2, color: C.ink40, fontSize: 7 }, refundLabel: { marginTop: 2, color: C.ink40, fontSize: 6 }, reservationActions: { minHeight: 48, flexDirection: 'row', borderTopWidth: 1, borderColor: C.line }, reservationAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, reservationActionText: { color: C.teal, fontSize: 9, fontWeight: '800' }, actionDivider: { width: 1, marginVertical: 10, backgroundColor: C.line }, manageActions: { paddingVertical: 10, flexDirection: 'row', gap: 8, borderTopWidth: 1, borderColor: C.line }, manageButton: { minHeight: 38, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, backgroundColor: '#E5F0ED' }, cancelButton: { backgroundColor: '#F7EAE6' }, manageText: { color: C.teal, fontSize: 9, fontWeight: '900' }, cancelText: { color: C.brick },
  courtCard: { marginBottom: 14, overflow: 'hidden', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, courtArt: { height: 132, overflow: 'hidden' }, courtArtLarge: { height: 215, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }, courtLines: { position: 'absolute', left: '16%', right: '16%', top: 17, bottom: -35, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', transform: [{ perspective: 260 }, { rotateX: '35deg' }] }, centerLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, backgroundColor: 'rgba(255,255,255,0.55)' }, crossLine: { position: 'absolute', left: 0, right: 0, top: '30%', height: 2, backgroundColor: 'rgba(255,255,255,0.55)' }, crossLineTwo: { top: '72%' }, availableBadge: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 7, backgroundColor: 'rgba(14,35,33,0.82)' }, availableDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.optic }, availableText: { color: C.surface, fontSize: 8, fontWeight: '800', letterSpacing: .7 },
  cardBody: { padding: 14 }, cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, cardTitle: { flex: 1, color: C.ink, fontSize: 17, fontWeight: '800' }, price: { color: C.teal, fontSize: 16, fontWeight: '800' }, perHour: { color: C.ink40, fontSize: 9, fontWeight: '500' }, meta: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }, metaText: { color: C.ink40, fontSize: 11 }, tags: { marginTop: 11, flexDirection: 'row', gap: 6 }, tag: { paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden', borderRadius: 7, color: C.ink70, backgroundColor: C.paper, fontSize: 9, fontWeight: '800' }, rating: { color: C.teal }, pressed: { opacity: .78, transform: [{ scale: .985 }] }, empty: { paddingVertical: 70, alignItems: 'center' }, emptyTitle: { marginTop: 12, color: C.ink, fontSize: 18, fontWeight: '800' }, emptyText: { marginTop: 5, color: C.ink40, fontSize: 12 },
  detailTop: { marginTop: 18, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, detailName: { flex: 1 }, savedButton: { borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, body: { color: C.ink70, fontSize: 13, lineHeight: 19 }, bodySmall: { color: C.ink40, fontSize: 11, lineHeight: 16 }, ratingRow: { marginTop: 18, padding: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface }, ratingBadge: { flex: 1.5 }, ratingBig: { color: C.ink, fontSize: 25, lineHeight: 27, fontWeight: '800' }, ratingCaption: { marginTop: 2, color: C.teal, fontSize: 9, fontWeight: '800' }, detailStat: { flex: 1, alignItems: 'center', borderLeftWidth: 1, borderColor: C.line }, detailNumber: { color: C.ink, fontSize: 17, fontWeight: '800' }, detailLabel: { marginTop: 2, color: C.ink40, fontSize: 8, fontWeight: '800', letterSpacing: .7 }, courtDescription: { marginTop: 16, color: C.ink70, fontSize: 12, lineHeight: 18 }, venueFacts: { marginTop: 14, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, venueFact: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderColor: C.line }, venueFactCopy: { flex: 1 }, venueFactLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, venueFactValue: { marginTop: 3, color: C.ink, fontSize: 10, fontWeight: '700' }, directionsButton: { minHeight: 45, marginTop: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, directionsText: { color: C.teal, fontSize: 10, fontWeight: '800' }, courtChoiceHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }, courtChoiceTitle: { marginTop: 2, color: C.ink, fontSize: 17, fontWeight: '800' }, courtChoiceCount: { color: C.teal, fontSize: 9, fontWeight: '800' }, courtOptions: { gap: 9, paddingTop: 11, paddingRight: 20 }, courtOption: { width: 164, minHeight: 128, padding: 12, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, courtOptionActive: { borderWidth: 2, borderColor: C.teal, backgroundColor: '#F6FAF8' }, courtOptionUnavailable: { opacity: .52, backgroundColor: '#E9ECE7' }, courtOptionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, courtOptionName: { color: C.ink, fontSize: 12, fontWeight: '800' }, courtOptionNameActive: { color: C.teal }, courtOptionMeta: { minHeight: 27, marginTop: 5, color: C.ink40, fontSize: 8, lineHeight: 12 }, courtOptionStatus: { marginTop: 5, color: C.teal, fontSize: 8, fontWeight: '800' }, courtOptionStatusBusy: { color: C.brick }, courtOptionPrice: { marginTop: 'auto', color: C.ink, fontSize: 15, fontWeight: '900' }, sectionLine: { marginVertical: 20, height: 1, backgroundColor: C.line }, amenities: { marginTop: 11, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, amenity: { width: '48%', minHeight: 48, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, amenityText: { flex: 1, color: C.ink70, fontSize: 11, fontWeight: '700' }, infoCard: { marginTop: 18, padding: 14, flexDirection: 'row', gap: 10, borderRadius: 14, backgroundColor: '#E5F0ED' }, infoCopy: { flex: 1 }, infoTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, bookBar: { marginTop: 22, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, barLabel: { color: C.ink40, fontSize: 8, fontWeight: '800', letterSpacing: .8 }, barPrice: { color: C.ink, fontSize: 19, fontWeight: '800' },
  primary: { minHeight: 52, paddingHorizontal: 18, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: C.optic }, primaryText: { color: C.ink, fontSize: 13, fontWeight: '800' }, disabled: { opacity: .4 }, compactCourt: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface }, compactSwatch: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, compactCopy: { flex: 1 }, compactName: { color: C.ink, fontSize: 13, fontWeight: '800' }, compactPrice: { color: C.teal, fontSize: 11, fontWeight: '800' }, sectionLabel: { marginTop: 24, marginBottom: 10, color: C.ink, fontSize: 10, fontWeight: '800', letterSpacing: .9 }, multiCourtGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, multiCourt: { width: '48.7%', minHeight: 58, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, multiCourtActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, multiCourtName: { color: C.ink, fontSize: 10, fontWeight: '900' }, multiCourtPrice: { marginTop: 2, color: C.ink40, fontSize: 8 }, dateRow: { gap: 8 }, date: { width: 58, height: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, dateActive: { backgroundColor: C.ink, borderColor: C.ink }, dateDay: { color: C.ink40, fontSize: 8, fontWeight: '800' }, dateNumber: { marginTop: 4, color: C.ink, fontSize: 20, fontWeight: '800' }, dateTextActive: { color: C.paper }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, timeZone: { marginTop: 14, color: C.ink40, fontSize: 9 }, timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, time: { width: '48.7%', height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, timeActive: { borderColor: C.optic, backgroundColor: C.optic }, timeBooked: { backgroundColor: '#E9ECE7' }, timeText: { color: C.ink, fontSize: 11, fontWeight: '800' }, timeTextActive: { color: C.ink }, timeTextBooked: { color: C.ink40 }, bookedText: { color: C.ink40, fontSize: 6, fontWeight: '800', letterSpacing: .6 }, segment: { padding: 4, flexDirection: 'row', borderRadius: 12, backgroundColor: '#E7EBE6' }, segmentItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, segmentActive: { backgroundColor: C.optic, ...shadow }, segmentText: { color: C.ink40, fontSize: 11, fontWeight: '700' }, segmentTextActive: { color: C.ink }, inviteRow: { marginTop: 18, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, inviteRowDisabled: { opacity: .65 }, inviteIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#E5F0ED' }, inviteCopy: { flex: 1 }, inviteTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, toggle: { width: 43, height: 25, padding: 3, borderRadius: 13, backgroundColor: C.line }, toggleOn: { backgroundColor: C.optic }, toggleKnob: { width: 19, height: 19, borderRadius: 10, backgroundColor: C.surface }, toggleKnobOn: { alignSelf: 'flex-end' }, teamChoices: { gap: 8, paddingTop: 9, paddingRight: 20 }, teamChoice: { maxWidth: 180, minHeight: 36, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, teamChoiceActive: { borderColor: C.teal, backgroundColor: C.teal }, teamChoiceText: { flexShrink: 1, color: C.teal, fontSize: 10, fontWeight: '800' }, teamChoiceTextActive: { color: C.surface }, promoInput: { minHeight: 48, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: C.line, color: C.ink, backgroundColor: C.surface, fontSize: 11, fontWeight: '800' }, summary: { marginVertical: 18, padding: 16, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, summaryTitle: { marginBottom: 13, color: C.ink, fontSize: 16, fontWeight: '800' }, summaryRow: { marginVertical: 5, flexDirection: 'row', justifyContent: 'space-between', gap: 15 }, summaryValue: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '700', textAlign: 'right' }, totalLabel: { color: C.ink, fontSize: 15, fontWeight: '800' }, total: { color: C.ink, fontSize: 20, fontWeight: '800' }, quoteExpiry: { marginTop: 9, color: C.teal, fontSize: 8, fontWeight: '900', textAlign: 'right' }, quoteError: { marginTop: 9, color: C.brick, fontSize: 8, lineHeight: 12 }, terms: { marginTop: 9, color: C.ink40, textAlign: 'center', fontSize: 9 },
  successContent: { alignItems: 'stretch', paddingTop: 28, paddingBottom: 38 }, successHero: { alignItems: 'center' }, successIcon: { width: 66, height: 66, marginBottom: 14, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, successTitle: { marginTop: 3, color: C.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -.8, textAlign: 'center' }, successLead: { maxWidth: 310, marginTop: 5, color: C.ink40, fontSize: 12, lineHeight: 18, textAlign: 'center' }, ticket: { width: '100%', marginTop: 22, overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, ticketTop: { padding: 17 }, ticketTopRow: { marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, ticketStatus: { minHeight: 28, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14 }, ticketStatusText: { fontSize: 8, fontWeight: '900', letterSpacing: .7 }, ticketReference: { flexShrink: 1, fontSize: 8, fontWeight: '900', letterSpacing: .8, opacity: .76 }, ticketVenue: { fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: .8, opacity: .72, textTransform: 'uppercase' }, ticketCourt: { marginTop: 3, fontSize: 21, lineHeight: 27, fontWeight: '900' }, ticketCourtMeta: { marginTop: 2, fontSize: 10, lineHeight: 15, fontWeight: '600', opacity: .72 }, ticketBody: { padding: 17, backgroundColor: C.surface }, ticketWhen: { flexDirection: 'row', alignItems: 'center', gap: 12 }, ticketWhenIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.paper }, ticketWhenCopy: { flex: 1 }, ticketDate: { marginTop: 3, color: C.ink, fontSize: 15, lineHeight: 20, fontWeight: '900' }, ticketTime: { marginTop: 1, color: C.ink70, fontSize: 13, lineHeight: 18, fontWeight: '800' }, ticketTimezone: { marginTop: 3, color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, ticketDivider: { marginVertical: 16, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.line }, ticketDetails: { flexDirection: 'row', alignItems: 'flex-start' }, ticketDetail: { flex: 1 }, ticketDetailMiddle: { paddingLeft: 12, borderLeftWidth: 1, borderColor: C.line }, ticketDetailRight: { paddingLeft: 12, alignItems: 'flex-end', borderLeftWidth: 1, borderColor: C.line }, ticketValue: { marginTop: 4, color: C.ink, fontSize: 12, lineHeight: 17, fontWeight: '800' }, ticketTotal: { marginTop: 2, color: C.ink, fontSize: 18, lineHeight: 22, fontWeight: '900' }, shared: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, sharedText: { color: C.teal, fontSize: 11, fontWeight: '700' }, successActions: { width: '100%', marginTop: 14, flexDirection: 'row', gap: 10 }, calendarButton: { minHeight: 50, flex: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, calendarText: { color: C.teal, fontSize: 10, fontWeight: '800' }, successDone: { width: '100%', marginTop: 10, flexDirection: 'row' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
