import Modal from '../components/ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import AppIcon from '../components/AppIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useOpenPlaySession } from '../context/OpenPlaySessionContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { getCourtAvailability, listManagedVenues, loadActiveOpenPlay, verifiedPublishingVenues, syncOpenPlay, updateOpenPlayMatchScorer } from '../services/database';
import { completeFairPlayMatch, createOpenPlaySession, listOrganizerOpenPlaySessions, recordFairPlayAssignment, recordOpenPlayRally, undoOpenPlayRally } from '../services/openPlayRegistration';
import { buildFairPlayAssignment, estimateWaitMinutes, playersPerMatch, rankFairPlayQueue, rebalanceFairPlayQueue } from '../services/fairPlayEngine';
import { useOperations } from '../context/OperationsContext';
import BlinkingDot from '../components/BlinkingDot';
import { publishOpenPlayAnnouncement } from '../services/realtimeOperations';
import ConnectionStatus from '../components/ConnectionStatus';
import ScrollView from '../components/FocusResetScrollView';
import useResponsiveWidth from '../hooks/useResponsiveWidth';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { SKILL_CATEGORIES, skillCategory, skillRangeLabel } from '../utils/skillCategories';
import { noShadow } from '../utils/shadow';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA',
};
let C = LIGHT_C;

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const initials = (name) => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const playerName = (players, id) => players.find((player) => player.id === id)?.name || 'Player';

function Icon({ name, size = 20, color = C.ink }) {
  return <AppIcon name={name} size={size} color={color} />;
}

function KitchenLine() {
  return <View style={styles.kitchen}><View style={styles.solid} /><View style={styles.dashed} /></View>;
}

function TopBar({ eyebrow, title, onBack, right }) {
  return (
    <>
      <View style={styles.topBar}>
        {onBack && <Pressable accessibilityLabel="Go back" onPress={onBack} style={styles.iconButton}><Icon name="arrow-back" /></Pressable>}
        <View style={styles.topCopy}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.h1}>{title}</Text></View>
        {right}
      </View>
      <KitchenLine />
    </>
  );
}

function ChoiceGroup({ label, value, options, onChange }) {
  return <><Text style={styles.sectionLabel}>{label}</Text><View style={styles.choiceGroup}>{options.map((option) => {
    const active = value === option.value;
    return <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.choice, active && styles.choiceActive]}><Icon name={option.icon} size={15} color={active ? '#0E2321' : C.ink40} /><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{option.label}</Text></Pressable>;
  })}</View></>;
}

function defaultSchedule() {
  // Work with Manila wall-clock parts directly so defaults stay correct even
  // when the organizer's device is temporarily set to another time zone.
  const start = new Date(Date.now() + 8 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() + 1);
  if (start.getUTCHours() > 20) { start.setUTCDate(start.getUTCDate() + 1); start.setUTCHours(9); }
  else if (start.getUTCHours() < 6) start.setUTCHours(9);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const two = (value) => String(value).padStart(2, '0');
  const date = `${start.getUTCFullYear()}-${two(start.getUTCMonth() + 1)}-${two(start.getUTCDate())}`;
  const clock = (value) => `${two(value.getUTCHours())}:${two(value.getUTCMinutes())}`;
  return { date, startTime: clock(start), endTime: clock(end) };
}

const ROTATION_PRESETS = {
  balanced: { averageMatchMinutes: '15', maxConsecutiveGames: '2', restMinutes: '0' },
  equal_turns: { averageMatchMinutes: '15', maxConsecutiveGames: '1', restMinutes: '3' },
};

const DEFAULT_SESSION_RULES = {
  doubles: 'Doubles · First to 11 · Win by 2',
  singles: 'Singles · First to 11 · Win by 2',
  mixed: 'Singles & doubles · First to 11 · Win by 2',
};

const formatLabel = (value) => value === 'singles' ? 'Singles' : value === 'mixed' ? 'Both' : 'Doubles';
const courtSession = (session, court) => ({ ...session, matchFormat: court?.matchFormat || session.matchFormat });

function parseManualSchedule(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!dateMatch || !timeMatch) return null;
  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return new Date(`${date.trim()}T${time.trim()}:00+08:00`);
}

