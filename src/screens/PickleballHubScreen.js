import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, LayoutAnimation, Linking, Modal, Pressable, ScrollView as NativeScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { WebView } from 'react-native-webview';
import ScrollView from '../components/FocusResetScrollView';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { listManagedVenues, verifiedPublishingVenues } from '../services/database';
import { saveCompetitionCover } from '../services/organizerMedia';
import OrganizerImagePicker from '../components/OrganizerImagePicker';
import ResilientImage from '../components/ResilientImage';
import AppDatePickerModal, { AppDatePickerField } from '../components/AppDatePickerModal';
import PeakleLoadingOverlay from '../components/PeakleLoadingOverlay';
import { requireSupabase } from '../lib/supabase';
import {
  claimMatchRequest, closeMatchRequest, closeOpenMatchRequests, COMPETITION_ENTRY_TYPES, COMPETITION_FORMATS, COMPETITION_PARTICIPANT_DIVISIONS, COMPETITION_SKILL_CATEGORIES, confirmMatchResult, createCompetition, createMembershipProduct, createTeamChallenge, createVenueProgram,
  joinCompetition, joinProgram, loadOrganizerPickleballHub, loadPlayerPickleballHub, loadVenueAnalytics,
  publishMatchRequest, recordCompetitionMatchResult, requestMembership, respondTeamChallenge, reviewCompetitionEntry, scheduleCompetitionMatch, seedTournamentBracket, setCompetitionDivisionStatus, setCompetitionStatus, startMembershipCheckout, updateCompetitionDetails, updateCompetitionDivisionDetails, updatePickleballPrivacy, venueAnalyticsCsv,
} from '../services/pickleball';