function manilaInputParts(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const scheduleDateLabel = (value) => value?.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) || 'Choose date';
const scheduleTimeLabel = (value) => value?.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }) || 'Choose time';
const clockTimeLabel = (value) => scheduleTimeLabel(new Date(`2026-01-01T${value}:00+08:00`));
const QUICK_TIME_OPTIONS = [
  { value: '06:00', label: '6:00 AM' },
  { value: '09:00', label: '9:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '15:00', label: '3:00 PM' },
  { value: '18:00', label: '6:00 PM' },
  { value: '21:00', label: '9:00 PM' },
];

function shiftClockTime(value, minutes) {
  const [hour, minute] = value.split(':').map(Number);
  const total = (hour * 60 + minute + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function monthFromDateInput(value) {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function calendarDays(monthCursor) {
  const year = monthCursor.getUTCFullYear();
  const month = monthCursor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const item = new Date(gridStart);
    item.setUTCDate(gridStart.getUTCDate() + index);
    const date = `${item.getUTCFullYear()}-${String(item.getUTCMonth() + 1).padStart(2, '0')}-${String(item.getUTCDate()).padStart(2, '0')}`;
    return { date, day: item.getUTCDate(), inMonth: item.getUTCMonth() === month };
  });
}

function Setup({ organizerName, onBack, onStart }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const publishingRef = useRef(false);
  const defaults = useMemo(defaultSchedule, []);
  const [step, setStep] = useState(1);
  const [venues, setVenues] = useState([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venueId, setVenueId] = useState('');
  const [venuePickerVisible, setVenuePickerVisible] = useState(false);
  const [venueSearch, setVenueSearch] = useState('');
  const [sessionName, setSessionName] = useState('Community open play');
  const [selectedCourtIds, setSelectedCourtIds] = useState([]);
  const [courtAvailability, setCourtAvailability] = useState(null);
  const [courtsLoading, setCourtsLoading] = useState(false);
  const [courtsError, setCourtsError] = useState('');
  const [capacity, setCapacity] = useState('24');
  const [visibility, setVisibility] = useState('public');
  const [approvalMode, setApprovalMode] = useState('automatic');
  const [matchFormat, setMatchFormat] = useState('doubles');
  const [courtFormats, setCourtFormats] = useState({});
  const [rotationPreset, setRotationPreset] = useState('balanced');
  const [averageMatchMinutes, setAverageMatchMinutes] = useState('15');
  const [maxConsecutiveGames, setMaxConsecutiveGames] = useState('2');
  const [restMinutes, setRestMinutes] = useState('0');
  const [date, setDate] = useState(defaults.date);
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [endTime, setEndTime] = useState(defaults.endTime);
  const [pickerField, setPickerField] = useState(null);
  const [timeDraft, setTimeDraft] = useState(defaults.startTime);
  const [pickerMonth, setPickerMonth] = useState(() => monthFromDateInput(defaults.date));
  const [skillMin, setSkillMin] = useState('');
  const [skillMax, setSkillMax] = useState('');
  const [skillCategoryValue, setSkillCategoryValue] = useState('open');
  const [fee, setFee] = useState('0');
  const [rules, setRules] = useState(DEFAULT_SESSION_RULES.doubles);
  const [cancellationPolicy, setCancellationPolicy] = useState('Cancel before the session starts so a waitlisted player can take your place.');
  const [names, setNames] = useState('');
  const [includeOrganizer, setIncludeOrganizer] = useState(true);
  const [showOptional, setShowOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historySegment, setHistorySegment] = useState('past');
  const [historySessions, setHistorySessions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const selectedVenue = useMemo(() => venues.find((venue) => venue.id === venueId) || null, [venueId, venues]);
  const selectedVenueCourts = useMemo(() => [...(selectedVenue?.courts || [])]
    .filter((court) => court.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [selectedVenue]);
  const filteredVenues = useMemo(() => {
    const query = venueSearch.trim().toLowerCase();
    if (!query) return venues;
    return venues.filter((venue) => `${venue.name} ${venue.area || ''} ${venue.address || ''}`.toLowerCase().includes(query));
  }, [venueSearch, venues]);
  const pickerCalendarDays = useMemo(() => calendarDays(pickerMonth), [pickerMonth]);
  const todayInput = manilaInputParts(new Date()).date;
  const parsedNames = useMemo(() => [...new Set(names.split(/[\n,]+/).map((name) => name.trim()).filter(Boolean))], [names]);
  const registeredNames = useMemo(() => includeOrganizer && !parsedNames.some((name) => name.toLowerCase() === organizerName.toLowerCase()) ? [organizerName, ...parsedNames] : parsedNames, [includeOrganizer, organizerName, parsedNames]);
  const capacityNumber = Number(capacity);
  const feeNumber = Number(fee);
  const averageMatchMinutesNumber = Number(averageMatchMinutes);
  const maxConsecutiveGamesNumber = Number(maxConsecutiveGames);
  const restMinutesNumber = Number(restMinutes);
  const skillMinNumber = skillMin.trim() ? Number(skillMin) : null;
  const skillMaxNumber = skillMax.trim() ? Number(skillMax) : null;
  const scheduledStart = parseManualSchedule(date, startTime);
  const scheduledEndSameDay = parseManualSchedule(date, endTime);
  const scheduledEnd = scheduledStart && scheduledEndSameDay && scheduledEndSameDay <= scheduledStart ? new Date(scheduledEndSameDay.getTime() + 24 * 60 * 60 * 1000) : scheduledEndSameDay;
  const scheduledStartIso = scheduledStart?.toISOString() || '';
  const scheduledEndIso = scheduledEnd?.toISOString() || '';
  const spansNextDay = Boolean(scheduledStart && scheduledEnd && manilaInputParts(scheduledStart).date !== manilaInputParts(scheduledEnd).date);
  const scheduleValid = Boolean(scheduledStart && scheduledEnd && scheduledStart > new Date() && scheduledEnd > scheduledStart);
  const pickerDraftStart = pickerField === 'start' ? parseManualSchedule(date, timeDraft) : null;
  const pickerDraftStartPassed = Boolean(pickerDraftStart && pickerDraftStart <= new Date());
  const availableCourtIds = useMemo(() => new Set((courtAvailability || []).filter((item) => item.available).map((item) => item.court_id)), [courtAvailability]);
  const courtAvailabilityById = useMemo(() => new Map((courtAvailability || []).map((item) => [item.court_id, item])), [courtAvailability]);
  const availableCourtCount = availableCourtIds.size;
  const courtCount = selectedCourtIds.length;
  const selectedCourtFormats = useMemo(() => selectedCourtIds.map((id, index) => (
    matchFormat === 'mixed'
      ? courtFormats[id] || (index % 2 === 0 ? 'doubles' : 'singles')
      : matchFormat
  )), [courtFormats, matchFormat, selectedCourtIds]);
  const validSkill = (skillMinNumber == null || Number.isFinite(skillMinNumber) && skillMinNumber >= 1 && skillMinNumber <= 5.5) && (skillMaxNumber == null || Number.isFinite(skillMaxNumber) && skillMaxNumber >= 1 && skillMaxNumber <= 5.5) && (skillMinNumber == null || skillMaxNumber == null || skillMinNumber <= skillMaxNumber);
  const basicsValid = Boolean(venueId && sessionName.trim().length >= 3 && Number.isInteger(capacityNumber) && capacityNumber >= 4 && capacityNumber <= 200 && scheduleValid && courtCount > 0 && courtCount <= 50 && !courtsLoading && !courtsError);
  const rotationValid = Number.isInteger(averageMatchMinutesNumber) && averageMatchMinutesNumber >= 5 && averageMatchMinutesNumber <= 90 && Number.isInteger(maxConsecutiveGamesNumber) && maxConsecutiveGamesNumber >= 0 && maxConsecutiveGamesNumber <= 10 && Number.isInteger(restMinutesNumber) && restMinutesNumber >= 0 && restMinutesNumber <= 120;
  const formatValid = matchFormat !== 'mixed' || courtCount >= 2;
  const rotationStepValid = rotationValid && formatValid;
  const joiningValid = rules.trim() && cancellationPolicy.trim() && validSkill && registeredNames.length <= capacityNumber && Number.isFinite(feeNumber) && feeNumber >= 0;
  const canStart = basicsValid && rotationStepValid && joiningValid;

  const scheduleMessage = !scheduledStart || !scheduledEnd
    ? 'Choose the date, start time, and end time.'
    : scheduledStart <= new Date()
      ? 'Choose a start time that has not passed yet.'
      : '';

  useEffect(() => {
    listManagedVenues().then((managed) => {
      const rows = verifiedPublishingVenues(managed).filter((venue) => ['owner', 'manager', 'admin'].includes(venue.role));
      setVenues(rows);
      if (rows[0]) setVenueId((current) => current || rows[0].id);
    }).catch((loadError) => setError(loadError.message || 'Verified venues could not be loaded.')).finally(() => setVenuesLoading(false));
  }, []);

  useEffect(() => {
    if (!historyVisible) return undefined;
    let current = true;
    setHistoryLoading(true);
    setHistoryError('');
    listOrganizerOpenPlaySessions({ segment: historySegment })
      .then((rows) => { if (current) setHistorySessions(rows); })
      .catch((loadError) => { if (current) setHistoryError(loadError.message || 'Sessions could not be loaded.'); })
      .finally(() => { if (current) setHistoryLoading(false); });
    return () => { current = false; };
  }, [historyVisible, historySegment]);

  useEffect(() => {
    let current = true;
    if (!selectedVenueCourts.length || !scheduleValid) {
      setCourtAvailability(null);
      setSelectedCourtIds([]);
      setCourtsLoading(false);
      return () => { current = false; };
    }
    setCourtsLoading(true);
    setCourtsError('');
    getCourtAvailability(selectedVenueCourts.map((court) => court.id), scheduledStartIso, scheduledEndIso)
      .then((rows) => {
        if (!current) return;
        const allowed = new Set(rows.filter((item) => item.available).map((item) => item.court_id));
        setCourtAvailability(rows);
        setSelectedCourtIds((selected) => {
          const stillAvailable = selected.filter((id) => allowed.has(id));
          return stillAvailable.length ? stillAvailable : selectedVenueCourts.filter((court) => allowed.has(court.id)).slice(0, 2).map((court) => court.id);
        });
      })
      .catch((loadError) => {
        if (!current) return;
        setCourtAvailability([]);
        setSelectedCourtIds([]);
        setCourtsError(loadError.message || 'Court availability could not be checked.');
      })
      .finally(() => { if (current) setCourtsLoading(false); });
    return () => { current = false; };
  }, [scheduleValid, scheduledEndIso, scheduledStartIso, selectedVenueCourts]);

  const chooseRotationPreset = (value) => {
    setRotationPreset(value);
    const preset = ROTATION_PRESETS[value];
    if (!preset) return;
    setAverageMatchMinutes(preset.averageMatchMinutes);
    setMaxConsecutiveGames(preset.maxConsecutiveGames);
    setRestMinutes(preset.restMinutes);
  };

  const chooseMatchFormat = (value) => {
    if (value === matchFormat) return;
    setMatchFormat(value);
    setRules((current) => current === DEFAULT_SESSION_RULES[matchFormat] ? DEFAULT_SESSION_RULES[value] : current);
  };

  const toggleCourtFormat = (courtIdToToggle, index) => {
    const current = courtFormats[courtIdToToggle] || (index % 2 === 0 ? 'doubles' : 'singles');
    setCourtFormats((formats) => ({ ...formats, [courtIdToToggle]: current === 'doubles' ? 'singles' : 'doubles' }));
  };

  const chooseSkillCategory = (value) => {
    const category = skillCategory(value);
    setSkillCategoryValue(value);
    setSkillMin(category.min == null ? '' : String(category.min));
    setSkillMax(category.max == null ? '' : String(category.max));
  };

  const openSchedulePicker = (field) => {
    if (field === 'date') setPickerMonth(monthFromDateInput(date));
    if (field === 'start') setTimeDraft(startTime);
    if (field === 'end') setTimeDraft(endTime);
    setPickerField(field);
  };

  const chooseScheduleDate = (value) => {
    setDate(value);
    setPickerField(null);
  };

  const chooseScheduleTime = (value) => {
    if (pickerField === 'start') {
      const nextStart = parseManualSchedule(date, value);
      if (!nextStart || nextStart <= new Date()) return;
      setStartTime(value);
    }
    else setEndTime(value);
    setPickerField(null);
  };

  const changePickerMonth = (amount) => setPickerMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + amount, 1)));

  const selectVenue = (venue) => {
    setVenueId(venue.id);
    setSelectedCourtIds([]);
    setCourtAvailability(null);
    setCourtsError('');
    setVenuePickerVisible(false);
    setVenueSearch('');
  };

  const toggleCourt = (courtIdToToggle) => {
    if (!availableCourtIds.has(courtIdToToggle)) return;
    setSelectedCourtIds((selected) => {
      if (selected.includes(courtIdToToggle)) return selected.filter((id) => id !== courtIdToToggle);
      return selected.length < 50 ? [...selected, courtIdToToggle] : selected;
    });
  };

  const closeVenuePicker = () => {
    setVenuePickerVisible(false);
    setVenueSearch('');
  };

  const moveToStep = (nextStep) => {
    setError('');
    setStep(nextStep);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  };

  const submit = async () => {
    if (publishingRef.current) return;
    if (!scheduledStart || scheduledStart <= new Date()) {
      setStep(1);
      setError('Choose a start time that has not passed yet.');
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
      return;
    }
    if (!canStart) return;
    publishingRef.current = true;
    setBusy(true); setError('');
    try {
      await onStart({
        name: sessionName.trim(), venueId, courtIds: selectedCourtIds, courtCount, capacity: capacityNumber, visibility, approvalMode,
        skillMin: skillMinNumber,
        skillMax: skillMaxNumber,
        feeAmount: feeNumber, scheduledStart: scheduledStart.toISOString(), scheduledEnd: scheduledEnd.toISOString(),
        rules,
        cancellationPolicy,
        matchFormat,
        courtFormats: selectedCourtFormats,
        averageMatchMinutes: averageMatchMinutesNumber,
        maxConsecutiveGames: maxConsecutiveGamesNumber,
        restMinutes: restMinutesNumber,
        names: registeredNames,
      });
    } catch (submitError) {
      setError(submitError.message || 'The session could not be published.');
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
    finally { publishingRef.current = false; setBusy(false); }
  };

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <TopBar eyebrow="ORGANIZER MODE" title="Set up open play" onBack={step === 1 ? onBack : () => moveToStep(step - 1)} right={step === 1 ? <View style={styles.setupHeaderActions}><Pressable accessibilityRole="button" accessibilityLabel="View past sessions" onPress={() => setHistoryVisible(true)} style={styles.historyButton}><Icon name="time-outline" size={17} color={C.teal} /></Pressable><View style={styles.rolePill}><Text style={styles.roleText}>{step} OF 3</Text></View></View> : <View style={styles.rolePill}><Text style={styles.roleText}>{step} OF 3</Text></View>} />

      <View style={styles.setupProgress}>{[1, 2, 3].map((item) => <View key={item} style={[styles.progressBar, item <= step && styles.progressBarActive]} />)}</View>
      {error && step !== 3 ? <View style={styles.setupError}><Icon name="alert-circle" color={C.brick} /><Text style={styles.setupErrorText}>{error}</Text></View> : null}

      {step === 1 ? <>
        <View style={styles.stepIntro}><View style={styles.stepIntroIcon}><Icon name="calendar-outline" size={21} color="#0E2321" /></View><View style={styles.flex}><Text style={[styles.stepIntroTitle, { color: '#0E2321' }]}>When and where?</Text><Text style={[styles.stepIntroBody, { color: 'rgba(14,35,33,.72)' }]}>Start with only the details players need to find the session.</Text></View></View>

        <Text style={styles.sectionLabel}>SESSION NAME</Text>
        <TextInput accessibilityLabel="Session name" value={sessionName} onChangeText={setSessionName} maxLength={80} placeholder="Community open play" placeholderTextColor={C.ink40} style={styles.singleInput} />

        <Text style={styles.sectionLabel}>VERIFIED VENUE</Text>
        {venuesLoading ? <View style={styles.venueLoading}><ActivityIndicator color={C.teal} /><Text style={styles.venueLoadingText}>Loading verified venues…</Text></View> : selectedVenue ? <Pressable accessibilityRole="button" accessibilityLabel={`Change venue, currently ${selectedVenue.name}`} onPress={() => setVenuePickerVisible(true)} style={styles.selectedVenueCard}><View style={styles.selectedVenueIcon}><Icon name="location" color={C.teal} /></View><View style={styles.flex}><Text numberOfLines={1} style={styles.selectedVenueName}>{selectedVenue.name}</Text><Text numberOfLines={1} style={styles.selectedVenueMeta}>{selectedVenue.area || selectedVenue.address || 'Verified Peakle venue'}</Text></View><View style={styles.changeVenuePill}><Text style={styles.changeVenueText}>CHANGE</Text><Icon name="chevron-forward" size={14} color={C.teal} /></View></Pressable> : venues.length ? <Pressable onPress={() => setVenuePickerVisible(true)} style={styles.venueLoading}><Icon name="search-outline" color={C.teal} /><Text style={styles.venueLoadingText}>Choose a verified venue</Text></Pressable> : <View style={styles.venueLoading}><Icon name="location-outline" color={C.ink40} /><Text style={styles.venueLoadingText}>You need owner or manager access to a verified venue.</Text></View>}

        <Text style={styles.sectionLabel}>DATE & TIME</Text>
        <View style={styles.scheduleCard}>
          <Text style={styles.inputLabel}>SESSION DATE</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Choose session date, currently ${scheduleDateLabel(scheduledStart)}`} onPress={() => openSchedulePicker('date')} style={styles.schedulePickerField}><View style={styles.schedulePickerIcon}><Icon name="calendar-outline" size={19} color={C.teal} /></View><Text style={styles.schedulePickerValue}>{scheduleDateLabel(scheduledStart)}</Text><Icon name="chevron-down" size={17} color={C.ink40} /></Pressable>
          <View style={styles.timeFields}>
            <View style={styles.timeField}><Text style={styles.inputLabel}>START TIME</Text><Pressable accessibilityRole="button" accessibilityLabel={`Choose start time, currently ${scheduleTimeLabel(scheduledStart)}`} onPress={() => openSchedulePicker('start')} style={styles.timePickerField}><Icon name="time-outline" size={17} color={C.teal} /><Text style={styles.timePickerValue}>{scheduleTimeLabel(scheduledStart)}</Text></Pressable></View>
            <View style={styles.timeField}><Text style={styles.inputLabel}>END TIME</Text><Pressable accessibilityRole="button" accessibilityLabel={`Choose end time, currently ${scheduleTimeLabel(scheduledEnd)}`} onPress={() => openSchedulePicker('end')} style={styles.timePickerField}><Icon name="flag-outline" size={17} color={C.teal} /><Text style={styles.timePickerValue}>{scheduleTimeLabel(scheduledEnd)}</Text></Pressable></View>
          </View>
          <View style={styles.timezoneRow}><Icon name="globe-outline" size={13} color={C.ink40} /><Text style={styles.timezoneText}>Asia/Manila (UTC+8){spansNextDay ? ' · Ends the next day' : ''}</Text></View>
        </View>
        {scheduleMessage ? <Text style={styles.inputError}>{scheduleMessage}</Text> : null}

        <View style={styles.courtSelectionHead}><Text style={styles.sectionLabel}>COURTS FOR OPEN PLAY</Text><View style={styles.courtAvailabilityMeta}>{courtsLoading ? <ActivityIndicator size="small" color={C.teal} /> : null}<Text style={styles.courtAvailabilityCount}>{courtsLoading ? 'Checking…' : `${availableCourtCount} available`}</Text></View></View>
        {selectedVenueCourts.length ? <View style={styles.setupCourtGrid}>{selectedVenueCourts.map((court) => {
          const selected = selectedCourtIds.includes(court.id);
          const availability = courtAvailabilityById.get(court.id);
          const available = Boolean(availability?.available);
          return <Pressable key={court.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: !available }} disabled={!available || courtsLoading} onPress={() => toggleCourt(court.id)} style={[styles.setupCourtChoice, selected && styles.setupCourtChoiceActive, !available && !courtsLoading && styles.setupCourtChoiceUnavailable]}><View style={[styles.setupCourtCheck, selected && styles.setupCourtCheckActive]}><Icon name={selected ? 'checkmark' : available ? 'tennisball-outline' : 'lock-closed-outline'} size={16} color={selected ? '#0E2321' : available ? C.teal : C.ink40} /></View><View style={styles.flex}><Text numberOfLines={1} style={styles.setupCourtName}>{court.name}</Text><Text style={[styles.setupCourtStatus, available && styles.setupCourtStatusAvailable]}>{courtsLoading || !courtAvailability ? 'Checking schedule' : available ? 'Available' : availability?.reason || 'Unavailable'}</Text></View></Pressable>;
        })}</View> : <View style={styles.noCourtsCard}><Icon name="alert-circle-outline" color={C.ink40} /><Text style={styles.noCourtsText}>This center has no active courts to select.</Text></View>}
        {courtsError ? <Text style={styles.inputError}>{courtsError}</Text> : courtAvailability && !availableCourtCount ? <Text style={styles.inputError}>No courts are available at this center for the selected time.</Text> : <Text style={styles.courtSelectionHelp}>{courtCount ? `${courtCount} ${courtCount === 1 ? 'court' : 'courts'} selected` : 'Select at least one available court.'}</Text>}

        <Text style={styles.sectionLabel}>PLAYER CAPACITY</Text>
        <View style={styles.capacityCard}><View style={styles.capacityIcon}><Icon name="people-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.capacityTitle}>Maximum players</Text><Text style={styles.capacityMeta}>You can still close registration early.</Text></View><TextInput accessibilityLabel="Maximum player capacity" keyboardType="number-pad" value={capacity} onChangeText={setCapacity} maxLength={3} style={styles.capacityInput} /></View>

        <Pressable disabled={!basicsValid} onPress={() => moveToStep(2)} style={({ pressed }) => [styles.primaryButton, !basicsValid && styles.disabledButton, pressed && basicsValid && styles.pressed]}><Text style={styles.primaryText}>Continue to rotation</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable>
      </> : null}

      {step === 2 ? <>
        <View style={styles.stepIntro}><View style={styles.stepIntroIcon}><Icon name="sync-outline" size={21} color="#0E2321" /></View><View style={styles.flex}><Text style={[styles.stepIntroTitle, { color: '#0E2321' }]}>How should rotation work?</Text><Text style={[styles.stepIntroBody, { color: 'rgba(14,35,33,.72)' }]}>Pick a ready-made setup or tune every control yourself.</Text></View></View>

        <ChoiceGroup label="MATCH FORMAT" value={matchFormat} onChange={chooseMatchFormat} options={[{ value: 'doubles', label: 'Doubles', icon: 'people-outline' }, { value: 'singles', label: 'Singles', icon: 'person-outline' }, { value: 'mixed', label: 'Both', icon: 'git-compare-outline' }]} />

        {matchFormat === 'mixed' ? <>
          <View style={styles.mixedFormatIntro}><View style={styles.mixedFormatIcon}><Icon name="sparkles-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.mixedFormatTitle}>Courts assigned automatically</Text><Text style={styles.mixedFormatMeta}>Peakle alternates doubles and singles. Tap a court only when you want to switch it.</Text></View></View>
          <Text style={styles.sectionLabel}>COURT FORMATS</Text>
          <View style={styles.courtFormatList}>{selectedCourtIds.map((id, index) => {
            const court = selectedVenueCourts.find((item) => item.id === id);
            const format = selectedCourtFormats[index];
            return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${court?.name || `Court ${index + 1}`}, ${formatLabel(format)}. Tap to switch.`} onPress={() => toggleCourtFormat(id, index)} style={styles.courtFormatRow}><View style={styles.courtFormatNumber}><Text style={styles.courtFormatNumberText}>{index + 1}</Text></View><View style={styles.flex}><Text style={styles.courtFormatName}>{court?.name || `Court ${index + 1}`}</Text><Text style={styles.courtFormatHint}>Tap to switch format</Text></View><View style={[styles.courtFormatPill, format === 'singles' && styles.courtFormatPillSingles]}><Icon name={format === 'singles' ? 'person-outline' : 'people-outline'} size={14} color={format === 'singles' ? C.teal : '#0E2321'} /><Text style={[styles.courtFormatText, format === 'singles' ? styles.courtFormatTextSingles : { color: '#0E2321' }]}>{formatLabel(format)}</Text></View></Pressable>;
          })}</View>
        </> : null}

        <Text style={styles.sectionLabel}>ROTATION STYLE</Text>
        <View style={styles.rotationPresetList}>
          {[
            ['balanced', 'Balanced', 'Up to 2 games in a row · no forced rest', 'sparkles-outline'],
            ['equal_turns', 'Equal turns', '1 game at a time · 3-minute rest', 'repeat-outline'],
            ['custom', 'Custom controls', 'Set match length, consecutive games, and rest', 'options-outline'],
          ].map(([value, title, meta, icon]) => { const active = rotationPreset === value; return <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} key={value} onPress={() => chooseRotationPreset(value)} style={[styles.rotationPreset, active && styles.rotationPresetActive]}><View style={[styles.rotationPresetIcon, active && styles.rotationPresetIconActive]}><Icon name={icon} size={18} color={active ? '#0E2321' : C.teal} /></View><View style={styles.flex}><Text style={styles.rotationPresetTitle}>{title}</Text><Text style={styles.rotationPresetMeta}>{meta}</Text></View><Icon name={active ? 'checkmark-circle' : 'ellipse-outline'} color={active ? C.teal : C.ink40} /></Pressable>; })}
        </View>

        {rotationPreset === 'custom' ? <><Text style={styles.sectionLabel}>CUSTOM ROTATION CONTROLS</Text><View style={styles.rotationControlList}>
          <View style={styles.rotationControl}><View style={styles.rotationControlCopy}><Text style={styles.rotationControlTitle}>Average match length</Text><Text style={styles.rotationControlMeta}>Used only for player wait estimates.</Text></View><View style={styles.rotationControlValue}><TextInput accessibilityLabel="Average match length in minutes" keyboardType="number-pad" value={averageMatchMinutes} onChangeText={setAverageMatchMinutes} maxLength={2} style={styles.rotationControlInput} /><Text numberOfLines={1} allowFontScaling={false} style={styles.rotationControlUnit}>MIN</Text></View></View>
          <View style={styles.rotationControl}><View style={styles.rotationControlCopy}><Text style={styles.rotationControlTitle}>Maximum games in a row</Text><Text style={styles.rotationControlMeta}>Use 0 when there is no limit.</Text></View><View style={styles.rotationControlValueSolo}><TextInput accessibilityLabel="Maximum consecutive games" keyboardType="number-pad" value={maxConsecutiveGames} onChangeText={setMaxConsecutiveGames} maxLength={2} style={styles.rotationControlInput} /></View></View>
          <View style={styles.rotationControl}><View style={styles.rotationControlCopy}><Text style={styles.rotationControlTitle}>Rest after a match</Text><Text style={styles.rotationControlMeta}>Use 0 when rest is optional.</Text></View><View style={styles.rotationControlValue}><TextInput accessibilityLabel="Rest minutes after a match" keyboardType="number-pad" value={restMinutes} onChangeText={setRestMinutes} maxLength={3} style={styles.rotationControlInput} /><Text numberOfLines={1} allowFontScaling={false} style={styles.rotationControlUnit}>MIN</Text></View></View>
        </View></> : null}
        {!formatValid ? <Text style={styles.inputError}>Both formats need at least two courts. Select Singles or Doubles for a one-court session.</Text> : null}
        {!rotationValid ? <Text style={styles.inputError}>Match length must be 5–90 minutes, consecutive games 0–10, and rest 0–120 minutes.</Text> : null}

        <View style={styles.manualInfo}><View style={styles.manualInfoIcon}><Icon name="hand-left-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.manualInfoTitle}>You stay in control</Text><Text style={styles.manualInfoMeta}>For every open court, use Peakle’s fair recommendation or tap “Choose manually” to build the lineup yourself.</Text></View></View>

        <Pressable disabled={!rotationStepValid} onPress={() => moveToStep(3)} style={({ pressed }) => [styles.primaryButton, !rotationStepValid && styles.disabledButton, pressed && rotationStepValid && styles.pressed]}><Text style={styles.primaryText}>Continue</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable>
      </> : null}

      {step === 3 ? <>
        <View style={styles.stepIntro}><View style={styles.stepIntroIcon}><Icon name="people-outline" size={21} color="#0E2321" /></View><View style={styles.flex}><Text style={[styles.stepIntroTitle, { color: '#0E2321' }]}>Who can join?</Text><Text style={[styles.stepIntroBody, { color: 'rgba(14,35,33,.72)' }]}>The recommended defaults are already selected. Change only what you need.</Text></View></View>

        <ChoiceGroup label="SESSION ACCESS" value={visibility} onChange={setVisibility} options={[{ value: 'public', label: 'Public', icon: 'earth-outline' }, { value: 'private', label: 'Code only', icon: 'key-outline' }, { value: 'invite_only', label: 'Invite only', icon: 'mail-outline' }]} />
        <ChoiceGroup label="JOIN APPROVAL" value={approvalMode} onChange={setApprovalMode} options={[{ value: 'automatic', label: 'Automatic', icon: 'flash-outline' }, { value: 'manual', label: 'Review first', icon: 'person-add-outline' }]} />

        <View style={styles.fieldHead}><Text style={styles.sectionLabel}>ADD PLAYERS NOW · OPTIONAL</Text><Text style={styles.countText}>{registeredNames.length} ADDED</Text></View>
        <TextInput accessibilityLabel="Player registration list" multiline value={names} onChangeText={setNames} placeholder={'Paste or type player names\nOne name per line'} placeholderTextColor={C.ink40} style={styles.nameInput} />
        <Text style={styles.helper}>You can also check in walk-ins after publishing.</Text>

        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: includeOrganizer }} onPress={() => setIncludeOrganizer((value) => !value)} style={[styles.joinCard, includeOrganizer && styles.joinCardActive]}><View style={[styles.joinCheck, includeOrganizer && styles.joinCheckActive]}><Icon name={includeOrganizer ? 'checkmark' : 'person-outline'} size={17} color={includeOrganizer ? '#0E2321' : C.teal} /></View><View style={styles.flex}><Text style={styles.joinTitle}>I’m playing too</Text><Text style={styles.joinMeta}>Add {organizerName} to the first waiting pool.</Text></View></Pressable>

        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showOptional }} onPress={() => setShowOptional((value) => !value)} style={styles.optionalToggle}><View style={styles.optionalIcon}><Icon name="options-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.optionalTitle}>Optional session settings</Text><Text style={styles.optionalMeta}>Skill category, fee, rules, and cancellation</Text></View><Icon name={showOptional ? 'chevron-up' : 'chevron-down'} color={C.teal} /></Pressable>

        {showOptional ? <View style={styles.optionalPanel}>
          <Text style={styles.sectionLabel}>SKILL CATEGORY</Text>
          <View style={styles.skillCategoryGrid}>{SKILL_CATEGORIES.map((category) => { const active = skillCategoryValue === category.value; return <Pressable key={category.value} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => chooseSkillCategory(category.value)} style={[styles.skillCategoryChoice, active && styles.skillCategoryChoiceActive]}><View style={[styles.skillCategoryIcon, active && styles.skillCategoryIconActive]}><Icon name={category.value === 'novice' ? 'leaf-outline' : category.value === 'intermediate' ? 'trending-up-outline' : category.value === 'advanced' ? 'trophy-outline' : 'people-outline'} size={16} color={active ? '#0E2321' : C.teal} /></View><View style={styles.flex}><Text style={[styles.skillCategoryTitle, active && styles.skillCategoryTitleActive]}>{category.label}</Text><Text style={styles.skillCategoryRange}>{category.rangeLabel}</Text></View>{active ? <Icon name="checkmark-circle" size={17} color={C.teal} /> : null}</Pressable>; })}</View>
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: skillCategoryValue === 'custom' }} onPress={() => setSkillCategoryValue('custom')} style={[styles.customSkillToggle, skillCategoryValue === 'custom' && styles.customSkillToggleActive]}><Icon name="options-outline" size={17} color={C.teal} /><View style={styles.flex}><Text style={styles.customSkillTitle}>Custom rating range</Text><Text style={styles.customSkillMeta}>Use precise minimum and maximum ratings.</Text></View><Icon name={skillCategoryValue === 'custom' ? 'checkmark-circle' : 'chevron-forward'} size={18} color={C.teal} /></Pressable>
          {skillCategoryValue === 'custom' ? <View style={styles.numericRow}><View style={styles.numericField}><Text style={styles.numericLabel}>MIN RATING</Text><TextInput accessibilityLabel="Minimum player rating" keyboardType="decimal-pad" value={skillMin} onChangeText={setSkillMin} placeholder="Any" placeholderTextColor={C.ink40} style={styles.numericInput} /></View><View style={styles.numericField}><Text style={styles.numericLabel}>MAX RATING</Text><TextInput accessibilityLabel="Maximum player rating" keyboardType="decimal-pad" value={skillMax} onChangeText={setSkillMax} placeholder="Any" placeholderTextColor={C.ink40} style={styles.numericInput} /></View></View> : null}
          <Text style={styles.sectionLabel}>PLAYER FEE</Text>
          <View style={[styles.numericField, styles.feeField]}><Text style={styles.numericLabel}>FEE ₱</Text><TextInput accessibilityLabel="Player fee in pesos" keyboardType="decimal-pad" value={fee} onChangeText={setFee} style={styles.numericInput} /></View>
          <Text style={styles.sectionLabel}>SESSION RULES</Text>
          <TextInput value={rules} onChangeText={setRules} maxLength={180} placeholder="Session rules" placeholderTextColor={C.ink40} style={styles.singleInput} />
          <TextInput multiline value={cancellationPolicy} onChangeText={setCancellationPolicy} maxLength={300} placeholder="Cancellation policy" placeholderTextColor={C.ink40} style={[styles.nameInput, styles.policyInput]} />
        </View> : null}

        {!joiningValid ? <Text style={styles.inputError}>Check capacity, player count, skill range, fee, rules, and cancellation details.</Text> : null}
        <View style={styles.reviewCard}><Text style={styles.reviewEyebrow}>READY TO PUBLISH</Text><Text style={styles.reviewTitle}>{sessionName.trim() || 'Open play'}</Text><Text style={styles.reviewMeta}>{scheduleDateLabel(scheduledStart)} · {scheduleTimeLabel(scheduledStart)}–{scheduleTimeLabel(scheduledEnd)}{spansNextDay ? ' next day' : ''} · {courtCount} {courtCount === 1 ? 'court' : 'courts'} · {capacity} players · {skillRangeLabel(skillMinNumber, skillMaxNumber)}</Text></View>
        {error ? <View style={styles.setupError}><Icon name="alert-circle" color={C.brick} /><Text style={styles.setupErrorText}>{error}</Text></View> : null}
        <Pressable disabled={!canStart || busy} onPress={submit} style={({ pressed }) => [styles.primaryButton, (!canStart || busy) && styles.disabledButton, pressed && canStart && styles.pressed]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.primaryText}>{canStart ? 'Publish open play' : 'Review missing details'}</Text><Icon name="checkmark" color="#0E2321" /></>}</Pressable>
      </> : null}
    </ScrollView>
    <Modal visible={venuePickerVisible} transparent animationType="slide" onRequestClose={closeVenuePicker} statusBarTranslucent>
      <KeyboardAvoidingView {...webDialog('backdrop')} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
        <View {...webDialog('surface')} style={[styles.sheet, styles.venuePickerSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
          <View {...webDialog('handle')} style={styles.sheetHandle} />
          <View style={styles.venuePickerHead}><View style={styles.flex}><Text style={styles.eyebrow}>VERIFIED VENUES</Text><Text style={styles.sheetTitle}>Choose a venue</Text></View><Pressable accessibilityLabel="Close venue picker" onPress={closeVenuePicker} style={styles.iconButton}><Icon name="close" /></Pressable></View>
          <View style={styles.venueSearchBox}><Icon name="search-outline" size={18} color={C.ink40} /><TextInput value={venueSearch} onChangeText={setVenueSearch} placeholder="Search venue or area" placeholderTextColor={C.ink40} style={styles.venueSearchInput} /></View>
          <FlatList style={styles.venueFlatList} data={filteredVenues} keyExtractor={(venue) => venue.id} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.venueList} renderItem={({ item }) => { const active = item.id === venueId; return <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => selectVenue(item)} style={[styles.venueListItem, active && styles.venueListItemActive]}><View style={[styles.venueListIcon, active && styles.venueListIconActive]}><Icon name={active ? 'checkmark' : 'location-outline'} size={18} color={active ? '#0E2321' : C.teal} /></View><View style={styles.flex}><Text numberOfLines={1} style={styles.venueListName}>{item.name}</Text><Text numberOfLines={1} style={styles.venueListMeta}>{item.area || item.address || 'Verified Peakle venue'}</Text></View><Icon name="chevron-forward" size={16} color={C.ink40} /></Pressable>; }} ListEmptyComponent={<View style={styles.venueEmpty}><Icon name="search-outline" size={26} color={C.ink40} /><Text style={styles.venueEmptyTitle}>No venue found</Text><Text style={styles.venueEmptyMeta}>Try a venue name, city, or area.</Text></View>} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <Modal visible={historyVisible} transparent animationType="slide" onRequestClose={() => setHistoryVisible(false)} statusBarTranslucent>
      <View {...webDialog('backdrop')} style={styles.modalBackdrop}>
        <View {...webDialog('surface')} style={[styles.sheet, styles.venuePickerSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
          <View {...webDialog('handle')} style={styles.sheetHandle} />
          <View style={styles.venuePickerHead}><View style={styles.flex}><Text style={styles.eyebrow}>OPEN PLAY</Text><Text style={styles.sheetTitle}>Session history</Text></View><Pressable accessibilityLabel="Close session history" onPress={() => setHistoryVisible(false)} style={styles.iconButton}><Icon name="close" /></Pressable></View>
          <View style={styles.historyTabs}>{[['upcoming', 'Upcoming'], ['current', 'Current'], ['past', 'Past']].map(([value, label]) => { const active = historySegment === value; return <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setHistorySegment(value)} style={[styles.historyTab, active && styles.historyTabActive]}><Text style={[styles.historyTabText, active && styles.historyTabTextActive]}>{label}</Text></Pressable>; })}</View>
          {historyLoading ? <View style={styles.venueEmpty}><ActivityIndicator color={C.teal} /><Text style={styles.venueEmptyMeta}>Loading sessions…</Text></View>
            : historyError ? <View style={styles.venueEmpty}><Icon name="cloud-offline-outline" size={26} color={C.ink40} /><Text style={styles.venueEmptyTitle}>Sessions could not load</Text><Text style={styles.venueEmptyMeta}>{historyError}</Text></View>
            : <FlatList style={styles.venueFlatList} data={historySessions} keyExtractor={(item) => item.id} showsVerticalScrollIndicator={false} contentContainerStyle={styles.venueList}
                renderItem={({ item }) => {
                  const isPast = historySegment === 'past';
                  const dateValue = isPast ? item.endedAt : item.scheduledStart;
                  return <View style={styles.historyRow}>
                    <View style={styles.venueListIcon}><Icon name={item.status === 'cancelled' ? 'close-circle-outline' : historySegment === 'current' ? 'radio-outline' : historySegment === 'upcoming' ? 'calendar-outline' : 'checkmark-done-outline'} size={18} color={C.teal} /></View>
                    <View style={styles.flex}>
                      <Text numberOfLines={1} style={styles.venueListName}>{item.name}</Text>
                      <Text numberOfLines={1} style={styles.venueListMeta}>{item.venueName}{item.venueArea ? ` · ${item.venueArea}` : ''}</Text>
                      <Text numberOfLines={1} style={styles.historyRowDate}>{dateValue ? `${scheduleDateLabel(new Date(dateValue))} · ${scheduleTimeLabel(new Date(dateValue))}` : 'Date unavailable'}</Text>
                    </View>
                    <View style={[styles.historyStatusPill, item.status === 'cancelled' && styles.historyStatusPillCancelled]}><Text style={[styles.historyStatusPillText, item.status === 'cancelled' && styles.historyStatusPillTextCancelled]}>{item.status === 'cancelled' ? 'CANCELLED' : historySegment.toUpperCase()}</Text></View>
                  </View>;
                }}
                ListEmptyComponent={<View style={styles.venueEmpty}><Icon name="calendar-outline" size={26} color={C.ink40} /><Text style={styles.venueEmptyTitle}>No {historySegment} sessions</Text><Text style={styles.venueEmptyMeta}>{historySegment === 'upcoming' ? 'Sessions you publish for a future time appear here.' : historySegment === 'current' ? 'A session appears here once you start it live.' : 'Completed and cancelled sessions appear here.'}</Text></View>} />}
        </View>
      </View>
    </Modal>
    <Modal visible={Boolean(pickerField)} transparent animationType="slide" onRequestClose={() => setPickerField(null)} statusBarTranslucent>
      <View {...webDialog('backdrop')} style={styles.modalBackdrop}>
        <View {...webDialog('surface')} style={[styles.sheet, styles.schedulePickerSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
          <View {...webDialog('handle')} style={styles.sheetHandle} />
          <View style={styles.schedulePickerHead}><View style={styles.flex}><Text style={styles.eyebrow}>{pickerField === 'date' ? 'SESSION DATE' : pickerField === 'start' ? 'START TIME' : 'END TIME'}</Text><Text style={styles.schedulePickerTitle}>{pickerField === 'date' ? 'Choose a date' : 'Choose a time'}</Text></View><Pressable accessibilityLabel="Close schedule picker" onPress={() => setPickerField(null)} style={styles.iconButton}><Icon name="close" /></Pressable></View>
          {pickerField === 'date' ? <View style={styles.calendarPicker}>
            <View style={styles.calendarPickerNav}><Pressable accessibilityLabel="Previous month" disabled={pickerMonth <= monthFromDateInput(todayInput)} onPress={() => changePickerMonth(-1)} style={[styles.calendarPickerNavButton, pickerMonth <= monthFromDateInput(todayInput) && styles.disabled]}><Icon name="chevron-back" color={C.teal} /></Pressable><Text style={styles.calendarPickerMonth}>{pickerMonth.toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</Text><Pressable accessibilityLabel="Next month" onPress={() => changePickerMonth(1)} style={styles.calendarPickerNavButton}><Icon name="chevron-forward" color={C.teal} /></Pressable></View>
            <View style={styles.calendarWeekdays}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <Text key={`${label}-${index}`} style={styles.calendarWeekday}>{label}</Text>)}</View>
            <View style={styles.calendarGrid}>{pickerCalendarDays.map((item) => { if (!item.inMonth) return <View key={item.date} style={styles.calendarDay} />; const active = item.date === date; const disabled = item.date < todayInput; return <Pressable key={item.date} accessibilityRole="button" accessibilityLabel={scheduleDateLabel(parseManualSchedule(item.date, '12:00'))} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={() => chooseScheduleDate(item.date)} style={[styles.calendarDay, active && styles.calendarDayActive, disabled && styles.calendarDayDisabled]}><Text style={[styles.calendarDayText, active && styles.calendarDayTextActive]}>{item.day}</Text>{item.date === todayInput ? <View style={[styles.calendarTodayDot, active && styles.calendarTodayDotActive]} /> : null}</Pressable>; })}</View>
          </View> : <View style={styles.compactTimePicker}>
            <Text style={styles.timeAdjustLabel}>ADJUST IN 15-MINUTE STEPS</Text>
            <View style={styles.timeAdjuster}>
              <Pressable accessibilityRole="button" accessibilityLabel="15 minutes earlier" onPress={() => setTimeDraft((value) => shiftClockTime(value, -15))} style={styles.timeAdjustButton}><Icon name="remove" size={24} color={C.teal} /></Pressable>
              <View style={styles.timeAdjustValue}><Text style={styles.timeAdjustValueText}>{clockTimeLabel(timeDraft)}</Text><Text style={styles.timeAdjustHint}>TAP − OR + TO ADJUST</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="15 minutes later" onPress={() => setTimeDraft((value) => shiftClockTime(value, 15))} style={[styles.timeAdjustButton, styles.timeAdjustButtonPrimary]}><Icon name="add" size={24} color="#0E2321" /></Pressable>
            </View>
            <View style={styles.hourJumpRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="One hour earlier" onPress={() => setTimeDraft((value) => shiftClockTime(value, -60))} style={styles.hourJumpButton}><Icon name="play-back" size={14} color={C.teal} /><Text style={styles.hourJumpText}>1 HOUR</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="One hour later" onPress={() => setTimeDraft((value) => shiftClockTime(value, 60))} style={styles.hourJumpButton}><Text style={styles.hourJumpText}>1 HOUR</Text><Icon name="play-forward" size={14} color={C.teal} /></Pressable>
            </View>
            <Text style={styles.timeQuickLabel}>QUICK TIMES</Text>
            <View style={styles.timeQuickGrid}>{QUICK_TIME_OPTIONS.map((item) => { const active = item.value === timeDraft; const optionStart = pickerField === 'start' ? parseManualSchedule(date, item.value) : null; const disabled = Boolean(optionStart && optionStart <= new Date()); return <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: active, disabled }} disabled={disabled} onPress={() => setTimeDraft(item.value)} style={[styles.timeQuickOption, active && styles.timeQuickOptionActive, disabled && styles.disabled]}><Text style={[styles.timeQuickText, active && { color: '#0E2321' }]}>{item.label}</Text>{active ? <Icon name="checkmark" size={13} color="#0E2321" /> : null}</Pressable>; })}</View>
            {pickerDraftStartPassed ? <Text style={styles.inputError}>That start time has already passed in Asia/Manila.</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: pickerDraftStartPassed }} disabled={pickerDraftStartPassed} onPress={() => chooseScheduleTime(timeDraft)} style={[styles.timeConfirmButton, pickerDraftStartPassed && styles.disabled]}><Text style={[styles.timeConfirmText, { color: '#0E2321' }]}>Use {clockTimeLabel(timeDraft)}</Text><Icon name="checkmark" size={18} color="#0E2321" /></Pressable>
          </View>}
        </View>
      </View>
    </Modal>
    </>
  );
}

function CourtCard({ court, players, now, onPress, compact = false, cardStyle }) {
  const match = court.match;
  const matchPoint = match && !match.complete && [0, 1].some((team) => match.scores[team] + 1 >= 11 && match.scores[team] + 1 - match.scores[1 - team] >= 2);
  const status = !match ? 'OPEN' : match.complete ? 'FINISHED' : matchPoint ? 'MATCH POINT' : 'IN PLAY';
  const statusColor = !match ? C.teal : match.complete ? C.brick : matchPoint ? C.ink : C.brick;
  const elapsed = match ? Math.max(0, Math.floor((now - match.startedAt) / 1000)) : 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.courtCard, compact && styles.courtCardCompact, !match && styles.openCourtCard, cardStyle, pressed && styles.pressed]}>
      <View style={styles.courtCardHead}>
        <View style={styles.flex}><View style={styles.courtTitleRow}><Text numberOfLines={1} style={styles.courtNumber}>{(court.name || `Court ${court.number}`).toUpperCase()}</Text><View style={styles.courtMatchFormat}><Text style={styles.courtMatchFormatText}>{formatLabel(court.matchFormat).toUpperCase()}</Text></View></View>{!compact && <Text style={styles.courtStatus}>{match ? 'Match underway' : `Ready for ${formatLabel(court.matchFormat).toLowerCase()}`}</Text>}</View>
        <View style={[styles.statusPill, { backgroundColor: statusColor }]}><View style={[styles.statusDot, !match && { backgroundColor: C.optic }]} /><Text style={styles.statusText}>{status}</Text></View>
      </View>
      {match ? (
        <>
          <View style={styles.compactScore}>
            <View style={styles.compactTeam}><Text numberOfLines={1} style={styles.compactNames}>{match.teams[0].map((id) => playerName(players, id)).join(' / ')}</Text><Text style={styles.compactNumber}>{match.scores[0]}</Text></View>
            <View style={styles.scoreDivider} />
            <View style={styles.compactTeam}><Text numberOfLines={1} style={styles.compactNames}>{match.teams[1].map((id) => playerName(players, id)).join(' / ')}</Text><Text style={styles.compactNumber}>{match.scores[1]}</Text></View>
          </View>
          <View style={styles.courtFoot}>{!compact && <Text numberOfLines={1} style={styles.scorerMeta}>Scorer · {playerName(players, match.scorerId)}</Text>}<Text style={styles.timer}>{formatTime(elapsed)}</Text></View>
        </>
      ) : (
        <View style={[styles.openPrompt, compact && styles.openPromptCompact]}><View style={styles.openPlus}><Icon name="add" size={21} /></View><View style={styles.flex}><Text style={styles.openTitle}>Assign fair lineup</Text>{!compact && <Text style={styles.openMeta}>Use the recommendation or record an override.</Text>}</View><Icon name="chevron-forward" color={C.teal} /></View>
      )}
    </Pressable>
  );
}