const LIGHT = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6', panel: '#0E2321', busy: 'rgba(255,255,255,.94)' };
const DARK = { ...DARK_CONTENT_COLORS, surface: '#17302D', tealWash: '#203B37', brickWash: '#402C29', panel: '#102825', busy: 'rgba(23,48,45,.96)' };
const BALL_IMAGE = require('../../public/images/ball.png');
const tomorrowAt = (hour) => { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(hour, 0, 0, 0); return date.toISOString(); };
const inDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const formatDate = (value, time = true) => new Date(value).toLocaleString('en-PH', time ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' });
const money = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const PARTICIPANT_DIVISION_LABELS = { open: 'Open', women: 'Women’s', men: 'Men’s', mixed: 'Mixed' };
const SKILL_CATEGORY_LABELS = { open: 'Open level', novice: 'Novice', intermediate: 'Intermediate', advanced: 'Advanced' };
const ENTRY_TYPE_LABELS = { player: 'Player', team: 'Team' };
let divisionDraftSequence = 0;
const competitionDivisionName = (division) => {
  const participant = PARTICIPANT_DIVISION_LABELS[division.participantDivision] || 'Open';
  const skill = SKILL_CATEGORY_LABELS[division.skillCategory] || 'Open level';
  const prefix = division.participantDivision === 'open' && division.skillCategory === 'open'
    ? 'Open'
    : `${participant}${division.skillCategory === 'open' ? '' : ` ${skill}`}`;
  return `${prefix} ${division.format === 'singles' ? 'Singles' : 'Doubles'}`;
};
const createDivisionDraft = (index = 0) => ({
  draftId: `division-${Date.now()}-${index}-${divisionDraftSequence++}`,
  participantDivision: 'open',
  skillCategory: 'open',
  format: 'doubles',
  entryType: 'player',
  capacity: '16',
  feeAmount: '0',
  feeBasis: 'player',
});
const createSixDivisionTemplate = () => ['novice', 'intermediate'].flatMap((skillCategory) => ['men', 'women', 'mixed'].map((participantDivision, index) => ({
  ...createDivisionDraft(index),
  participantDivision,
  skillCategory,
  format: 'doubles',
  entryType: 'player',
})));
const MATCH_REQUEST_TYPES = {
  partner: { format: 'doubles', icon: 'people-outline', filterLabel: 'Doubles partner requests', note: 'Looking for a reliable doubles partner.' },
  opponent: { format: 'singles', icon: 'tennisball-outline', filterLabel: 'Singles opponent requests', note: 'Looking for a competitive singles opponent.' },
  substitute: { format: 'team', icon: 'flash-outline', filterLabel: 'Team substitute requests', note: 'Team needs a substitute player.' },
};

const padDatePart = (value) => String(value).padStart(2, '0');
const localDateValue = (date) => `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
function localDateTimeIso(dateValue, timeValue, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue || '') || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeValue || '')) {
    throw new Error(`${label} must use YYYY-MM-DD and 24-hour HH:MM.`);
  }
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) throw new Error(`${label} is not a valid date.`);
  return result;
}
const requestDateOptions = () => Array.from({ length: 7 }, (_, index) => {
  const date = new Date();
  date.setDate(date.getDate() + index + 1);
  return {
    value: localDateValue(date),
    day: date.toLocaleDateString('en-PH', { weekday: 'short' }),
    date: date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
  };
});
const defaultRequestAction = (area) => ({
  type: 'publish',
  kind: 'partner',
  ...MATCH_REQUEST_TYPES.partner,
  date: requestDateOptions()[0].value,
  startTime: '18:00',
  endTime: '20:00',
  area,
  error: '',
});

function parseRequestSchedule(action) {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(action.startTime || '') || !timePattern.test(action.endTime || '')) {
    throw new Error('Enter start and end times in 24-hour HH:MM format.');
  }
  if (!action.area?.trim()) throw new Error('Add an area so nearby players know where you want to play.');
  const [year, month, day] = action.date.split('-').map(Number);
  const [startHour, startMinute] = action.startTime.split(':').map(Number);
  const [endHour, endMinute] = action.endTime.split(':').map(Number);
  const startsAt = new Date(year, month - 1, day, startHour, startMinute, 0, 0);
  const endsAt = new Date(year, month - 1, day, endHour, endMinute, 0, 0);
  if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) throw new Error('Choose a future start time.');
  if (endsAt <= startsAt) throw new Error('End time must be later than start time.');
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), area: action.area.trim() };
}

function Icon({ name, size = 20, color }) { return <Ionicons name={name} size={size} color={color} />; }
function Pill({ children, active, onPress, C }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[s.pill, { backgroundColor: active ? C.optic : C.surface, borderColor: active ? 'transparent' : C.line }]}><Text style={[s.pillText, { color: active ? '#0E2321' : C.ink40 }]}>{children}</Text></Pressable>; }
function Section({ eyebrow, title, action, C }) { return <View style={s.sectionHead}><View style={s.flex}><Text style={[s.eyebrow, { color: C.ink40 }]}>{eyebrow}</Text><Text style={[s.h2, { color: C.ink }]}>{title}</Text></View>{action}</View>; }
function Empty({ icon, title, detail, C }) { return <View style={[s.empty, { backgroundColor: C.surface, borderColor: C.line }]}><Icon name={icon} size={28} color={C.teal} /><Text style={[s.emptyTitle, { color: C.ink }]}>{title}</Text><Text style={[s.emptyDetail, { color: C.ink40 }]}>{detail}</Text></View>; }
function ActionButton({ title, icon = 'add', onPress, secondary, disabled, C }) { return <Pressable disabled={disabled} onPress={onPress} style={[s.action, { backgroundColor: secondary ? C.surface : C.optic, borderColor: secondary ? C.line : C.optic }, disabled && s.disabled]}><Icon name={icon} size={16} color={secondary ? C.teal : '#0E2321'} /><Text style={[s.actionText, { color: secondary ? C.teal : '#0E2321' }]}>{title}</Text></Pressable>; }
function BackHeader({ navigation, eyebrow, title, C }) { return <><View style={s.header}><Pressable accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={[s.back, { backgroundColor: C.surface, borderColor: C.line }]}><Icon name="arrow-back" color={C.ink} /></Pressable><View style={s.headerCopy}><Text numberOfLines={1} style={[s.eyebrow, { color: C.ink40 }]}>{eyebrow}</Text><Text numberOfLines={1} style={[s.h1, { color: C.ink }]}>{title}</Text></View><View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.ball, { backgroundColor: C.optic }]}><Image source={BALL_IMAGE} style={s.ballImage} resizeMode="contain" /></View></View><View style={[s.solid, { backgroundColor: C.ink }]} /><View style={[s.dashed, { borderColor: C.ink40 }]} /></>; }

function RatingCard({ label, rating, record, C }) {
  const value = rating?.rating ?? rating;
  return <View style={[s.ratingCard, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.ratingLabel, { color: C.ink40 }]}>{label}</Text><Text style={[s.ratingValue, { color: C.ink }]}>{value == null ? '—' : Number(value).toFixed(2)}</Text><Text style={[s.ratingMeta, { color: C.teal }]}>{record ? `${record.wins}–${record.losses} · ${record.verified_matches} verified` : 'Complete a verified match'}</Text></View>;
}

function VerificationCard({ match, userId, onConfirm, C }) {
  const mine = match.match_result_confirmations?.find((item) => item.user_id === userId);
  const players = match.match_participants?.map((item) => item.profiles?.display_name || 'Guest').join(' · ');
  return <View style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.row}><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{match.match_type === 'singles' ? 'Singles' : 'Doubles'} result</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{formatDate(match.ended_at)} · {players}</Text></View><View style={[s.status, { backgroundColor: match.verification_status === 'disputed' ? C.brickWash : C.tealWash }]}><Text style={[s.statusText, { color: match.verification_status === 'disputed' ? C.brick : C.teal }]}>{match.verification_status.toUpperCase()}</Text></View></View>{!mine ? <View style={s.inlineActions}><ActionButton title="Dispute" icon="flag-outline" secondary onPress={() => onConfirm(match.id, false)} C={C} /><ActionButton title="Confirm result" icon="shield-checkmark" onPress={() => onConfirm(match.id, true)} C={C} /></View> : <Text style={[s.decision, { color: mine.decision === 'confirmed' ? C.teal : C.brick }]}>You {mine.decision} revision {match.result_revision}.</Text>}</View>;
}

const PROFILE_PRIVACY = [
  { value: 'private', icon: 'lock-closed-outline', title: 'Only me', detail: 'Your ratings and competitive stats stay private.' },
  { value: 'members', icon: 'people-outline', title: 'My teammates', detail: 'Only players who share a Peakle team with you can see them.', recommended: true },
  { value: 'public', icon: 'globe-outline', title: 'All Peakle players', detail: 'Any signed-in player can see your ratings and competitive stats.' },
];
function PrivacyChoice({ option, selected, disabled, onPress, C }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={[s.privacyChoice, { backgroundColor: selected ? C.tealWash : C.surface, borderColor: selected ? C.teal : C.line }, disabled && s.privacyDisabled]}><View style={[s.privacyIcon, { backgroundColor: selected ? C.optic : C.paper }]}><Icon name={option.icon} size={17} color={selected ? '#0E2321' : C.teal} /></View><View style={s.flex}><View style={s.privacyTitleRow}><Text style={[s.privacyChoiceTitle, { color: C.ink }]}>{option.title}</Text>{option.recommended ? <View style={[s.recommended, { backgroundColor: C.tealWash }]}><Text style={[s.recommendedText, { color: C.teal }]}>RECOMMENDED</Text></View> : null}</View><Text style={[s.privacyChoiceDetail, { color: C.ink40 }]}>{option.detail}</Text></View><Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={selected ? C.teal : C.ink40} /></Pressable>;
}

function PrivacyControls({ profile, onSave, C }) {
  const initial = { profileVisibility: profile.profile_visibility, availabilityVisibility: profile.availability_visibility, matchingEnabled: profile.matching_enabled };
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => setSettings({ profileVisibility: profile.profile_visibility, availabilityVisibility: profile.availability_visibility, matchingEnabled: profile.matching_enabled }), [profile]);

  const change = async (patch) => {
    if (saving) return;
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    setMessage('');
    setLocalError('');
    try {
      await onSave(next);
      setMessage('Saved automatically');
    } catch (error) {
      setSettings(previous);
      setLocalError(error.message || 'Your privacy change could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const profileLabel = PROFILE_PRIVACY.find((item) => item.value === settings.profileVisibility)?.title;
  return <>
    <View style={[s.privacySummary, { backgroundColor: C.panel }]}><View style={[s.privacyShield, { backgroundColor: C.optic }]}><Icon name="shield-checkmark" color="#0E2321" /></View><View style={s.flex}><Text style={s.infoTitle}>Your privacy at a glance</Text><Text style={s.infoMeta}>Competitive profile: {profileLabel}{'\n'}Player matching: {settings.matchingEnabled ? 'On' : 'Off'}</Text></View></View>
    <View style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}>
      <View style={s.matchingRow}><View style={[s.privacyIcon, { backgroundColor: settings.matchingEnabled ? C.tealWash : C.paper }]}><Icon name="search-outline" color={settings.matchingEnabled ? C.teal : C.ink40} /></View><View style={s.flex}><View style={s.privacyTitleRow}><Text style={[s.privacyChoiceTitle, { color: C.ink }]}>Allow player matching</Text><View style={[s.matchingState, { backgroundColor: settings.matchingEnabled ? C.tealWash : C.paper }]}><Text style={[s.matchingStateText, { color: settings.matchingEnabled ? C.teal : C.ink40 }]}>{settings.matchingEnabled ? 'ON' : 'OFF'}</Text></View></View><Text style={[s.privacyChoiceDetail, { color: C.ink40 }]}>{settings.matchingEnabled ? 'You can publish and accept partner, opponent, and substitute requests.' : 'You are hidden from matching. Any open request is closed for your safety.'}</Text></View><Switch accessibilityLabel="Allow player matching" disabled={saving} value={settings.matchingEnabled} onValueChange={(value) => change({ matchingEnabled: value })} trackColor={{ false: C.line, true: C.teal }} thumbColor={settings.matchingEnabled ? C.optic : C.ink40} /></View>
    </View>
    <Text style={[s.privacySectionTitle, { color: C.ink }]}>Who can see my competitive profile?</Text>
    <Text style={[s.privacySectionHelp, { color: C.ink40 }]}>This includes your singles and doubles ratings and verified performance.</Text>
    <View accessibilityRole="radiogroup" style={s.privacyChoices}>{PROFILE_PRIVACY.map((option) => <PrivacyChoice key={option.value} option={option} selected={settings.profileVisibility === option.value} disabled={saving} onPress={() => change({ profileVisibility: option.value })} C={C} />)}</View>
    <View style={s.privacySaveState}>{saving ? <ActivityIndicator size="small" color={C.teal} /> : <Icon name={localError ? 'alert-circle' : 'checkmark-circle'} size={17} color={localError ? C.brick : C.teal} />}<Text style={[s.privacySaveText, { color: localError ? C.brick : C.ink40 }]}>{saving ? 'Saving your privacy choice…' : localError || message || 'Changes save automatically'}</Text></View>
  </>;
}

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

function clockTimeLabel(value) {
  if (!value) return '';
  const [hour, minute] = value.split(':').map(Number);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function PlayRequestSheet({ action, busy, onClose, onConfirm, onChangeKind, onChangeField, C }) {
  const insets = useSafeAreaInsets();
  const [timePickerField, setTimePickerField] = useState(null);
  const [timeDraft, setTimeDraft] = useState('18:00');

  useEffect(() => {
    if (!action) setTimePickerField(null);
  }, [action]);

  const openTimePicker = (field) => {
    setTimeDraft(action[field] || '18:00');
    setTimePickerField(field);
  };

  const chooseScheduleTime = (value) => {
    onChangeField(timePickerField, value);
    setTimePickerField(null);
  };

  if (!action) return null;
  const publishing = action.type === 'publish';
  const clearing = action.type === 'clear';
  const title = publishing ? `Find a ${action.kind}` : clearing ? 'Clear your open requests?' : 'Close this request?';
  const detail = publishing
    ? 'Review the details before making this visible to nearby Peakle players.'
    : clearing
      ? 'This closes all of your currently open partner, opponent, and substitute requests.'
      : `Your ${action.kind} request will be removed from the public list.`;
  const confirmLabel = publishing ? 'Publish request' : clearing ? 'Clear requests' : 'Close request';
  const dates = publishing ? requestDateOptions() : [];
  return <Modal visible transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close request dialog" onPress={() => !busy && onClose()} style={s.modalBackdrop}>
      <Pressable onPress={(event) => event.stopPropagation()} style={[s.requestSheet, { backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 18) }]}>
        <View style={[s.handle, { backgroundColor: C.line }]} />
        <View style={s.row}><View style={s.flex}><Text style={[s.eyebrow, { color: C.teal }]}>{publishing ? 'FIND PLAY' : 'MANAGE REQUESTS'}</Text><Text style={[s.sheetTitle, { color: C.ink }]}>{title}</Text></View><Pressable accessibilityLabel="Close" disabled={busy} onPress={onClose} style={[s.sheetClose, { backgroundColor: C.surface }]}><Icon name="close" size={20} color={C.ink} /></Pressable></View>
        <NativeScrollView style={s.requestSheetScroll} contentContainerStyle={s.requestSheetContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"><Text style={[s.sheetSubtitle, { color: C.ink40 }]}>{detail}</Text>
        {timePickerField ? <View style={s.compactTimePicker}>
          <Text style={[s.timeAdjustLabel, { color: C.ink40 }]}>ADJUST IN 15-MINUTE STEPS</Text>
          <View style={[s.timeAdjuster, { backgroundColor: C.surface, borderColor: C.line }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="15 minutes earlier" onPress={() => setTimeDraft((value) => shiftClockTime(value, -15))} style={[s.timeAdjustButton, { backgroundColor: C.paper }]}><Icon name="remove" size={24} color={C.teal} /></Pressable>
            <View style={s.timeAdjustValue}><Text style={[s.timeAdjustValueText, { color: C.ink }]}>{clockTimeLabel(timeDraft)}</Text><Text style={[s.timeAdjustHint, { color: C.ink40 }]}>TAP − OR + TO ADJUST</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="15 minutes later" onPress={() => setTimeDraft((value) => shiftClockTime(value, 15))} style={[s.timeAdjustButton, { backgroundColor: C.optic }]}><Icon name="add" size={24} color="#0E2321" /></Pressable>
          </View>
          <View style={s.hourJumpRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="One hour earlier" onPress={() => setTimeDraft((value) => shiftClockTime(value, -60))} style={[s.hourJumpButton, { backgroundColor: C.surface, borderColor: C.line }]}><Icon name="play-back" size={14} color={C.teal} /><Text style={[s.hourJumpText, { color: C.teal }]}>1 HOUR</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="One hour later" onPress={() => setTimeDraft((value) => shiftClockTime(value, 60))} style={[s.hourJumpButton, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.hourJumpText, { color: C.teal }]}>1 HOUR</Text><Icon name="play-forward" size={14} color={C.teal} /></Pressable>
          </View>
          <Text style={[s.timeQuickLabel, { color: C.ink40 }]}>QUICK TIMES</Text>
          <View style={s.timeQuickGrid}>{QUICK_TIME_OPTIONS.map((item) => { const active = item.value === timeDraft; return <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => setTimeDraft(item.value)} style={[s.timeQuickOption, { backgroundColor: active ? C.optic : C.surface, borderColor: active ? C.optic : C.line }]}><Text style={[s.timeQuickText, { color: active ? '#0E2321' : C.ink70 }]}>{item.label}</Text>{active ? <Icon name="checkmark" size={13} color="#0E2321" /> : null}</Pressable>; })}</View>
          <Pressable accessibilityRole="button" onPress={() => chooseScheduleTime(timeDraft)} style={[s.timeConfirmButton, { backgroundColor: C.optic }]}><Text style={[s.timeConfirmText, { color: '#0E2321' }]}>Use {clockTimeLabel(timeDraft)}</Text><Icon name="checkmark" size={18} color="#0E2321" /></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setTimePickerField(null)} style={[s.timeCancelButton, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.timeCancelText, { color: C.ink70 }]}>Cancel</Text></Pressable>
        </View> : publishing ? <>
          <Text style={[s.modalChoiceLabel, { color: C.ink40 }]}>PLAY DATE</Text>
          <NativeScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.requestDateList}>{dates.map((option) => { const active = action.date === option.value; return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: active }} disabled={busy} onPress={() => onChangeField('date', option.value)} style={[s.requestDate, { backgroundColor: active ? C.optic : C.surface, borderColor: active ? C.teal : C.line }]}><Text style={[s.requestDateDay, { color: active ? '#0E2321' : C.ink40 }]}>{option.day}</Text><Text style={[s.requestDateValue, { color: active ? '#0E2321' : C.ink }]}>{option.date}</Text></Pressable>; })}</NativeScrollView>
          <View style={s.requestFieldRow}>
            <View style={s.requestField}><Text style={[s.modalChoiceLabel, { color: C.ink40 }]}>START TIME</Text><Pressable accessibilityRole="button" accessibilityLabel={`Choose start time, currently ${clockTimeLabel(action.startTime)}`} disabled={busy} onPress={() => openTimePicker('startTime')} style={[s.input, s.timePickerPressable, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.timePickerPressableText, { color: C.ink }]}>{clockTimeLabel(action.startTime) || '18:00'}</Text></Pressable></View>
            <View style={s.requestField}><Text style={[s.modalChoiceLabel, { color: C.ink40 }]}>END TIME</Text><Pressable accessibilityRole="button" accessibilityLabel={`Choose end time, currently ${clockTimeLabel(action.endTime)}`} disabled={busy} onPress={() => openTimePicker('endTime')} style={[s.input, s.timePickerPressable, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.timePickerPressableText, { color: C.ink }]}>{clockTimeLabel(action.endTime) || '20:00'}</Text></Pressable></View>
          </View>
          <Text style={[s.modalChoiceLabel, { color: C.ink40 }]}>AREA</Text><TextInput accessibilityLabel="Play area" editable={!busy} value={action.area} onChangeText={(value) => onChangeField('area', value)} placeholder="City or nearby venue" placeholderTextColor={C.ink40} maxLength={80} style={[s.input, { backgroundColor: C.surface, borderColor: C.line, color: C.ink }]} />
          <Text style={[s.modalChoiceLabel, { color: C.ink40 }]}>MESSAGE (OPTIONAL)</Text><TextInput accessibilityLabel="Request message" editable={!busy} value={action.note} onChangeText={(value) => onChangeField('note', value)} placeholder="Tell players what kind of game you want" placeholderTextColor={C.ink40} maxLength={240} multiline style={[s.input, s.requestNoteInput, { backgroundColor: C.surface, borderColor: C.line, color: C.ink }]} />
          {action.error ? <View style={[s.requestFormError, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" size={17} color={C.brick} /><Text style={[s.requestFormErrorText, { color: C.brick }]}>{action.error}</Text></View> : null}</> : <View style={[s.requestWarning, { backgroundColor: C.brickWash }]}><Icon name="information-circle-outline" color={C.brick} /><Text style={[s.requestWarningText, { color: C.brick }]}>{clearing ? 'Matched requests are kept so both players can still see the connection.' : 'You can publish a new request later if your plans change.'}</Text></View>}</NativeScrollView>
        {!timePickerField && <View style={s.sheetActions}><Pressable disabled={busy} onPress={onClose} style={[s.sheetCancel, { backgroundColor: C.surface, borderColor: C.line }, busy && s.disabled]}><Text style={[s.sheetCancelText, { color: C.ink70 }]}>Cancel</Text></Pressable><Pressable disabled={busy} onPress={onConfirm} style={[s.sheetConfirm, { backgroundColor: publishing ? C.optic : C.brick }, busy && s.disabled]}>{busy ? <ActivityIndicator color={publishing ? '#0E2321' : '#FFFFFF'} /> : <><Text style={[s.sheetConfirmText, { color: publishing ? '#0E2321' : '#FFFFFF' }]}>{confirmLabel}</Text><Icon name={publishing ? 'arrow-forward' : clearing ? 'trash-outline' : 'close-circle-outline'} size={17} color={publishing ? '#0E2321' : '#FFFFFF'} /></>}</Pressable></View>}
      </Pressable>
    </Pressable>
  </Modal>;
}

function PlayerCompetitionDivision({ competition, division, userId, managedTeams, navigation, act, C }) {
  const allEntries = division.competition_entries || [];
  const activeEntries = allEntries.filter((entry) => ['registered', 'active'].includes(entry.status) && entry.eligibility_status !== 'rejected');
  const standings = activeEntries.filter((entry) => ['not_required', 'approved'].includes(entry.eligibility_status)).sort((a, b) => b.standing_points - a.standing_points || b.won - a.won);
  const managedTeamIds = new Set(managedTeams.map((team) => team.id));
  const mine = allEntries.find((entry) => entry.user_id === userId || managedTeamIds.has(entry.team_id));
  const entryName = (id) => {
    const entry = allEntries.find((item) => item.id === id);
    return entry?.profiles?.display_name || entry?.teams?.name || 'TBD';
  };
  const canRegister = ['registration', 'active'].includes(competition.status) && division.status === 'registration' && activeEntries.length < division.capacity;
  const feeLabel = Number(division.fee_amount) > 0 ? `${money(division.fee_amount)} / ${division.fee_basis}` : 'Free';
  const registrationMessage = mine?.eligibility_status === 'pending'
    ? 'Eligibility review pending.'
    : mine?.eligibility_status === 'rejected'
      ? 'Eligibility was not approved.'
      : mine
        ? 'Registered in this division.'
        : null;

  return <View style={[s.competitionDivision, { backgroundColor: C.paper, borderColor: C.line }]}>
    <View style={s.row}><View style={s.flex}><Text style={[s.divisionName, { color: C.ink }]}>{division.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{PARTICIPANT_DIVISION_LABELS[division.participant_division]} · {SKILL_CATEGORY_LABELS[division.skill_category]} · {division.format} · {ENTRY_TYPE_LABELS[division.entry_type]} entry</Text></View><Text style={[s.capacity, { color: C.teal }]}>{activeEntries.length}/{division.capacity}</Text></View>
    <Text style={[s.divisionFee, { color: C.ink70 }]}>{feeLabel}</Text>
    {standings.slice(0, 3).map((entry, index) => <View key={entry.id} style={[s.standing, { borderColor: C.line }]}><Text style={[s.rank, { color: C.teal }]}>{index + 1}</Text><Text style={[s.standingName, { color: C.ink }]}>{entry.profiles?.display_name || entry.teams?.name || 'Entrant'}</Text><Text style={[s.standingPoints, { color: C.ink }]}>{entry.standing_points} PTS</Text></View>)}
    {division.competition_bracket_matches?.filter((slot) => slot.round_number === 1).slice(0, 4).map((slot, i) => <View key={slot.id} style={[s.bracket, { backgroundColor: C.surface, marginTop: i === 0 ? 16 : 8 }]}><Text style={[s.bracketRound, { color: C.teal }]}>R1 · {slot.position}</Text><Text numberOfLines={1} style={[s.bracketTeams, { color: C.ink }]}>{entryName(slot.home_entry_id)} vs {entryName(slot.away_entry_id)}</Text></View>)}
    {standings.length || division.competition_bracket_matches?.length ? <View style={{ marginTop: 16 }}><ActionButton title={competition.kind === 'tournament' ? 'View standings & bracket' : 'View standings'} icon="podium-outline" secondary onPress={() => navigation.navigate('CompetitionDivision', { competitionId: competition.id, divisionId: division.id })} C={C} /></View> : null}
    {registrationMessage ? <Text style={[s.decision, { color: mine?.eligibility_status === 'rejected' ? C.brick : C.teal }]}>{registrationMessage}</Text> : canRegister && division.entry_type === 'player' ? <ActionButton title="Register in division" icon="trophy-outline" onPress={() => act(() => joinCompetition(competition.id, division.id), `Registration saved for ${division.name}.`)} C={C} /> : canRegister && managedTeams.length ? <View style={s.inlineActions}>{managedTeams.map((team) => <ActionButton key={team.id} title={`Register ${team.name}`} icon="people-outline" onPress={() => act(() => joinCompetition(competition.id, division.id, team.id), `${team.name} is registered for ${division.name}.`)} C={C} />)}</View> : <Text style={[s.decision, { color: C.ink40 }]}>{canRegister ? 'A team you manage is required.' : activeEntries.length >= division.capacity ? 'Division full.' : `${standings.length} eligible entries`}</Text>}
    {division.participant_division !== 'open' || division.skill_category !== 'open' ? <Text style={[s.eligibilityNote, { color: C.ink40 }]}>Restricted eligibility is reviewed privately by the organizer.</Text> : null}
  </View>;
}

const MEMBERSHIP_PAYMENT_METHODS = [
  { value: 'gcash', label: 'GCash', detail: 'Pay securely from your GCash wallet', icon: 'phone-portrait-outline' },
  { value: 'paymaya', label: 'Maya', detail: 'Pay securely from your Maya wallet', icon: 'wallet-outline' },
  { value: 'card', label: 'Credit / debit card', detail: 'Visa, Mastercard, or JCB', icon: 'card-outline' },
  { value: 'dob', label: 'Online banking', detail: 'Pay directly from your bank', icon: 'business-outline' },
];

function membershipCheckoutResult(url, membershipId) {
  if (!url || !membershipId || !String(url).startsWith(`peakle://membership/${membershipId}/payment-result`)) return null;
  const match = String(url).match(/[?&]status=([^&#]+)/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : 'unknown';
}

function MembershipCheckoutModal({ membershipId, product, onDone, C }) {
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const finishedRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    finishedRef.current = false;
    setCheckoutUrl(null);
    setLoading(false);
    setVerifying(false);
    setError('');
  }, [membershipId]);

  const finish = useCallback((status) => {
    if (!membershipId || finishedRef.current) return;
    finishedRef.current = true;
    setCheckoutUrl(null);
    setVerifying(false);
    onDoneRef.current(status);
  }, [membershipId]);

  const handleResultUrl = useCallback((url) => {
    const result = membershipCheckoutResult(url, membershipId);
    if (!result) return false;
    if (result === 'success') {
      // A success redirect is not proof of payment. Wait for the signed
      // PayMongo webhook to update the database before granting access.
      setCheckoutUrl(null);
      setVerifying(true);
      setError('');
    } else {
      finish(result);
    }
    return true;
  }, [finish, membershipId]);

  useEffect(() => {
    if (!membershipId) return undefined;
    const listener = Linking.addEventListener('url', ({ url }) => handleResultUrl(url));
    return () => listener.remove();
  }, [handleResultUrl, membershipId]);

  useEffect(() => {
    if (!membershipId || (!checkoutUrl && !verifying)) return undefined;
    let active = true;
    const client = requireSupabase();
    const checkPayment = async () => {
      const { data } = await client.from('player_memberships').select('status,payment_status').eq('id', membershipId).maybeSingle();
      if (!active || !data) return;
      if (data.payment_status === 'paid' && data.status === 'active') finish('paid');
      if (data.payment_status === 'failed') finish('failed');
    };
    checkPayment();
    const timer = setInterval(checkPayment, 2000);
    const appStateListener = AppState.addEventListener('change', (state) => { if (state === 'active') checkPayment(); });
    const channel = client.channel(`membership-checkout-${membershipId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_memberships', filter: `id=eq.${membershipId}` }, ({ new: updated }) => {
        if (updated.payment_status === 'paid' && updated.status === 'active') finish('paid');
        if (updated.payment_status === 'failed') finish('failed');
      })
      .subscribe();
    return () => {
      active = false;
      clearInterval(timer);
      appStateListener.remove();
      client.removeChannel(channel);
    };
  }, [checkoutUrl, finish, membershipId, verifying]);

  const choose = async (method) => {
    setLoading(true);
    setError('');
    try {
      const { checkout_url: url } = await startMembershipCheckout(membershipId, method);
      setCheckoutUrl(url);
    } catch (reason) {
      setError(reason.message || 'Could not start checkout.');
    } finally {
      setLoading(false);
    }
  };

  const shouldLoad = (request) => !handleResultUrl(request?.url);
  if (!membershipId) return null;

  return <Modal visible animationType="slide" statusBarTranslucent onRequestClose={() => finish('cancelled')}>
    <SafeAreaView style={[s.checkoutSafe, { backgroundColor: C.surface }]}>
      <View style={[s.checkoutHeader, { borderColor: C.line }]}><View style={s.flex}><Text style={[s.checkoutEyebrow, { color: C.teal }]}>SECURE MEMBERSHIP CHECKOUT</Text><Text numberOfLines={1} style={[s.checkoutTitle, { color: C.ink }]}>{product?.name || 'Venue membership'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close checkout" onPress={() => finish('cancelled')} style={[s.sheetClose, { backgroundColor: C.paper }]}><Icon name="close" color={C.ink} /></Pressable></View>
      {checkoutUrl ? <WebView source={{ uri: checkoutUrl }} onShouldStartLoadWithRequest={shouldLoad} onNavigationStateChange={({ url }) => handleResultUrl(url)} startInLoadingState setSupportMultipleWindows={false} renderLoading={() => <View style={s.checkoutCenter}><ActivityIndicator color={C.teal} /><Text style={[s.checkoutHelp, { color: C.ink40 }]}>Opening PayMongo…</Text></View>} style={s.checkoutWebview} />
        : verifying ? <View style={s.checkoutCenter}><View style={[s.checkoutVerifyIcon, { backgroundColor: C.tealWash }]}><ActivityIndicator color={C.teal} /></View><Text style={[s.checkoutVerifyTitle, { color: C.ink }]}>Confirming your payment</Text><Text style={[s.checkoutHelp, { color: C.ink40 }]}>Keep this screen open while Peakle securely verifies the payment with PayMongo. Access activates only after verification.</Text></View>
          : <View style={s.checkoutMethods}><Text style={[s.checkoutAmount, { color: C.ink }]}>{money(product?.price)}</Text><Text style={[s.checkoutHelp, { color: C.ink40 }]}>Choose a payment method. Your membership activates automatically after PayMongo confirms payment.</Text>{error ? <View style={[s.error, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" color={C.brick} /><Text style={[s.errorText, { color: C.brick }]}>{error}</Text></View> : null}{loading ? <View style={s.checkoutCenter}><ActivityIndicator color={C.teal} /></View> : MEMBERSHIP_PAYMENT_METHODS.map((method) => <Pressable key={method.value} accessibilityRole="button" onPress={() => choose(method.value)} style={({ pressed }) => [s.paymentMethod, { backgroundColor: C.paper, borderColor: C.line }, pressed && s.cardPressed]}><View style={[s.paymentMethodIcon, { backgroundColor: C.surface }]}><Icon name={method.icon} color={C.teal} /></View><View style={s.flex}><Text style={[s.paymentMethodTitle, { color: C.ink }]}>{method.label}</Text><Text style={[s.paymentMethodDetail, { color: C.ink40 }]}>{method.detail}</Text></View><Icon name="chevron-forward" color={C.ink40} /></Pressable>)}</View>}
    </SafeAreaView>
  </Modal>;
}

function PlayerCompete({ data, navigation, managedTeams, challengeOpponent, busy, onPurchaseMembership, act, C }) {
  return <>
    <Section eyebrow="LEAGUES · LADDERS · TOURNAMENTS" title="Competition" C={C} />
    {data.competitions.map((competition) => {
      return <View key={competition.id} style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}>
        {competition.cover_image_url ? <ResilientImage uri={competition.cover_image_url} accessibilityLabel={`${competition.name} cover photo`} style={s.competitionCover} /> : null}
        <View style={s.row}><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{competition.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{competition.kind.toUpperCase()} · {competition.competition_divisions?.length || 0} {(competition.competition_divisions?.length || 0) === 1 ? 'division' : 'divisions'} · starts {formatDate(competition.starts_on, false)}</Text></View><View style={[s.status, { backgroundColor: C.tealWash }]}><Text style={[s.statusText, { color: C.teal }]}>{competition.status.toUpperCase()}</Text></View></View>
        <View style={s.competitionDivisionList}>{[...(competition.competition_divisions || [])].sort((a, b) => a.position - b.position).map((division) => <PlayerCompetitionDivision key={division.id} competition={competition} division={division} userId={data.userId} managedTeams={managedTeams} navigation={navigation} act={act} C={C} />)}</View>
      </View>;
    })}
    {!data.competitions.length ? <Empty icon="trophy-outline" title="No open competition" detail="Published leagues, ladders, seasons, and tournaments appear here." C={C} /> : null}
    <Section eyebrow="TEAM CHALLENGES" title="Private scrimmages" action={managedTeams.length && challengeOpponent ? <ActionButton title="Challenge" onPress={() => act(() => createTeamChallenge({ challengerTeamId: managedTeams[0].id, challengedTeamId: challengeOpponent.id, startsAt: tomorrowAt(19), privacy: 'private', note: 'Private Peakle team scrimmage.' }), `Challenge sent to ${challengeOpponent.name}.`)} C={C} /> : null} C={C} />
    {data.challenges.map((challenge) => {
      const incoming = managedTeams.some((team) => team.id === challenge.challenged_team_id) && challenge.status === 'pending';
      return <View key={challenge.id} style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.cardTitle, { color: C.ink }]}>{challenge.challenger?.name} vs {challenge.challenged?.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{formatDate(challenge.starts_at)} · {challenge.format} · {challenge.privacy}</Text>{incoming ? <View style={s.inlineActions}><ActionButton title="Decline" secondary onPress={() => act(() => respondTeamChallenge(challenge.id, false), 'Challenge declined.')} C={C} /><ActionButton title="Accept" onPress={() => act(() => respondTeamChallenge(challenge.id, true), 'Scrimmage accepted.')} C={C} /></View> : <Text style={[s.decision, { color: C.teal }]}>{challenge.status.toUpperCase()}</Text>}</View>;
    })}
    {!data.challenges.length ? <Empty icon="people-outline" title="No team challenges" detail="Team managers can propose private scrimmages to another Peakle team." C={C} /> : null}
    <Section eyebrow="LEARN & IMPROVE" title="Clinics and coaching" C={C} />
    {data.programs.map((program) => { const mine = program.program_registrations?.find((entry) => entry.user_id === data.userId); return <View key={program.id} style={[s.rowCard, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.iconBox, { backgroundColor: C.optic }]}><Icon name="school-outline" color="#0E2321" /></View><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{program.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{program.venues?.name} · {formatDate(program.starts_at)} · {money(program.price)}</Text></View>{mine ? <Text style={[s.tinyStatus, { color: C.teal }]}>{mine.status.toUpperCase()}</Text> : <Pressable onPress={() => act(() => joinProgram(program.id), `Registration saved for ${program.name}.`)}><Icon name="add-circle" size={28} color={C.teal} /></Pressable>}</View>; })}
    {!data.programs.length ? <Empty icon="school-outline" title="No programs open" detail="Clinics, coaching blocks, and pickleball camps will appear here." C={C} /> : null}
    <Section eyebrow="MEMBERSHIPS · PACKAGES · CREDITS" title="Venue offers" C={C} />
    {data.products.map((product) => { const mine = data.memberships.find((membership) => membership.product_id === product.id); const active = mine?.status === 'active' && mine?.payment_status === 'paid'; const awaiting = mine?.status === 'pending' && mine?.payment_status === 'awaiting_payment'; return <View key={product.id} style={[s.rowCard, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.iconBox, { backgroundColor: C.tealWash }]}><Icon name="card-outline" color={C.teal} /></View><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{product.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{product.venues?.name} · {money(product.price)} · {product.validity_days} days</Text></View>{active ? <Text style={[s.tinyStatus, { color: C.teal }]}>ACTIVE</Text> : <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={`${awaiting ? 'Continue payment for' : 'Buy'} ${product.name}`} onPress={() => onPurchaseMembership(product, mine)} style={[s.offerBuy, { backgroundColor: C.optic }, busy && s.disabled]}><Text style={s.offerBuyText}>{Number(product.price) === 0 ? 'GET' : awaiting ? 'PAY' : 'BUY'}</Text><Icon name="arrow-forward" size={14} color="#0E2321" /></Pressable>}</View>; })}
    {!data.products.length ? <Empty icon="card-outline" title="No venue offers" detail="Venue memberships, court packages, credits, and discounts appear here." C={C} /> : null}
  </>;
}

function PlayerFind({ data, busy, act, ownPost, requestKinds, onToggleRequestKind, C }) {
  const [requestAction, setRequestAction] = useState(null);
  const area = data.profile?.home_area || 'Nearby';
  const visiblePosts = data.posts.filter((request) => requestKinds.includes(request.kind));
  const openRequestModal = () => {
    const allKinds = Object.keys(MATCH_REQUEST_TYPES);
    const defaultKind = requestKinds.find((k) => allKinds.includes(k)) || allKinds[0];
    setRequestAction({ ...defaultRequestAction(area), kind: defaultKind, ...MATCH_REQUEST_TYPES[defaultKind] });
  };
  const changeRequestKind = (kind) => setRequestAction((current) => current?.type === 'publish' ? { ...current, kind, ...MATCH_REQUEST_TYPES[kind] } : current);
  const hasOpenPost = data.posts.some((request) => ownPost(request) && request.status === 'open');
  const confirmRequestAction = async () => {
    if (!requestAction) return;
    let schedule;
    if (requestAction.type === 'publish') {
      try {
        schedule = parseRequestSchedule(requestAction);
      } catch (reason) {
        setRequestAction((current) => ({ ...current, error: reason.message }));
        return;
      }
    }
    const succeeded = requestAction.type === 'publish'
      ? await act(() => publishMatchRequest({ kind: requestAction.kind, format: requestAction.format, ...schedule, note: requestAction.note }))
      : requestAction.type === 'clear'
        ? await act(() => closeOpenMatchRequests())
        : await act(() => closeMatchRequest(requestAction.requestId));
    if (succeeded) setRequestAction(null);
  };
  return <>
    <Section eyebrow="PARTNER · OPPONENT · SUBSTITUTE" title="Find players" C={C} />
    <Pressable accessibilityRole="button" disabled={busy} onPress={openRequestModal} style={({ pressed }) => [s.requestCreate, { backgroundColor: C.optic }, busy && s.disabled, pressed && s.pressed]}><View style={[s.requestCreateIcon, { backgroundColor: 'rgba(255,255,255,.5)' }]}><Icon name="add" size={21} color="#0E2321" /></View><View style={s.flex}><Text style={s.requestCreateTitle}>Create a play request</Text><Text style={s.requestCreateMeta}>Choose who you need, when you can play, and your area.</Text></View><Icon name="arrow-forward" size={19} color="#0E2321" /></Pressable>
    {hasOpenPost ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => setRequestAction({ type: 'clear' })} style={({ pressed }) => [s.requestClear, { borderColor: C.line }, busy && s.disabled, pressed && s.pressed]}><Icon name="trash-outline" size={15} color={C.brick} /><Text style={[s.requestClearText, { color: C.brick }]}>Clear my open requests</Text></Pressable> : null}
    <View style={[s.requestControls, { backgroundColor: C.surface, borderColor: C.line }]}>
      <View style={s.requestControlsHead}><View style={[s.requestControlsIcon, { backgroundColor: C.tealWash }]}><Icon name="options-outline" size={19} color={C.teal} /></View><View style={s.flex}><Text style={[s.requestControlsTitle, { color: C.ink }]}>Choose what you want to see</Text><Text style={[s.requestControlsMeta, { color: C.ink40 }]}>Turn each request type on or off independently.</Text></View><View style={[s.requestOnPill, { backgroundColor: C.tealWash }]}><Text style={[s.requestOnText, { color: C.teal }]}>{requestKinds.length}/3 ON</Text></View></View>
      <View accessibilityRole="group" accessibilityLabel="Request filters" style={s.requestToggleList}>{Object.entries(MATCH_REQUEST_TYPES).map(([kind, config], index) => { const active = requestKinds.includes(kind); const count = data.posts.filter((request) => request.kind === kind).length; return <View key={kind} style={[s.requestToggleRow, index > 0 && { borderTopWidth: 1, borderColor: C.line }]}><View style={[s.requestToggleIcon, { backgroundColor: active ? C.optic : C.paper }]}><Icon name={config.icon} size={18} color={active ? '#0E2321' : C.ink40} /></View><View style={s.flex}><Text style={[s.requestToggleTitle, { color: C.ink }]}>{kind}</Text><Text style={[s.requestToggleMeta, { color: C.ink40 }]}>{config.filterLabel} · {count}</Text></View><Switch accessibilityLabel={`Show ${kind} requests`} value={active} onValueChange={() => onToggleRequestKind(kind)} trackColor={{ false: C.line, true: C.teal }} thumbColor={active ? C.optic : C.ink40} ios_backgroundColor={C.line} /></View>; })}</View>
    </View>
    <View style={s.requestResultsHead}><Text style={[s.requestListLabel, { color: C.ink40 }]}>VISIBLE REQUESTS</Text><Text style={[s.requestResultsCount, { color: C.teal }]}>{visiblePosts.length} {visiblePosts.length === 1 ? 'RESULT' : 'RESULTS'}</Text></View>
    {visiblePosts.map((request) => {
      const mine = ownPost(request);
      const matched = request.status === 'matched';
      const counterpart = mine ? request.matched_profile?.display_name : request.profiles?.display_name;
      return <View key={request.id} style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.row}><View style={[s.iconBox, { backgroundColor: mine ? C.optic : C.tealWash }]}><Icon name={matched ? 'checkmark-done' : request.kind === 'substitute' ? 'flash-outline' : 'people-outline'} color={C.teal} /></View><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{mine ? 'Your request' : request.profiles?.display_name || 'Peakle player'} · {request.kind}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{formatDate(request.starts_at)} · {request.area} · {request.format}</Text></View>{matched ? <View style={[s.status, { backgroundColor: C.tealWash }]}><Text style={[s.statusText, { color: C.teal }]}>MATCHED</Text></View> : null}</View>{request.note ? <Text style={[s.note, { color: C.ink70 }]}>{request.note}</Text> : null}{matched ? <Text style={[s.decision, { color: C.teal }]}>Matched with {counterpart || 'a Peakle player'}.</Text> : mine ? <ActionButton title="Close request" icon="close-circle-outline" secondary disabled={busy} onPress={() => setRequestAction({ type: 'close', requestId: request.id, kind: request.kind })} C={C} /> : <ActionButton title="I can play" icon="hand-right-outline" disabled={busy} onPress={() => act(() => claimMatchRequest(request.id), 'You are matched. Both players can now see the match.')} C={C} />}</View>;
    })}
    {!visiblePosts.length ? <Empty icon="options-outline" title={requestKinds.length ? 'No matching requests' : 'All request filters are off'} detail={requestKinds.length ? 'Try another filter or create a new play request.' : 'Turn on Partner, Opponent, or Substitute to show those requests.'} C={C} /> : null}
    <PlayRequestSheet action={requestAction} busy={busy} onClose={() => setRequestAction(null)} onConfirm={confirmRequestAction} onChangeKind={changeRequestKind} onChangeField={(field, value) => setRequestAction((current) => current?.type === 'publish' ? { ...current, [field]: value, error: '' } : current)} C={C} />
  </>;
}

function PlayerHub({ C, navigation, initialTab = 'Ratings', onTabChange }) {
  const [tab, setTab] = useState(initialTab);
  const [findRequestKinds, setFindRequestKinds] = useState(Object.keys(MATCH_REQUEST_TYPES));
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [membershipCheckout, setMembershipCheckout] = useState(null);
  useEffect(() => {
    if (['Ratings', 'Find play', 'Compete', 'Privacy'].includes(initialTab)) setTab(initialTab); // Privacy still supported as deep-link target from Profile Settings
  }, [initialTab]);
  const load = useCallback(async () => { setError(''); try { setData(await loadPlayerPickleballHub()); } catch (e) { setError(e.message); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const act = async (task, success) => { setBusy(true); setError(''); try { await task(); if (success) Alert.alert('Saved', success); await load(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); } };
  const purchaseMembership = async (product, existingMembership) => {
    setBusy(true);
    setError('');
    try {
      const membership = !existingMembership || existingMembership.payment_status === 'failed'
        ? await requestMembership(product.id)
        : existingMembership;
      if (membership.status === 'active' && membership.payment_status === 'paid') {
        await load();
        Alert.alert('Membership active', Number(product.price) === 0 ? `${product.name} is now active.` : `${product.name} is already active.`);
        return;
      }
      if (membership.status !== 'pending' || membership.payment_status !== 'awaiting_payment') {
        throw new Error('This membership cannot be purchased from its current status.');
      }
      setMembershipCheckout({ id: membership.id, product });
      await load();
    } catch (reason) {
      setError(reason.message || 'Could not prepare membership checkout.');
    } finally {
      setBusy(false);
    }
  };
  const finishMembershipCheckout = async (status) => {
    const productName = membershipCheckout?.product?.name || 'Your membership';
    setMembershipCheckout(null);
    await load();
    if (status === 'paid') Alert.alert('Payment confirmed', `${productName} is active and ready to use.`);
    else if (status === 'failed') Alert.alert('Payment failed', 'No membership was activated. You can try paying again.');
  };
  const savePrivacy = async (settings) => {
    await updatePickleballPrivacy(settings);
    setData((current) => ({ ...current, profile: { ...current.profile, profile_visibility: settings.profileVisibility, availability_visibility: settings.availabilityVisibility, matching_enabled: settings.matchingEnabled }, posts: settings.matchingEnabled ? current.posts : current.posts.filter((post) => post.creator_id !== current.userId) }));
  };
  const ratings = Object.fromEntries((data?.ratings || []).map((rating) => [rating.format, rating]));
  const ownPost = (post) => post.creator_id === data?.userId;
  const managedTeams = (data?.teams || []).filter((team) => team.team_members?.some((member) => member.user_id === data.userId && ['creator', 'admin', 'co_admin'].includes(member.role)));
  const challengeOpponent = (data?.teams || []).find((team) => !managedTeams.some((mine) => mine.id === team.id));
  const loadingTitle = tab === 'Compete' ? 'Loading events' : tab === 'Find play' ? 'Finding players' : 'Loading your ratings';
  const loadingDetail = tab === 'Compete' ? 'Getting the latest competitions, programs, and venue offers.' : tab === 'Find play' ? 'Checking current partner, opponent, and substitute requests.' : 'Preparing verified results and performance insights.';
  return <View style={s.playerHubHost}><><View style={s.tabRow}>{['Ratings', 'Find play', 'Compete'].map((item) => <Pill key={item} active={tab === item} onPress={() => { setTab(item); onTabChange?.(item); }} C={C}>{item}</Pill>)}</View>{error ? <View style={[s.error, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" color={C.brick} /><Text style={[s.errorText, { color: C.brick }]}>{error}</Text></View> : null}
    {!data && !error ? <View accessibilityRole="progressbar" accessibilityLabel={loadingTitle} style={[s.playerLoadingCard, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.playerLoadingIcon, { backgroundColor: C.optic }]}><ActivityIndicator color="#0E2321" /></View><View style={s.flex}><Text style={[s.playerLoadingTitle, { color: C.ink }]}>{loadingTitle}</Text><Text style={[s.playerLoadingDetail, { color: C.ink40 }]}>{loadingDetail}</Text></View></View> : null}
    {tab === 'Ratings' && data ? <><View style={s.ratingGrid}><RatingCard label="SINGLES RATING" rating={ratings.singles?.rating} record={ratings.singles} C={C} /><RatingCard label="DOUBLES RATING" rating={ratings.doubles?.rating} record={ratings.doubles} C={C} /></View><View style={[s.info, { backgroundColor: C.panel }]}><Icon name="shield-checkmark" color={C.optic} /><View style={s.flex}><Text style={s.infoTitle}>Results players can trust</Text><Text style={s.infoMeta}>Ranked results count only after every registered player confirms the same score. Disputes freeze the rating update.</Text></View></View><Section eyebrow="ACTION REQUIRED" title="Verify match results" C={C} />{data.pendingResults?.length ? data.pendingResults.map((match) => <VerificationCard key={match.id} match={match} userId={data.userId} onConfirm={(id, yes) => act(() => confirmMatchResult(id, yes, yes ? '' : 'Score or lineup needs review'), yes ? 'Your confirmation was recorded.' : 'The result is frozen for organizer review.')} C={C} />) : <Empty icon="checkmark-circle-outline" title="No results waiting" detail="Completed ranked matches that need your confirmation appear here." C={C} />}<Section eyebrow="VERIFIED MATCH INSIGHTS" title="Your best combinations" C={C} />{data.performance?.length ? data.performance.slice(0, 8).map((item) => <View key={`${item.dimension}-${item.label}`} style={[s.standing, { borderColor: C.line }]}><Text style={[s.insightDimension, { color: C.teal }]}>{item.dimension.toUpperCase()}</Text><Text numberOfLines={1} style={[s.standingName, { color: C.ink }]}>{item.label}</Text><Text style={[s.standingPoints, { color: C.ink }]}>{item.winRate}% · {item.played}</Text></View>) : <Empty icon="analytics-outline" title="Insights build with verified play" detail="See performance by partner, opponent, venue, court, and game format after results are confirmed." C={C} />}</> : null}
    {tab === 'Find play' && data ? <PlayerFind data={data} busy={busy} act={act} ownPost={ownPost} requestKinds={findRequestKinds} onToggleRequestKind={(kind) => setFindRequestKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind])} C={C} /> : null}
    {tab === 'Compete' && data ? <PlayerCompete data={data} navigation={navigation} managedTeams={managedTeams} challengeOpponent={challengeOpponent} busy={busy} onPurchaseMembership={purchaseMembership} act={act} C={C} /> : null}
    {tab === 'Privacy' && data?.profile ? <><Section eyebrow="SIMPLE, PRIVATE, YOUR CHOICE" title="Your privacy" C={C} /><PrivacyControls profile={data.profile} onSave={savePrivacy} C={C} /></> : null}</><MembershipCheckoutModal membershipId={membershipCheckout?.id} product={membershipCheckout?.product} onDone={finishMembershipCheckout} C={C} /></View>;
}

function CompetitionDivisionEditor({ divisions, onChange, activeDraftId, onSelect, C }) {
  const activeDivision = divisions.find((division) => division.draftId === activeDraftId) || divisions[0];
  const activeIndex = Math.max(0, divisions.findIndex((division) => division.draftId === activeDivision?.draftId));
  const updateActive = (patch) => onChange(divisions.map((division) => division.draftId === activeDivision.draftId ? { ...division, ...patch } : division));
  const addDivision = (duplicate = false) => {
    if (divisions.length >= 12) return;
    const next = duplicate ? { ...activeDivision, draftId: createDivisionDraft(divisions.length).draftId } : createDivisionDraft(divisions.length);
    onChange([...divisions, next]);
    onSelect(next.draftId);
  };
  const removeActive = () => {
    if (divisions.length === 1) return;
    const remaining = divisions.filter((division) => division.draftId !== activeDivision.draftId);
    onChange(remaining);
    onSelect(remaining[Math.min(activeIndex, remaining.length - 1)].draftId);
  };
  const applyTemplate = (template) => {
    onChange(template);
    onSelect(template[0].draftId);
  };

  return <>
    <View style={[s.quickSetup, { backgroundColor: C.surface, borderColor: C.line }]}>
      <View style={[s.quickSetupIcon, { backgroundColor: C.tealWash }]}><Icon name="sparkles-outline" color={C.teal} /></View>
      <View style={s.flex}><Text style={[s.quickSetupTitle, { color: C.ink }]}>Quick setup</Text><Text style={[s.quickSetupHelp, { color: C.ink40 }]}>Start simple or create the common six-category tournament instantly.</Text></View>
    </View>
    <View style={s.templateActions}>
      <Pressable accessibilityRole="button" onPress={() => { const simple = [createDivisionDraft()]; applyTemplate(simple); }} style={[s.templateButton, { backgroundColor: C.surface, borderColor: C.line }]}><Icon name="tennisball-outline" size={17} color={C.teal} /><Text style={[s.templateButtonText, { color: C.ink }]}>Single division</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => applyTemplate(createSixDivisionTemplate())} style={[s.templateButton, { backgroundColor: C.optic, borderColor: C.optic }]}><Icon name="grid-outline" size={17} color="#0E2321" /><Text style={[s.templateButtonText, { color: '#0E2321' }]}>Six divisions</Text></Pressable>
    </View>

    <View style={s.divisionSwitcherHead}><View style={s.flex}><Text style={[s.fieldLabel, { color: C.ink40 }]}>EDITING DIVISION</Text><Text style={[s.divisionsHelp, { color: C.ink40 }]}>{activeIndex + 1} of {divisions.length}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Add division" disabled={divisions.length >= 12} onPress={() => addDivision(false)} style={[s.smallAddButton, { backgroundColor: C.optic }, divisions.length >= 12 && s.disabled]}><Icon name="add" size={18} color="#0E2321" /></Pressable></View>
    <NativeScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.divisionTabs}>{divisions.map((division, index) => { const active = division.draftId === activeDivision.draftId; return <Pressable key={division.draftId} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onSelect(division.draftId)} style={[s.divisionTab, { backgroundColor: active ? C.ink : C.surface, borderColor: active ? C.ink : C.line }]}><Text style={[s.divisionTabIndex, { color: active ? C.optic : C.teal }]}>{index + 1}</Text><Text numberOfLines={1} style={[s.divisionTabText, { color: active ? C.surface : C.ink }]}>{competitionDivisionName(division)}</Text></Pressable>; })}</NativeScrollView>

    <View style={[s.divisionEditor, { backgroundColor: C.surface, borderColor: C.line }]}>
      <View style={s.divisionEditorHeader}><View style={s.divisionNumber}><Text style={s.divisionNumberText}>{activeIndex + 1}</Text></View><View style={s.flex}><Text style={[s.divisionName, { color: C.ink }]}>{competitionDivisionName(activeDivision)}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>Changes save in this setup</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${competitionDivisionName(activeDivision)}`} disabled={divisions.length === 1} onPress={removeActive} style={[s.divisionRemove, divisions.length === 1 && s.disabled]}><Icon name="trash-outline" size={17} color={C.brick} /></Pressable></View>

      <Text style={[s.fieldLabel, { color: C.ink40 }]}>WHO CAN JOIN?</Text>
      <View style={s.pillRow}>{COMPETITION_PARTICIPANT_DIVISIONS.map((item) => <Pill key={item} active={activeDivision.participantDivision === item} onPress={() => updateActive({ participantDivision: item })} C={C}>{PARTICIPANT_DIVISION_LABELS[item]}</Pill>)}</View>

      <Text style={[s.fieldLabel, { color: C.ink40 }]}>SKILL LEVEL</Text>
      <View style={s.pillRow}>{COMPETITION_SKILL_CATEGORIES.map((item) => <Pill key={item} active={activeDivision.skillCategory === item} onPress={() => updateActive({ skillCategory: item })} C={C}>{SKILL_CATEGORY_LABELS[item]}</Pill>)}</View>

      <Text style={[s.fieldLabel, { color: C.ink40 }]}>PLAY</Text>
      <View style={s.pillRow}>{COMPETITION_FORMATS.map((item) => <Pill key={item} active={activeDivision.format === item} onPress={() => updateActive({ format: item })} C={C}>{item}</Pill>)}</View>

      <Text style={[s.fieldLabel, { color: C.ink40 }]}>REGISTRATION</Text>
      <View style={s.pillRow}>{COMPETITION_ENTRY_TYPES.map((item) => <Pill key={item} active={activeDivision.entryType === item} onPress={() => updateActive({ entryType: item })} C={C}>{ENTRY_TYPE_LABELS[item]}</Pill>)}</View>

      <View style={s.requestFieldRow}>
        <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>SLOTS</Text><TextInput accessibilityLabel={`${competitionDivisionName(activeDivision)} capacity`} value={activeDivision.capacity} onChangeText={(value) => updateActive({ capacity: value })} keyboardType="number-pad" style={[s.input, { color: C.ink, backgroundColor: C.paper, borderColor: C.line }]} /></View>
        <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>FEE (PHP)</Text><TextInput accessibilityLabel={`${competitionDivisionName(activeDivision)} fee`} value={activeDivision.feeAmount} onChangeText={(value) => updateActive({ feeAmount: value })} keyboardType="decimal-pad" style={[s.input, { color: C.ink, backgroundColor: C.paper, borderColor: C.line }]} /></View>
      </View>
      <Text style={[s.fieldLabel, { color: C.ink40 }]}>CHARGE FEE</Text>
      <View style={s.pillRow}>{['player', 'entry'].map((item) => <Pill key={item} active={activeDivision.feeBasis === item} onPress={() => updateActive({ feeBasis: item })} C={C}>per {item}</Pill>)}</View>
      {activeDivision.participantDivision !== 'open' || activeDivision.skillCategory !== 'open' ? <View style={[s.divisionReviewNote, { backgroundColor: C.tealWash }]}><Icon name="shield-checkmark-outline" size={17} color={C.teal} /><Text style={[s.divisionReviewText, { color: C.ink70 }]}>Peakle holds restricted registrations for your private approval.</Text></View> : null}
    </View>
    <Pressable accessibilityRole="button" disabled={divisions.length >= 12} onPress={() => addDivision(true)} style={[s.duplicateButton, { borderColor: C.line }, divisions.length >= 12 && s.disabled]}><Icon name="copy-outline" size={16} color={C.teal} /><Text style={[s.duplicateButtonText, { color: C.teal }]}>Duplicate this setup</Text></Pressable>
  </>;
}

const venueCourtImage = (venue) => venue?.courts?.find((court) => court.active !== false && court.image_url)?.image_url
  || venue?.courts?.find((court) => court.image_url)?.image_url
  || venue?.brand_image_url
  || null;

function CourtVenuePreview({ venue, C, style }) {
  const image = venueCourtImage(venue);
  return <ResilientImage
    uri={image}
    transition={260}
    accessibilityLabel={image ? `${venue?.name || 'Venue'} court photo` : `${venue?.name || 'Venue'} court preview`}
    fallbackColor={C.teal}
    style={[s.courtVenuePreview, style]}
    fallback={<View style={[s.courtFallback, { backgroundColor: C.teal }]}>
      <View style={s.courtBoundary}>
        <View style={s.courtServiceCenterLeft} />
        <View style={s.courtServiceCenterRight} />
        <View style={[s.courtKitchenLine, s.courtKitchenLineLeft]} />
        <View style={[s.courtKitchenLine, s.courtKitchenLineRight]} />
        <View style={s.courtNetVertical} />
      </View>
    </View>}
  />;
}

function OrganizerVenuePickerModal({ visible, venues, selectedVenueId, onClose, onSelect, C }) {
  const insets = useSafeAreaInsets();
  const selectVenue = (venueId) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onSelect(venueId);
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <Pressable accessibilityRole="button" accessibilityLabel="Close venue picker" onPress={onClose} style={s.modalBackdrop}>
      <Pressable onPress={(event) => event.stopPropagation()} style={[s.venuePickerSheet, { backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 18) }]}>
        <View style={[s.handle, { backgroundColor: C.line }]} />
        <View style={s.row}><View style={s.flex}><Text style={[s.eyebrow, { color: C.teal }]}>PUBLISHING FOR</Text><Text style={[s.sheetTitle, { color: C.ink }]}>Choose a venue</Text><Text style={[s.sheetSubtitle, { color: C.ink40 }]}>This activity and its registrations will belong to the venue you select.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close venue picker" onPress={onClose} style={[s.sheetClose, { backgroundColor: C.surface }]}><Icon name="close" color={C.ink} /></Pressable></View>
        <NativeScrollView style={s.venuePickerList} contentContainerStyle={s.venuePickerListContent} showsVerticalScrollIndicator={false}>{venues.map((item) => {
          const active = item.id === selectedVenueId;
          const courtCount = item.courts?.filter((court) => court.active !== false).length || item.courts?.length || 0;
          return <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => selectVenue(item.id)} style={[s.venuePickerOption, { backgroundColor: active ? C.tealWash : C.surface, borderColor: active ? C.teal : C.line }]}>
            <CourtVenuePreview venue={item} C={C} style={s.venuePickerCourtPreview} />
            <View style={s.flex}><Text numberOfLines={1} style={[s.venuePickerOptionName, { color: C.ink }]}>{item.name}</Text><Text numberOfLines={1} style={[s.venuePickerOptionMeta, { color: C.ink40 }]}>{item.area || item.address || 'Managed venue'}</Text><Text style={[s.venuePickerCourtCount, { color: C.teal }]}>{courtCount} {courtCount === 1 ? 'court' : 'courts'}</Text></View>
            <View style={[s.venuePickerSelection, { backgroundColor: active ? C.optic : C.paper }]}><Icon name={active ? 'checkmark' : 'chevron-forward'} size={17} color={active ? '#0E2321' : C.ink40} /></View>
          </Pressable>;
        })}</NativeScrollView>
      </Pressable>
    </Pressable>
  </Modal>;
}

function CreateSheet({ type, venue, venues = [], onSelectVenue, onClose, onCreate, C, embedded = false, busy = false, externalError = '' }) {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const presentWizard = (wizard) => embedded
    ? <SafeAreaView style={[s.fullScreenWizardSafe, { backgroundColor: C.paper }]}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />{wizard}</SafeAreaView>
    : <Modal visible transparent animationType="slide" onRequestClose={() => !busy && onClose()}><View style={s.modalBackdrop}>{wizard}</View></Modal>;
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const venuePicker = embedded && venue
    ? <View style={s.createVenueSection}><Text style={[s.fieldLabel, s.createVenueLabel, { color: C.ink40 }]}>PUBLISHING FOR</Text><Pressable accessibilityRole="button" accessibilityLabel={`Publishing for ${venue.name}${venues.length > 1 ? ', change venue' : ''}`} disabled={venues.length < 2} onPress={() => setVenuePickerOpen(true)} style={[s.createVenueField, { backgroundColor: C.surface, borderColor: C.line }]}>
      <CourtVenuePreview venue={venue} C={C} style={s.createVenueCourtPreview} />
      <View style={s.flex}><Text numberOfLines={1} style={[s.createVenueName, { color: C.ink }]}>{venue.name}</Text><Text numberOfLines={1} style={[s.createVenueMeta, { color: C.ink40 }]}>{venue.area || `${venue.courts?.filter((court) => court.active !== false).length || venue.courts?.length || 0} courts`}</Text></View>
      <View style={[s.createVenueChange, { backgroundColor: venues.length > 1 ? C.tealWash : C.paper }]}><Icon name={venues.length > 1 ? 'swap-horizontal' : 'checkmark'} size={17} color={C.teal} /></View>
    </Pressable></View>
    : null;
  const defaults = type === 'program'
    ? { name: 'Weekly Skills Clinic', kind: 'clinic', price: '650', capacity: '16' }
    : type === 'competition'
      ? { name: 'Venue Pickleball Tournament', kind: 'tournament', price: '0', capacity: '16' }
      : { name: '10-Session Court Pack', kind: 'court_package', price: '4500', capacity: '10' };
  const [name, setName] = useState(defaults.name);
  const [kind, setKind] = useState(defaults.kind);
  const [price, setPrice] = useState(defaults.price);
  const [capacity, setCapacity] = useState(defaults.capacity);
  const [weekly, setWeekly] = useState(true);
  const [skillDivision, setSkillDivision] = useState('all');
  const [divisions, setDivisions] = useState([createDivisionDraft()]);
  const [activeDivisionId, setActiveDivisionId] = useState(null);
  const [competitionStep, setCompetitionStep] = useState(0);
  const [setupStep, setSetupStep] = useState(0);
  const [coverImage, setCoverImage] = useState('');
  const [date, setDate] = useState(inDays(type === 'competition' ? 7 : 1));
  const [endDate, setEndDate] = useState(inDays(type === 'competition' ? 60 : 1));
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('20:00');
  const [description, setDescription] = useState('');
  const [credits, setCredits] = useState('10');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [validityDays, setValidityDays] = useState('90');
  const [terms, setTerms] = useState('');
  const [formError, setFormError] = useState('');
  const [datePickerField, setDatePickerField] = useState(null);
  const choices = type === 'program'
    ? ['clinic', 'coaching', 'open_play', 'camp']
    : type === 'competition'
      ? ['league', 'ladder', 'season', 'tournament']
      : ['membership', 'court_package', 'session_package', 'credit_pack'];
  const datePickerValue = datePickerField === 'competitionEnd' ? endDate : date;
  const datePicker = <AppDatePickerModal
    visible={Boolean(datePickerField)}
    value={datePickerValue}
    eyebrow={datePickerField === 'competitionEnd' ? 'COMPETITION END' : datePickerField === 'competitionStart' ? 'COMPETITION START' : 'PROGRAM DATE'}
    title={datePickerField === 'competitionEnd' ? 'Choose the end date' : datePickerField === 'competitionStart' ? 'Choose the start date' : 'Choose the program date'}
    minimumDate={datePickerField === 'competitionEnd' ? date : inDays(0)}
    onClose={() => setDatePickerField(null)}
    onSelect={(value) => {
      if (datePickerField === 'competitionEnd') setEndDate(value);
      else {
        setDate(value);
        if (datePickerField === 'competitionStart' && endDate < value) setEndDate(value);
      }
      setDatePickerField(null);
    }}
    colors={C}
  />;
  const venuePickerModal = <OrganizerVenuePickerModal visible={venuePickerOpen} venues={venues} selectedVenueId={venue?.id} onClose={() => setVenuePickerOpen(false)} onSelect={(selectedId) => { onSelectVenue?.(selectedId); setVenuePickerOpen(false); }} C={C} />;

  const validateCompetitionBasics = () => {
    if (name.trim().length < 3) throw new Error('Name must be at least 3 characters.');
    const startsOn = localDateTimeIso(date, '00:00', 'Competition start');
    const endsOn = localDateTimeIso(endDate, '23:59', 'Competition end');
    if (startsOn < new Date(new Date().setHours(0, 0, 0, 0))) throw new Error('Competition start cannot be in the past.');
    if (endsOn < startsOn) throw new Error('Competition end must be on or after its start.');
  };
  const normalizeCompetitionDivisions = () => {
    const normalized = divisions.map((division) => {
      const numericCapacity = Number(division.capacity);
      const numericFee = Number(division.feeAmount);
      if (!Number.isInteger(numericCapacity) || numericCapacity < 2 || numericCapacity > 200) throw new Error(`${competitionDivisionName(division)} slots must be from 2 to 200.`);
      if (!Number.isFinite(numericFee) || numericFee < 0) throw new Error(`${competitionDivisionName(division)} fee must be zero or greater.`);
      return { name: competitionDivisionName(division), participantDivision: division.participantDivision, skillCategory: division.skillCategory, format: division.format, entryType: division.entryType, capacity: numericCapacity, feeAmount: numericFee, feeBasis: division.feeBasis };
    });
    if (new Set(normalized.map((division) => division.name)).size !== normalized.length) throw new Error('Two divisions have the same setup. Change or remove one before continuing.');
    if (normalized.reduce((total, division) => total + division.capacity, 0) > 512) throw new Error('Combined division slots cannot exceed 512.');
    return normalized;
  };
  const continueCompetition = () => {
    setFormError('');
    try {
      if (competitionStep === 0) validateCompetitionBasics();
      if (competitionStep === 1) normalizeCompetitionDivisions();
      setCompetitionStep((current) => Math.min(2, current + 1));
    } catch (error) {
      setFormError(error.message);
    }
  };
  const validateProgramSetup = () => {
    const numericPrice = Number(price);
    const numericCapacity = Number(capacity);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) throw new Error('Price must be zero or a positive number.');
    if (!Number.isInteger(numericCapacity) || numericCapacity < 1 || numericCapacity > 200) throw new Error('Capacity must be a whole number from 1 to 200.');
    const startsAt = localDateTimeIso(date, startTime, 'Program start');
    const endsAt = localDateTimeIso(date, endTime, 'Program end');
    if (startsAt <= new Date()) throw new Error('Program start must be in the future.');
    if (endsAt <= startsAt) throw new Error('Program end must be later than its start.');
    return { price: numericPrice, capacity: numericCapacity, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  };
  const validateMembershipSetup = () => {
    const numericPrice = Number(price);
    const numericCredits = Number(credits);
    const numericDiscount = Number(discountPercent);
    const numericValidity = Number(validityDays);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) throw new Error('Price must be zero or a positive number.');
    if (!Number.isInteger(numericCredits) || numericCredits < 0 || numericCredits > 10000) throw new Error('Included credits must be a whole number from 0 to 10,000.');
    if (!Number.isFinite(numericDiscount) || numericDiscount < 0 || numericDiscount > 100) throw new Error('Discount must be from 0% to 100%.');
    if (!Number.isInteger(numericValidity) || numericValidity < 1 || numericValidity > 730) throw new Error('Validity must be from 1 to 730 days.');
    if (kind !== 'membership' && numericCredits < 1) throw new Error('Packages must include at least one credit or session.');
    return { price: numericPrice, credits: numericCredits, discountPercent: numericDiscount, validityDays: numericValidity };
  };
  const continueSetup = () => {
    setFormError('');
    try {
      if (name.trim().length < 3) throw new Error('Name must be at least 3 characters.');
      if (setupStep === 1) {
        if (type === 'program') validateProgramSetup();
        else validateMembershipSetup();
      }
      setSetupStep((current) => Math.min(2, current + 1));
    } catch (error) {
      setFormError(error.message);
    }
  };
  const chooseMembershipKind = (nextKind) => {
    setKind(nextKind);
    if (nextKind === 'membership') {
      setCredits('0');
      setDiscountPercent('10');
    } else {
      setCredits(nextKind === 'credit_pack' ? '100' : '10');
      setDiscountPercent('0');
    }
  };

  const submit = () => {
    setFormError('');
    try {
      if (name.trim().length < 3) throw new Error('Name must be at least 3 characters.');
      if (type === 'program') {
        const setup = validateProgramSetup();
        onCreate({ name: name.trim(), kind, weekly, skillDivision, description: description.trim(), ...setup });
        return;
      }
      if (type === 'competition') {
        validateCompetitionBasics();
        const normalizedDivisions = normalizeCompetitionDivisions();
        onCreate({ name: name.trim(), kind, divisions: normalizedDivisions, startsOn: date, endsOn: endDate, coverImage });
        return;
      }
      const setup = validateMembershipSetup();
      onCreate({ name: name.trim(), kind, terms: terms.trim(), ...setup });
    } catch (error) {
      setFormError(error.message);
    }
  };

  if (type === 'competition') {
    const stepTitles = ['Event details', 'Build divisions', 'Review & publish'];
    const totalSlots = divisions.reduce((total, division) => total + (Number(division.capacity) || 0), 0);
    const wizard = <View style={[embedded ? s.fullScreenWizard : s.sheet, { backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 14) }]}>
          {!embedded ? <View style={[s.handle, { backgroundColor: C.line }]} /> : null}
          <View style={s.row}><View style={s.flex}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.88} style={[s.eyebrow, s.wizardEyebrow, { color: C.teal }]}>STEP {competitionStep + 1} OF 3 · CREATE COMPETITION</Text><Text style={[s.sheetTitle, { color: C.ink }]}>{stepTitles[competitionStep]}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close competition setup" disabled={busy} onPress={onClose} style={s.sheetClose}><Icon name="close" size={22} color={C.ink40} /></Pressable></View>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 3, now: competitionStep + 1 }} style={s.wizardProgress}>{stepTitles.map((stepTitle, index) => <View key={stepTitle} style={[s.wizardProgressSegment, { backgroundColor: index <= competitionStep ? C.teal : C.line }]} />)}</View>
          {competitionStep === 0 ? venuePicker : null}

          <NativeScrollView key={`competition-step-${competitionStep}`} style={[s.createSheetScroll, embedded && s.fullScreenWizardScroll]} contentContainerStyle={s.wizardContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {competitionStep === 0 ? <>
              <Text style={[s.wizardIntro, { color: C.ink70 }]}>Start with the event. You’ll add categories on the next screen.</Text>
              <Text style={[s.fieldLabel, { color: C.ink40 }]}>COMPETITION NAME</Text>
              <TextInput accessibilityLabel="Competition name" value={name} onChangeText={setName} maxLength={100} placeholder="e.g. Personal Collection Tournament" placeholderTextColor={C.ink40} style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
              <Text style={[s.fieldLabel, { color: C.ink40 }]}>COMPETITION TYPE</Text>
              <NativeScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillRow}>{choices.map((item) => <Pill key={item} active={kind === item} onPress={() => setKind(item)} C={C}>{item.replace('_', ' ')}</Pill>)}</NativeScrollView>
              <View style={s.requestFieldRow}>
                <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>START DATE</Text><AppDatePickerField accessibilityLabel="Choose competition start date" value={date} onPress={() => setDatePickerField('competitionStart')} colors={C} /></View>
                <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>END DATE</Text><AppDatePickerField accessibilityLabel="Choose competition end date" value={endDate} onPress={() => setDatePickerField('competitionEnd')} colors={C} /></View>
              </View>
              <Text style={[s.fieldLabel, { color: C.ink40 }]}>COVER PHOTO · OPTIONAL</Text>
              <OrganizerImagePicker value={coverImage} onChange={setCoverImage} onError={setFormError} title="Competition cover photo" detail="Add a poster or event photo." emptyIcon="trophy-outline" colors={C} />
            </> : null}

            {competitionStep === 1 ? <>
              <Text style={[s.wizardIntro, { color: C.ink70 }]}>Use a quick setup, then edit one division at a time. You can review everything before publishing.</Text>
              <CompetitionDivisionEditor divisions={divisions} onChange={setDivisions} activeDraftId={activeDivisionId} onSelect={setActiveDivisionId} C={C} />
            </> : null}

            {competitionStep === 2 ? <>
              <View style={[s.reviewEventCard, { backgroundColor: C.panel }]}><View style={[s.reviewEventIcon, { backgroundColor: C.optic }]}><Icon name="trophy-outline" color="#0E2321" /></View><View style={s.flex}><Text style={s.reviewEventEyebrow}>{kind.toUpperCase()}</Text><Text style={s.reviewEventTitle}>{name.trim()}</Text><Text style={s.reviewEventMeta}>{formatDate(date, false)} – {formatDate(endDate, false)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Edit event details" onPress={() => { setFormError(''); setCompetitionStep(0); }} style={s.reviewEdit}><Icon name="pencil-outline" size={17} color={C.optic} /></Pressable></View>
              <View style={s.reviewSummaryRow}><View><Text style={[s.reviewSummaryValue, { color: C.ink }]}>{divisions.length}</Text><Text style={[s.reviewSummaryLabel, { color: C.ink40 }]}>{divisions.length === 1 ? 'DIVISION' : 'DIVISIONS'}</Text></View><View style={[s.reviewSummaryDivider, { backgroundColor: C.line }]} /><View><Text style={[s.reviewSummaryValue, { color: C.ink }]}>{totalSlots}</Text><Text style={[s.reviewSummaryLabel, { color: C.ink40 }]}>TOTAL SLOTS</Text></View></View>
              <View style={s.reviewHeading}><View style={s.flex}><Text style={[s.fieldLabel, { color: C.ink40 }]}>DIVISION SUMMARY</Text><Text style={[s.divisionsHelp, { color: C.ink40 }]}>Each gets separate registration, standings, and bracket.</Text></View><Pressable accessibilityRole="button" onPress={() => { setFormError(''); setCompetitionStep(1); }} style={[s.reviewEditDivisions, { borderColor: C.line }]}><Icon name="pencil-outline" size={15} color={C.teal} /><Text style={[s.reviewEditText, { color: C.teal }]}>Edit</Text></Pressable></View>
              <View style={s.reviewDivisionList}>{divisions.map((division, index) => <Pressable key={division.draftId} accessibilityRole="button" accessibilityLabel={`Edit ${competitionDivisionName(division)}`} onPress={() => { setActiveDivisionId(division.draftId); setFormError(''); setCompetitionStep(1); }} style={[s.reviewDivisionRow, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.reviewDivisionIndex, { backgroundColor: C.tealWash }]}><Text style={[s.reviewDivisionIndexText, { color: C.teal }]}>{index + 1}</Text></View><View style={s.flex}><Text style={[s.divisionName, { color: C.ink }]}>{competitionDivisionName(division)}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{division.format} · {ENTRY_TYPE_LABELS[division.entryType]} · {division.capacity} slots · {Number(division.feeAmount) ? `${money(division.feeAmount)} / ${division.feeBasis}` : 'Free'}</Text></View><Icon name="chevron-forward" size={17} color={C.ink40} /></Pressable>)}</View>
              <View style={[s.publishNotice, { backgroundColor: C.tealWash }]}><Icon name="shield-checkmark-outline" size={19} color={C.teal} /><View style={s.flex}><Text style={[s.publishNoticeTitle, { color: C.ink }]}>Ready for registration</Text><Text style={[s.publishNoticeText, { color: C.ink70 }]}>Restricted categories remain private and require your approval before bracket seeding.</Text></View></View>
            </> : null}
          </NativeScrollView>

          {formError || externalError ? <View style={[s.requestFormError, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" size={18} color={C.brick} /><Text style={[s.requestFormErrorText, { color: C.brick }]}>{formError || externalError}</Text></View> : null}
          <View style={s.wizardActions}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={competitionStep === 0 ? onClose : () => { setFormError(''); setCompetitionStep((current) => current - 1); }} style={[s.wizardBack, { backgroundColor: C.surface, borderColor: C.line }, busy && s.disabled]}><Icon name={competitionStep === 0 ? 'close' : 'arrow-back'} size={17} color={C.ink70} /><Text style={[s.wizardBackText, { color: C.ink70 }]}>{competitionStep === 0 ? 'Cancel' : 'Back'}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={competitionStep === 2 ? submit : continueCompetition} style={[s.wizardNext, { backgroundColor: C.optic }, busy && s.disabled]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={s.wizardNextText}>{competitionStep === 2 ? 'Publish competition' : 'Continue'}</Text><Icon name={competitionStep === 2 ? 'checkmark' : 'arrow-forward'} size={18} color="#0E2321" /></>}</Pressable>
          </View>
        </View>;
    return <>{presentWizard(wizard)}{datePicker}{venuePickerModal}</>;
  }

  const isProgram = type === 'program';
  const stepTitles = isProgram
    ? ['Program basics', 'Schedule & pricing', 'Review & publish']
    : ['Offer basics', 'Benefits & pricing', 'Review & publish'];
  const selectedKindLabel = kind.replaceAll('_', ' ');
  const membershipBenefit = kind === 'membership'
    ? `${discountPercent || 0}% venue discount`
    : `${credits || 0} ${kind === 'court_package' ? 'court credits' : kind === 'session_package' ? 'sessions' : 'credits'}`;

  const wizard = <View style={[embedded ? s.fullScreenWizard : s.sheet, { backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 14) }]}>
        {!embedded ? <View style={[s.handle, { backgroundColor: C.line }]} /> : null}
        <View style={s.row}><View style={s.flex}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.88} style={[s.eyebrow, s.wizardEyebrow, { color: C.teal }]}>STEP {setupStep + 1} OF 3 · CREATE {isProgram ? 'PROGRAM' : 'MEMBERSHIP'}</Text><Text style={[s.sheetTitle, { color: C.ink }]}>{stepTitles[setupStep]}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Close ${isProgram ? 'program' : 'membership'} setup`} disabled={busy} onPress={onClose} style={s.sheetClose}><Icon name="close" size={22} color={C.ink40} /></Pressable></View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 3, now: setupStep + 1 }} style={s.wizardProgress}>{stepTitles.map((stepTitle, index) => <View key={stepTitle} style={[s.wizardProgressSegment, { backgroundColor: index <= setupStep ? C.teal : C.line }]} />)}</View>
        {setupStep === 0 ? venuePicker : null}

        <NativeScrollView key={`${type}-step-${setupStep}`} style={[s.createSheetScroll, embedded && s.fullScreenWizardScroll]} contentContainerStyle={s.wizardContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {setupStep === 0 ? <>
            <Text style={[s.wizardIntro, { color: C.ink70 }]}>{isProgram ? 'Tell players what they can join. Timing and price come next.' : 'Choose what you want to offer. Peakle will suggest the right benefits.'}</Text>
            <Text style={[s.fieldLabel, { color: C.ink40 }]}>{isProgram ? 'PROGRAM NAME' : 'OFFER NAME'}</Text>
            <TextInput accessibilityLabel={isProgram ? 'Program name' : 'Membership or package name'} value={name} onChangeText={setName} maxLength={100} placeholder={isProgram ? 'e.g. Saturday Beginner Clinic' : 'e.g. 10-Session Court Pack'} placeholderTextColor={C.ink40} style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
            <Text style={[s.fieldLabel, { color: C.ink40 }]}>{isProgram ? 'PROGRAM TYPE' : 'OFFER TYPE'}</Text>
            <View style={s.setupChoiceList}>{choices.map((item) => {
              const active = kind === item;
              const details = isProgram
                ? { clinic: 'Group instruction with a clear skill focus.', coaching: 'Coach-led training for individual improvement.', open_play: 'A hosted recurring play session.', camp: 'A longer multi-skill training experience.' }[item]
                : { membership: 'Ongoing venue access with a member discount.', court_package: 'Prepaid court credits players can use later.', session_package: 'A bundle of program or play sessions.', credit_pack: 'Flexible Peakle credits with an expiry date.' }[item];
              return <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => isProgram ? setKind(item) : chooseMembershipKind(item)} style={[s.setupChoice, { backgroundColor: active ? C.tealWash : C.surface, borderColor: active ? C.teal : C.line }]}><View style={[s.setupChoiceIcon, { backgroundColor: active ? C.optic : C.paper }]}><Icon name={isProgram ? (item === 'coaching' ? 'person-outline' : item === 'camp' ? 'bonfire-outline' : item === 'open_play' ? 'tennisball-outline' : 'school-outline') : (item === 'membership' ? 'ribbon-outline' : item === 'credit_pack' ? 'wallet-outline' : 'card-outline')} size={19} color={active ? '#0E2321' : C.teal} /></View><View style={s.flex}><Text style={[s.setupChoiceTitle, { color: C.ink }]}>{item.replaceAll('_', ' ')}</Text><Text style={[s.setupChoiceMeta, { color: C.ink40 }]}>{details}</Text></View><Icon name={active ? 'checkmark-circle' : 'chevron-forward'} color={active ? C.teal : C.ink40} /></Pressable>;
            })}</View>
            {isProgram ? <>
              <Text style={[s.fieldLabel, { color: C.ink40 }]}>WHO IS IT FOR?</Text>
              <View style={s.pillRow}>{['beginner', 'intermediate', 'advanced', 'all'].map((item) => <Pill key={item} active={skillDivision === item} onPress={() => setSkillDivision(item)} C={C}>{item === 'all' ? 'All levels' : item}</Pill>)}</View>
              <Text style={[s.fieldLabel, { color: C.ink40 }]}>SHORT DESCRIPTION · OPTIONAL</Text>
              <TextInput accessibilityLabel="Program description" value={description} onChangeText={setDescription} maxLength={300} multiline placeholder="What will players learn or experience?" placeholderTextColor={C.ink40} style={[s.input, s.multilineInput, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
            </> : null}
          </> : null}

          {setupStep === 1 && isProgram ? <>
            <Text style={[s.wizardIntro, { color: C.ink70 }]}>Set one clear schedule. Players will see the exact time, capacity, and price before registering.</Text>
            <Text style={[s.fieldLabel, { color: C.ink40 }]}>DATE</Text>
            <AppDatePickerField accessibilityLabel="Choose program date" value={date} onPress={() => setDatePickerField('program')} colors={C} />
            <View style={s.requestFieldRow}>
              <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>START TIME</Text><TextInput accessibilityLabel="Program start time" value={startTime} onChangeText={setStartTime} autoCapitalize="none" maxLength={5} placeholder="18:00" placeholderTextColor={C.ink40} style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View>
              <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>END TIME</Text><TextInput accessibilityLabel="Program end time" value={endTime} onChangeText={setEndTime} autoCapitalize="none" maxLength={5} placeholder="20:00" placeholderTextColor={C.ink40} style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View>
            </View>
            <Text style={[s.requestTimeHelp, { color: C.ink40 }]}>Times use 24-hour format, for example 18:00 for 6 PM.</Text>
            <View style={s.requestFieldRow}>
              <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>PLAYER LIMIT</Text><TextInput accessibilityLabel="Program player limit" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View>
              <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>PRICE (PHP)</Text><TextInput accessibilityLabel="Program price in Philippine pesos" value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View>
            </View>
            <View style={[s.settingRow, s.settingCard, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.setupChoiceIcon, { backgroundColor: C.tealWash }]}><Icon name="repeat-outline" color={C.teal} /></View><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>Repeat every week</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>Use this schedule as a recurring program.</Text></View><Switch accessibilityLabel="Repeat every week" value={weekly} onValueChange={setWeekly} trackColor={{ false: C.line, true: C.teal }} /></View>
          </> : null}

          {setupStep === 1 && !isProgram ? <>
            <Text style={[s.wizardIntro, { color: C.ink70 }]}>Keep the offer simple: one price, one clear benefit, and an expiry players can understand.</Text>
            <View style={s.requestFieldRow}>
              <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>PRICE (PHP)</Text><TextInput accessibilityLabel="Offer price in Philippine pesos" value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View>
              <View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>VALID FOR DAYS</Text><TextInput accessibilityLabel="Offer validity in days" value={validityDays} onChangeText={setValidityDays} keyboardType="number-pad" style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View>
            </View>
            {kind === 'membership' ? <>
              <Text style={[s.fieldLabel, { color: C.ink40 }]}>MEMBER DISCOUNT (%)</Text>
              <TextInput accessibilityLabel="Member discount percent" value={discountPercent} onChangeText={setDiscountPercent} keyboardType="decimal-pad" style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
              <View style={[s.publishNotice, { backgroundColor: C.tealWash }]}><Icon name="sparkles-outline" size={19} color={C.teal} /><View style={s.flex}><Text style={[s.publishNoticeTitle, { color: C.ink }]}>Easy member benefit</Text><Text style={[s.publishNoticeText, { color: C.ink70 }]}>Players receive this discount while their membership is active.</Text></View></View>
            </> : <>
              <Text style={[s.fieldLabel, { color: C.ink40 }]}>{kind === 'session_package' ? 'INCLUDED SESSIONS' : kind === 'court_package' ? 'INCLUDED COURT CREDITS' : 'INCLUDED CREDITS'}</Text>
              <TextInput accessibilityLabel="Included credits or sessions" value={credits} onChangeText={setCredits} keyboardType="number-pad" style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
            </>}
            <Text style={[s.fieldLabel, { color: C.ink40 }]}>TERMS · OPTIONAL</Text>
            <TextInput accessibilityLabel="Membership or package terms" value={terms} onChangeText={setTerms} maxLength={500} multiline placeholder="Example: Non-transferable. Booking rules still apply." placeholderTextColor={C.ink40} style={[s.input, s.multilineInput, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
          </> : null}

          {setupStep === 2 ? <>
            <View style={[s.reviewEventCard, { backgroundColor: C.panel }]}><View style={[s.reviewEventIcon, { backgroundColor: C.optic }]}><Icon name={isProgram ? 'school-outline' : 'card-outline'} color="#0E2321" /></View><View style={s.flex}><Text style={s.reviewEventEyebrow}>{selectedKindLabel.toUpperCase()}</Text><Text style={s.reviewEventTitle}>{name.trim()}</Text><Text style={s.reviewEventMeta}>{isProgram ? `${skillDivision === 'all' ? 'All levels' : skillDivision} · ${formatDate(date, false)}` : `${membershipBenefit} · ${validityDays} days`}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Edit basic details" onPress={() => { setFormError(''); setSetupStep(0); }} style={s.reviewEdit}><Icon name="pencil-outline" size={17} color={C.optic} /></Pressable></View>
            <View style={s.reviewSummaryRow}><View><Text style={[s.reviewSummaryValue, { color: C.ink }]}>{isProgram ? capacity : validityDays}</Text><Text style={[s.reviewSummaryLabel, { color: C.ink40 }]}>{isProgram ? 'PLAYER LIMIT' : 'VALID DAYS'}</Text></View><View style={[s.reviewSummaryDivider, { backgroundColor: C.line }]} /><View><Text style={[s.reviewSummaryValue, { color: C.ink }]}>{money(price)}</Text><Text style={[s.reviewSummaryLabel, { color: C.ink40 }]}>PRICE</Text></View></View>
            <View style={s.reviewHeading}><View style={s.flex}><Text style={[s.fieldLabel, { color: C.ink40 }]}>SETUP SUMMARY</Text><Text style={[s.divisionsHelp, { color: C.ink40 }]}>Check what players will see before publishing.</Text></View><Pressable accessibilityRole="button" onPress={() => { setFormError(''); setSetupStep(1); }} style={[s.reviewEditDivisions, { borderColor: C.line }]}><Icon name="pencil-outline" size={15} color={C.teal} /><Text style={[s.reviewEditText, { color: C.teal }]}>Edit</Text></Pressable></View>
            <View style={s.reviewDetailList}>
              {(isProgram
                ? [
                  ['calendar-outline', 'Schedule', `${formatDate(date, false)} · ${startTime}–${endTime}`],
                  ['people-outline', 'Players', `${capacity} maximum · ${skillDivision === 'all' ? 'All levels' : skillDivision}`],
                  ['repeat-outline', 'Frequency', weekly ? 'Repeats weekly' : 'One-time program'],
                ]
                : [
                  ['gift-outline', 'Player benefit', membershipBenefit],
                  ['calendar-outline', 'Validity', `${validityDays} days after activation`],
                  ['document-text-outline', 'Terms', terms.trim() || 'No additional terms'],
                ]).map(([icon, label, value]) => <View key={label} style={[s.reviewDetailRow, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.reviewDetailIcon, { backgroundColor: C.tealWash }]}><Icon name={icon} size={18} color={C.teal} /></View><View style={s.flex}><Text style={[s.reviewDetailLabel, { color: C.ink40 }]}>{label.toUpperCase()}</Text><Text style={[s.reviewDetailValue, { color: C.ink }]}>{value}</Text></View></View>)}
            </View>
            <View style={[s.publishNotice, { backgroundColor: C.tealWash }]}><Icon name="shield-checkmark-outline" size={19} color={C.teal} /><View style={s.flex}><Text style={[s.publishNoticeTitle, { color: C.ink }]}>Ready for players</Text><Text style={[s.publishNoticeText, { color: C.ink70 }]}>{isProgram ? 'Registration opens as soon as you publish.' : 'Players can request this offer; activation remains under venue control.'}</Text></View></View>
          </> : null}
        </NativeScrollView>

        {formError || externalError ? <View style={[s.requestFormError, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" size={18} color={C.brick} /><Text style={[s.requestFormErrorText, { color: C.brick }]}>{formError || externalError}</Text></View> : null}
        <View style={s.wizardActions}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={setupStep === 0 ? onClose : () => { setFormError(''); setSetupStep((current) => current - 1); }} style={[s.wizardBack, { backgroundColor: C.surface, borderColor: C.line }, busy && s.disabled]}><Icon name={setupStep === 0 ? 'close' : 'arrow-back'} size={17} color={C.ink70} /><Text style={[s.wizardBackText, { color: C.ink70 }]}>{setupStep === 0 ? 'Cancel' : 'Back'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={setupStep === 2 ? submit : continueSetup} style={[s.wizardNext, { backgroundColor: C.optic }, busy && s.disabled]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={s.wizardNextText}>{setupStep === 2 ? `Publish ${isProgram ? 'program' : 'offer'}` : 'Continue'}</Text><Icon name={setupStep === 2 ? 'checkmark' : 'arrow-forward'} size={18} color="#0E2321" /></>}</Pressable>
        </View>
      </View>;
  return <>{presentWizard(wizard)}{datePicker}{venuePickerModal}</>;
}

function Metric({ value, label, C }) { return <View style={[s.metric, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.metricValue, { color: C.ink }]}>{value}</Text><Text style={[s.metricLabel, { color: C.ink40 }]}>{label}</Text></View>; }

const competitionEntryName = (entry) => entry?.profiles?.display_name || entry?.teams?.name || 'Entrant';
const eligibleCompetitionEntries = (division) => (division?.competition_entries || []).filter((entry) => ['registered', 'active', 'completed', 'eliminated'].includes(entry.status) && ['not_required', 'approved'].includes(entry.eligibility_status));

function OrganizerCompetitionCard({ item, onManage, C }) {
  const divisions = [...(item.competition_divisions || [])].sort((a, b) => a.position - b.position);
  const totalEntries = divisions.reduce((total, division) => total + (division.competition_entries || []).filter((entry) => ['registered', 'active'].includes(entry.status) && entry.eligibility_status !== 'rejected').length, 0);
  const totalCapacity = divisions.reduce((total, division) => total + Number(division.capacity || 0), 0);
  const pending = divisions.reduce((total, division) => total + (division.competition_entries || []).filter((entry) => entry.eligibility_status === 'pending' && entry.status !== 'withdrawn').length, 0);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Manage ${item.name}`} onPress={onManage} style={({ pressed }) => [s.card, s.manageCompetitionCard, { backgroundColor: C.surface, borderColor: C.line }, pressed && s.cardPressed]}>
    <View style={s.row}><View style={[s.iconBox, { backgroundColor: C.tealWash }]}><Icon name="trophy-outline" color={C.teal} /></View><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{item.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{item.kind} · {divisions.length} {divisions.length === 1 ? 'division' : 'divisions'} · {formatDate(item.starts_on, false)}</Text></View><Icon name="chevron-forward" color={C.teal} /></View>
    <View style={[s.manageCompetitionFooter, { borderColor: C.line }]}><Text style={[s.manageCompetitionCount, { color: C.ink }]}>{totalEntries}/{totalCapacity} entries</Text><View style={[s.status, { backgroundColor: item.status === 'cancelled' ? C.brickWash : C.tealWash }]}><Text style={[s.statusText, { color: item.status === 'cancelled' ? C.brick : C.teal }]}>{item.status.toUpperCase()}</Text></View>{pending ? <Text style={[s.pendingCount, { color: C.brick }]}>{pending} to review</Text> : null}</View>
  </Pressable>;
}