function Queue({ session, now, onDone, onPriority }) {
  const ranked = rankFairPlayQueue(session, now);
  const queue = ranked.map((item) => item.player.id);
  return (
    <View style={styles.queueCard}>
      {!queue.length && <View style={styles.emptyQueue}><Icon name="hourglass-outline" size={26} color={C.ink40} /><Text style={styles.emptyTitle}>No players waiting</Text><Text style={styles.emptyMeta}>Players return here when their match ends.</Text></View>}
      {queue.map((id, index) => {
        const ranking = ranked[index];
        const player = ranking.player;
        const wait = estimateWaitMinutes(session, id, now);
        return (
          <View key={id} style={[styles.queueRow, index > 0 && styles.rowBorder]}>
            <Text style={styles.queuePosition}>{index + 1}</Text>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(player.name)}</Text></View>
            <View style={styles.flex}><Text style={styles.playerName}>{player.name}</Text><Text style={styles.playerMeta}>{player.gamesPlayed} {player.gamesPlayed === 1 ? 'game' : 'games'} · {wait === 0 ? 'next court' : wait == null ? 'resting' : `~${wait} min`} · {ranking.reasons[0]}</Text></View>
            <Pressable accessibilityLabel={`${player.priorityBoost ? 'Remove' : 'Give'} organizer priority for ${player.name}`} onPress={() => onPriority(id)} style={[styles.priorityButton, player.priorityBoost && styles.priorityButtonActive]}><Icon name={player.priorityBoost ? 'star' : 'star-outline'} size={14} color={player.priorityBoost ? '#0E2321' : C.ink40} /></Pressable>
            <Pressable accessibilityLabel={`Mark ${player.name} done`} onPress={() => onDone(id)} style={styles.doneButton}><Text style={styles.doneText}>Done</Text></Pressable>
          </View>
        );
      })}
    </View>
  );
}

function Dashboard({ session, now, onCourt, onPlayerDone, onPlayerPriority, onAddPlayer, onAnnouncement, onTV, onEndSession, endingSession }) {
  const width = useResponsiveWidth();
  const [density, setDensity] = useState('comfortable');
  const activeCount = session.courts.filter((court) => court.match).length;
  const nextCourt = session.courts.find((court) => !court.match) || session.courts[0];
  const next = buildFairPlayAssignment(courtSession(session, nextCourt), now);
  const lastDecision = session.assignmentHistory?.[0];
  const useGrid = width >= 700 || density === 'compact';
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TopBar eyebrow="OPEN PLAY · LIVE" title="Court monitor" right={<View style={styles.monitorActions}><Pressable accessibilityLabel="Publish venue announcement" onPress={onAnnouncement} style={styles.monitorIcon}><Icon name="megaphone-outline" size={18} /></Pressable><Pressable accessibilityLabel="Open venue TV display" onPress={onTV} style={styles.monitorIcon}><Icon name="tv-outline" size={18} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="End live session" accessibilityState={{ disabled: endingSession }} disabled={endingSession} onPress={onEndSession} style={[styles.endSessionButton, endingSession && styles.disabled]}>{endingSession ? <ActivityIndicator size="small" color={C.brick} /> : <Text style={styles.endSessionText}>End</Text>}</Pressable></View>} />
      <ConnectionStatus />
      {session.code ? <View style={styles.inviteCard}><View style={styles.inviteCode}><Text style={styles.inviteCodeLabel}>SESSION CODE</Text><Text style={styles.inviteCodeValue}>{session.code}</Text></View><View style={styles.flex}><Text style={styles.inviteTitle}>{session.visibility === 'public' ? 'Public registration is live' : session.visibility === 'private' ? 'Share the private code' : 'Invite selected players'}</Text><Text style={styles.inviteMeta}>Players join at peakle://open-play/{session.code}</Text></View><Pressable accessibilityLabel="Share session invitation" onPress={() => Share.share({ message: `Join ${session.name} on Peakle. Use code ${session.code} or open peakle://open-play/${session.code}` })} style={styles.shareButton}><Icon name="share-social-outline" color="#0E2321" /></Pressable></View> : null}
      <View style={styles.sessionStats}>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.courts.length}</Text><Text style={styles.sessionLabel}>COURTS</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{activeCount}</Text><Text style={styles.sessionLabel}>IN PLAY</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.queue.length}</Text><Text style={styles.sessionLabel}>WAITING</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.completedMatches.length}</Text><Text style={styles.sessionLabel}>FINISHED</Text></View>
      </View>

      {next.ready ? <View style={[styles.fairCard, styles.fairCardPriority]}><View style={styles.fairIcon}><Icon name="sparkles" color={C.teal} /></View><View style={styles.flex}><Text style={styles.fairTitle}>Next fair lineup is ready</Text><Text style={styles.fairMeta}>{next.reason}</Text></View><Icon name="arrow-forward" color={C.teal} /></View> : null}

      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>ALL BOOKED COURTS</Text><Text style={styles.h2}>Live courts</Text></View><View style={styles.courtHeadActions}><View style={styles.densityToggle}><Pressable accessibilityRole="button" accessibilityLabel="Comfortable court view" accessibilityState={{ selected: density === 'comfortable' }} onPress={() => setDensity('comfortable')} style={[styles.densityButton, density === 'comfortable' && styles.densityButtonActive]}><Icon name="reorder-two-outline" size={17} color={density === 'comfortable' ? '#0E2321' : C.ink40} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Compact court view" accessibilityState={{ selected: density === 'compact' }} onPress={() => setDensity('compact')} style={[styles.densityButton, density === 'compact' && styles.densityButtonActive]}><Icon name="grid-outline" size={16} color={density === 'compact' ? '#0E2321' : C.ink40} /></Pressable></View><View style={styles.livePill}><BlinkingDot style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View></View></View>
      <View style={useGrid ? styles.courtGrid : styles.courtList}>{session.courts.map((court) => <CourtCard key={court.id} court={court} players={session.players} now={now} compact={useGrid} cardStyle={useGrid ? styles.courtGridItem : styles.courtListItem} onPress={() => onCourt(court.id)} />)}</View>

      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>ROTATION ORDER</Text><Text style={styles.h2}>Waiting pool</Text></View><View style={styles.queueHeadActions}><Text style={styles.queueCount}>{session.queue.length} WAITING</Text><Pressable accessibilityLabel="Check in a player" onPress={onAddPlayer} style={styles.addPlayerButton}><Icon name="person-add-outline" size={15} color="#0E2321" /><Text style={styles.addPlayerText}>Check in</Text></Pressable></View></View>
      {lastDecision?.overridden ? <View style={styles.overrideAudit}><Icon name="document-text-outline" size={17} color={C.brick} /><View style={styles.flex}><Text style={styles.overrideAuditTitle}>Last lineup was overridden</Text><Text style={styles.overrideAuditMeta}>{lastDecision.overrideReason}</Text></View></View> : null}
      <Queue session={session} now={now} onDone={onPlayerDone} onPriority={onPlayerPriority} />
    </ScrollView>
  );
}