function CompetitionDetailsSheet({ competition, busy, onClose, onSave, C }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(competition.name);
  const [startsOn, setStartsOn] = useState(competition.starts_on);
  const [endsOn, setEndsOn] = useState(competition.ends_on || competition.starts_on);
  const [visibility, setVisibility] = useState(competition.visibility || 'public');
  const [rules, setRules] = useState(competition.rules || '');
  const [formError, setFormError] = useState('');
  const [datePickerField, setDatePickerField] = useState(null);
  const submit = () => {
    try {
      localDateTimeIso(startsOn, '00:00', 'Start date');
      localDateTimeIso(endsOn, '23:59', 'End date');
      if (name.trim().length < 3) throw new Error('Competition name must be at least 3 characters.');
      if (endsOn < startsOn) throw new Error('End date must be on or after the start date.');
      setFormError('');
      onSave({ name: name.trim(), startsOn, endsOn, visibility, rules: rules.trim() });
    } catch (error) {
      setFormError(error.message);
    }
  };
  return <><Modal visible transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
    <Pressable onPress={() => !busy && onClose()} style={s.modalBackdrop}><Pressable onPress={(event) => event.stopPropagation()} style={[s.requestSheet, { backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 18) }]}>
      <View style={[s.handle, { backgroundColor: C.line }]} /><View style={s.row}><View style={s.flex}><Text style={[s.eyebrow, { color: C.teal }]}>COMPETITION</Text><Text style={[s.sheetTitle, { color: C.ink }]}>Edit event details</Text></View><Pressable accessibilityLabel="Close" disabled={busy} onPress={onClose} style={[s.sheetClose, { backgroundColor: C.surface }]}><Icon name="close" color={C.ink} /></Pressable></View>
      <NativeScrollView style={s.requestSheetScroll} keyboardShouldPersistTaps="handled"><Text style={[s.fieldLabel, { color: C.ink40 }]}>NAME</Text><TextInput value={name} onChangeText={setName} maxLength={100} style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
        <View style={s.requestFieldRow}><View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>START DATE</Text><AppDatePickerField accessibilityLabel="Choose competition start date" value={startsOn} onPress={() => setDatePickerField('start')} colors={C} /></View><View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>END DATE</Text><AppDatePickerField accessibilityLabel="Choose competition end date" value={endsOn} onPress={() => setDatePickerField('end')} colors={C} /></View></View>
        <Text style={[s.fieldLabel, { color: C.ink40 }]}>WHO CAN SEE IT?</Text><View style={s.pillRow}>{['public', 'members', 'private'].map((value) => <Pill key={value} active={visibility === value} onPress={() => setVisibility(value)} C={C}>{value}</Pill>)}</View>
        <Text style={[s.fieldLabel, { color: C.ink40 }]}>RULES · OPTIONAL</Text><TextInput value={rules} onChangeText={setRules} maxLength={1000} multiline placeholder="Scoring, format, and event policies" placeholderTextColor={C.ink40} style={[s.input, s.multilineInput, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
        {formError ? <View style={[s.requestFormError, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" color={C.brick} /><Text style={[s.requestFormErrorText, { color: C.brick }]}>{formError}</Text></View> : null}
      </NativeScrollView>
      <View style={s.sheetActions}><Pressable disabled={busy} onPress={onClose} style={[s.sheetCancel, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.sheetCancelText, { color: C.ink70 }]}>Cancel</Text></Pressable><Pressable disabled={busy} onPress={submit} style={[s.sheetConfirm, { backgroundColor: C.optic }]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={s.wizardNextText}>Save changes</Text><Icon name="checkmark" color="#0E2321" /></>}</Pressable></View>
    </Pressable></Pressable>
  </Modal><AppDatePickerModal visible={Boolean(datePickerField)} value={datePickerField === 'end' ? endsOn : startsOn} eyebrow={datePickerField === 'end' ? 'COMPETITION END' : 'COMPETITION START'} title={datePickerField === 'end' ? 'Choose the end date' : 'Choose the start date'} minimumDate={datePickerField === 'end' ? startsOn : inDays(0)} onClose={() => setDatePickerField(null)} onSelect={(value) => { if (datePickerField === 'end') setEndsOn(value); else { setStartsOn(value); if (endsOn < value) setEndsOn(value); } setDatePickerField(null); }} colors={C} /></>;
}

function CompetitionDivisionDetailsSheet({ division, busy, onClose, onSave, C }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(division.name);
  const [capacity, setCapacity] = useState(String(division.capacity));
  const [feeAmount, setFeeAmount] = useState(String(division.fee_amount || 0));
  const [feeBasis, setFeeBasis] = useState(division.fee_basis || 'entry');
  const [formError, setFormError] = useState('');
  const submit = () => {
    const capacityValue = Number(capacity);
    const feeValue = Number(feeAmount);
    if (name.trim().length < 3) { setFormError('Division name must be at least 3 characters.'); return; }
    if (!Number.isInteger(capacityValue) || capacityValue < 2 || capacityValue > 200) { setFormError('Capacity must be from 2 to 200.'); return; }
    if (!Number.isFinite(feeValue) || feeValue < 0) { setFormError('Fee must be zero or greater.'); return; }
    setFormError('');
    onSave({ name: name.trim(), capacity: capacityValue, feeAmount: feeValue, feeBasis });
  };
  return <Modal visible transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
    <Pressable onPress={() => !busy && onClose()} style={s.modalBackdrop}><Pressable onPress={(event) => event.stopPropagation()} style={[s.requestSheet, { backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 18) }]}>
      <View style={[s.handle, { backgroundColor: C.line }]} /><View style={s.row}><View style={s.flex}><Text style={[s.eyebrow, { color: C.teal }]}>DIVISION</Text><Text style={[s.sheetTitle, { color: C.ink }]}>Edit division details</Text></View><Pressable accessibilityLabel="Close" disabled={busy} onPress={onClose} style={[s.sheetClose, { backgroundColor: C.surface }]}><Icon name="close" color={C.ink} /></Pressable></View>
      <Text style={[s.fieldLabel, { color: C.ink40 }]}>DIVISION NAME</Text><TextInput value={name} onChangeText={setName} maxLength={100} style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} />
      <View style={s.requestFieldRow}><View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>CAPACITY</Text><TextInput value={capacity} onChangeText={setCapacity} keyboardType="number-pad" style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View><View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>FEE (PHP)</Text><TextInput value={feeAmount} onChangeText={setFeeAmount} keyboardType="decimal-pad" style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View></View>
      <Text style={[s.fieldLabel, { color: C.ink40 }]}>FEE BASIS</Text><View style={s.pillRow}>{['entry', 'player'].map((value) => <Pill key={value} active={feeBasis === value} onPress={() => setFeeBasis(value)} C={C}>Per {value}</Pill>)}</View>
      <View style={[s.publishNotice, { backgroundColor: C.tealWash }]}><Icon name="information-circle-outline" color={C.teal} /><Text style={[s.publishNoticeText, { color: C.ink70 }]}>Gender, skill, format, and entry type stay locked after publishing to protect registrations and results.</Text></View>
      {formError ? <View style={[s.requestFormError, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" color={C.brick} /><Text style={[s.requestFormErrorText, { color: C.brick }]}>{formError}</Text></View> : null}
      <View style={s.sheetActions}><Pressable disabled={busy} onPress={onClose} style={[s.sheetCancel, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.sheetCancelText, { color: C.ink70 }]}>Cancel</Text></Pressable><Pressable disabled={busy} onPress={submit} style={[s.sheetConfirm, { backgroundColor: C.optic }]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={s.wizardNextText}>Save division</Text><Icon name="checkmark" color="#0E2321" /></>}</Pressable></View>
    </Pressable></Pressable>
  </Modal>;
}

function CompetitionMatchSheet({ competition, division, bracketSlot, match, busy, onClose, onSchedule, onScore, C }) {
  const insets = useSafeAreaInsets();
  const entries = eligibleCompetitionEntries(division);
  const bracketHomeId = bracketSlot?.home_entry_id || null;
  const bracketAwayId = bracketSlot?.away_entry_id || null;
  const [homeEntryId, setHomeEntryId] = useState(bracketHomeId || entries[0]?.id || null);
  const [awayEntryId, setAwayEntryId] = useState(bracketAwayId || entries.find((entry) => entry.id !== (bracketHomeId || entries[0]?.id))?.id || null);
  const nextHour = new Date(Date.now() + 60 * 60 * 1000);
  const [date, setDate] = useState(localDateValue(nextHour));
  const [time, setTime] = useState(`${padDatePart(nextHour.getHours())}:${padDatePart(nextHour.getMinutes())}`);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [formError, setFormError] = useState('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const scoring = Boolean(match);
  const entryName = (id) => competitionEntryName(entries.find((entry) => entry.id === id));
  const submit = () => {
    try {
      if (scoring) {
        const home = Number(homeScore);
        const away = Number(awayScore);
        if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home === away) throw new Error('Enter valid scores with one winner.');
        onScore(home, away);
        return;
      }
      if (!homeEntryId || !awayEntryId || homeEntryId === awayEntryId) throw new Error('Choose two different entries.');
      const scheduledAt = localDateTimeIso(date, time, 'Match time');
      if (scheduledAt < new Date(Date.now() - 5 * 60 * 1000)) throw new Error('Choose a current or future match time.');
      onSchedule({ homeEntryId, awayEntryId, scheduledAt: scheduledAt.toISOString(), bracketMatchId: bracketSlot?.id || null });
    } catch (error) {
      setFormError(error.message);
    }
  };
  const matchHomeId = match ? entries.find((entry) => entry.team_id ? entry.team_id === match.team_home_id : match.match_participants?.some((participant) => participant.side === 0 && participant.user_id === entry.user_id))?.id : homeEntryId;
  const matchAwayId = match ? entries.find((entry) => entry.team_id ? entry.team_id === match.team_away_id : match.match_participants?.some((participant) => participant.side === 1 && participant.user_id === entry.user_id))?.id : awayEntryId;
  return <><Modal visible transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
    <Pressable onPress={() => !busy && onClose()} style={s.modalBackdrop}><Pressable onPress={(event) => event.stopPropagation()} style={[s.requestSheet, { backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 18) }]}>
      <View style={[s.handle, { backgroundColor: C.line }]} /><View style={s.row}><View style={s.flex}><Text style={[s.eyebrow, { color: C.teal }]}>{division.name.toUpperCase()}</Text><Text style={[s.sheetTitle, { color: C.ink }]}>{scoring ? 'Record official score' : 'Schedule match'}</Text></View><Pressable accessibilityLabel="Close" disabled={busy} onPress={onClose} style={[s.sheetClose, { backgroundColor: C.surface }]}><Icon name="close" color={C.ink} /></Pressable></View>
      <NativeScrollView style={s.requestSheetScroll} keyboardShouldPersistTaps="handled">
        {scoring ? <><View style={[s.scoreMatchup, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.scoreEntryName, { color: C.ink }]}>{entryName(matchHomeId)}</Text><Text style={[s.scoreVersus, { color: C.ink40 }]}>VS</Text><Text style={[s.scoreEntryName, { color: C.ink }]}>{entryName(matchAwayId)}</Text></View><View style={s.scoreInputs}><TextInput accessibilityLabel={`Score for ${entryName(matchHomeId)}`} value={homeScore} onChangeText={setHomeScore} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.ink40} style={[s.scoreInput, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /><Text style={[s.scoreDash, { color: C.ink40 }]}>–</Text><TextInput accessibilityLabel={`Score for ${entryName(matchAwayId)}`} value={awayScore} onChangeText={setAwayScore} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.ink40} style={[s.scoreInput, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View><View style={[s.publishNotice, { backgroundColor: C.tealWash }]}><Icon name="shield-checkmark-outline" color={C.teal} /><Text style={[s.publishNoticeText, { color: C.ink70 }]}>This is an official organizer result. Standings and the tournament bracket update immediately.</Text></View></> : <>
          {!bracketSlot ? <><Text style={[s.fieldLabel, { color: C.ink40 }]}>HOME ENTRY</Text><NativeScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillRow}>{entries.map((entry) => <Pill key={entry.id} active={homeEntryId === entry.id} onPress={() => { setHomeEntryId(entry.id); if (awayEntryId === entry.id) setAwayEntryId(null); }} C={C}>{competitionEntryName(entry)}</Pill>)}</NativeScrollView><Text style={[s.fieldLabel, { color: C.ink40 }]}>AWAY ENTRY</Text><NativeScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillRow}>{entries.filter((entry) => entry.id !== homeEntryId).map((entry) => <Pill key={entry.id} active={awayEntryId === entry.id} onPress={() => setAwayEntryId(entry.id)} C={C}>{competitionEntryName(entry)}</Pill>)}</NativeScrollView></> : <View style={[s.scoreMatchup, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.scoreEntryName, { color: C.ink }]}>{entryName(homeEntryId)}</Text><Text style={[s.scoreVersus, { color: C.ink40 }]}>VS</Text><Text style={[s.scoreEntryName, { color: C.ink }]}>{entryName(awayEntryId)}</Text></View>}
          <View style={s.requestFieldRow}><View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>DATE</Text><AppDatePickerField accessibilityLabel="Choose match date" value={date} onPress={() => setDatePickerOpen(true)} colors={C} /></View><View style={s.requestField}><Text style={[s.fieldLabel, { color: C.ink40 }]}>TIME</Text><TextInput value={time} onChangeText={setTime} maxLength={5} autoCapitalize="none" placeholder="18:00" placeholderTextColor={C.ink40} style={[s.input, { color: C.ink, backgroundColor: C.surface, borderColor: C.line }]} /></View></View>
        </>}
        {formError ? <View style={[s.requestFormError, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" color={C.brick} /><Text style={[s.requestFormErrorText, { color: C.brick }]}>{formError}</Text></View> : null}
      </NativeScrollView>
      <View style={s.sheetActions}><Pressable disabled={busy} onPress={onClose} style={[s.sheetCancel, { backgroundColor: C.surface, borderColor: C.line }]}><Text style={[s.sheetCancelText, { color: C.ink70 }]}>Cancel</Text></Pressable><Pressable disabled={busy} onPress={submit} style={[s.sheetConfirm, { backgroundColor: C.optic }]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={s.wizardNextText}>{scoring ? 'Save official result' : 'Schedule match'}</Text><Icon name={scoring ? 'checkmark' : 'calendar-outline'} color="#0E2321" /></>}</Pressable></View>
    </Pressable></Pressable>
  </Modal><AppDatePickerModal visible={datePickerOpen} value={date} eyebrow="MATCH DATE" title="Choose the match date" minimumDate={inDays(0)} onClose={() => setDatePickerOpen(false)} onSelect={(value) => { setDate(value); setDatePickerOpen(false); }} colors={C} /></>;
}

function OrganizerCompetitionWorkspace({ competition, matches, busy, act, onBack, C }) {
  const divisions = useMemo(() => [...(competition.competition_divisions || [])].sort((a, b) => a.position - b.position), [competition.competition_divisions]);
  const [tab, setTab] = useState('Overview');
  const [divisionId, setDivisionId] = useState(divisions[0]?.id || null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [divisionDetailsOpen, setDivisionDetailsOpen] = useState(false);
  const [matchSheet, setMatchSheet] = useState(null);
  const division = divisions.find((item) => item.id === divisionId) || divisions[0];
  const entries = eligibleCompetitionEntries(division);
  const pendingEntries = (division?.competition_entries || []).filter((entry) => entry.eligibility_status === 'pending' && entry.status !== 'withdrawn');
  const divisionMatches = (matches || []).filter((match) => match.competition_division_id === division?.id);
  const standings = [...entries].sort((a, b) => b.standing_points - a.standing_points || b.won - a.won || (b.points_for - b.points_against) - (a.points_for - a.points_against));
  const bracketSlots = [...(division?.competition_bracket_matches || [])].sort((a, b) => a.round_number - b.round_number || a.position - b.position);
  const entryName = (id) => id ? competitionEntryName((division?.competition_entries || []).find((entry) => entry.id === id)) : 'TBD';
  const matchForSlot = (slot) => divisionMatches.find((match) => match.id === slot.match_id);
  const totalEntries = divisions.reduce((total, item) => total + eligibleCompetitionEntries(item).length, 0);
  const totalCapacity = divisions.reduce((total, item) => total + Number(item.capacity || 0), 0);
  const completedMatches = (matches || []).filter((match) => match.status === 'completed').length;
  const confirmStatus = (status, title, message) => Alert.alert(title, message, [{ text: 'Not now', style: 'cancel' }, { text: title, style: status === 'cancelled' ? 'destructive' : 'default', onPress: () => act(() => setCompetitionStatus(competition.id, status), `Competition marked ${status}.`) }]);
  const confirmDivisionStatus = (status) => Alert.alert(`${status === 'active' ? 'Start' : status === 'completed' ? 'Complete' : 'Cancel'} division?`, `${division.name} will be marked ${status}.`, [{ text: 'Not now', style: 'cancel' }, { text: status === 'active' ? 'Start' : status === 'completed' ? 'Complete' : 'Cancel division', style: status === 'cancelled' ? 'destructive' : 'default', onPress: () => act(() => setCompetitionDivisionStatus(division.id, status), `${division.name} marked ${status}.`) }]);
  return <>
    <View style={s.competitionWorkspaceHeader}><Pressable accessibilityRole="button" accessibilityLabel="Back to competitions" onPress={onBack} style={[s.back, { backgroundColor: C.surface, borderColor: C.line }]}><Icon name="arrow-back" color={C.ink} /></Pressable><View style={s.flex}><Text style={[s.eyebrow, { color: C.teal }]}>MANAGE COMPETITION</Text><Text numberOfLines={1} style={[s.workspaceTitle, { color: C.ink }]}>{competition.name}</Text></View><View style={[s.status, { backgroundColor: competition.status === 'cancelled' ? C.brickWash : C.tealWash }]}><Text style={[s.statusText, { color: competition.status === 'cancelled' ? C.brick : C.teal }]}>{competition.status.toUpperCase()}</Text></View></View>
    <NativeScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.workspaceTabs}>{['Overview', 'Divisions', 'Entries', 'Matches', 'Standings'].map((item) => <Pill key={item} active={tab === item} onPress={() => setTab(item)} C={C}>{item}</Pill>)}</NativeScrollView>
    {tab !== 'Overview' ? <NativeScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.divisionFilter}>{divisions.map((item) => <Pill key={item.id} active={division?.id === item.id} onPress={() => setDivisionId(item.id)} C={C}>{item.name}</Pill>)}</NativeScrollView> : null}

    {tab === 'Overview' ? <><View style={s.metrics}><Metric value={`${totalEntries}/${totalCapacity}`} label="ENTRIES" C={C} /><Metric value={divisions.length} label="DIVISIONS" C={C} /><Metric value={(matches || []).length} label="MATCHES" C={C} /><Metric value={completedMatches} label="COMPLETED" C={C} /></View><View style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.row}><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>Event details</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{competition.kind} · {formatDate(competition.starts_on, false)}{competition.ends_on ? ` – ${formatDate(competition.ends_on, false)}` : ''} · {competition.visibility}</Text></View>{!['completed', 'cancelled'].includes(competition.status) ? <ActionButton title="Edit" icon="pencil-outline" secondary onPress={() => setDetailsOpen(true)} C={C} /> : null}</View>{competition.rules ? <Text style={[s.note, { color: C.ink70 }]}>{competition.rules}</Text> : null}<View style={s.inlineActions}>{competition.status === 'registration' ? <ActionButton title="Start competition" icon="play-outline" onPress={() => confirmStatus('active', 'Start competition', 'Registration will close and all open divisions will become active.')} C={C} /> : null}{competition.status === 'active' ? <ActionButton title="Complete competition" icon="checkmark-circle-outline" onPress={() => confirmStatus('completed', 'Complete competition', 'This closes every remaining division and registration.')} C={C} /> : null}{!['completed', 'cancelled'].includes(competition.status) ? <ActionButton title="Cancel" icon="close-circle-outline" secondary onPress={() => confirmStatus('cancelled', 'Cancel competition', 'Registration and every open division will be cancelled.')} C={C} /> : null}</View></View><View style={s.competitionCoverPicker}><OrganizerImagePicker compact value={competition.cover_image_url || ''} onChange={(uri) => act(() => saveCompetitionCover(competition.id, uri), uri ? 'Competition photo updated.' : 'Competition photo removed.')} title="Competition photo" detail="Add event artwork or an action photo." emptyIcon="trophy-outline" colors={C} /></View></> : null}

    {tab === 'Divisions' && division ? <View style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.row}><View style={s.flex}><Text style={[s.h2, { color: C.ink }]}>{division.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{PARTICIPANT_DIVISION_LABELS[division.participant_division]} · {SKILL_CATEGORY_LABELS[division.skill_category]} · {division.format} · {ENTRY_TYPE_LABELS[division.entry_type]} entries</Text></View><View style={[s.status, { backgroundColor: division.status === 'cancelled' ? C.brickWash : C.tealWash }]}><Text style={[s.statusText, { color: division.status === 'cancelled' ? C.brick : C.teal }]}>{division.status.toUpperCase()}</Text></View></View><View style={s.metrics}><Metric value={`${entries.length}/${division.capacity}`} label="ENTRIES" C={C} /><Metric value={pendingEntries.length} label="TO REVIEW" C={C} /><Metric value={bracketSlots.length} label="BRACKET SLOTS" C={C} /><Metric value={money(division.fee_amount)} label={`PER ${division.fee_basis.toUpperCase()}`} C={C} /></View><View style={s.inlineActions}>{!['completed', 'cancelled'].includes(division.status) ? <ActionButton title="Edit details" icon="pencil-outline" secondary onPress={() => setDivisionDetailsOpen(true)} C={C} /> : null}{competition.kind === 'tournament' && !bracketSlots.length ? <ActionButton title="Seed bracket" icon="git-network-outline" disabled={entries.length < 2 || pendingEntries.length > 0} onPress={() => act(() => seedTournamentBracket(competition.id, division.id), `${division.name} bracket seeded.`)} C={C} /> : null}{division.status === 'registration' ? <ActionButton title="Start division" icon="play-outline" onPress={() => confirmDivisionStatus('active')} C={C} /> : null}{division.status === 'active' ? <ActionButton title="Complete" icon="checkmark-circle-outline" onPress={() => confirmDivisionStatus('completed')} C={C} /> : null}{!['completed', 'cancelled'].includes(division.status) ? <ActionButton title="Cancel division" icon="close-circle-outline" secondary onPress={() => confirmDivisionStatus('cancelled')} C={C} /> : null}</View>{competition.kind === 'tournament' && !bracketSlots.length && (entries.length < 2 || pendingEntries.length) ? <Text style={[s.decision, { color: C.ink40 }]}>{pendingEntries.length ? 'Review every pending entry before seeding.' : 'At least two eligible entries are needed.'}</Text> : null}</View> : null}

    {tab === 'Entries' && division ? <>{pendingEntries.length ? <><Section eyebrow="ACTION REQUIRED" title={`${pendingEntries.length} eligibility ${pendingEntries.length === 1 ? 'review' : 'reviews'}`} C={C} />{pendingEntries.map((entry) => <View key={entry.id} style={[s.entryRow, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{competitionEntryName(entry)}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>Eligibility review required</Text></View><Pressable accessibilityLabel="Decline entry" onPress={() => act(() => reviewCompetitionEntry(entry.id, false), 'Registration declined.')} style={[s.reviewIconButton, { backgroundColor: C.brickWash }]}><Icon name="close" color={C.brick} /></Pressable><Pressable accessibilityLabel="Approve entry" onPress={() => act(() => reviewCompetitionEntry(entry.id, true), 'Registration approved.')} style={[s.reviewIconButton, { backgroundColor: C.tealWash }]}><Icon name="checkmark" color={C.teal} /></Pressable></View>)}</> : null}<Section eyebrow="DIVISION ROSTER" title={`${entries.length} eligible ${entries.length === 1 ? 'entry' : 'entries'}`} C={C} />{entries.length ? entries.map((entry) => <View key={entry.id} style={[s.entryRow, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.entryAvatar, { backgroundColor: C.tealWash }]}><Text style={[s.entryAvatarText, { color: C.teal }]}>{competitionEntryName(entry).slice(0, 2).toUpperCase()}</Text></View><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{competitionEntryName(entry)}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{ENTRY_TYPE_LABELS[division.entry_type]} · {entry.status}</Text></View><Text style={[s.tinyStatus, { color: C.teal }]}>{entry.eligibility_status === 'approved' ? 'APPROVED' : 'ELIGIBLE'}</Text></View>) : <Empty icon="people-outline" title="No eligible entries yet" detail="Approved registrations will appear here." C={C} />}</> : null}

    {tab === 'Matches' && division ? <>{competition.kind !== 'tournament' && !['completed', 'cancelled'].includes(division.status) ? <View style={s.workspacePrimaryAction}><ActionButton title="Schedule match" icon="calendar-outline" disabled={entries.length < 2} onPress={() => setMatchSheet({ type: 'schedule' })} C={C} /></View> : null}{competition.kind === 'tournament' ? bracketSlots.length ? bracketSlots.map((slot) => { const match = matchForSlot(slot); const game = match?.match_games?.[0]; const ready = slot.home_entry_id && slot.away_entry_id && !slot.winner_entry_id; return <View key={slot.id} style={[s.matchCard, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.row}><Text style={[s.bracketRoundLabel, { color: C.teal }]}>ROUND {slot.round_number} · MATCH {slot.position}</Text><View style={[s.status, { backgroundColor: slot.status === 'completed' ? C.tealWash : C.paper }]}><Text style={[s.statusText, { color: C.teal }]}>{slot.status.toUpperCase()}</Text></View></View><View style={s.matchSides}><Text numberOfLines={1} style={[s.matchSideName, { color: C.ink }]}>{entryName(slot.home_entry_id)}</Text><Text style={[s.matchScore, { color: C.ink }]}>{game ? `${game.home_score}–${game.away_score}` : 'vs'}</Text><Text numberOfLines={1} style={[s.matchSideName, { color: C.ink }]}>{entryName(slot.away_entry_id)}</Text></View>{match?.status === 'scheduled' ? <View style={s.inlineActions}><Text style={[s.matchTime, { color: C.ink40 }]}>{formatDate(match.scheduled_at)}</Text><ActionButton title="Record score" icon="create-outline" onPress={() => setMatchSheet({ type: 'score', match, slot })} C={C} /></View> : ready && !match ? <ActionButton title="Schedule this match" icon="calendar-outline" onPress={() => setMatchSheet({ type: 'schedule', slot })} C={C} /> : null}</View>; }) : <Empty icon="git-network-outline" title="Bracket not seeded" detail="Open Divisions, resolve eligibility reviews, then seed this bracket." C={C} /> : divisionMatches.length ? divisionMatches.map((match) => { const game = match.match_games?.[0]; const home = entries.find((entry) => entry.team_id ? entry.team_id === match.team_home_id : match.match_participants?.some((participant) => participant.side === 0 && participant.user_id === entry.user_id)); const away = entries.find((entry) => entry.team_id ? entry.team_id === match.team_away_id : match.match_participants?.some((participant) => participant.side === 1 && participant.user_id === entry.user_id)); return <View key={match.id} style={[s.matchCard, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.matchSides}><Text numberOfLines={1} style={[s.matchSideName, { color: C.ink }]}>{competitionEntryName(home)}</Text><Text style={[s.matchScore, { color: C.ink }]}>{game ? `${game.home_score}–${game.away_score}` : 'vs'}</Text><Text numberOfLines={1} style={[s.matchSideName, { color: C.ink }]}>{competitionEntryName(away)}</Text></View><View style={s.inlineActions}><Text style={[s.matchTime, { color: C.ink40 }]}>{formatDate(match.scheduled_at)}</Text>{match.status === 'scheduled' ? <ActionButton title="Record score" icon="create-outline" onPress={() => setMatchSheet({ type: 'score', match })} C={C} /> : <View style={[s.status, { backgroundColor: C.tealWash }]}><Text style={[s.statusText, { color: C.teal }]}>COMPLETED</Text></View>}</View></View>; }) : <Empty icon="calendar-outline" title="No matches scheduled" detail="Use Schedule match to choose two eligible entries and a time." C={C} />}</> : null}

    {tab === 'Standings' && division ? <>{standings.length ? <View style={[s.standingsTable, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.standingHeader, { borderColor: C.line }]}><Text style={[s.rank, { color: C.ink40 }]}>#</Text><Text style={[s.standingName, { color: C.ink40 }]}>ENTRY</Text><Text style={[s.standingRecord, { color: C.ink40 }]}>W–L</Text><Text style={[s.standingPoints, { color: C.ink40 }]}>PTS</Text></View>{standings.map((entry, index) => <View key={entry.id} style={[s.standingRow, { borderColor: C.line }]}><Text style={[s.rank, { color: C.teal }]}>{index + 1}</Text><Text numberOfLines={1} style={[s.standingName, { color: C.ink }]}>{competitionEntryName(entry)}</Text><Text style={[s.standingRecord, { color: C.ink70 }]}>{entry.won}–{entry.lost}</Text><Text style={[s.standingPoints, { color: C.ink }]}>{entry.standing_points}</Text></View>)}</View> : <Empty icon="podium-outline" title="Standings are ready" detail="Eligible entries and official results will appear here." C={C} />}</> : null}

    {detailsOpen ? <CompetitionDetailsSheet competition={competition} busy={busy} onClose={() => setDetailsOpen(false)} onSave={(changes) => act(() => updateCompetitionDetails({ competitionId: competition.id, ...changes }), 'Competition details updated.').then((saved) => saved && setDetailsOpen(false))} C={C} /> : null}
    {divisionDetailsOpen && division ? <CompetitionDivisionDetailsSheet division={division} busy={busy} onClose={() => setDivisionDetailsOpen(false)} onSave={(changes) => act(() => updateCompetitionDivisionDetails({ divisionId: division.id, ...changes }), 'Division details updated.').then((saved) => saved && setDivisionDetailsOpen(false))} C={C} /> : null}
    {matchSheet && division ? <CompetitionMatchSheet competition={competition} division={division} bracketSlot={matchSheet.slot} match={matchSheet.match} busy={busy} onClose={() => setMatchSheet(null)} onSchedule={(form) => act(() => scheduleCompetitionMatch({ competitionId: competition.id, divisionId: division.id, ...form }), 'Match scheduled.').then((saved) => saved && setMatchSheet(null))} onScore={(homeScore, awayScore) => act(() => recordCompetitionMatchResult(matchSheet.match.id, homeScore, awayScore), 'Official result saved.').then((saved) => saved && setMatchSheet(null))} C={C} /> : null}
  </>;
}

function OrganizerMembershipCard({ item, C }) {
  const active = item.player_memberships?.filter((membership) => membership.status === 'active' && membership.payment_status === 'paid').length || 0;
  const awaitingPayment = item.player_memberships?.filter((membership) => membership.status === 'pending' && membership.payment_status === 'awaiting_payment').length || 0;
  return <View style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.row}><View style={[s.iconBox, { backgroundColor: C.optic }]}><Icon name="card-outline" color="#0E2321" /></View><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{item.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{item.kind.replace('_', ' ')} · {item.validity_days} days · {item.credits ? `${item.credits} credits` : `${item.discount_percent}% discount`}</Text></View><Text style={[s.capacity, { color: C.teal }]}>{money(item.price)}</Text></View><Text style={[s.decision, { color: C.ink40 }]}>{active} paid and active · {awaitingPayment} awaiting payment</Text></View>;
}

function OrganizerHub({ C, navigation, initialTab = 'Programs', showTabs = true, createActivityType = null, createActivityToken = null, createCompetitionToken = null }) {
  const canUseAnalytics = true;
  const canExport = true;
  const requestedCreateType = ['program', 'competition', 'membership'].includes(createActivityType)
    ? createActivityType
    : createCompetitionToken
      ? 'competition'
      : null;
  const [tab, setTab] = useState(['Programs', 'Competition', 'Memberships', 'Analytics'].includes(initialTab) ? initialTab : 'Programs');
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState(null);
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [sheet, setSheet] = useState(requestedCreateType);
  const [managedCompetitionId, setManagedCompetitionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selectedVenueRef = useRef(null);
  const loadVersionRef = useRef(0);
  const handledCreateActivityRef = useRef(null);
  const venue = venues.find((item) => item.id === venueId) || venues[0];
  const activeSheet = requestedCreateType || sheet;

  useEffect(() => {
    if (['Programs', 'Competition', 'Memberships', 'Analytics'].includes(initialTab)) setTab(initialTab);
  }, [initialTab]);
  useEffect(() => {
    const token = createActivityToken || createCompetitionToken;
    const type = createActivityType || (createCompetitionToken ? 'competition' : null);
    const targetTab = { program: 'Programs', competition: 'Competition', membership: 'Memberships' }[type];
    if (!token || !targetTab || handledCreateActivityRef.current === token) return;
    handledCreateActivityRef.current = token;
    setTab(targetTab);
    setSheet(type);
    navigation.setParams({ createActivityType: undefined, createActivityToken: undefined, createCompetitionToken: undefined });
  }, [createActivityToken, createActivityType, createCompetitionToken, navigation]);

  const load = useCallback(async (preferredVenueId = selectedVenueRef.current) => {
    const version = ++loadVersionRef.current;
    setLoading(true); setError('');
    try {
      const managed = verifiedPublishingVenues(await listManagedVenues());
      const selected = managed.some((item) => item.id === preferredVenueId) ? preferredVenueId : managed[0]?.id || null;
      const [hub, report] = await Promise.all([
        loadOrganizerPickleballHub(managed),
        selected && canUseAnalytics ? loadVenueAnalytics(selected, inDays(-30), inDays(0)) : Promise.resolve(null),
      ]);
      if (version !== loadVersionRef.current) return;
      selectedVenueRef.current = selected;
      setVenues(managed); setVenueId(selected); setData(hub); setAnalytics(report);
    } catch (loadError) {
      if (version === loadVersionRef.current) setError(loadError.message || 'Programs and insights could not be loaded.');
    } finally {
      if (version === loadVersionRef.current) setLoading(false);
    }
  }, [canUseAnalytics]);

  useFocusEffect(useCallback(() => {
    load();
    return () => { loadVersionRef.current += 1; };
  }, [load]));

  const act = async (task, message) => {
    setBusy(true); setError('');
    try { await task(); setSheet(null); if (message) Alert.alert('Organizer', message); await load(); return true; }
    catch (actionError) {
      const messageText = actionError.message || 'The organizer action could not be completed.';
      setError(messageText);
      Alert.alert('Couldn’t complete action', messageText);
      return false;
    }
    finally { setBusy(false); }
  };
  const create = (form) => {
    if (!venue) return;
    if (activeSheet === 'program') return act(() => createVenueProgram({ venueId: venue.id, name: form.name, kind: form.kind, skillDivision: form.skillDivision, startsAt: form.startsAt, endsAt: form.endsAt, capacity: form.capacity, price: form.price, description: form.description, recurringRule: form.weekly ? { frequency: 'weekly', interval: 1 } : null }), `${form.name} is open for registration.`);
    if (activeSheet === 'competition') return act(() => createCompetition({ venueId: venue.id, name: form.name, kind: form.kind, startsOn: form.startsOn, endsOn: form.endsOn, divisions: form.divisions, coverImage: form.coverImage, rules: 'Verified Peakle results determine division standings.' }), `${form.name} is accepting entries across ${form.divisions.length} ${form.divisions.length === 1 ? 'division' : 'divisions'}.`);
    return act(() => createMembershipProduct({ venueId: venue.id, name: form.name, kind: form.kind, price: form.price, credits: form.credits, discountPercent: form.discountPercent, validityDays: form.validityDays, terms: form.terms }), `${form.name} is available to players.`);
  };
  const exportAnalytics = async () => {
    if (!analytics || !venue) return;
    setError('');
    try { await Share.share({ title: `${venue.name} report`, message: venueAnalyticsCsv(venue.name, analytics) }); }
    catch (shareError) { setError(shareError.message || 'The report could not be shared.'); }
  };

  const programs = (data?.programs || []).filter((item) => item.venue_id === venue?.id);
  const competitions = (data?.competitions || []).filter((item) => item.venue_id === venue?.id);
  const competitionMatches = (data?.competitionMatches || []).filter((item) => item.venue_id === venue?.id || competitions.some((competition) => competition.id === item.competition_id));
  const products = (data?.products || []).filter((item) => item.venue_id === venue?.id);
  const managedCompetition = competitions.find((item) => item.id === managedCompetitionId);
  if (managedCompetition) return <><OrganizerCompetitionWorkspace competition={managedCompetition} matches={competitionMatches.filter((match) => match.competition_id === managedCompetition.id)} busy={busy} act={act} onBack={() => { setError(''); setManagedCompetitionId(null); }} C={C} />{error ? <View style={[s.error, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" color={C.brick} /><Text style={[s.errorText, { color: C.brick }]}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={() => load()} style={s.retryButton}><Icon name="refresh" size={18} color={C.brick} /></Pressable></View> : null}{busy || loading ? <View style={[s.busy, { backgroundColor: C.busy, borderColor: C.line }]}><ActivityIndicator color={C.teal} /></View> : null}</>;
  return <View style={s.hubLoadingHost}><>
    {venues.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.venueRow}>{venues.map((item) => <Pill key={item.id} active={venue?.id === item.id} onPress={() => { if (venue?.id === item.id) return; selectedVenueRef.current = item.id; setVenueId(item.id); setAnalytics(null); load(item.id); }} C={C}>{item.name}</Pill>)}</ScrollView> : null}
    {showTabs ? <View style={s.tabRow}>{['Programs', 'Competition', 'Memberships', 'Analytics'].map((item) => <Pill key={item} active={tab === item} onPress={() => setTab(item)} C={C}>{item === 'Analytics' && !canUseAnalytics ? 'Analytics · Pro' : item}</Pill>)}</View> : null}
    {error ? <View style={[s.error, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" color={C.brick} /><Text style={[s.errorText, { color: C.brick }]}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={() => load()} style={s.retryButton}><Icon name="refresh" size={18} color={C.brick} /></Pressable></View> : null}
    {!venues.length && !loading ? <Empty icon="shield-checkmark-outline" title="No verified venue" detail="Pending, rejected, and inactive venues stay out of publishing. Manage the venue application and return after Peakle verifies it." C={C} /> : null}
    {tab === 'Programs' && venue ? <><Section eyebrow="RECURRING SESSIONS · CLINICS · COACHING" title="Programs" action={<ActionButton title="Create" onPress={() => navigation.navigate('CreateProgram', { ownerTab: 'More', venueId: venue.id })} C={C} />} C={C} />{programs.map((program) => { const registered = program.program_registrations?.filter((item) => ['registered', 'attended'].includes(item.status)).length || 0; return <View key={program.id} style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}><View style={s.row}><View style={[s.iconBox, { backgroundColor: C.optic }]}><Icon name="school-outline" color="#0E2321" /></View><View style={s.flex}><Text style={[s.cardTitle, { color: C.ink }]}>{program.name}</Text><Text style={[s.cardMeta, { color: C.ink40 }]}>{program.kind.replace('_', ' ')} · {program.skill_division} · {formatDate(program.starts_at)}</Text></View><Text style={[s.capacity, { color: C.teal }]}>{registered}/{program.capacity}</Text></View><Text style={[s.note, { color: C.ink70 }]}>{money(program.price)}{program.recurrence_rule ? ' · Repeats weekly' : ''}</Text></View>; })}{!programs.length ? <Empty icon="school-outline" title="No programs yet" detail="Publish clinics, coaching, camps, or recurring open play with capacity and skill division." C={C} /> : null}</> : null}
    {tab === 'Competition' && venue ? <><Section eyebrow="LEAGUES · LADDERS · SEASONS · BRACKETS" title="Competition" action={<ActionButton title="Create" onPress={() => navigation.navigate('CreateCompetition', { ownerTab: 'More', venueId: venue.id })} C={C} />} C={C} />{competitions.map((item) => <OrganizerCompetitionCard key={item.id} item={item} onManage={() => { setError(''); setManagedCompetitionId(item.id); }} C={C} />)}{!competitions.length ? <Empty icon="trophy-outline" title="No competition yet" detail="Open registration for a bracket, ladder, league, or season with live standings." C={C} /> : null}</> : null}
    {tab === 'Memberships' && venue ? <><Section eyebrow="PACKAGES · CREDITS · DISCOUNTS" title="Membership products" action={<ActionButton title="Create" onPress={() => navigation.navigate('CreateMembership', { ownerTab: 'More', venueId: venue.id })} C={C} />} C={C} />{products.map((item) => <OrganizerMembershipCard key={item.id} item={item} act={act} C={C} />)}{!products.length ? <Empty icon="card-outline" title="No memberships or packages" detail="Create venue memberships, court packs, session packs, credits, and discounts." C={C} /> : null}</> : null}
    {tab === 'Analytics' && venue ? canUseAnalytics ? <><Section eyebrow="LAST 30 DAYS" title="Venue performance" action={<ActionButton title={canExport ? 'Export CSV' : 'Export · Pro'} disabled={!canExport || !analytics} secondary icon={canExport ? 'download-outline' : 'lock-closed-outline'} onPress={exportAnalytics} C={C} />} C={C} />{analytics ? <><View style={s.metrics}><Metric value={analytics.bookings || 0} label="BOOKINGS" C={C} /><Metric value={money(analytics.grossRevenue)} label="REVENUE" C={C} /><Metric value={`${analytics.courtUtilization || 0}%`} label="UTILIZATION" C={C} /><Metric value={analytics.peakHour || '—'} label="PEAK HOUR" C={C} /><Metric value={analytics.uniquePlayers || 0} label="UNIQUE PLAYERS" C={C} /><Metric value={analytics.returningPlayers || 0} label="RETURNING PLAYERS" C={C} /><Metric value={`${analytics.cancellationRate || 0}%`} label="CANCELLATIONS" C={C} /><Metric value={analytics.openPlayAttendance || 0} label="OPEN PLAY VISITS" C={C} /></View><View style={[s.info, { backgroundColor: C.panel }]}><Icon name="analytics-outline" color={C.optic} /><View style={s.flex}><Text style={s.infoTitle}>Retention-ready reporting</Text><Text style={s.infoMeta}>{analytics.programRegistrations || 0} program registrations and {analytics.openPlaySessions || 0} open-play sessions in this reporting window. CSV export uses the same server-authorized totals.</Text></View></View></> : <ActivityIndicator style={s.analyticsLoader} color={C.teal} />}</> : <View style={[s.proGate, { backgroundColor: C.surface, borderColor: C.line }]}><View style={[s.proGateIcon, { backgroundColor: C.optic }]}><Icon name="analytics-outline" size={26} color="#0E2321" /></View><Text style={[s.emptyTitle, { color: C.ink }]}>Unlock venue insights</Text><Text style={[s.emptyDetail, { color: C.ink40 }]}>Organizer Pro adds revenue, utilization, retention, cancellations, attendance, and downloadable reports.</Text><ActionButton title="View Organizer Pro" icon="diamond-outline" onPress={() => navigation.navigate('Pass')} C={C} /></View> : null}
    {activeSheet && venue ? <CreateSheet key={`${activeSheet}-${venue.id}`} type={activeSheet} venue={venue} onClose={() => setSheet(null)} onCreate={create} C={C} /> : null}
    {busy || (loading && data) ? <View style={[s.busy, { backgroundColor: C.busy, borderColor: C.line }]}><ActivityIndicator color={C.teal} /></View> : null}
  </><PeakleLoadingOverlay visible={loading && !data} status="LOADING ORGANIZER ACTIVITIES" /></View>;
}

function OrganizerCreateActivityScreen({ navigation, route, type }) {
  const { isDark } = useTheme();
  const C = isDark ? DARK : LIGHT;
  const [venues, setVenues] = useState([]);
  const preferredVenueId = route?.params?.venueId || null;
  const [venueId, setVenueId] = useState(preferredVenueId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadVersionRef = useRef(0);
  const venue = venues.find((item) => item.id === venueId) || venues[0];
  const title = type === 'program' ? 'Create program' : type === 'competition' ? 'Create competition' : 'Create membership';

  const load = useCallback(async () => {
    const loadVersion = ++loadVersionRef.current;
    setLoading(true); setError('');
    try {
      const managed = verifiedPublishingVenues(await listManagedVenues());
      if (loadVersion !== loadVersionRef.current) return;
      setVenues(managed);
      setVenueId((current) => managed.some((item) => item.id === current) ? current : managed.some((item) => item.id === preferredVenueId) ? preferredVenueId : managed[0]?.id || null);
    } catch (loadError) {
      if (loadVersion !== loadVersionRef.current) return;
      setError(loadError.message || 'Your managed venues could not be loaded.');
    } finally {
      if (loadVersion === loadVersionRef.current) setLoading(false);
    }
  }, [preferredVenueId]);
  useFocusEffect(useCallback(() => {
    load();
    return () => { loadVersionRef.current += 1; };
  }, [load]));

  const create = async (form) => {
    if (!venue || busy) return;
    setBusy(true); setError('');
    try {
      if (type === 'program') {
        await createVenueProgram({ venueId: venue.id, name: form.name, kind: form.kind, skillDivision: form.skillDivision, startsAt: form.startsAt, endsAt: form.endsAt, capacity: form.capacity, price: form.price, description: form.description, recurringRule: form.weekly ? { frequency: 'weekly', interval: 1 } : null });
      } else if (type === 'competition') {
        await createCompetition({ venueId: venue.id, name: form.name, kind: form.kind, startsOn: form.startsOn, endsOn: form.endsOn, divisions: form.divisions, coverImage: form.coverImage, rules: 'Verified Peakle results determine division standings.' });
      } else {
        await createMembershipProduct({ venueId: venue.id, name: form.name, kind: form.kind, price: form.price, credits: form.credits, discountPercent: form.discountPercent, validityDays: form.validityDays, terms: form.terms });
      }
      Alert.alert('Published', `${form.name} is now available to players.`);
      navigation.goBack();
    } catch (createError) {
      const message = createError.message || `${title} could not be published.`;
      setError(message);
      Alert.alert('Couldn’t publish', message);
    } finally {
      setBusy(false);
    }
  };

  if (!venue) return <SafeAreaView style={[s.safe, { backgroundColor: C.paper }]}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><ScrollView contentContainerStyle={s.content}><BackHeader navigation={navigation} eyebrow="ORGANIZER SETUP" title={title} C={C} />{error ? <View style={[s.error, { backgroundColor: C.brickWash }]}><Icon name="alert-circle" color={C.brick} /><Text style={[s.errorText, { color: C.brick }]}>{error}</Text></View> : null}{!loading ? <Empty icon="shield-checkmark-outline" title="Venue verification required" detail="Only verified, active venues can publish. Pending or rejected venues remain available in venue management but are not shown here." C={C} /> : null}</ScrollView><PeakleLoadingOverlay visible={loading} status={`PREPARING ${type.toUpperCase()} SETUP`} /></SafeAreaView>;
  return <View style={s.fullScreenHost}><CreateSheet embedded key={type} type={type} venue={venue} venues={venues} onSelectVenue={setVenueId} onClose={() => !busy && navigation.goBack()} onCreate={create} C={C} busy={busy} externalError={error} /><PeakleLoadingOverlay visible={loading} status={`PREPARING ${type.toUpperCase()} SETUP`} /></View>;
}

export default function PickleballHubScreen({ navigation, route }) {
  const { isDark } = useTheme(); const C = isDark ? DARK : LIGHT;
  const initialTab = route?.params?.openTab || 'Ratings';
  const titles = { Ratings: 'Ratings & insights', 'Find play': 'Find play', Compete: 'Events & competition', Privacy: 'Privacy & matching' };
  const ownerByTab = { Ratings: 'Profile', 'Find play': 'Play', Compete: 'Book', Privacy: 'Profile' };
  return <SafeAreaView style={[s.safe, { backgroundColor: C.paper }]}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"><BackHeader navigation={navigation} eyebrow="YOUR GAME" title={titles[initialTab] || 'Ratings & insights'} C={C} /><PlayerHub C={C} navigation={navigation} initialTab={initialTab} onTabChange={(openTab) => navigation.setParams({ openTab, ownerTab: ownerByTab[openTab] })} /></ScrollView></SafeAreaView>;
}

export function OrganizerProgramsScreen(props) { return <PickleballHubScreen {...props} organizerSection="Programs" />; }
export function OrganizerCompetitionScreen(props) { return <PickleballHubScreen {...props} organizerSection="Competition" />; }
export function OrganizerMembershipsScreen(props) { return <PickleballHubScreen {...props} organizerSection="Memberships" />; }
export function OrganizerAnalyticsScreen(props) { return <PickleballHubScreen {...props} organizerSection="Analytics" />; }
export function OrganizerCreateProgramScreen(props) { return <OrganizerCreateActivityScreen {...props} type="program" />; }
export function OrganizerCreateCompetitionScreen(props) { return <OrganizerCreateActivityScreen {...props} type="competition" />; }
export function OrganizerCreateMembershipScreen(props) { return <OrganizerCreateActivityScreen {...props} type="membership" />; }

const s = createMobileStyleSheet({
  compactTimePicker: { marginTop: 18 },
  timeAdjustLabel: { marginBottom: 8, fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  timeAdjuster: { minHeight: 94, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 18, borderWidth: 1 },
  timeAdjustButton: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  timeAdjustValue: { minWidth: 0, flex: 1, alignItems: 'center' },
  timeAdjustValueText: { fontSize: 24, lineHeight: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  timeAdjustHint: { marginTop: 3, fontSize: 6, fontWeight: '900', letterSpacing: .45 },
  hourJumpRow: { marginTop: 9, flexDirection: 'row', gap: 8 },
  hourJumpButton: { minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1 },
  hourJumpText: { fontSize: 7, fontWeight: '900', letterSpacing: .45 },
  timeQuickLabel: { marginTop: 17, marginBottom: 8, fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  timeQuickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  timeQuickOption: { width: '31.5%', minHeight: 43, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 12, borderWidth: 1 },
  timeQuickText: { fontSize: 8, fontWeight: '900', fontVariant: ['tabular-nums'] },
  timeConfirmButton: { minHeight: 54, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14 },
  timeConfirmText: { fontSize: 11, fontWeight: '900' },
  timeCancelButton: { minHeight: 54, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1 },
  timeCancelText: { fontSize: 11, fontWeight: '900' },
  timePickerPressable: { paddingVertical: 0, justifyContent: 'center' },
  timePickerPressableText: { fontSize: 15, fontWeight: '500' },
  safe: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 52 }, fullScreenHost: { flex: 1, position: 'relative' }, playerHubHost: { position: 'relative' }, hubLoadingHost: { position: 'relative', minHeight: 620 }, playerLoadingCard: { minHeight: 116, marginTop: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18 }, playerLoadingIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, playerLoadingTitle: { fontSize: 13, lineHeight: 18, fontWeight: '900' }, playerLoadingDetail: { marginTop: 4, fontSize: 9, lineHeight: 14 }, fullScreenWizardSafe: { flex: 1 }, fullScreenWizard: { flex: 1, paddingHorizontal: 18, paddingTop: 14 }, fullScreenWizardScroll: { flex: 1 }, createVenueSection: { marginTop: 4 }, createVenueLabel: { marginTop: 8 }, createVenueField: { height: 76, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden', borderWidth: 1, borderRadius: 16 }, createVenueCourtPreview: { width: 76, height: 56, borderRadius: 11 }, createVenueName: { fontSize: 11, fontWeight: '900' }, createVenueMeta: { marginTop: 3, fontSize: 8, fontWeight: '700' }, createVenueChange: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, courtVenuePreview: { overflow: 'hidden' }, courtFallback: { width: '100%', height: '100%', padding: 6, alignItems: 'center', justifyContent: 'center' }, courtBoundary: { width: '100%', height: '100%', overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,.92)' }, courtCenterLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(255,255,255,.88)' }, courtKitchenLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,.88)' }, courtKitchenLineLeft: { left: '33%' }, courtKitchenLineRight: { right: '33%' }, courtNet: { position: 'absolute', top: '50%', left: 0, right: 0, height: 2, backgroundColor: '#D6E94A' }, venuePickerSheet: { maxHeight: '78%', paddingHorizontal: 18, paddingTop: 10, borderTopLeftRadius: 26, borderTopRightRadius: 26 }, venuePickerList: { marginTop: 13 }, venuePickerListContent: { paddingBottom: 4, gap: 7 }, venuePickerOption: { height: 88, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden', borderWidth: 1, borderRadius: 16 }, venuePickerCourtPreview: { width: 86, height: 66, borderRadius: 12 }, venuePickerOptionName: { fontSize: 11, fontWeight: '900' }, venuePickerOptionMeta: { marginTop: 3, fontSize: 8, fontWeight: '700' }, venuePickerCourtCount: { marginTop: 5, fontSize: 7, fontWeight: '900', letterSpacing: .4, textTransform: 'uppercase' }, venuePickerSelection: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, createRouteState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }, createRouteStateText: { fontSize: 10, fontWeight: '800' }, flex: { flex: 1, minWidth: 0 }, header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }, headerCopy: { flex: 1, minWidth: 0 }, back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 }, ball: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, ballImage: { width: 26, height: 26 }, eyebrow: { fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: .9 }, wizardEyebrow: { minHeight: 12 }, h1: { marginTop: 1, fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -.4 }, h2: { marginTop: 2, fontSize: 19, fontWeight: '900' }, solid: { height: 2, marginTop: 10 }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed' }, tabRow: { paddingTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, venueRow: { paddingTop: 15, gap: 7 }, pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, pill: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1 }, pillText: { fontSize: 10, fontWeight: '900', textTransform: 'capitalize' }, sectionHead: { marginTop: 23, marginBottom: 11, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }, action: { minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, borderWidth: 1 }, actionText: { fontSize: 10, fontWeight: '900' }, disabled: { opacity: .45 }, ratingGrid: { marginTop: 14, flexDirection: 'row', gap: 8 }, ratingCard: { flex: 1, padding: 14, borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 8 }, ratingLabel: { fontSize: 8, fontWeight: '900', letterSpacing: .7 }, ratingValue: { marginTop: 7, fontSize: 30, fontWeight: '900' }, ratingMeta: { marginTop: 3, fontSize: 9, fontWeight: '800' }, info: { marginTop: 12, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 16 }, infoTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' }, infoMeta: { marginTop: 4, color: '#B7C6C1', fontSize: 10, lineHeight: 15 }, card: { marginBottom: 9, padding: 14, borderWidth: 1, borderRadius: 17, borderBottomLeftRadius: 8 }, rowCard: { minHeight: 72, marginBottom: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 16 }, row: { flexDirection: 'row', alignItems: 'center', gap: 9 }, iconBox: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, cardTitle: { fontSize: 12, fontWeight: '900' }, cardMeta: { marginTop: 3, fontSize: 10, lineHeight: 15 }, note: { marginTop: 10, marginBottom: 8, fontSize: 11, lineHeight: 16 }, status: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 8 }, statusText: { fontSize: 8, fontWeight: '900' }, decision: { marginTop: 10, fontSize: 10, fontWeight: '900' }, inlineActions: { marginTop: 11, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }, empty: { minHeight: 145, padding: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderRadius: 17 }, emptyTitle: { marginTop: 9, fontSize: 13, fontWeight: '900' }, emptyDetail: { maxWidth: 280, marginTop: 5, textAlign: 'center', fontSize: 10, lineHeight: 15 }, loader: { marginTop: 80 }, analyticsLoader: { marginVertical: 48 }, error: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12 }, errorText: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: '800' }, retryButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, settingRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 8 }, fieldLabel: { marginTop: 16, marginBottom: 7, fontSize: 9, fontWeight: '900', letterSpacing: .7 }, standing: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 }, rank: { width: 25, fontSize: 10, fontWeight: '900' }, insightDimension: { width: 69, fontSize: 7, fontWeight: '900' }, standingName: { flex: 1, fontSize: 10, fontWeight: '800' }, standingPoints: { fontSize: 9, fontWeight: '900' }, tinyStatus: { fontSize: 8, fontWeight: '900' }, capacity: { fontSize: 13, fontWeight: '900' }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, metric: { width: '48%', minHeight: 94, padding: 13, justifyContent: 'center', borderWidth: 1, borderRadius: 17, borderBottomLeftRadius: 7 }, metricValue: { fontSize: 22, fontWeight: '900' }, metricLabel: { marginTop: 4, fontSize: 8, fontWeight: '900', letterSpacing: .6 }, proGate: { marginTop: 22, padding: 22, alignItems: 'center', borderWidth: 1, borderRadius: 20 }, proGateIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 17 }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.54)' }, sheet: { maxHeight: '92%', paddingHorizontal: 18, paddingTop: 9, borderTopLeftRadius: 26, borderTopRightRadius: 26 }, createSheetScroll: { flexShrink: 1 }, createSheetContent: { paddingBottom: 6 }, requestSheet: { maxHeight: '94%', paddingHorizontal: 18, paddingTop: 9, borderTopLeftRadius: 26, borderTopRightRadius: 26 }, requestSheetScroll: { flexShrink: 1 }, requestSheetContent: { paddingBottom: 2 }, modalChoiceLabel: { marginTop: 16, marginBottom: 7, fontSize: 9, fontWeight: '900', letterSpacing: .7 }, modalTypeSwitcher: { padding: 4, flexDirection: 'row', gap: 4, borderWidth: 1, borderRadius: 14 }, modalTypeChoice: { minHeight: 44, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderRadius: 10 }, modalTypeText: { fontSize: 8, fontWeight: '900', textTransform: 'capitalize' }, requestDateList: { gap: 7, paddingRight: 4, gap: 7 }, requestDate: { minWidth: 82, minHeight: 56, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 13 }, requestDateDay: { fontSize: 8, fontWeight: '900', textTransform: 'uppercase' }, requestDateValue: { marginTop: 3, fontSize: 10, fontWeight: '900' }, requestFieldRow: { flexDirection: 'row', gap: 8 }, requestField: { flex: 1, minWidth: 0 }, requestTimeHelp: { marginTop: 6, fontSize: 9, lineHeight: 13 }, requestNoteInput: { minHeight: 64, paddingTop: 12, textAlignVertical: 'top' }, requestFormError: { marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderRadius: 12 }, requestFormErrorText: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: '800' }, requestWarning: { marginTop: 16, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 15 }, requestWarningText: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: '800' }, sheetActions: { marginTop: 17, flexDirection: 'row', gap: 8 }, sheetCancel: { minHeight: 53, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 14 }, sheetCancelText: { fontSize: 11, fontWeight: '900' }, sheetConfirm: { minHeight: 53, flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14 }, sheetConfirmText: { fontSize: 11, fontWeight: '900' }, input: { minHeight: 50, paddingHorizontal: 12, borderWidth: 1, borderRadius: 13, fontSize: 12, fontWeight: '800' }, busy: { position: 'absolute', top: 120, right: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.9)' },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  sheetSubtitle: { marginTop: 9, fontSize: 10, lineHeight: 15 },
  offerBuy: { minHeight: 40, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 11 },
  offerBuyText: { color: '#0E2321', fontSize: 8, fontWeight: '900', letterSpacing: .4 },
  checkoutSafe: { flex: 1 },
  checkoutHeader: { minHeight: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  checkoutEyebrow: { fontSize: 7, fontWeight: '900', letterSpacing: .7 },
  checkoutTitle: { marginTop: 2, fontSize: 16, fontWeight: '900' },
  checkoutWebview: { flex: 1 },
  checkoutMethods: { flex: 1, padding: 18 },
  checkoutAmount: { marginTop: 8, fontSize: 30, fontWeight: '900' },
  checkoutHelp: { maxWidth: 360, marginTop: 7, textAlign: 'center', fontSize: 10, lineHeight: 16 },
  checkoutCenter: { flex: 1, minHeight: 160, padding: 24, alignItems: 'center', justifyContent: 'center' },
  checkoutVerifyIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  checkoutVerifyTitle: { marginTop: 16, fontSize: 19, fontWeight: '900' },
  paymentMethod: { minHeight: 68, marginTop: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 15 },
  paymentMethodIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  paymentMethodTitle: { fontSize: 11, fontWeight: '900' },
  paymentMethodDetail: { marginTop: 3, fontSize: 8, lineHeight: 12 },
  courtServiceCenterLeft: { position: 'absolute', top: '50%', left: 0, width: '33%', height: 1, backgroundColor: 'rgba(255,255,255,.88)' },
  courtServiceCenterRight: { position: 'absolute', top: '50%', right: 0, width: '33%', height: 1, backgroundColor: 'rgba(255,255,255,.88)' },
  courtNetVertical: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, backgroundColor: '#D6E94A' },
  bracket: { minHeight: 40, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10 }, bracketRound: { width: 36, fontSize: 8, fontWeight: '900' }, bracketTeams: { flex: 1, fontSize: 10, fontWeight: '800' },
  competitionDivisionList: { marginTop: 12, gap: 9 },
  competitionCover: { height: 148, marginBottom: 12, borderRadius: 13 },
  competitionCoverPicker: { marginTop: 12 },
  competitionDivision: { padding: 12, borderWidth: 1, borderRadius: 14, borderBottomLeftRadius: 7 },
  manageCompetitionCard: { minHeight: 118, justifyContent: 'space-between' },
  cardPressed: { opacity: .78 },
  manageCompetitionFooter: { marginTop: 16, paddingTop: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1 },
  manageCompetitionCount: { flex: 1, fontSize: 10, fontWeight: '900' },
  pendingCount: { fontSize: 8, fontWeight: '900' },
  competitionWorkspaceHeader: { marginTop: 17, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10 },
  workspaceTitle: { marginTop: 2, fontSize: 18, fontWeight: '900' },
  workspaceTabs: { paddingTop: 14, paddingRight: 4, gap: 7 },
  divisionFilter: { paddingTop: 10, paddingBottom: 15, paddingRight: 4, gap: 7 },
  workspacePrimaryAction: { marginTop: 15, marginBottom: 10, flexDirection: 'row', justifyContent: 'flex-end' },
  entryRow: { minHeight: 70, marginBottom: 7, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 15 },
  entryAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  entryAvatarText: { fontSize: 10, fontWeight: '900' },
  matchCard: { marginBottom: 8, padding: 12, borderWidth: 1, borderRadius: 16, borderBottomLeftRadius: 7 },
  bracketRoundLabel: { flex: 1, fontSize: 8, fontWeight: '900', letterSpacing: .5 },
  matchSides: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8 },
  matchSideName: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '900' },
  matchScore: { minWidth: 42, textAlign: 'center', fontSize: 15, fontWeight: '900' },
  matchTime: { flex: 1, fontSize: 9, fontWeight: '800' },
  scoreMatchup: { minHeight: 76, marginTop: 15, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 16 },
  scoreEntryName: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '900' },
  scoreVersus: { fontSize: 8, fontWeight: '900' },
  scoreInputs: { marginTop: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  scoreInput: { width: 92, minHeight: 72, textAlign: 'center', borderWidth: 1, borderRadius: 16, fontSize: 26, fontWeight: '900' },
  scoreDash: { fontSize: 22, fontWeight: '900' },
  standingsTable: { marginTop: 15, paddingHorizontal: 12, borderWidth: 1, borderRadius: 17, overflow: 'hidden' },
  standingHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  standingRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  standingRecord: { width: 46, textAlign: 'center', fontSize: 9, fontWeight: '800' },
  divisionName: { fontSize: 11, fontWeight: '900' },
  divisionFee: { marginTop: 7, marginBottom: 2, fontSize: 9, fontWeight: '800' },
  eligibilityNote: { marginTop: 9, fontSize: 8, lineHeight: 12 },
  divisionsHeading: { marginTop: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  divisionsHelp: { fontSize: 9, lineHeight: 13 },
  divisionEditor: { marginTop: 10, padding: 13, borderWidth: 1, borderRadius: 17, borderBottomLeftRadius: 8 },
  divisionEditorHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 },
  divisionNumber: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#D6E94A' },
  divisionNumberText: { color: '#0E2321', fontSize: 12, fontWeight: '900' },
  divisionRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  divisionReviewNote: { marginTop: 13, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderRadius: 12 },
  divisionReviewText: { flex: 1, fontSize: 8, lineHeight: 12, fontWeight: '700' },
  eligibilityReview: { minHeight: 58, marginTop: 8, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1 },
  eligibilityReviewName: { fontSize: 10, fontWeight: '900' },
  reviewIconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  wizardProgress: { height: 4, marginTop: 11, flexDirection: 'row', gap: 5 },
  wizardProgressSegment: { flex: 1, borderRadius: 2 },
  wizardContent: { paddingBottom: 14 },
  wizardIntro: { marginTop: 15, fontSize: 11, lineHeight: 16 },
  wizardActions: { paddingTop: 12, flexDirection: 'row', gap: 8 },
  wizardBack: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 14 },
  wizardBackText: { fontSize: 10, fontWeight: '900' },
  wizardNext: { minHeight: 52, flex: 1, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14 },
  wizardNextText: { color: '#0E2321', fontSize: 11, fontWeight: '900' },
  setupChoiceList: { marginTop: 2, gap: 7 },
  setupChoice: { minHeight: 72, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 15, borderBottomLeftRadius: 7 },
  setupChoiceIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  setupChoiceTitle: { fontSize: 10, fontWeight: '900', textTransform: 'capitalize' },
  setupChoiceMeta: { marginTop: 3, fontSize: 8, lineHeight: 12 },
  multilineInput: { minHeight: 82, paddingTop: 12, textAlignVertical: 'top' },
  settingCard: { minHeight: 76, marginTop: 16, paddingHorizontal: 12, borderWidth: 1, borderRadius: 15 },
  reviewDetailList: { marginTop: 8, gap: 7 },
  reviewDetailRow: { minHeight: 65, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 14 },
  reviewDetailIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  reviewDetailLabel: { fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  reviewDetailValue: { marginTop: 3, fontSize: 9, lineHeight: 13, fontWeight: '800' },
  quickSetup: { marginTop: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 15 },
  quickSetupIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  quickSetupTitle: { fontSize: 11, fontWeight: '900' },
  quickSetupHelp: { marginTop: 3, fontSize: 8, lineHeight: 12 },
  templateActions: { marginTop: 8, flexDirection: 'row', gap: 7 },
  templateButton: { minHeight: 48, flex: 1, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 13 },
  templateButtonText: { fontSize: 8, fontWeight: '900' },
  divisionSwitcherHead: { marginTop: 15, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  smallAddButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  divisionTabs: { paddingTop: 8, paddingRight: 4, gap: 7 },
  divisionTab: { width: 142, minHeight: 48, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 13 },
  divisionTabIndex: { fontSize: 9, fontWeight: '900' },
  divisionTabText: { flex: 1, fontSize: 8, fontWeight: '900' },
  duplicateButton: { minHeight: 45, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 13 },
  duplicateButtonText: { fontSize: 9, fontWeight: '900' },
  reviewEventCard: { marginTop: 15, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderBottomLeftRadius: 8 },
  reviewEventIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  reviewEventEyebrow: { color: '#B7C6C1', fontSize: 7, fontWeight: '900', letterSpacing: .7 },
  reviewEventTitle: { marginTop: 2, color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  reviewEventMeta: { marginTop: 4, color: '#B7C6C1', fontSize: 8, fontWeight: '700' },
  reviewEdit: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  reviewSummaryRow: { minHeight: 79, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  reviewSummaryValue: { textAlign: 'center', fontSize: 22, fontWeight: '900' },
  reviewSummaryLabel: { marginTop: 2, textAlign: 'center', fontSize: 7, fontWeight: '900', letterSpacing: .7 },
  reviewSummaryDivider: { width: 1, height: 38 },
  reviewHeading: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  reviewEditDivisions: { minHeight: 39, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderRadius: 11 },
  reviewEditText: { fontSize: 8, fontWeight: '900' },
  reviewDivisionList: { marginTop: 8, gap: 7 },
  reviewDivisionRow: { minHeight: 62, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 14 },
  reviewDivisionIndex: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  reviewDivisionIndexText: { fontSize: 10, fontWeight: '900' },
  publishNotice: { marginTop: 11, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14 },
  publishNoticeTitle: { fontSize: 10, fontWeight: '900' },
  publishNoticeText: { marginTop: 3, fontSize: 8, lineHeight: 12 },
  requestControls: { marginTop: 10, overflow: 'hidden', borderWidth: 1, borderRadius: 19, borderBottomLeftRadius: 8 }, requestControlsHead: { minHeight: 72, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, requestControlsIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, requestControlsTitle: { fontSize: 11, fontWeight: '900' }, requestControlsMeta: { marginTop: 3, fontSize: 7.5, lineHeight: 11 }, requestOnPill: { minHeight: 25, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, requestOnText: { fontSize: 6, fontWeight: '900' }, requestToggleList: { paddingHorizontal: 13 }, requestToggleRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 10 }, requestToggleIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, requestToggleTitle: { fontSize: 10, fontWeight: '900', textTransform: 'capitalize' }, requestToggleMeta: { marginTop: 3, fontSize: 7, lineHeight: 11 }, requestCreate: { minHeight: 70, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderBottomLeftRadius: 8 }, requestCreateIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, requestCreateTitle: { color: '#0E2321', fontSize: 11, fontWeight: '900' }, requestCreateMeta: { marginTop: 3, color: '#3C4A45', fontSize: 7.5, lineHeight: 11 }, requestClear: { minHeight: 42, marginTop: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 13 }, requestClearText: { fontSize: 8, fontWeight: '900' }, requestResultsHead: { minHeight: 43, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, requestListLabel: { fontSize: 7, fontWeight: '900', letterSpacing: .7 }, requestResultsCount: { fontSize: 6.5, fontWeight: '900', letterSpacing: .4 },
  privacySummary: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18 }, privacyShield: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, matchingRow: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 10 }, privacyTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }, privacyChoiceTitle: { flexShrink: 1, fontSize: 11, fontWeight: '900' }, privacyChoiceDetail: { marginTop: 4, fontSize: 8, lineHeight: 13 }, privacyIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, matchingState: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 }, matchingStateText: { fontSize: 6, fontWeight: '900', letterSpacing: .5 }, privacySectionTitle: { marginTop: 22, fontSize: 14, fontWeight: '900' }, privacySectionHelp: { marginTop: 4, fontSize: 9, lineHeight: 14 }, privacyChoices: { marginTop: 10, gap: 7 }, privacyChoice: { minHeight: 75, paddingHorizontal: 11, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 15 }, privacyDisabled: { opacity: .42 }, recommended: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 }, recommendedText: { fontSize: 5.5, fontWeight: '900', letterSpacing: .45 }, privacySaveState: { minHeight: 42, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, privacySaveText: { fontSize: 8, fontWeight: '800' },
});