function AnnouncementModal({ visible, onCancel, onPublish }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setBody(''); setBusy(false); } }, [visible]);
  const publish = async () => {
    if (body.trim().length < 3) return;
    setBusy(true);
    try { await onPublish(body.trim()); } finally { setBusy(false); }
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}><View {...webDialog('backdrop')} style={styles.modalBackdrop}><View {...webDialog('surface')} style={styles.sheet}><View {...webDialog('handle')} style={styles.sheetHandle} /><Text style={styles.eyebrow}>VENUE ANNOUNCEMENT</Text><Text style={styles.sheetTitle}>Message everyone</Text><Text style={styles.sheetLead}>Checked-in players receive this in their inbox and by push notification when enabled.</Text><TextInput autoFocus multiline maxLength={280} value={body} onChangeText={setBody} placeholder="Court 2 is reopening in five minutes." placeholderTextColor={C.ink40} style={[styles.singleInput, styles.announcementInput]} /><View style={styles.sheetActions}><Pressable disabled={busy} onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable><Pressable disabled={busy || body.trim().length < 3} onPress={publish} style={[styles.confirmButton, (busy || body.trim().length < 3) && styles.disabled]}>{busy ? <ActivityIndicator color={C.surface} /> : <Text style={styles.confirmText}>Publish</Text>}</Pressable></View></View></View></Modal>;
}

function VenueTVDisplay({ session, onBack }) {
  const nextCourt = session.courts.find((court) => !court.match) || session.courts[0];
  const next = buildFairPlayAssignment(courtSession(session, nextCourt));
  const byId = new Map(session.players.map((player) => [player.id, player.name]));
  return <View style={styles.tvScreen}><View style={styles.tvHeader}><View><Text style={styles.tvBrand}>PEAKLE · LIVE OPEN PLAY</Text><Text style={styles.tvTitle}>{session.name}</Text></View><Pressable accessibilityLabel="Close TV display" onPress={onBack} style={styles.tvClose}><Icon name="close" color={C.surface} /></Pressable></View><ConnectionStatus /><View style={styles.tvStats}><View><Text style={styles.tvNumber}>{session.queue.length}</Text><Text style={styles.tvLabel}>WAITING</Text></View><View><Text style={styles.tvNumber}>{session.courts.filter((court) => court.match).length}/{session.courts.length}</Text><Text style={styles.tvLabel}>COURTS LIVE</Text></View><View><Text style={styles.tvNumber}>{session.completedMatches.length}</Text><Text style={styles.tvLabel}>FINISHED</Text></View></View><Text style={styles.tvSection}>COURT STATUS</Text><View style={styles.tvCourts}>{session.courts.map((court) => <View key={court.id} style={[styles.tvCourt, !court.match && styles.tvCourtOpen]}><Text style={styles.tvCourtName}>COURT {court.number}</Text>{court.match ? <><Text style={styles.tvScore}>{court.match.scores[0]}–{court.match.scores[1]}</Text><Text numberOfLines={2} style={styles.tvPlayers}>{court.match.teams.map((team) => team.map((id) => byId.get(id) || 'Player').join(' / ')).join('  vs  ')}</Text></> : <><Text style={styles.tvOpen}>OPEN</Text><Text style={styles.tvPlayers}>Ready for the next rotation</Text></>}</View>)}</View><View style={styles.tvNext}><Text style={styles.tvSection}>NEXT PLAYERS</Text><Text style={styles.tvNextNames}>{next.ready ? next.playerIds.map((id) => byId.get(id) || 'Player').join('  ·  ') : next.reason}</Text><Text style={styles.tvReason}>{next.ready ? next.reason : 'The display updates automatically when players check in.'}</Text></View></View>;
}

function AddPlayerModal({ visible, players, onCancel, onAdd }) {
  const [name, setName] = useState('');
  const duplicate = players.some((player) => player.name.toLowerCase() === name.trim().toLowerCase());
  const canAdd = Boolean(name.trim()) && !duplicate;
  useEffect(() => { if (visible) setName(''); }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View {...webDialog('backdrop')} style={styles.modalBackdrop}>
        <View {...webDialog('surface')} style={styles.sheet}>
          <View {...webDialog('handle')} style={styles.sheetHandle} /><Text style={styles.eyebrow}>PLAYER CHECK-IN</Text><Text style={styles.sheetTitle}>Add to the waiting pool</Text><Text style={styles.sheetLead}>Walk-ins join at the end of the current rotation.</Text>
          <TextInput accessibilityLabel="Player name" autoFocus value={name} onChangeText={setName} placeholder="Player name" placeholderTextColor={C.ink40} returnKeyType="done" onSubmitEditing={() => canAdd && onAdd(name.trim())} style={styles.singleInput} />
          {duplicate && <Text style={styles.inputError}>That player is already registered.</Text>}
          <View style={styles.sheetActions}><Pressable onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable><Pressable disabled={!canAdd} onPress={() => onAdd(name.trim())} style={[styles.confirmButton, !canAdd && styles.disabled]}><Text style={styles.confirmText}>Check in</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function Assignment({ session, courtId, onBack, onStart }) {
  const court = session.courts.find((item) => item.id === courtId);
  const assignmentSession = useMemo(() => courtSession(session, court), [court, session]);
  const decision = useMemo(() => buildFairPlayAssignment(assignmentSession), [assignmentSession]);
  const suggested = decision.playerIds;
  const required = playersPerMatch(assignmentSession);
  const signedInScorer = (ids) => ids.find((id) => session.players.find((player) => player.id === id)?.userId) || null;
  const [selectionMode, setSelectionMode] = useState('recommended');
  const [selected, setSelected] = useState(suggested);
  const [scorerId, setScorerId] = useState(signedInScorer(suggested));
  const [overrideReason, setOverrideReason] = useState('');
  const overridden = selected.join('|') !== suggested.join('|');
  const useRecommendation = () => { setSelectionMode('recommended'); setSelected(suggested); setScorerId(signedInScorer(suggested)); setOverrideReason(''); };
  const chooseManually = () => { setSelectionMode('manual'); setSelected([]); setScorerId(null); setOverrideReason(''); };
  const toggle = (id) => {
    setSelectionMode('manual');
    setSelected((current) => {
      if (current.includes(id)) {
        const next = current.filter((item) => item !== id);
        if (scorerId === id) setScorerId(signedInScorer(next));
        return next;
      }
      if (current.length >= required) return current;
      const next = [...current, id];
      if (!scorerId && session.players.find((player) => player.id === id)?.userId) setScorerId(id);
      return next;
    });
  };
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TopBar eyebrow={`COURT ${court.number} · ${formatLabel(court.matchFormat).toUpperCase()}`} title="Build the lineup" onBack={onBack} />
      <Text style={styles.lead}>Use the fair recommendation or choose all {required} players manually. You approve every lineup before it starts.</Text>

      <View style={styles.lineupMode}>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: selectionMode === 'recommended' }} onPress={useRecommendation} style={[styles.lineupModeChoice, selectionMode === 'recommended' && styles.lineupModeChoiceActive]}><Icon name="sparkles-outline" size={16} color={selectionMode === 'recommended' ? '#0E2321' : C.ink40} /><Text style={[styles.lineupModeText, selectionMode === 'recommended' && styles.lineupModeTextActive]}>Use recommendation</Text></Pressable>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: selectionMode === 'manual' }} onPress={chooseManually} style={[styles.lineupModeChoice, selectionMode === 'manual' && styles.lineupModeChoiceActive]}><Icon name="hand-left-outline" size={16} color={selectionMode === 'manual' ? '#0E2321' : C.ink40} /><Text style={[styles.lineupModeText, selectionMode === 'manual' && styles.lineupModeTextActive]}>Choose manually</Text></Pressable>
      </View>

      <View style={styles.explainCard}><View style={styles.fairIcon}><Icon name="sparkles" color={C.teal} /></View><View style={styles.flex}><Text style={styles.fairTitle}>{decision.ready ? 'Why this lineup?' : 'Lineup not ready'}</Text><Text style={styles.fairMeta}>{decision.reason}</Text></View></View>

      <View style={styles.teamsCard}>
        {[0, 1].map((team) => (
          <View key={team} style={[styles.lineupTeam, team === 1 && styles.lineupTeamAway]}>
            <Text style={styles.teamLabel}>TEAM {team + 1}</Text>
            {Array.from({ length: required / 2 }, (_, slot) => {
              const id = selected[team * (required / 2) + slot];
              return <View key={slot} style={styles.lineupSlot}>{id ? <><View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>{initials(playerName(session.players, id))}</Text></View><Text numberOfLines={1} style={styles.lineupName}>{playerName(session.players, id)}</Text></> : <Text style={styles.openSlot}>Open spot</Text>}</View>;
            })}
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>{selectionMode === 'manual' ? 'CHOOSE PLAYERS MANUALLY' : 'REVIEW PLAYERS'} · {selected.length}/{required}</Text>
      <View style={styles.pickerCard}>
        {session.queue.map((id, index) => {
          const chosen = selected.includes(id);
          const ranking = decision.ranked.find((item) => item.player.id === id);
          return <Pressable key={id} onPress={() => toggle(id)} style={[styles.pickerRow, index > 0 && styles.rowBorder]}><Text style={styles.queuePosition}>{index + 1}</Text><View style={styles.flex}><Text style={styles.playerName}>{playerName(session.players, id)}</Text><Text style={styles.playerMeta}>{suggested.includes(id) ? 'Suggested · ' : ''}{ranking?.reasons?.[0] || 'Waiting'}</Text></View><Icon name={chosen ? 'checkmark-circle' : 'ellipse-outline'} color={chosen ? C.teal : C.ink40} /></Pressable>;
        })}
      </View>

      {overridden ? <><Text style={styles.sectionLabel}>OVERRIDE REASON</Text><Text style={styles.helperTop}>Required for the rotation audit. Be specific so players can understand the change.</Text><TextInput multiline value={overrideReason} onChangeText={setOverrideReason} maxLength={240} placeholder="Example: Alex needs to leave in 15 minutes." placeholderTextColor={C.ink40} style={[styles.nameInput, styles.overrideInput]} /></> : null}

      <Text style={styles.sectionLabel}>ON-COURT SCORER</Text>
      <Text style={styles.helperTop}>Choose a signed-in player. Their Peakle app opens the live match and scoring controls.</Text>
      <View style={styles.scorerGrid}>
        {selected.filter((id) => session.players.find((player) => player.id === id)?.userId).map((id) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: scorerId === id }} onPress={() => setScorerId(id)} style={[styles.scorerChoice, scorerId === id && styles.scorerChoiceActive]}><View style={[styles.smallAvatar, scorerId === id && styles.scorerAvatarActive]}><Text style={styles.smallAvatarText}>{initials(playerName(session.players, id))}</Text></View><Text numberOfLines={1} style={styles.scorerName}>{playerName(session.players, id)}</Text>{scorerId === id && <Icon name="phone-portrait-outline" size={15} color={C.teal} />}</Pressable>)}
      </View>

      <Pressable disabled={selected.length !== required || !scorerId || overridden && overrideReason.trim().length < 8} onPress={() => onStart(selected, scorerId, { recommendedIds: suggested, reason: decision.reason, factors: decision.factors, metrics: decision.metrics, overrideReason })} style={({ pressed }) => [styles.primaryButton, (selected.length !== required || !scorerId || overridden && overrideReason.trim().length < 8) && styles.disabledButton, pressed && selected.length === required && styles.pressed]}><Text style={styles.primaryText}>{overridden ? 'Start with override' : 'Start fair match'}</Text><Icon name="play" color="#0E2321" /></Pressable>
    </ScrollView>
  );
}

function EndMatchModal({ visible, match, players, onCancel, onConfirm }) {
  const ids = match?.playerIds || [];
  const [doneIds, setDoneIds] = useState([]);
  useEffect(() => { if (visible) setDoneIds([]); }, [visible]);
  if (!match) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View {...webDialog('backdrop')} style={styles.modalBackdrop}>
        <View {...webDialog('surface')} style={styles.sheet}>
          <View {...webDialog('handle')} style={styles.sheetHandle} /><Text style={styles.eyebrow}>END MATCH</Text><Text style={styles.sheetTitle}>Where should players go?</Text><Text style={styles.sheetLead}>Everyone returns to the queue unless you mark them done for the day.</Text>
          {ids.map((id) => {
            const done = doneIds.includes(id);
            return <Pressable key={id} onPress={() => setDoneIds((current) => done ? current.filter((item) => item !== id) : [...current, id])} style={styles.endPlayerRow}><View style={styles.avatar}><Text style={styles.avatarText}>{initials(playerName(players, id))}</Text></View><Text style={[styles.playerName, styles.flex]}>{playerName(players, id)}</Text><View style={[styles.returnPill, done && styles.donePill]}><Text style={[styles.returnText, done && styles.donePillText]}>{done ? 'DONE' : 'RETURN TO QUEUE'}</Text></View></Pressable>;
          })}
          <View style={styles.sheetActions}><Pressable onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Keep playing</Text></Pressable><Pressable onPress={() => onConfirm(doneIds)} style={styles.confirmButton}><Text style={styles.confirmText}>End match</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function LiveCourt({ session, courtId, now, onBack, onScore, onUndo, onScorer, onEnd }) {
  const court = session.courts.find((item) => item.id === courtId);
  const match = court.match;
  const elapsed = Math.max(0, Math.floor((now - match.startedAt) / 1000));
  const matchPoint = !match.complete && [0, 1].some((team) => match.scores[team] + 1 >= 11 && match.scores[team] + 1 - match.scores[1 - team] >= 2);
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TopBar eyebrow={`COURT ${court.number} · ${match.complete ? 'FINISHED' : matchPoint ? 'MATCH POINT' : 'IN PLAY'}`} title="Live scoring" onBack={onBack} right={<View style={styles.timerPill}><Icon name="time-outline" size={14} color={C.surface} /><Text style={styles.timerText}>{formatTime(elapsed)}</Text></View>} />
      {matchPoint && <View style={styles.matchPointBanner}><Icon name="flag" color="#0E2321" /><Text style={styles.matchPointText}>Match point — the next legal point can finish this game.</Text></View>}
      {match.complete && <View style={styles.finishedBanner}><Icon name="checkmark-circle" color={C.surface} /><Text style={styles.finishedText}>Game finished. Confirm where each player goes next.</Text></View>}

      <View style={styles.scoreCard}>
        {[0, 1].map((team) => (
          <View key={team} style={[styles.scoreTeam, team === 1 && styles.scoreTeamAway]}>
            <Text style={styles.teamLabel}>TEAM {team + 1}</Text>
            <Text numberOfLines={2} style={styles.scoreNames}>{match.teams[team].map((id) => playerName(session.players, id)).join(' / ')}</Text>
            <Text style={styles.bigScore}>{match.scores[team]}</Text>
            <Pressable disabled={match.complete} onPress={() => onScore(team)} style={[styles.pointButton, team === 1 && styles.pointButtonAway, match.complete && styles.disabled]}><Icon name="add" color={C.surface} /><Text style={styles.pointText}>POINT</Text></Pressable>
          </View>
        ))}
      </View>

      <View style={styles.scorerCard}>
        <View style={styles.scorerHead}><View><Text style={styles.eyebrow}>ON-COURT SCORER</Text><Text style={styles.scorerTitle}>{playerName(session.players, match.scorerId)}</Text></View><View style={styles.assignmentPill}><Text style={styles.assignmentText}>MATCH ASSIGNMENT</Text></View></View>
        <Text style={styles.scorerHelp}>Still playing on court. Tap another player to hand over scoring.</Text>
        <View style={styles.scorerChips}>{match.playerIds.map((id) => <Pressable key={id} onPress={() => onScorer(id)} style={[styles.scorerChip, match.scorerId === id && styles.scorerChipActive]}><Text style={[styles.scorerChipText, match.scorerId === id && styles.scorerChipTextActive]}>{playerName(session.players, id)}</Text>{match.scorerId === id && <Icon name="phone-portrait-outline" size={13} color={C.teal} />}</Pressable>)}</View>
      </View>

      <View style={styles.liveActions}><Pressable disabled={!match.history.length} onPress={onUndo} style={[styles.secondaryButton, !match.history.length && styles.disabled]}><Icon name="arrow-undo-outline" color={C.teal} /><Text style={styles.secondaryText}>Undo</Text></Pressable><Pressable onPress={onEnd} style={styles.endMatchButton}><Icon name="flag-outline" color={C.surface} /><Text style={styles.endMatchText}>{match.complete ? 'Finish rotation' : 'End match'}</Text></Pressable></View>
    </ScrollView>
  );
}

function Summary({ session, onDone }) {
  const active = session.courts.filter((court) => court.match).length;
  return (
    <ScrollView contentContainerStyle={[styles.content, styles.summaryContent]}>
      <View style={styles.summaryIcon}><Icon name="checkmark" size={34} /></View><Text style={styles.eyebrow}>SESSION COMPLETE</Text><Text style={styles.summaryTitle}>Open play wrapped.</Text><Text style={styles.summaryLead}>{session.completedMatches.length} matches completed across {session.courts.length} courts.</Text>
      {active > 0 && <Text style={styles.summaryWarning}>{active} active {active === 1 ? 'court was' : 'courts were'} closed with the session.</Text>}
      <View style={styles.summaryStats}><View style={styles.summaryStat}><Text style={styles.summaryNumber}>{session.players.length}</Text><Text style={styles.sessionLabel}>PLAYERS</Text></View><View style={styles.summaryStat}><Text style={styles.summaryNumber}>{session.completedMatches.length}</Text><Text style={styles.sessionLabel}>MATCHES</Text></View><View style={styles.summaryStat}><Text style={styles.summaryNumber}>{session.courts.length}</Text><Text style={styles.sessionLabel}>COURTS</Text></View></View>
      <Pressable onPress={onDone} style={styles.primaryButton}><Text style={styles.primaryText}>Back to Play</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable>
    </ScrollView>
  );
}

export default function OpenPlayScreen({ onExit }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { user } = useAuth();
  const { enqueueOperation } = useOperations();
  const { screen, setScreen, session, setSession, courtId, setCourtId, endSession, resetSession } = useOpenPlaySession();
  const [showEndMatch, setShowEndMatch] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!session || screen === 'setup' || screen === 'summary') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [screen, session]);

  const updateCourt = (id, update) => setSession((current) => ({ ...current, courts: current.courts.map((court) => court.id === id ? update(court) : court) }));
  const startSession = async (details) => {
    const created = await createOpenPlaySession(details);
    if (created.status !== 'active') throw new Error('This session has already ended or been cancelled. Check your past sessions.');
    // A retry can return an existing session. Recover its roster and scores
    // before constructing initial state, so publishing cannot reset live play.
    const existing = await loadActiveOpenPlay(created.id);
    if (!existing) throw new Error('This session is no longer active. Check your past sessions.');
    if (created.live_started_at || existing.players.length || existing.completedMatches.length || existing.courts.some((court) => court.match)) {
      setSession(existing);
      setScreen('dashboard');
      return;
    }
    const { names } = details;
    const checkedInAt = new Date().toISOString();
    const players = names.map((name, index) => ({ id: `${created.id}-initial-player-${index + 1}`, name, status: 'waiting', gamesPlayed: 0, consecutiveGames: 0, checkedInAt, waitingSince: checkedInAt, playPreference: 'either', priorityBoost: 0 }));
    const courts = created.sessionCourts.map((court) => ({ id: court.id, number: court.court_number, venueCourtId: court.venue_court_id, name: court.venue_court?.name || null, matchFormat: court.match_format || details.courtFormats?.[court.court_number - 1] || details.matchFormat, match: null }));
    const nextSession = { id: created.id, name: created.name, code: created.session_code, venueId: created.venue_id, visibility: created.visibility, approvalMode: created.approval_mode, capacity: created.capacity, skillMin: created.skill_min, skillMax: created.skill_max, feeAmount: created.fee_amount, scheduledStart: created.scheduled_start, scheduledEnd: created.scheduled_end, rules: created.rules, cancellationPolicy: created.cancellation_policy, matchFormat: created.match_format || details.matchFormat, averageMatchMinutes: created.average_match_minutes || details.averageMatchMinutes, maxConsecutiveGames: created.max_consecutive_games ?? details.maxConsecutiveGames, restMinutes: created.rest_minutes ?? details.restMinutes, players, queue: players.map((player) => player.id), courts, completedMatches: [], assignmentHistory: [] };
    setSession(nextSession);
    setScreen('dashboard');
    // Publishing is complete once the RPC returns. Keep local operations
    // usable while the context retries any transient guest-player sync.
    syncOpenPlay(nextSession).catch((syncError) => {
      console.warn('Open-play session published; initial live-state sync will retry.', syncError?.message || syncError);
    });
  };
  const openCourt = (id) => {
    setCourtId(id);
    const court = session.courts.find((item) => item.id === id);
    setScreen(court.match ? 'live' : 'assign');
  };
  const startMatch = async (playerIds, scorerId, decision) => {
    const court = session.courts.find((item) => item.id === courtId);
    const matchFormatForCourt = court?.matchFormat || session.matchFormat;
    const match = { id: uid('match'), matchFormat: matchFormatForCourt, playerIds, teams: [playerIds.slice(0, 2), playerIds.slice(2, 4)], scorerId, scores: [0, 0], history: [], startedAt: Date.now(), complete: false, winner: null };
    if (playersPerMatch({ ...session, matchFormat: matchFormatForCourt }) === 2) match.teams = [[playerIds[0]], [playerIds[1]]];
    try {
      await recordFairPlayAssignment({ sessionId: session.id, courtId, matchId: match.id, playerIds, scorerId, recommendedIds: decision.recommendedIds, explanation: { reason: decision.reason, factors: decision.factors || [], metrics: decision.metrics || {} }, overrideReason: decision.overrideReason });
    } catch (assignmentError) {
      Alert.alert('Lineup changed', assignmentError.message || 'The players could not be assigned. Refresh the queue and try again.');
      return;
    }
    const audit = { matchId: match.id, playerIds, recommendedIds: decision.recommendedIds, explanation: decision.reason, overridden: playerIds.join('|') !== decision.recommendedIds.join('|'), overrideReason: decision.overrideReason?.trim() || null, createdAt: new Date().toISOString() };
    setSession((current) => {
      const next = { ...current, queue: current.queue.filter((id) => !playerIds.includes(id)), players: current.players.map((player) => playerIds.includes(player.id) ? { ...player, status: 'playing' } : player.status === 'waiting' ? { ...player, consecutiveGames: 0 } : player), courts: current.courts.map((court) => court.id === courtId ? { ...court, match } : court), assignmentHistory: [audit, ...(current.assignmentHistory || [])] };
      return { ...next, queue: rebalanceFairPlayQueue(next) };
    });
    setNow(Date.now());
    setScreen('live');
  };
  const score = async (team) => {
    const court = session.courts.find((item) => item.id === courtId);
    if (!court?.match) return;
    try {
      const event = await recordOpenPlayRally(court.match.id, team);
      const nextScores = [Number(event.home_score || 0), Number(event.away_score || 0)];
      const won = Math.max(...nextScores) >= 11 && Math.abs(nextScores[0] - nextScores[1]) >= 2;
      updateCourt(courtId, (current) => ({ ...current, match: { ...current.match, scores: nextScores, history: [...current.match.history, current.match.scores], complete: won, winner: won ? (nextScores[0] > nextScores[1] ? 0 : 1) : null } }));
    } catch (scoreError) {
      Alert.alert('Score not recorded', scoreError.message || 'The rally could not be recorded.');
    }
  };
  const undo = async () => {
    const court = session.courts.find((item) => item.id === courtId);
    if (!court?.match) return;
    try {
      const event = await undoOpenPlayRally(court.match.id);
      updateCourt(courtId, (current) => ({ ...current, match: { ...current.match, scores: [Number(event.home_score || 0), Number(event.away_score || 0)], history: current.match.history.slice(0, -1), complete: false, winner: null } }));
    } catch (undoError) {
      Alert.alert('Undo not saved', undoError.message || 'The last rally could not be restored.');
    }
  };
  const changeScorer = async (scorerId) => {
    const court = session.courts.find((item) => item.id === courtId);
    if (!court?.match || court.match.scorerId === scorerId) return;
    try {
      await updateOpenPlayMatchScorer(court.match.id, scorerId);
      updateCourt(courtId, (current) => ({ ...current, match: { ...current.match, scorerId } }));
    } catch (scorerError) {
      Alert.alert('Scorer not changed', scorerError.message || 'The scorer assignment could not be saved.');
    }
  };
  const finishMatch = async (doneIds) => {
    const court = session.courts.find((item) => item.id === courtId);
    const returned = court.match.playerIds.filter((id) => !doneIds.includes(id));
    const endedAt = Date.now();
    const result = { ...court.match, endedAt, courtNumber: court.number };
    try {
      await completeFairPlayMatch({ matchId: court.match.id, doneIds, scores: court.match.scores, winner: court.match.winner, endedAt: new Date(endedAt).toISOString() });
    } catch (finishError) {
      Alert.alert('Match not finished', finishError.message || 'The rotation could not be updated. Try again.');
      return;
    }
    setSession((current) => {
      const next = { ...current, queue: [...current.queue, ...returned], players: current.players.map((player) => court.match.playerIds.includes(player.id) ? { ...player, status: doneIds.includes(player.id) ? 'done' : 'waiting', departedAt: doneIds.includes(player.id) ? new Date(endedAt).toISOString() : null, waitingSince: doneIds.includes(player.id) ? player.waitingSince : new Date(endedAt).toISOString(), lastMatchEndedAt: new Date(endedAt).toISOString(), consecutiveGames: Number(player.consecutiveGames || 0) + 1, gamesPlayed: player.gamesPlayed + 1 } : player), courts: current.courts.map((item) => item.id === courtId ? { ...item, match: null } : item), completedMatches: [...current.completedMatches, result] };
      return { ...next, queue: rebalanceFairPlayQueue(next, endedAt) };
    });
    setShowEndMatch(false);
    setCourtId(null);
    setScreen('dashboard');
  };
  const markDone = (id) => {
    enqueueOperation(session.id, session.operationRevision || 0, { type: 'mark_done', playerId: id }).catch((operationError) => Alert.alert('Change not saved', operationError.message));
    setSession((current) => ({ ...current, queue: current.queue.filter((playerId) => playerId !== id), players: current.players.map((player) => player.id === id ? { ...player, status: 'done', departedAt: new Date().toISOString() } : player) }));
  };
  const togglePriority = (id) => {
    const player = session.players.find((item) => item.id === id);
    const value = player?.priorityBoost ? 0 : 1;
    enqueueOperation(session.id, session.operationRevision || 0, { type: 'set_priority', playerId: id, value }).catch((operationError) => Alert.alert('Change not saved', operationError.message));
    setSession((current) => { const next = { ...current, players: current.players.map((item) => item.id === id ? { ...item, priorityBoost: value } : item) }; return { ...next, queue: rebalanceFairPlayQueue(next) }; });
  };
  const addPlayer = (name) => {
    const activePlayers = session.players.filter((player) => player.status !== 'done').length;
    if (session.capacity && activePlayers >= session.capacity) {
      Alert.alert('Session is full', 'Remove or mark a player done before checking in another walk-in.');
      return;
    }
    const checkedInAt = new Date().toISOString();
    const player = { id: uid('player'), name, status: 'waiting', gamesPlayed: 0, consecutiveGames: 0, checkedInAt, waitingSince: checkedInAt, playPreference: 'either', priorityBoost: 0 };
    setSession((current) => { const next = { ...current, players: [...current.players, player], queue: [...current.queue, player.id] }; return { ...next, queue: rebalanceFairPlayQueue(next) }; });
    setShowAddPlayer(false);
  };

  const finishSession = async () => {
    if (endingSession) return;
    setEndingSession(true);
    try {
      await endSession();
    } catch (endError) {
      Alert.alert('Session not ended', endError.message || 'The live session could not be ended. Try again.');
    } finally {
      setEndingSession(false);
    }
  };

  const exitFlow = () => { resetSession(); onExit?.(); };
  if (screen === 'setup') return <Setup organizerName={user?.name || 'Organizer'} onBack={onExit} onStart={startSession} />;
  if (screen === 'summary') return <Summary session={session} onDone={exitFlow} />;
  if (screen === 'tv') return <VenueTVDisplay session={session} onBack={() => setScreen('dashboard')} />;
  if (screen === 'assign') return <Assignment session={session} courtId={courtId} onBack={() => setScreen('dashboard')} onStart={startMatch} />;
  if (screen === 'live') {
    const match = session.courts.find((court) => court.id === courtId)?.match;
    return <><LiveCourt session={session} courtId={courtId} now={now} onBack={() => setScreen('dashboard')} onScore={score} onUndo={undo} onScorer={changeScorer} onEnd={() => setShowEndMatch(true)} /><EndMatchModal visible={showEndMatch} match={match} players={session.players} onCancel={() => setShowEndMatch(false)} onConfirm={finishMatch} /></>;
  }
  return <><Dashboard session={session} now={now} onCourt={openCourt} onPlayerDone={markDone} onPlayerPriority={togglePriority} onAddPlayer={() => setShowAddPlayer(true)} onAnnouncement={() => setShowAnnouncement(true)} onTV={() => setScreen('tv')} onEndSession={finishSession} endingSession={endingSession} /><AddPlayerModal visible={showAddPlayer} players={session.players} onCancel={() => setShowAddPlayer(false)} onAdd={addPlayer} /><AnnouncementModal visible={showAnnouncement} onCancel={() => setShowAnnouncement(false)} onPublish={async (body) => { await publishOpenPlayAnnouncement(session.id, body); setShowAnnouncement(false); }} /></>;
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .08, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, android: { elevation: 3 } });
const lightStyles = createMobileStyleSheet({
  flex: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 44 }, pressed: { opacity: .78, transform: [{ scale: .99 }] }, disabled: { opacity: .38 },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 }, topCopy: { flex: 1 }, iconButton: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, eyebrow: { color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -.7 }, h2: { marginTop: 2, color: C.ink, fontSize: 21, fontWeight: '900' }, kitchen: { height: 7, marginTop: 16, marginBottom: 20 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 },
  rolePill: { minHeight: 32, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 16, backgroundColor: '#E5F0ED' }, roleText: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, heroCard: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, heroIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.45)' }, heroTitle: { color: C.ink, fontSize: 14, fontWeight: '900' }, heroBody: { marginTop: 4, color: C.ink70, fontSize: 10, lineHeight: 15 },
  setupProgress: { marginTop: -8, marginBottom: 18, flexDirection: 'row', gap: 6 }, progressBar: { height: 4, flex: 1, borderRadius: 2, backgroundColor: C.line }, progressBarActive: { backgroundColor: C.teal }, stepIntro: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, stepIntroIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: 'rgba(255,255,255,.52)' }, stepIntroTitle: { color: C.ink, fontSize: 15, fontWeight: '900' }, stepIntroBody: { marginTop: 3, color: C.ink70, fontSize: 9, lineHeight: 14 },
  sectionLabel: { marginTop: 22, marginBottom: 9, color: C.ink, fontSize: 10, fontWeight: '900', letterSpacing: .9 },
  courtSelectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }, courtAvailabilityMeta: { marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 5 }, courtAvailabilityCount: { color: C.teal, fontSize: 8, fontWeight: '900' }, setupCourtGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, setupCourtChoice: { width: '48.7%', minHeight: 62, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, setupCourtChoiceActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, setupCourtChoiceUnavailable: { opacity: .58, backgroundColor: '#E9ECE7' }, setupCourtCheck: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#E5F0ED' }, setupCourtCheckActive: { backgroundColor: C.optic }, setupCourtName: { color: C.ink, fontSize: 10, fontWeight: '900' }, setupCourtStatus: { marginTop: 2, color: C.ink40, fontSize: 7, fontWeight: '700' }, setupCourtStatusAvailable: { color: C.teal }, courtSelectionHelp: { marginTop: 7, color: C.ink40, fontSize: 8, fontWeight: '700' }, noCourtsCard: { minHeight: 62, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, noCourtsText: { flex: 1, color: C.ink40, fontSize: 9, lineHeight: 13 },
  venueChoices: { gap: 8, paddingRight: 8 }, venueChoice: { width: 145, minHeight: 77, padding: 11, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, venueChoiceActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, venueChoiceName: { marginTop: 6, color: C.ink, fontSize: 10, fontWeight: '900' }, venueChoiceArea: { marginTop: 3, color: C.ink40, fontSize: 7 }, venueLoading: { minHeight: 70, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, venueLoadingText: { color: C.ink40, fontSize: 9, fontWeight: '700' }, selectedVenueCard: { minHeight: 76, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: C.teal, backgroundColor: C.surface }, selectedVenueIcon: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E5F0ED' }, selectedVenueName: { color: C.ink, fontSize: 12, fontWeight: '900' }, selectedVenueMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, changeVenuePill: { minHeight: 30, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 15, backgroundColor: C.paper }, changeVenueText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .4 }, scheduleCard: { padding: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, inputLabel: { marginBottom: 6, color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .55 }, scheduleInput: { minHeight: 48, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.paper, color: C.ink, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] }, schedulePickerField: { minHeight: 56, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: C.paper }, schedulePickerIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.surface }, schedulePickerValue: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '900' }, timeFields: { marginTop: 12, flexDirection: 'row', gap: 9 }, timeField: { minWidth: 0, flex: 1 }, timePickerField: { minHeight: 50, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: C.paper }, timePickerValue: { minWidth: 0, flex: 1, color: C.ink, fontSize: 10, fontWeight: '900' }, timezoneRow: { marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 5 }, timezoneText: { color: C.ink40, fontSize: 8, fontWeight: '700' }, schedulePickerSheet: { maxHeight: '78%', paddingTop: 12 }, schedulePickerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, schedulePickerTitle: { marginTop: 3, color: C.ink, fontSize: 21, fontWeight: '900' }, calendarPicker: { marginTop: 18 }, calendarPickerNav: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, calendarPickerNavButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, calendarPickerMonth: { color: C.ink, fontSize: 14, fontWeight: '900' }, calendarWeekdays: { marginTop: 10, flexDirection: 'row' }, calendarWeekday: { width: '14.285%', color: C.ink40, textAlign: 'center', fontSize: 8, fontWeight: '900' }, calendarGrid: { marginTop: 7, flexDirection: 'row', flexWrap: 'wrap' }, calendarDay: { width: '14.285%', height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, calendarDayActive: { backgroundColor: C.optic }, calendarDayOutside: { opacity: .42 }, calendarDayDisabled: { opacity: .18 }, calendarDayText: { color: C.ink, fontSize: 12, fontWeight: '800' }, calendarDayTextActive: { color: '#0E2321', fontWeight: '900' }, calendarTodayDot: { position: 'absolute', bottom: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: C.teal }, calendarTodayDotActive: { backgroundColor: '#0E2321' }, timeOptionList: { flex: 1, marginTop: 16 }, timeOptionContent: { paddingBottom: 12 }, timeOptionRow: { justifyContent: 'space-between', gap: 7 }, timeOption: { width: '31.5%', minHeight: 48, marginBottom: 8, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, timeOptionActive: { borderColor: C.optic, backgroundColor: C.optic }, timeOptionText: { color: C.ink70, fontSize: 8, fontWeight: '800' }, timeOptionTextActive: { color: '#0E2321', fontWeight: '900' }, capacityCard: { minHeight: 70, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, capacityIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, capacityTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, capacityMeta: { marginTop: 3, color: C.ink40, fontSize: 7.5 }, capacityInput: { width: 58, minHeight: 44, paddingHorizontal: 8, borderRadius: 11, backgroundColor: C.paper, color: C.ink, textAlign: 'center', fontSize: 17, fontWeight: '900' }, choiceGroup: { flexDirection: 'row', gap: 7 }, choice: { minHeight: 47, flex: 1, paddingHorizontal: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, choiceActive: { borderColor: C.teal, backgroundColor: C.optic }, choiceText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, choiceTextActive: { color: '#0E2321', fontWeight: '900' }, skillCategoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }, skillCategoryChoice: { width: '48.7%', minHeight: 64, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, skillCategoryChoiceActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, skillCategoryIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#E5F0ED' }, skillCategoryIconActive: { backgroundColor: C.optic }, skillCategoryTitle: { color: C.ink70, fontSize: 8.5, fontWeight: '900' }, skillCategoryTitleActive: { color: C.ink }, skillCategoryRange: { marginTop: 2, color: C.ink40, fontSize: 6.5, fontWeight: '700' }, customSkillToggle: { minHeight: 57, marginTop: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, customSkillToggleActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, customSkillTitle: { color: C.ink, fontSize: 9, fontWeight: '900' }, customSkillMeta: { marginTop: 2, color: C.ink40, fontSize: 7 }, numericRow: { marginTop: 8, flexDirection: 'row', gap: 6 }, numericField: { flex: 1, minHeight: 67, padding: 8, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, feeField: { width: '48.7%', flex: 0 }, numericLabel: { color: C.ink40, fontSize: 5.5, fontWeight: '900', letterSpacing: .35 }, numericInput: { flex: 1, padding: 0, color: C.ink, fontSize: 12, fontWeight: '900' }, setupError: { marginBottom: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#F7EAE6' }, setupErrorText: { flex: 1, color: C.brick, fontSize: 8, lineHeight: 12, fontWeight: '800' },
  compactTimePicker: { marginTop: 18 },
  timeAdjustLabel: { marginBottom: 8, color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  timeAdjuster: { minHeight: 94, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  timeAdjustButton: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: C.paper },
  timeAdjustButtonPrimary: { backgroundColor: C.optic },
  timeAdjustValue: { minWidth: 0, flex: 1, alignItems: 'center' },
  timeAdjustValueText: { color: C.ink, fontSize: 24, lineHeight: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  timeAdjustHint: { marginTop: 3, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .45 },
  hourJumpRow: { marginTop: 9, flexDirection: 'row', gap: 8 },
  hourJumpButton: { minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  hourJumpText: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .45 },
  timeQuickLabel: { marginTop: 17, marginBottom: 8, color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  timeQuickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  timeQuickOption: { width: '31.5%', minHeight: 43, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  timeQuickOptionActive: { borderColor: C.optic, backgroundColor: C.optic },
  timeQuickText: { color: C.ink70, fontSize: 8, fontWeight: '900', fontVariant: ['tabular-nums'] },
  timeConfirmButton: { minHeight: 54, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic },
  timeConfirmText: { fontSize: 11, fontWeight: '900' },
  mixedFormatIntro: { marginTop: 13, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, backgroundColor: '#E5F0ED' },
  mixedFormatIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.surface },
  mixedFormatTitle: { color: C.ink, fontSize: 10, fontWeight: '900' },
  mixedFormatMeta: { marginTop: 3, color: C.ink70, fontSize: 7.5, lineHeight: 11 },
  courtFormatList: { overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  courtFormatRow: { minHeight: 61, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  courtFormatNumber: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper },
  courtFormatNumberText: { color: C.teal, fontSize: 10, fontWeight: '900' },
  courtFormatName: { color: C.ink, fontSize: 9.5, fontWeight: '900' },
  courtFormatHint: { marginTop: 2, color: C.ink40, fontSize: 7 },
  courtFormatPill: { minWidth: 82, minHeight: 34, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 17, backgroundColor: C.optic },
  courtFormatPillSingles: { borderWidth: 1, borderColor: C.teal, backgroundColor: '#E5F0ED' },
  courtFormatText: { color: '#0E2321', fontSize: 7, fontWeight: '900' },
  courtFormatTextSingles: { color: C.teal },
  rotationPresetList: { gap: 8 }, rotationPreset: { minHeight: 70, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, rotationPresetActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, rotationPresetIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, rotationPresetIconActive: { backgroundColor: C.optic }, rotationPresetTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, rotationPresetMeta: { marginTop: 3, color: C.ink40, fontSize: 7.5, lineHeight: 11 }, rotationControlList: { overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, rotationControl: { minHeight: 72, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line }, rotationControlCopy: { minWidth: 0, flex: 1 }, rotationControlTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, rotationControlMeta: { marginTop: 3, color: C.ink40, fontSize: 7.5 }, rotationControlValue: { width: 80, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }, rotationControlValueSolo: { width: 80, flexShrink: 0, alignItems: 'flex-end' }, rotationControlInput: { width: 48, minHeight: 43, paddingHorizontal: 4, borderRadius: 11, backgroundColor: C.paper, color: C.ink, textAlign: 'center', fontSize: 16, fontWeight: '900' }, rotationControlUnit: { minWidth: 25, flexShrink: 0, color: C.ink40, fontSize: 7, fontWeight: '900' }, manualInfo: { marginTop: 18, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: '#E5F0ED' }, manualInfoIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.surface }, manualInfoTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, manualInfoMeta: { marginTop: 3, color: C.ink70, fontSize: 8, lineHeight: 12 }, stepActions: { marginTop: 18, flexDirection: 'row', gap: 9 }, stepPrimaryButton: { marginTop: 0, flex: 1.3 }, optionalToggle: { minHeight: 72, marginTop: 20, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, optionalIcon: { width: 41, height: 41, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, optionalTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, optionalMeta: { marginTop: 3, color: C.ink40, fontSize: 7.5 }, optionalPanel: { marginTop: 4 }, reviewCard: { marginTop: 18, padding: 15, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.ink }, reviewEyebrow: { color: C.optic, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, reviewTitle: { marginTop: 4, color: C.surface, fontSize: 15, fontWeight: '900' }, reviewMeta: { marginTop: 5, color: '#B9C8C2', fontSize: 8.5, lineHeight: 13 },
  fieldHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, countText: { marginBottom: 9, color: C.teal, fontSize: 8, fontWeight: '900' }, nameInput: { minHeight: 142, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 13, lineHeight: 21, textAlignVertical: 'top' }, policyInput: { minHeight: 86, marginTop: 8, fontSize: 10, lineHeight: 15 }, helper: { marginTop: 7, color: C.ink40, fontSize: 8, lineHeight: 12 }, helperTop: { marginTop: -4, marginBottom: 9, color: C.ink40, fontSize: 9, lineHeight: 13 },
  rulesCard: { minHeight: 70, marginTop: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, rulesIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, rulesTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, rulesMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, primaryButton: { minHeight: 58, marginTop: 18, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: C.optic }, disabledButton: { opacity: .42 }, primaryText: { color: C.ink, fontSize: 12, fontWeight: '900' },
  joinCard: { minHeight: 68, marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, joinCardActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, joinCheck: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, joinCheckActive: { backgroundColor: C.optic }, joinTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, joinMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  endSessionButton: { minWidth: 48, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#E2C4BC', backgroundColor: '#FFF5F2' }, endSessionText: { color: C.brick, fontSize: 9, fontWeight: '900' }, sessionStats: { paddingVertical: 14, flexDirection: 'row', borderRadius: 18, backgroundColor: C.ink }, sessionStat: { flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.18)' }, sessionNumber: { color: C.surface, fontSize: 21, fontWeight: '900', fontVariant: ['tabular-nums'] }, sessionLabel: { marginTop: 3, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .7 }, sectionHead: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, livePill: { paddingHorizontal: 9, minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: '#FFF5F2' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.brick }, liveText: { color: C.brick, fontSize: 7, fontWeight: '900' },
  monitorActions: { flexDirection: 'row', alignItems: 'center', gap: 5 }, monitorIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, courtHeadActions: { flexDirection: 'row', alignItems: 'center', gap: 6 }, densityToggle: { padding: 3, flexDirection: 'row', gap: 2, borderRadius: 13, backgroundColor: '#E7EBE6' }, densityButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, densityButtonActive: { backgroundColor: C.optic }, courtList: { width: '100%' }, courtListItem: { width: '100%' }, courtGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, courtGridItem: { width: '48.5%' },
  inviteCard: { marginBottom: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: C.teal, backgroundColor: C.surface }, inviteCode: { minWidth: 72, padding: 8, alignItems: 'center', borderRadius: 11, backgroundColor: C.ink }, inviteCodeLabel: { color: C.ink40, fontSize: 5, fontWeight: '900', letterSpacing: .4 }, inviteCodeValue: { marginTop: 2, color: C.optic, fontSize: 15, fontWeight: '900', letterSpacing: 1.2 }, inviteTitle: { color: C.ink, fontSize: 9, fontWeight: '900' }, inviteMeta: { marginTop: 3, color: C.ink40, fontSize: 6.5, lineHeight: 10 }, shareButton: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic },
  courtTitleRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  courtMatchFormat: { flexShrink: 0, minHeight: 20, paddingHorizontal: 6, justifyContent: 'center', borderRadius: 10, backgroundColor: '#E5F0ED' },
  courtMatchFormatText: { color: C.teal, fontSize: 5.5, fontWeight: '900', letterSpacing: .35 },
  courtCard: { marginBottom: 10, padding: 14, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, courtCardCompact: { minHeight: 150, padding: 10, borderRadius: 16 }, openCourtCard: { borderStyle: 'dashed', borderColor: C.teal, ...noShadow }, courtCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7 }, courtNumber: { flexShrink: 1, color: C.ink, fontSize: 12, fontWeight: '900', letterSpacing: .5 }, courtStatus: { marginTop: 3, color: C.ink40, fontSize: 8 }, statusPill: { minHeight: 25, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13 }, statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.surface }, statusText: { color: C.surface, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, compactScore: { marginTop: 12, flexDirection: 'row', alignItems: 'stretch' }, compactTeam: { flex: 1, alignItems: 'center' }, compactNames: { width: '100%', color: C.ink70, textAlign: 'center', fontSize: 8, fontWeight: '800' }, compactNumber: { marginTop: 2, color: C.ink, fontSize: 32, lineHeight: 37, fontWeight: '900', fontVariant: ['tabular-nums'] }, scoreDivider: { width: 1, marginHorizontal: 10, backgroundColor: C.line }, courtFoot: { marginTop: 8, paddingTop: 9, borderTopWidth: 1, borderColor: C.line, flexDirection: 'row', justifyContent: 'space-between' }, scorerMeta: { flex: 1, color: C.teal, fontSize: 8, fontWeight: '800' }, timer: { marginLeft: 'auto', color: C.ink, fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] }, openPrompt: { minHeight: 58, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, openPromptCompact: { minHeight: 78, gap: 6 }, openPlus: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, openTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, openMeta: { marginTop: 3, color: C.ink40, fontSize: 8 },
  queueHeadActions: { alignItems: 'flex-end', gap: 5 }, queueCount: { color: C.teal, fontSize: 7, fontWeight: '900' }, addPlayerButton: { minHeight: 31, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, backgroundColor: C.optic }, addPlayerText: { color: C.ink, fontSize: 7, fontWeight: '900' }, fairCard: { marginBottom: 9, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 14, backgroundColor: '#E5F0ED' }, fairCardPriority: { marginTop: 12, marginBottom: 0, borderWidth: 1, borderColor: C.teal }, fairIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.surface }, fairTitle: { color: C.ink, fontSize: 9, fontWeight: '900' }, fairMeta: { marginTop: 3, color: C.ink70, fontSize: 7.5, lineHeight: 12 }, overrideAudit: { marginBottom: 9, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 13, backgroundColor: '#F7EAE6' }, overrideAuditTitle: { color: C.brick, fontSize: 8, fontWeight: '900' }, overrideAuditMeta: { marginTop: 2, color: C.ink70, fontSize: 7, lineHeight: 11 }, queueCard: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, queueRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 7 }, rowBorder: { borderTopWidth: 1, borderColor: C.line }, queuePosition: { width: 20, color: C.ink40, textAlign: 'center', fontSize: 9, fontWeight: '900' }, avatar: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, avatarText: { color: C.surface, fontSize: 9, fontWeight: '900' }, playerName: { color: C.ink, fontSize: 11, fontWeight: '900' }, playerMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, priorityButton: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, priorityButtonActive: { backgroundColor: C.optic }, doneButton: { minWidth: 44, minHeight: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, doneText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, emptyQueue: { minHeight: 130, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { marginTop: 7, color: C.ink, fontSize: 11, fontWeight: '900' }, emptyMeta: { marginTop: 4, color: C.ink40, fontSize: 8 },
  lead: { marginTop: -5, marginBottom: 15, color: C.ink70, fontSize: 10, lineHeight: 15 }, lineupMode: { marginBottom: 12, padding: 4, flexDirection: 'row', gap: 4, borderRadius: 14, backgroundColor: '#E7EBE6' }, lineupModeChoice: { minHeight: 46, flex: 1, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11 }, lineupModeChoiceActive: { backgroundColor: C.optic }, lineupModeText: { color: C.ink40, textAlign: 'center', fontSize: 7.5, fontWeight: '800' }, lineupModeTextActive: { color: '#0E2321', fontWeight: '900' }, explainCard: { marginBottom: 12, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 15, borderWidth: 1, borderColor: C.teal, backgroundColor: C.surface }, teamsCard: { flexDirection: 'row', gap: 9 }, lineupTeam: { flex: 1, padding: 12, borderRadius: 18, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, backgroundColor: '#E5F0ED' }, lineupTeamAway: { backgroundColor: '#F8EDE9' }, teamLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, lineupSlot: { minHeight: 50, marginTop: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 11, backgroundColor: C.surface }, smallAvatar: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink }, smallAvatarText: { color: C.surface, fontSize: 7, fontWeight: '900' }, lineupName: { flex: 1, color: C.ink, fontSize: 8, fontWeight: '800' }, openSlot: { color: C.ink40, fontSize: 8 }, pickerCard: { paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, pickerRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8 }, overrideInput: { minHeight: 82, fontSize: 10, lineHeight: 15 }, scorerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, scorerChoice: { width: '48%', minHeight: 54, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, scorerChoiceActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, scorerAvatarActive: { backgroundColor: C.teal }, scorerName: { flex: 1, color: C.ink, fontSize: 8, fontWeight: '800' },
  timerPill: { minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 17, backgroundColor: C.ink }, timerText: { color: C.surface, fontSize: 9, fontWeight: '900', fontVariant: ['tabular-nums'] }, matchPointBanner: { minHeight: 48, marginBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: C.optic }, matchPointText: { flex: 1, color: C.ink, fontSize: 9, fontWeight: '900' }, finishedBanner: { minHeight: 48, marginBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: C.teal }, finishedText: { flex: 1, color: C.surface, fontSize: 9, fontWeight: '800' }, scoreCard: { flexDirection: 'row', gap: 9 }, scoreTeam: { minHeight: 280, flex: 1, padding: 13, alignItems: 'center', borderRadius: 21, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, scoreTeamAway: { backgroundColor: '#FFFDFC' }, scoreNames: { minHeight: 38, marginTop: 9, color: C.ink, textAlign: 'center', fontSize: 10, lineHeight: 14, fontWeight: '900' }, bigScore: { marginTop: 13, color: C.ink, fontSize: 72, lineHeight: 80, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -4 }, pointButton: { width: '100%', minHeight: 54, marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 13, backgroundColor: C.teal }, pointButtonAway: { backgroundColor: C.brick }, pointText: { color: C.surface, fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  scorerCard: { marginTop: 13, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, scorerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scorerTitle: { marginTop: 3, color: C.ink, fontSize: 14, fontWeight: '900' }, assignmentPill: { paddingHorizontal: 7, minHeight: 24, justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, assignmentText: { color: C.teal, fontSize: 6, fontWeight: '900' }, scorerHelp: { marginTop: 6, color: C.ink40, fontSize: 8 }, scorerChips: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, scorerChip: { minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 11, backgroundColor: C.paper }, scorerChipActive: { borderWidth: 1, borderColor: C.teal, backgroundColor: '#E5F0ED' }, scorerChipText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, scorerChipTextActive: { color: C.teal, fontWeight: '900' }, liveActions: { marginTop: 13, flexDirection: 'row', gap: 9 }, secondaryButton: { minHeight: 49, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, secondaryText: { color: C.teal, fontSize: 9, fontWeight: '900' }, endMatchButton: { minHeight: 49, flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 13, backgroundColor: C.ink }, endMatchText: { color: C.surface, fontSize: 9, fontWeight: '900' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.5)' }, sheet: { padding: 20, paddingBottom: 32, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: C.paper }, sheetHandle: { width: 42, height: 4, alignSelf: 'center', marginBottom: 18, borderRadius: 2, backgroundColor: C.line }, sheetTitle: { marginTop: 3, color: C.ink, fontSize: 23, fontWeight: '900' }, sheetLead: { marginTop: 5, marginBottom: 11, color: C.ink40, fontSize: 9, lineHeight: 14 }, venuePickerSheet: { height: '82%', paddingBottom: 18 }, venuePickerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, venueSearchBox: { minHeight: 52, marginTop: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, venueSearchInput: { flex: 1, color: C.ink, fontSize: 11, fontWeight: '800' }, venueResultCount: { minWidth: 26, minHeight: 26, paddingHorizontal: 6, textAlign: 'center', textAlignVertical: 'center', borderRadius: 13, overflow: 'hidden', backgroundColor: '#E5F0ED', color: C.teal, fontSize: 8, fontWeight: '900' }, venueFlatList: { flex: 1 }, venueList: { paddingTop: 10, paddingBottom: 18 }, venueListItem: { minHeight: 70, marginBottom: 7, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, venueListItemActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, venueListIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, venueListIconActive: { backgroundColor: C.optic }, venueListName: { color: C.ink, fontSize: 11, fontWeight: '900' }, venueListMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, venueEmpty: { minHeight: 220, alignItems: 'center', justifyContent: 'center' }, venueEmptyTitle: { marginTop: 8, color: C.ink, fontSize: 11, fontWeight: '900' }, venueEmptyMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, setupHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 }, historyButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, historyTabs: { marginTop: 14, marginBottom: 6, flexDirection: 'row', gap: 7 }, historyTab: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, historyTabActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, historyTabText: { color: C.ink40, fontSize: 9, fontWeight: '900' }, historyTabTextActive: { color: C.teal }, historyRow: { minHeight: 70, marginBottom: 7, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, historyRowDate: { marginTop: 2, color: C.ink40, fontSize: 8, fontWeight: '700' }, historyStatusPill: { minHeight: 24, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, historyStatusPillText: { color: C.teal, fontSize: 7, fontWeight: '900' }, historyStatusPillCancelled: { backgroundColor: '#F8EDE9' }, historyStatusPillTextCancelled: { color: C.brick }, singleInput: { minHeight: 52, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 12, fontWeight: '700' }, inputError: { marginTop: 6, color: C.brick, fontSize: 8, fontWeight: '800' }, endPlayerRow: { minHeight: 59, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderColor: C.line }, returnPill: { minHeight: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E5F0ED' }, returnText: { color: C.teal, fontSize: 6, fontWeight: '900' }, donePill: { backgroundColor: '#F8EDE9' }, donePillText: { color: C.brick }, sheetActions: { marginTop: 16, flexDirection: 'row', gap: 9 }, confirmButton: { minHeight: 49, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.ink }, confirmText: { color: C.surface, fontSize: 9, fontWeight: '900' },
  announcementInput: { minHeight: 105, paddingTop: 13, textAlignVertical: 'top' },
  tvScreen: { flex: 1, padding: 24, backgroundColor: C.ink }, tvHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, tvBrand: { color: C.optic, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, tvTitle: { marginTop: 4, color: C.surface, fontSize: 28, fontWeight: '900' }, tvClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#304743' }, tvStats: { marginTop: 22, padding: 18, flexDirection: 'row', justifyContent: 'space-around', borderRadius: 18, backgroundColor: '#17302D' }, tvNumber: { color: C.surface, textAlign: 'center', fontSize: 30, fontWeight: '900' }, tvLabel: { marginTop: 3, color: '#9FB3AC', textAlign: 'center', fontSize: 7, fontWeight: '900', letterSpacing: .8 }, tvSection: { marginTop: 22, color: C.optic, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, tvCourts: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, tvCourt: { width: '48%', minHeight: 135, padding: 14, borderRadius: 17, backgroundColor: '#17302D' }, tvCourtOpen: { borderWidth: 1, borderColor: C.optic }, tvCourtName: { color: '#9FB3AC', fontSize: 8, fontWeight: '900' }, tvScore: { marginTop: 8, color: C.surface, fontSize: 36, fontWeight: '900' }, tvOpen: { marginTop: 13, color: C.optic, fontSize: 24, fontWeight: '900' }, tvPlayers: { marginTop: 5, color: '#C8D3CF', fontSize: 8, lineHeight: 12 }, tvNext: { marginTop: 'auto', padding: 18, borderRadius: 18, backgroundColor: C.optic }, tvNextNames: { marginTop: 8, color: '#0E2321', fontSize: 18, lineHeight: 24, fontWeight: '900' }, tvReason: { marginTop: 6, color: '#3C4A45', fontSize: 8, lineHeight: 12 },
  summaryContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' }, summaryIcon: { width: 72, height: 72, marginBottom: 18, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, summaryTitle: { marginTop: 5, color: C.ink, fontSize: 28, fontWeight: '900' }, summaryLead: { maxWidth: 300, marginTop: 7, color: C.ink40, textAlign: 'center', fontSize: 10, lineHeight: 16 }, summaryWarning: { marginTop: 10, color: C.brick, fontSize: 8, fontWeight: '800' }, summaryStats: { width: '100%', marginTop: 23, paddingVertical: 17, flexDirection: 'row', borderRadius: 18, backgroundColor: C.surface }, summaryStat: { flex: 1, alignItems: 'center' }, summaryNumber: { color: C.ink, fontSize: 27, fontWeight: '900' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
