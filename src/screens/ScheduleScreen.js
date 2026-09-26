import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView as HorizontalScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import Modal from '../components/ResponsiveModal';
import AppIcon from '../components/AppIcon';
import ProfilePhoto from '../components/ProfilePhoto';
import ScrollView from '../components/FocusResetScrollView';
import CourtPickerSheet from '../components/CourtPickerSheet';
import ScheduleCalendar from '../components/ScheduleCalendar';
import { HeaderAvatar } from '../components/AccountMenu';
import { SCHEDULE_ACTIVITY_TYPES as KINDS } from '../config/scheduleTypes';
import useDesktopLayout from '../hooks/useDesktopLayout';
import { webDialog, webLayout } from '../utils/webLayout';
import { useAuth } from '../context/AuthContext';
import { useUserLocation } from '../context/LocationContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { searchRegisteredPlayers } from '../services/nearbyPlayers';
import { listFollowingPlayers, listPrivateConnections, sendTextToPlayers } from '../services/directMessages';
import { copyText } from '../components/MessageFocusModal';
import { areaFromLocationLabel, courtLabel, loadRecentCourts, rememberCourt } from '../services/playCourts';
import {
  cancelScheduledGame, clockFromMinutes, createScheduledActivity, dateFromDayKey, dayKey, DURATION_STEP_MINUTES, earliestStartMinutes, entriesByDay, formatDayLabel, formatDuration, formatTime, GAME_DURATIONS,
  MAX_GAME_MINUTES, MIN_GAME_MINUTES, maskClockInput, parseClockInput, parseHoursInput,
  getScheduledGameShareUrl, googleCalendarUrl, inviteToScheduledGame, isOnMyCalendar, openScheduledGameLink, scheduledGameShareMessage, setScheduledGameVisibility, isPlayerScheduledEntry, listScheduledGames, listScheduleEvents, monthGrid, playSetupFromGame, respondToScheduledGame, shiftDayKey, shiftMonthKey,
} from '../services/schedule';

const kindColor = (kind, isDark) => (KINDS[kind] || KINDS.game)[isDark ? 'darkColor' : 'color'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const START_WINDOW_MS = 60 * 60000;
const VISIBILITY_OPTIONS = [{ value: 'open', label: 'Public' }, { value: 'invite', label: 'Private' }];
const VISIBILITY_HELP = {
  open: 'Public: anyone on Peakle can find it in Discover and take an open spot.',
  invite: 'Private: only players you invite or send the link to can join.',
};
// The server allows 6 messages per 10 seconds per sender.
const MAX_CHAT_SHARES = 6;

function usePalette() {
  const { isDark } = useTheme();
  return { isDark, styles: isDark ? darkStyles : lightStyles, palette: isDark ? DARK_CONTENT_COLORS : LIGHT_CONTENT_COLORS };
}

function Segmented({ options, value, onChange, styles, accessibilityLabel }) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return <Pressable key={option.value} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected }} aria-selected={selected} onPress={() => onChange(option.value)} style={({ pressed }) => [styles.segment, selected && styles.segmentActive, pressed && styles.pressed]}><Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{option.label}</Text></Pressable>;
      })}
    </View>
  );
}

function DayMarkers({ kinds }) {
  const { isDark } = useTheme();
  if (!kinds?.length) return <View style={markerStyles.row} />;
  return <View style={markerStyles.row}>{[...new Set(kinds)].slice(0, 3).map((kind) => <View key={kind} style={[markerStyles.dot, { backgroundColor: kindColor(kind, isDark) }]} />)}</View>;
}

function MonthCalendar({ monthKey, selectedKey, todayKey, markers, onSelect, onMonth, minKey = null }) {
  const { styles, palette } = usePalette();
  const days = useMemo(() => monthGrid(monthKey), [monthKey]);
  const title = dateFromDayKey(`${monthKey}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
  return (
    <View style={styles.calendar}>
      <View style={styles.calendarHead}>
        <Text accessibilityRole="header" style={styles.calendarTitle}>{title}</Text>
        <View style={styles.calendarNav}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => onMonth(-1)} style={({ pressed }) => [styles.calendarNavButton, pressed && styles.pressed]}><AppIcon name="chevron-back" size={17} color={palette.ink} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => onMonth(1)} style={({ pressed }) => [styles.calendarNavButton, pressed && styles.pressed]}><AppIcon name="chevron-forward" size={17} color={palette.ink} /></Pressable>
        </View>
      </View>
      <View style={styles.weekdayRow}>{WEEKDAYS.map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View>
      <View style={styles.dayGrid}>
        {Array.from({ length: days.length / 7 }, (_, week) => (
          <View key={days[week * 7]} style={styles.dayWeekRow}>
            {days.slice(week * 7, week * 7 + 7).map((key) => {
              const inMonth = key.startsWith(monthKey);
              const selected = key === selectedKey;
              const today = key === todayKey;
              const disabled = Boolean(minKey && key < minKey);
              const hasItems = Boolean(markers[key]?.length);
              return (
                <Pressable key={key} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected, disabled }} accessibilityLabel={`${formatDayLabel(key)}${hasItems ? `, ${markers[key].length} scheduled` : ''}`} onPress={() => onSelect(key)} style={styles.dayCell}>
                  {({ pressed }) => (
                    <View style={[styles.day, hasItems && !selected && styles.dayBusy, selected && styles.daySelected, pressed && !selected && styles.dayPressed]}>
                      <Text style={[styles.dayText, !inMonth && styles.dayTextMuted, disabled && styles.dayTextDisabled, today && !selected && styles.dayTextToday, selected && styles.dayTextSelected]}>{Number(key.slice(8))}</Text>
                      <DayMarkers kinds={markers[key]} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function EntryCard({ entry, onPress, past }) {
  const { isDark, styles, palette } = usePalette();
  const kind = { ...(KINDS[entry.kind] || KINDS.game), color: kindColor(entry.kind, isDark) };
  const cancelled = entry.status === 'cancelled';
  const scheduled = isPlayerScheduledEntry(entry);
  const badge = scheduled
    ? cancelled ? 'Cancelled' : entry.isHost ? 'Hosting' : entry.myStatus === 'invited' ? 'Invited' : entry.myStatus === 'going' ? 'Going' : entry.spotsLeft ? `${entry.spotsLeft} open` : 'Full'
    : entry.joined ? 'Registered' : entry.availability;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${kind.label}: ${entry.title}, ${formatTime(entry.startsAt)}`} onPress={onPress} style={({ pressed }) => [styles.entry, (past || cancelled) && styles.entryMuted, pressed && styles.pressed]}>
      <View style={styles.entryTitleRow}>
        <View style={styles.entryTime}><View style={[styles.legendDot, { backgroundColor: kind.color, borderColor: kind.color }]} /><Text style={styles.entryTimeStart}>{entry.kind === 'competition' && !scheduled ? 'All day' : `${formatTime(entry.startsAt)} – ${formatTime(entry.endsAt)}`}</Text></View>
        {badge ? <View style={[styles.badge, entry.myStatus === 'invited' && styles.badgeAttention]}><Text style={[styles.badgeText, entry.myStatus === 'invited' && styles.badgeTextAttention]}>{badge}</Text></View> : null}
      </View>
      <View style={styles.entryBody}>
        <Text numberOfLines={2} style={[styles.entryTitle, cancelled && styles.strike]}>{entry.title}</Text>
        <View style={styles.entryMeta}><AppIcon name="location-outline" size={13} color={palette.ink40} /><Text numberOfLines={1} style={styles.entryMetaText}>{[entry.place, entry.area].filter(Boolean).join(' · ')}</Text></View>
        <View style={styles.entryFoot}>
          <View style={styles.kindTag}><AppIcon name={kind.icon} size={12} color={kind.color} /><Text style={[styles.kindTagText, { color: kind.color }]}>{entry.kind === 'game' ? `${entry.matchType === 'singles' ? 'Singles' : 'Doubles'} · ${entry.mode === 'ranked' ? 'Ranked' : 'Casual'}` : entry.typeLabel || kind.label}</Text></View>
          {scheduled && entry.going?.length ? <View style={styles.avatarStack}>{entry.going.slice(0, 4).map((player, index) => <View key={player.id} style={[styles.avatarRing, index > 0 && styles.avatarOverlap]}><ProfilePhoto photo={player.avatar} name={player.name} size={22} /></View>)}</View> : null}
        </View>
      </View>
    </Pressable>
  );
}

function EntrySheet({ entry, onClose, onChanged, onStart, onOpenEvent }) {
  const { styles, palette } = usePalette();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => { setError(''); setConfirmCancel(false); setBusy(''); }, [entry?.id]);
  if (!entry) return null;
  const kind = KINDS[entry.kind] || KINDS.game;
  const now = Date.now();
  const startsAt = new Date(entry.startsAt).getTime();
  const endsAt = new Date(entry.endsAt).getTime();
  const ended = endsAt < now;
  const cancelled = entry.status === 'cancelled';
  const game = isPlayerScheduledEntry(entry) ? entry : null;
  const activityName = entry.kind === 'game' ? 'game' : 'activity';
  const canStart = game?.kind === 'game' && !cancelled && game.myStatus === 'going' && now >= startsAt - START_WINDOW_MS && !ended;
  const run = async (name, action) => {
    setBusy(name);
    setError('');
    try {
      await action();
      onChanged();
    } catch (actionError) {
      setError(actionError.message || 'Something went wrong. Try again.');
    } finally {
      setBusy('');
    }
  };
  const when = `${formatDayLabel(dayKey(entry.startsAt), { weekday: 'long', month: 'long', day: 'numeric' })} · ${entry.kind === 'competition' && !game ? 'All day' : `${formatTime(entry.startsAt)} – ${formatTime(entry.endsAt)}`}`;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable {...webDialog('backdrop')} accessibilityLabel="Close details" style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={onClose}>
        <Pressable {...webDialog('surface')} accessibilityRole="dialog" style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View {...webDialog('handle')} style={styles.handle} />
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHead}>
              <View style={[styles.kindIcon, { backgroundColor: kind.color }]}><AppIcon name={kind.icon} size={20} color="#FFFFFF" /></View>
              <View style={styles.flex}><Text style={styles.eyebrow}>{(entry.typeLabel || kind.label).toUpperCase()}{cancelled ? ' · CANCELLED' : ''}</Text><Text style={styles.sheetTitle}>{entry.title}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}><AppIcon name="close" size={20} color={palette.ink} /></Pressable>
            </View>
            <View style={styles.factList}>
              <View style={styles.fact}><AppIcon name="calendar-outline" size={17} color={palette.teal} /><Text style={styles.factText}>{when}</Text></View>
              <View style={styles.fact}><AppIcon name="location-outline" size={17} color={palette.teal} /><Text style={styles.factText}>{[entry.place, entry.area].filter(Boolean).join(' · ')}</Text></View>
              {game ? <View style={styles.fact}><AppIcon name={kind.icon} size={17} color={palette.teal} /><Text style={styles.factText}>{game.kind === 'game' ? `${game.matchType === 'singles' ? 'Singles' : 'Doubles'} · ${game.mode === 'ranked' ? 'Ranked' : 'Casual'}` : kind.name} · {game.visibility === 'open' ? 'Public' : 'Private'}</Text></View> : null}
              {game?.notes ? <View style={styles.fact}><AppIcon name="document-text-outline" size={17} color={palette.teal} /><Text style={styles.factText}>{game.notes}</Text></View> : null}
            </View>
            {game ? <>
              <Text style={styles.groupLabel}>PLAYERS · {game.going.length}/{game.capacity}</Text>
              {game.roster.filter((player) => player.status !== 'declined').map((player) => <View key={player.id} style={styles.rosterRow}><ProfilePhoto photo={player.avatar} name={player.name} size={32} /><Text numberOfLines={1} style={styles.rosterName}>{player.name}{player.id === game.hostId ? ' · Host' : ''}</Text><Text style={[styles.rosterStatus, player.status === 'going' && styles.rosterGoing]}>{player.status === 'going' ? 'Going' : 'Invited'}</Text></View>)}
              {Array.from({ length: game.spotsLeft }, (_, index) => <View key={`open-${index}`} style={styles.rosterRow}><View style={styles.openSeat}><AppIcon name="add" size={15} color={palette.ink40} /></View><Text style={styles.rosterOpen}>Open spot</Text></View>)}
            </> : null}
            {game && !cancelled && !ended && (game.isHost || game.visibility === 'open') ? <ShareActivityPanel game={game} onChanged={onChanged} /> : null}
            {error ? <View style={styles.errorBox}><AppIcon name="alert-circle-outline" size={17} color={palette.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
            <View style={styles.sheetActions}>
              {game && !cancelled && !ended ? <>
                {game.kind === 'game' && (game.isHost || game.myStatus === 'going') ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canStart }} disabled={!canStart} onPress={() => onStart(game)} style={({ pressed }) => [styles.primary, !canStart && styles.disabled, pressed && styles.pressed]}><AppIcon name="play" size={16} color="#0E2321" /><Text style={styles.primaryText}>{canStart ? 'Start match' : 'Start opens 1 hour before'}</Text></Pressable> : null}
                {!game.isHost && game.myStatus === 'invited' ? <View style={styles.actionRow}>
                  <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => run('yes', () => respondToScheduledGame(game.sourceId, true))} style={({ pressed }) => [styles.primary, styles.flex, pressed && styles.pressed]}>{busy === 'yes' ? <ActivityIndicator color="#0E2321" /> : <><AppIcon name="checkmark" size={16} color="#0E2321" /><Text style={styles.primaryText}>I’m going</Text></>}</Pressable>
                  <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => run('no', () => respondToScheduledGame(game.sourceId, false))} style={({ pressed }) => [styles.secondary, styles.flex, pressed && styles.pressed]}>{busy === 'no' ? <ActivityIndicator color={palette.teal} /> : <Text style={styles.secondaryText}>Can’t make it</Text>}</Pressable>
                </View> : null}
                {!game.isHost && !game.myStatus && game.visibility === 'open' ? <Pressable accessibilityRole="button" disabled={Boolean(busy) || !game.spotsLeft} onPress={() => run('join', () => respondToScheduledGame(game.sourceId, true))} style={({ pressed }) => [styles.primary, !game.spotsLeft && styles.disabled, pressed && styles.pressed]}>{busy === 'join' ? <ActivityIndicator color="#0E2321" /> : <><AppIcon name="add" size={16} color="#0E2321" /><Text style={styles.primaryText}>{game.spotsLeft ? `Join ${activityName}` : 'No spots left'}</Text></>}</Pressable> : null}
                {!game.isHost && (game.myStatus === 'going' || game.myStatus === 'declined') ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => run('toggle', () => respondToScheduledGame(game.sourceId, game.myStatus !== 'going'))} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>{busy === 'toggle' ? <ActivityIndicator color={palette.teal} /> : <Text style={styles.secondaryText}>{game.myStatus === 'going' ? 'I can’t make it anymore' : 'I can make it after all'}</Text>}</Pressable> : null}
              </> : null}
              {!game ? <Pressable accessibilityRole="button" onPress={() => onOpenEvent(entry)} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}><AppIcon name="open-outline" size={16} color="#0E2321" /><Text style={styles.primaryText}>{entry.joined ? 'View your registration' : 'View event'}</Text></Pressable> : null}
              {!cancelled && !ended ? <Pressable accessibilityRole="link" onPress={() => Linking.openURL(googleCalendarUrl(entry))} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}><AppIcon name="calendar-outline" size={16} color={palette.teal} /><Text style={styles.secondaryText}>Add to Google Calendar</Text></Pressable> : null}
              {game?.isHost && !cancelled && !ended ? (confirmCancel
                ? <View style={styles.confirmBox}><Text style={styles.confirmText}>Cancel this {activityName} for everyone? Players will be notified.</Text><View style={styles.actionRow}><Pressable accessibilityRole="button" onPress={() => setConfirmCancel(false)} style={({ pressed }) => [styles.secondary, styles.flex, pressed && styles.pressed]}><Text style={styles.secondaryText}>Keep {activityName}</Text></Pressable><Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => run('cancel', () => cancelScheduledGame(game.sourceId))} style={({ pressed }) => [styles.destructive, styles.flex, pressed && styles.pressed]}>{busy === 'cancel' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.destructiveText}>Cancel {activityName}</Text>}</Pressable></View></View>
                : <Pressable accessibilityRole="button" onPress={() => setConfirmCancel(true)} style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}><Text style={styles.textButtonDanger}>Cancel {activityName}</Text></Pressable>) : null}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PlayerInvitePicker({ selected, onChange, max, userId, excludeIds = [] }) {
  const { styles, palette } = usePalette();
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState([]);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => { listFollowingPlayers().then(setFollowing).catch(() => setFollowing([])); }, []);
  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) { setResults([]); return undefined; }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchRegisteredPlayers(clean).then((rows) => { if (active) setResults(rows); }).catch(() => { if (active) setResults([]); }).finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  const needle = query.trim().toLocaleLowerCase();
  const candidates = (needle.length >= 2 ? results : following.filter((player) => !needle || player.name.toLocaleLowerCase().includes(needle)))
    .filter((player) => player.id && player.id !== userId && !excludeIds.includes(player.id))
    .slice(0, 8);
  const selectedIds = new Set(selected.map((player) => player.id));
  const full = selected.length >= max;
  const toggle = (player) => onChange(selectedIds.has(player.id) ? selected.filter((item) => item.id !== player.id) : full ? selected : [...selected, { id: player.id, name: player.name, avatar: player.avatar || null }]);
  return (
    <View>
      {selected.length ? <View style={styles.chipRow}>{selected.map((player) => <Pressable key={player.id} accessibilityRole="button" accessibilityLabel={`Remove ${player.name}`} onPress={() => toggle(player)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}><ProfilePhoto photo={player.avatar} name={player.name} size={20} /><Text numberOfLines={1} style={styles.chipText}>{player.name}</Text><AppIcon name="close" size={13} color={palette.ink40} /></Pressable>)}</View> : null}
      <View style={styles.search}><AppIcon name="search-outline" size={17} color={palette.ink40} /><TextInput value={query} onChangeText={setQuery} placeholder="Search players by name" placeholderTextColor={palette.ink40} style={styles.searchInput} />{searching ? <ActivityIndicator size="small" color={palette.teal} /> : null}</View>
      <Text style={styles.helperText}>{full ? (max ? `That fills the last ${max === 1 ? 'spot' : `${max} spots`}.` : 'No spots left to invite.') : needle.length >= 2 ? 'Search results' : following.length ? 'People you follow' : 'Search for any Peakle player'}</Text>
      {candidates.map((player) => {
        const active = selectedIds.has(player.id);
        return <Pressable key={player.id} accessibilityRole="button" accessibilityState={{ selected: active, disabled: full && !active }} disabled={full && !active} onPress={() => toggle(player)} style={({ pressed }) => [styles.rosterRow, styles.pickRow, active && styles.pickRowActive, full && !active && styles.disabled, pressed && styles.pressed]}><ProfilePhoto photo={player.avatar} name={player.name} size={32} /><View style={styles.flex}><Text numberOfLines={1} style={styles.rosterName}>{player.name}</Text>{player.area ? <Text numberOfLines={1} style={styles.helperInline}>{player.area}</Text> : null}</View><AppIcon name={active ? 'checkmark-circle' : 'add-circle-outline'} size={21} color={active ? palette.teal : palette.ink40} /></Pressable>;
      })}
    </View>
  );
}

// Mutual follows the player can message, with a quick filter.
function ChatSharePicker({ selected, onChange }) {
  const { styles, palette } = usePalette();
  const [query, setQuery] = useState('');
  const [connections, setConnections] = useState(null);
  useEffect(() => { listPrivateConnections().then(setConnections).catch(() => setConnections([])); }, []);
  const needle = query.trim().toLocaleLowerCase();
  const candidates = (connections || []).filter((player) => !needle || player.name.toLocaleLowerCase().includes(needle)).slice(0, 12);
  const selectedIds = new Set(selected.map((player) => player.id));
  const full = selected.length >= MAX_CHAT_SHARES;
  const toggle = (player) => onChange(selectedIds.has(player.id) ? selected.filter((item) => item.id !== player.id) : full ? selected : [...selected, player]);
  if (connections === null) return <View style={styles.loadingBox}><ActivityIndicator color={palette.teal} /></View>;
  if (!connections.length) return <Text style={styles.helperText}>Follow players who follow you back to send them activities in chat.</Text>;
  return (
    <View>
      <View style={styles.search}><AppIcon name="search-outline" size={17} color={palette.ink40} /><TextInput value={query} onChangeText={setQuery} placeholder="Search your chats" placeholderTextColor={palette.ink40} style={styles.searchInput} /></View>
      <Text style={styles.helperText}>{full ? `Send to up to ${MAX_CHAT_SHARES} players at a time.` : 'Friends you can message'}</Text>
      {candidates.map((player) => {
        const active = selectedIds.has(player.id);
        return <Pressable key={player.id} accessibilityRole="checkbox" accessibilityState={{ checked: active, disabled: full && !active }} disabled={full && !active} onPress={() => toggle(player)} style={({ pressed }) => [styles.rosterRow, styles.pickRow, active && styles.pickRowActive, full && !active && styles.disabled, pressed && styles.pressed]}><ProfilePhoto photo={player.avatar} name={player.name} size={32} /><View style={styles.flex}><Text numberOfLines={1} style={styles.rosterName}>{player.name}</Text>{player.area ? <Text numberOfLines={1} style={styles.helperInline}>{player.area}</Text> : null}</View><AppIcon name={active ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={active ? palette.teal : palette.ink40} /></Pressable>;
      })}
    </View>
  );
}

// Host controls for an upcoming activity: public or private, invite more
// players, share the link, or send it straight to chats. Players in a public
// activity can share its link too.
function ShareActivityPanel({ game, onChanged }) {
  const { styles, palette } = usePalette();
  const { user } = useAuth();
  const [mode, setMode] = useState(null);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setMode(null); setPicked([]); setNotice(''); setError(''); }, [game.id]);
  const rosterIds = game.roster.filter((player) => player.status !== 'declined').map((player) => player.id);
  const openSpots = Math.max(0, game.capacity - rosterIds.length);
  const run = async (name, action) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (actionError) {
      setError(actionError.message || 'Something went wrong. Try again.');
    } finally {
      setBusy('');
    }
  };
  const switchMode = (next) => { setMode((current) => (current === next ? null : next)); setPicked([]); setError(''); setNotice(''); };
  const changeVisibility = (visibility) => {
    if (visibility === game.visibility || busy) return;
    run('visibility', async () => { await setScheduledGameVisibility(game.sourceId, visibility); onChanged(); });
  };
  const shareLink = () => run('link', async () => {
    const url = await getScheduledGameShareUrl(game.sourceId);
    const message = scheduledGameShareMessage(game, url);
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: game.title, text: message }).catch(() => {});
      } else {
        await copyText(url);
        setNotice('Link copied. Anyone with it can ask to join.');
      }
      return;
    }
    await Share.share({ title: game.title, message });
  });
  const invite = () => run('invite', async () => {
    const count = await inviteToScheduledGame(game.sourceId, picked);
    setPicked([]);
    setMode(null);
    setNotice(count ? `Invited ${count} ${count === 1 ? 'player' : 'players'}.` : 'Those players are already invited.');
    onChanged();
  });
  const sendToChats = () => run('chat', async () => {
    const url = await getScheduledGameShareUrl(game.sourceId);
    const { sent, failed } = await sendTextToPlayers(picked, scheduledGameShareMessage(game, url));
    setPicked(failed.map((item) => item.player));
    if (sent.length) setNotice(`Sent to ${sent.map((player) => player.name).join(', ')}.`);
    if (failed.length) setError(`Not sent to ${failed.map((item) => `${item.player.name} (${item.message})`).join('; ')}`);
    else setMode(null);
  });

  return (
    <View style={styles.sharePanel}>
      {game.isHost ? <>
        <Text style={styles.groupLabel}>WHO CAN JOIN</Text>
        <Segmented accessibilityLabel="Who can join" styles={styles} value={game.visibility} onChange={changeVisibility} options={VISIBILITY_OPTIONS} />
        <Text style={styles.helperText}>{busy === 'visibility' ? 'Saving…' : VISIBILITY_HELP[game.visibility]}</Text>
      </> : null}
      <Text style={styles.groupLabel}>{game.isHost ? 'INVITE & SHARE' : 'SHARE'}</Text>
      <View style={styles.shareRow}>
        {game.isHost ? <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'invite', disabled: !openSpots }} disabled={!openSpots} onPress={() => switchMode('invite')} style={({ pressed }) => [styles.shareButton, mode === 'invite' && styles.shareButtonActive, !openSpots && styles.disabled, pressed && styles.pressed]}><AppIcon name="person-add-outline" size={18} color={palette.teal} /><Text style={styles.shareButtonText}>Invite</Text></Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'chat' }} onPress={() => switchMode('chat')} style={({ pressed }) => [styles.shareButton, mode === 'chat' && styles.shareButtonActive, pressed && styles.pressed]}><AppIcon name="paper-plane-outline" size={18} color={palette.teal} /><Text style={styles.shareButtonText}>Send in chat</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={shareLink} style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}>{busy === 'link' ? <ActivityIndicator size="small" color={palette.teal} /> : <AppIcon name={Platform.OS === 'web' ? 'link-outline' : 'share-outline'} size={18} color={palette.teal} />}<Text style={styles.shareButtonText}>{Platform.OS === 'web' ? 'Copy link' : 'Share link'}</Text></Pressable>
      </View>
      {mode === 'invite' ? <>
        <PlayerInvitePicker selected={picked} onChange={setPicked} max={openSpots} userId={user?.id} excludeIds={rosterIds} />
        <Pressable accessibilityRole="button" disabled={!picked.length || Boolean(busy)} onPress={invite} style={({ pressed }) => [styles.primary, !picked.length && styles.disabled, pressed && styles.pressed]}>{busy === 'invite' ? <ActivityIndicator color="#0E2321" /> : <Text style={styles.primaryText}>{picked.length ? `Invite ${picked.length} ${picked.length === 1 ? 'player' : 'players'}` : 'Pick players to invite'}</Text>}</Pressable>
      </> : null}
      {mode === 'chat' ? <>
        <ChatSharePicker selected={picked} onChange={setPicked} />
        <Pressable accessibilityRole="button" disabled={!picked.length || Boolean(busy)} onPress={sendToChats} style={({ pressed }) => [styles.primary, !picked.length && styles.disabled, pressed && styles.pressed]}>{busy === 'chat' ? <ActivityIndicator color="#0E2321" /> : <><AppIcon name="paper-plane" size={16} color="#0E2321" /><Text style={styles.primaryText}>{picked.length ? `Send to ${picked.length}` : 'Pick who to send to'}</Text></>}</Pressable>
      </> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.shareNotice}>{notice}</Text> : null}
      {error ? <View style={styles.errorBox}><AppIcon name="alert-circle-outline" size={17} color={palette.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
    </View>
  );
}

// Start time: one card you type into. It turns lime once the time is valid, and
// −/+ nudge it by 15 minutes. Any minute works, so players can match a booking.
const LAST_START = 24 * 60 - 1;
const NUDGE_MINUTES = 15;
const splitTime = (value) => { const [clock, meridiem] = formatTime(value).split(' '); return { clock, meridiem }; };
const typedClock = (minutes) => `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`;
const clockLabel = (minutes) => `${typedClock(minutes)} ${minutes >= 720 ? 'PM' : 'AM'}`;
// "13:00" or "07:30" (no AM/PM) means the player thinks in 24-hour time; show the end the same way.
const isTwentyFourHourText = (text) => /^\s*(0\d|1[3-9]|2[0-3])(?:[:.\s]?\d{0,2})?\s*$/.test(String(text || ''));

function StartTimePicker({ earliest, startMinutes, startsAt, duration, dayLabel, onChange }) {
  const { styles, palette } = usePalette();
  const [text, setText] = useState(startMinutes === null ? '' : typedClock(startMinutes));
  const [meridiem, setMeridiem] = useState(startMinutes === null ? 'pm' : startMinutes >= 720 ? 'pm' : 'am');
  const [touched, setTouched] = useState(false);
  // Remembered from what was typed, so −/+ nudges keep the same clock style.
  const [twentyFour, setTwentyFour] = useState(false);
  const parsed = parseClockInput(text, meridiem);
  const tooEarly = parsed !== null && parsed < earliest;
  const error = tooEarly ? `Too soon. The earliest start is ${clockLabel(earliest)}.` : touched && text.trim() && parsed === null ? 'Type a time like 1:00 PM or 13:00' : '';
  const set = Boolean(startsAt);
  const end = set ? splitTime(new Date(new Date(startsAt).getTime() + duration * 60000)) : null;
  const endLabel = set ? (twentyFour ? clockFromMinutes((startMinutes + duration) % (24 * 60)) : `${end.clock} ${end.meridiem}`) : '';

  // Nudges and day changes update the card; keep the typed text in step with them.
  useEffect(() => {
    if (startMinutes === null || startMinutes === parseClockInput(text, meridiem)) return;
    setText(twentyFour ? clockFromMinutes(startMinutes) : typedClock(startMinutes));
    setMeridiem(startMinutes >= 720 ? 'pm' : 'am');
  }, [startMinutes]);

  const apply = (nextText, nextMeridiem) => {
    const minutes = parseClockInput(nextText, nextMeridiem);
    // "1:00 pm" or a 24-hour "13:00" decides the half of the day; keep the toggle on it.
    if (minutes !== null) setMeridiem(minutes >= 720 ? 'pm' : 'am');
    onChange(minutes !== null && minutes >= earliest ? minutes : null);
  };
  // A different day can make the typed time valid (or too soon) without retyping.
  useEffect(() => { if (text.trim()) apply(text, meridiem); }, [earliest]);
  const type = (value) => { const clean = maskClockInput(text, value); setText(clean); setTwentyFour(isTwentyFourHourText(clean)); apply(clean, meridiem); };
  const pickMeridiem = (value) => { setMeridiem(value); setTouched(true); apply(text, value); };
  const nudge = (step) => onChange(Math.min(LAST_START, Math.max(earliest, startMinutes + step * NUDGE_MINUTES)));

  return (
    <View style={[styles.timeCard, set && styles.timeCardSet]}>
      <View style={styles.timeCardHead}>
        <AppIcon name={set ? 'checkmark-circle' : 'time-outline'} size={16} color={set ? '#0E2321' : palette.teal} />
        <Text numberOfLines={1} style={[styles.timeCardEyebrow, set && styles.timeCardInk]}>START TIME · {dayLabel.toUpperCase()}</Text>
      </View>
      <View style={styles.timeEntryRow}>
        <TextInput
          value={text}
          onChangeText={type}
          onBlur={() => setTouched(true)}
          onSubmitEditing={() => setTouched(true)}
          placeholder="7:30"
          placeholderTextColor={set ? '#3C4A45' : palette.ink40}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          maxLength={8}
          accessibilityLabel="Start time"
          dataSet={{ displayInput: 'time' }}
          style={[styles.timeEntry, set && styles.timeCardInk]}
        />
        <View style={[styles.meridiemToggle, set && styles.meridiemToggleSet]}>
          {['am', 'pm'].map((value) => {
            const selected = meridiem === value;
            return <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => pickMeridiem(value)} style={({ pressed }) => [styles.meridiemButton, selected && (set ? styles.meridiemButtonOnLime : styles.meridiemButtonActive), pressed && styles.pressed]}><Text style={[styles.meridiemText, set && styles.timeCardInk, selected && (set ? styles.meridiemTextOnLime : styles.meridiemTextActive)]}>{value.toUpperCase()}</Text></Pressable>;
          })}
        </View>
      </View>
      <View style={styles.timeCardFoot}>
        <Text style={[styles.timeCardSub, set && styles.timeCardInk, error && styles.timeCardError]} numberOfLines={2}>
          {error || (set ? `Ends ${endLabel}` : 'Type the start time, then choose AM or PM')}
        </Text>
        {set ? (
          <View style={styles.timeNudges}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${NUDGE_MINUTES} minutes earlier`} disabled={startMinutes <= earliest} onPress={() => nudge(-1)} style={({ pressed }) => [styles.timeNudge, startMinutes <= earliest && styles.disabled, pressed && styles.pressed]}><AppIcon name="remove" size={16} color="#0E2321" /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${NUDGE_MINUTES} minutes later`} disabled={startMinutes >= LAST_START} onPress={() => nudge(1)} style={({ pressed }) => [styles.timeNudge, startMinutes >= LAST_START && styles.disabled, pressed && styles.pressed]}><AppIcon name="add" size={16} color="#0E2321" /></Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DurationPicker({ value, onChange }) {
  const { styles, palette } = usePalette();
  const [draft, setDraft] = useState(null);
  const step = (direction) => onChange(Math.min(MAX_GAME_MINUTES, Math.max(MIN_GAME_MINUTES, value + direction * DURATION_STEP_MINUTES)));
  const commit = () => { const minutes = parseHoursInput(draft); if (minutes) onChange(minutes); setDraft(null); };
  return (
    <View>
      <View style={styles.durationStepper}>
        <Pressable accessibilityRole="button" accessibilityLabel="Shorter by 30 minutes" disabled={value <= MIN_GAME_MINUTES} onPress={() => step(-1)} style={({ pressed }) => [styles.durationButton, value <= MIN_GAME_MINUTES && styles.disabled, pressed && styles.pressed]}><AppIcon name="remove" size={18} color={palette.ink} /></Pressable>
        <View style={styles.durationValue}>
          <View style={styles.durationEntryRow}>
            <TextInput value={draft ?? String(value / 60)} onFocus={() => setDraft('')} onChangeText={(next) => setDraft(next.replace(/[^0-9.,]/g, '').slice(0, 4))} onBlur={commit} onSubmitEditing={commit} placeholder={String(value / 60)} placeholderTextColor={palette.ink40} keyboardType="decimal-pad" returnKeyType="done" accessibilityLabel="Game length in hours" dataSet={{ displayInput: 'duration' }} style={styles.durationEntry} />
            <Text style={styles.durationValueText}>hr</Text>
          </View>
          <Text style={styles.durationValueSub}>tap to type</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Longer by 30 minutes" disabled={value >= MAX_GAME_MINUTES} onPress={() => step(1)} style={({ pressed }) => [styles.durationButton, value >= MAX_GAME_MINUTES && styles.disabled, pressed && styles.pressed]}><AppIcon name="add" size={18} color={palette.ink} /></Pressable>
      </View>
      <View style={styles.durationPresets}>{GAME_DURATIONS.map((preset) => {
        const selected = preset === value;
        return <Pressable key={preset} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => onChange(preset)} style={({ pressed }) => [styles.durationPreset, selected && styles.durationPresetActive, pressed && styles.pressed]}><Text style={[styles.durationPresetText, selected && styles.durationPresetTextActive]}>{formatDuration(preset)}</Text></Pressable>;
      })}</View>
    </View>
  );
}

function ActivityTypePicker({ value, onChange }) {
  const { isDark, styles } = usePalette();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Activity type" style={styles.activityTypeGrid}>
      {Object.entries(KINDS).map(([key, type]) => {
        const selected = value === key;
        const color = kindColor(key, isDark);
        return (
          <Pressable key={key} accessibilityRole="radio" accessibilityLabel={type.name} accessibilityState={{ checked: selected }} aria-checked={selected} onPress={() => onChange(key)} style={({ pressed }) => [styles.activityType, selected && styles.activityTypeActive, selected && { borderColor: color }, pressed && styles.pressed]}>
            <AppIcon name={type.icon} size={18} color={color} />
            <Text style={styles.activityTypeName}>{type.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function NewActivitySheet({ visible, initialDay, todayKey, onClose, onCreated }) {
  const { styles, palette } = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const { user } = useAuth();
  const { userLocation } = useUserLocation();
  const [step, setStep] = useState('when');
  const [monthKey, setMonthKey] = useState(initialDay.slice(0, 7));
  const [day, setDay] = useState(initialDay);
  const [startMinutes, setStartMinutes] = useState(null);
  const [duration, setDuration] = useState(90);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('game');
  const [capacity, setCapacity] = useState(16);
  const [matchType, setMatchType] = useState('doubles');
  const [mode, setMode] = useState('casual');
  const [visibility, setVisibility] = useState('invite');
  const [court, setCourt] = useState(null);
  const [invitees, setInvitees] = useState([]);
  const [notes, setNotes] = useState('');
  const [courtsOpen, setCourtsOpen] = useState(false);
  const [recentCourts, setRecentCourts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    const earliest = initialDay < todayKey ? todayKey : initialDay;
    // Late in the evening, today has no start times left; open on tomorrow instead.
    const start = earliestStartMinutes(earliest) !== null ? earliest : shiftDayKey(earliest, 1);
    setStep('when'); setDay(start); setMonthKey(start.slice(0, 7)); setStartMinutes(null); setDuration(90);
    setTitle(''); setKind('game'); setCapacity(16); setMatchType('doubles'); setMode('casual'); setVisibility('invite'); setCourt(null); setInvitees([]); setNotes(''); setError('');
    loadRecentCourts(user?.id).then(setRecentCourts);
  }, [visible]);

  const maxInvites = (kind === 'game' ? (matchType === 'singles' ? 2 : 4) : capacity) - 1;
  useEffect(() => { setInvitees((current) => current.slice(0, maxInvites)); }, [maxInvites]);
  const earliest = earliestStartMinutes(day);
  const slot = useMemo(() => (startMinutes === null ? null : { time: clockFromMinutes(startMinutes), startsAt: dateFromDayKey(day, clockFromMinutes(startMinutes)).toISOString() }), [day, startMinutes]);
  const endsAt = slot ? new Date(new Date(slot.startsAt).getTime() + duration * 60000) : null;
  const summary = slot ? `${formatDayLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatTime(slot.startsAt)} – ${formatTime(endsAt)}` : formatDayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' });
  const defaultTitle = (kind === 'game'
    ? `${matchType === 'singles' ? 'Singles' : 'Doubles'}${court ? ` at ${court.name}` : ' game'}`
    : `${KINDS[kind].name}${court ? ` at ${court.name}` : ''}`).slice(0, 80);

  const submit = async () => {
    if (!slot || !court) return;
    setSaving(true);
    setError('');
    try {
      const created = await createScheduledActivity({ kind, title: title.trim() || defaultTitle, startsAt: slot.startsAt, durationMinutes: duration, matchType, mode, visibility, capacity, court, notes, invitees });
      rememberCourt(user?.id, court);
      onCreated(day, kind, created?.id);
    } catch (createError) {
      setError(createError.message || 'The activity could not be scheduled. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const whenStep = (
    <View>
      <Text style={styles.groupLabel}>ACTIVITY TYPE</Text>
      <ActivityTypePicker value={kind} onChange={setKind} />
      <View style={[styles.newGameWhen, wide && styles.newGameWhenWide]}>
        <View style={wide ? styles.newGameCalendarCol : null}>
          <MonthCalendar monthKey={monthKey} selectedKey={day} todayKey={todayKey} markers={{}} minKey={todayKey} onSelect={(key) => { setDay(key); setStartMinutes((current) => { const open = earliestStartMinutes(key); return current !== null && open !== null && current >= open ? current : null; }); }} onMonth={(delta) => setMonthKey((current) => shiftMonthKey(current, delta))} />
        </View>
        <View style={[styles.slotCol, wide && styles.slotColWide]}>
          {earliest !== null ? <StartTimePicker earliest={earliest} startMinutes={startMinutes} startsAt={slot?.startsAt} duration={duration} dayLabel={formatDayLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })} onChange={setStartMinutes} /> : <Text style={styles.emptyText}>No start times left today. Pick another day.</Text>}
          {earliest !== null ? <><Text style={styles.groupLabel}>DURATION</Text><DurationPicker value={duration} onChange={setDuration} /></> : null}
          {earliest !== null ? <Pressable accessibilityRole="button" accessibilityLabel="Continue to activity details" accessibilityState={{ disabled: !slot }} disabled={!slot} onPress={() => setStep('details')} style={({ pressed }) => [styles.primary, styles.slotNext, !slot && styles.slotNextIdle, pressed && styles.pressed]}><Text style={[styles.primaryText, !slot && styles.slotNextIdleText]}>{slot ? 'Next: activity details' : 'Pick a start time'}</Text>{slot ? <AppIcon name="arrow-forward" size={16} color="#0E2321" /> : null}</Pressable> : null}
        </View>
      </View>
    </View>
  );

  const detailsStep = (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Change date and time" onPress={() => setStep('when')} style={({ pressed }) => [styles.summaryCard, pressed && styles.pressed]}><AppIcon name="calendar" size={18} color={palette.teal} /><Text style={styles.summaryText}>{summary}</Text><Text style={styles.summaryEdit}>Change</Text></Pressable>
      <Text style={styles.groupLabel}>COURT</Text>
      <Pressable accessibilityRole="button" onPress={() => setCourtsOpen(true)} style={({ pressed }) => [styles.courtButton, court && styles.courtButtonChosen, pressed && styles.pressed]}><View style={styles.courtButtonIcon}><AppIcon name={court ? 'tennisball-outline' : 'location-outline'} size={19} color="#FFFFFF" /></View><View style={styles.flex}><Text numberOfLines={1} style={styles.rosterName}>{court ? courtLabel(court) : 'Where are you playing?'}</Text><Text numberOfLines={1} style={styles.helperInline}>{court ? court.area || 'Your court' : 'Pick a recent court or add any venue'}</Text></View><AppIcon name={court ? 'create-outline' : 'chevron-forward'} size={19} color={palette.teal} /></Pressable>
      {kind === 'game' ? <><Text style={styles.groupLabel}>FORMAT</Text>
      <Segmented accessibilityLabel="Match format" styles={styles} value={matchType} onChange={setMatchType} options={[{ value: 'doubles', label: 'Doubles' }, { value: 'singles', label: 'Singles' }]} />
      <View style={styles.spacer} />
      <Segmented accessibilityLabel="Match mode" styles={styles} value={mode} onChange={setMode} options={[{ value: 'casual', label: 'Casual' }, { value: 'ranked', label: 'Ranked' }]} /></>
        : <><Text style={styles.groupLabel}>PLAYER LIMIT</Text><Segmented accessibilityLabel="Player limit" styles={styles} value={capacity} onChange={setCapacity} options={[4, 8, 12, 16].map((count) => ({ value: count, label: `${count} players` }))} /><Text style={styles.helperText}>Includes you and the players who join.</Text></>}
      <Text style={styles.groupLabel}>WHO CAN JOIN</Text>
      <Segmented accessibilityLabel="Who can join" styles={styles} value={visibility} onChange={setVisibility} options={VISIBILITY_OPTIONS} />
      <Text style={styles.helperText}>{VISIBILITY_HELP[visibility]}</Text>
      <Text style={styles.groupLabel}>INVITE PLAYERS · {invitees.length}/{maxInvites}</Text>
      <PlayerInvitePicker selected={invitees} onChange={setInvitees} max={maxInvites} userId={user?.id} />
      <Text style={styles.groupLabel}>TITLE (OPTIONAL)</Text>
      <TextInput accessibilityLabel="Activity title" value={title} onChangeText={(value) => setTitle(value.slice(0, 80))} placeholder={defaultTitle} placeholderTextColor={palette.ink40} style={styles.field} />
      <Text style={styles.groupLabel}>NOTE FOR PLAYERS (OPTIONAL)</Text>
      <TextInput accessibilityLabel="Note for players" value={notes} onChangeText={(value) => setNotes(value.slice(0, 500))} placeholder="Bring balls, meet at the gate…" placeholderTextColor={palette.ink40} multiline style={[styles.field, styles.fieldMultiline]} />
      {error ? <View style={styles.errorBox}><AppIcon name="alert-circle-outline" size={17} color={palette.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Save activity" accessibilityState={{ disabled: !court || saving }} disabled={!court || saving} onPress={submit} style={({ pressed }) => [styles.primary, styles.submit, !court && styles.slotNextIdle, saving && styles.disabled, pressed && styles.pressed]}>{saving ? <ActivityIndicator color="#0E2321" /> : <><AppIcon name={court ? 'checkmark' : 'location-outline'} size={17} color={court ? '#0E2321' : palette.ink70} /><Text style={[styles.primaryText, !court && styles.slotNextIdleText]}>{court ? `Schedule ${KINDS[kind].name.toLowerCase()}` : 'Choose a court to continue'}</Text></>}</Pressable>
      <CourtPickerSheet visible={courtsOpen} selected={court} recentCourts={recentCourts} defaultArea={areaFromLocationLabel(userLocation?.label)} onClose={() => setCourtsOpen(false)} onSelect={(selected) => { setCourt(selected); setCourtsOpen(false); }} />
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable {...webDialog('backdrop')} accessibilityLabel="Close new activity" style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={onClose}>
        <Pressable {...webDialog('surface')} accessibilityRole="dialog" style={[styles.sheet, styles.newGameSheet, wide && styles.newGameSheetWide]} onPress={(event) => event.stopPropagation()}>
          <View {...webDialog('handle')} style={styles.handle} />
          <View style={styles.sheetHead}>
            {step === 'details' ? <Pressable accessibilityRole="button" accessibilityLabel="Back to date and time" onPress={() => setStep('when')} style={styles.close}><AppIcon name="arrow-back" size={20} color={palette.ink} /></Pressable> : null}
            <View style={styles.flex}><Text style={styles.eyebrow}>NEW ACTIVITY · STEP {step === 'when' ? 1 : 2} OF 2</Text><Text style={styles.sheetTitle}>{step === 'when' ? 'Pick a type, date & time' : `${KINDS[kind].name} details`}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}><AppIcon name="close" size={20} color={palette.ink} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">{step === 'when' ? whenStep : detailsStep}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function ScheduleScreen({ navigation, route }) {
  const { isDark, styles, palette } = usePalette();
  const desktop = useDesktopLayout();
  // Measure the app shell: tablets and the desktop sidebar reduce usable space.
  const [layoutWidth, setLayoutWidth] = useState(0);
  const wide = layoutWidth >= 900;
  const { user } = useAuth();
  const todayKey = dayKey(Date.now());
  const [view, setView] = useState('mine');
  const [monthKey, setMonthKey] = useState(todayKey.slice(0, 7));
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [monthOpen, setMonthOpen] = useState(true);
  const [games, setGames] = useState([]);
  const [events, setEvents] = useState([]);
  const [hiddenKinds, setHiddenKinds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [openEntryId, setOpenEntryId] = useState(null);
  const [newGameDay, setNewGameDay] = useState(null);
  const handledTokens = useRef({});

  const range = useMemo(() => {
    const grid = monthGrid(monthKey);
    return { from: dateFromDayKey(grid[0], '00:00').toISOString(), to: dateFromDayKey(shiftDayKey(grid[grid.length - 1], 1), '00:00').toISOString() };
  }, [monthKey]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    setError('');
    const [gameResult, eventResult] = await Promise.allSettled([listScheduledGames(range), listScheduleEvents()]);
    if (gameResult.status === 'fulfilled') setGames(gameResult.value);
    if (eventResult.status === 'fulfilled') setEvents(eventResult.value);
    const failure = [gameResult, eventResult].find((result) => result.status === 'rejected');
    if (failure) setError(failure.reason?.message || 'Part of your schedule could not load.');
    setLoading(false);
    setRefreshing(false);
  }, [range]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const newToken = route?.params?.newGameToken;
    if (newToken && handledTokens.current.newGame !== newToken) {
      handledTokens.current.newGame = newToken;
      setNewGameDay(todayKey);
    }
    const viewToken = route?.params?.openViewToken;
    if (viewToken && handledTokens.current.view !== viewToken) {
      handledTokens.current.view = viewToken;
      setView(route.params.openView === 'discover' ? 'discover' : 'mine');
    }
    const gameId = route?.params?.openGameId;
    const gameToken = route?.params?.openGameToken;
    if (gameId && gameToken && handledTokens.current.openGame !== gameToken) {
      handledTokens.current.openGame = gameToken;
      setView(route.params.openView === 'discover' ? 'discover' : 'mine');
      setOpenEntryId(`game:${gameId}`);
    }
  }, [route?.params?.newGameToken, route?.params?.openGameToken, route?.params?.openViewToken]);

  // A shared link (peakle://games/<code> or /games/<code>) puts the activity on
  // this player's calendar as an invitation and opens it.
  const shareCode = route?.params?.shareCode;
  const shareKey = shareCode ? `${shareCode}:${route?.params?.shareToken || ''}` : null;
  useEffect(() => {
    if (!shareKey || handledTokens.current.share === shareKey) return;
    handledTokens.current.share = shareKey;
    openScheduledGameLink(shareCode)
      .then(({ gameId, startsAt }) => {
        setView('mine');
        selectDay(dayKey(startsAt));
        setOpenEntryId(`game:${gameId}`);
        load();
      })
      .catch((linkError) => setError(linkError.message || 'This invitation could not be opened.'));
  }, [shareKey]);

  const allEntries = useMemo(() => [...games, ...events], [games, events]);
  // My schedule is what you're in; Discover is only what you could still join.
  const scoped = useMemo(() => allEntries.filter((entry) => (view === 'mine'
    ? isOnMyCalendar(entry)
    : !isOnMyCalendar(entry) && entry.status !== 'cancelled' && (!isPlayerScheduledEntry(entry) || (entry.visibility === 'open' && entry.status === 'scheduled' && entry.spotsLeft > 0)))), [allEntries, view]);
  const visible = useMemo(() => scoped.filter((entry) => !hiddenKinds.includes(entry.kind)), [scoped, hiddenKinds]);
  const byDay = useMemo(() => entriesByDay(visible), [visible]);
  const dayEntries = (byDay[selectedKey] || []).slice().sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const upcoming = useMemo(() => visible
    .filter((entry) => new Date(entry.endsAt).getTime() >= Date.now() && entry.status !== 'cancelled' && dayKey(entry.startsAt) !== selectedKey)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .slice(0, 5), [visible, selectedKey]);
  const discoverDays = useMemo(() => {
    const groups = {};
    visible
      .filter((entry) => new Date(entry.endsAt).getTime() >= Date.now())
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
      .forEach((entry) => { const key = dayKey(entry.startsAt); if (!groups[key]) groups[key] = []; groups[key].push(entry); });
    return Object.entries(groups);
  }, [visible]);
  const pendingInvites = games.filter((game) => game.myStatus === 'invited' && game.status === 'scheduled' && new Date(game.endsAt).getTime() > Date.now());
  const openEntry = openEntryId ? allEntries.find((entry) => entry.id === openEntryId) || null : null;
  const hasFilteredEntries = scoped.some((entry) => dayKey(entry.startsAt) === selectedKey && hiddenKinds.includes(entry.kind));

  const selectDay = (key) => {
    setSelectedKey(key);
    if (!key.startsWith(monthKey)) setMonthKey(key.slice(0, 7));
  };
  const changeMonth = (delta) => {
    const next = shiftMonthKey(monthKey, delta);
    setMonthKey(next);
    setSelectedKey(next === todayKey.slice(0, 7) ? todayKey : `${next}-01`);
  };
  const toggleKind = (kind) => setHiddenKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);
  const startGame = (game) => {
    setOpenEntryId(null);
    navigation.navigate('Play', { scheduledGame: playSetupFromGame(game), scheduledGameToken: Date.now() });
  };
  const openEvent = (entry) => {
    setOpenEntryId(null);
    if (entry.kind === 'open_play') navigation.navigate('OpenPlayActivity', { token: Date.now(), sessionId: entry.sourceId, direct: true, returnTo: 'Schedule' });
    else navigation.navigate('ActivityDetails', { activity: entry.activity, returnTo: 'Schedule' });
  };

  const newGameButton = (
    <Pressable accessibilityRole="button" accessibilityLabel="Schedule a new activity" onPress={() => setNewGameDay(selectedKey < todayKey ? todayKey : selectedKey)} style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}>
      <AppIcon name="add" size={18} color="#0E2321" />
      {layoutWidth >= 360 ? <Text style={styles.newButtonText}>New activity</Text> : null}
    </Pressable>
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.flex}><Text style={styles.eyebrow}>YOUR COURT TIME</Text><Text accessibilityRole="header" style={styles.h1}>Schedule</Text><Text style={styles.headerSubtitle}>Your next game starts here.</Text></View>
      {layoutWidth >= 600 ? newGameButton : null}
      {!desktop ? <HeaderAvatar size={36} /> : null}
    </View>
  );

  const legend = (
    <HorizontalScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Activity filters" style={styles.legendScroll} contentContainerStyle={styles.legend}>
      {Object.entries(KINDS).map(([kind, meta]) => {
        const hidden = hiddenKinds.includes(kind);
        const color = kindColor(kind, isDark);
        return (
          <Pressable key={kind} accessibilityRole="checkbox" accessibilityState={{ checked: !hidden }} aria-checked={!hidden} accessibilityLabel={`Show ${meta.label}`} onPress={() => toggleKind(kind)} style={({ pressed }) => [styles.legendItem, !hidden && styles.legendItemActive, pressed && styles.pressed]}>
            <View style={[styles.legendIcon, { backgroundColor: `${color}${hidden ? '12' : '22'}` }]}>
              <AppIcon name={meta.icon} size={22} color={hidden ? palette.ink40 : color} />
              <View style={[styles.legendCheck, !hidden && { backgroundColor: color, borderColor: color }]}>
                {!hidden ? <AppIcon name="checkmark" size={10} color={isDark || kind === 'open_play' ? '#0E2321' : '#FFFFFF'} /> : null}
              </View>
            </View>
            <Text style={[styles.legendText, hidden && styles.legendTextOff]}>{meta.label}</Text>
          </Pressable>
        );
      })}
    </HorizontalScrollView>
  );

  const agenda = (
    <View {...webLayout('schedule-agenda')} style={styles.agenda}>
      {pendingInvites.length && view === 'mine' ? <Pressable accessibilityRole="button" onPress={() => { selectDay(dayKey(pendingInvites[0].startsAt)); setOpenEntryId(pendingInvites[0].id); }} style={({ pressed }) => [styles.inviteBanner, pressed && styles.pressed]}><AppIcon name="mail-unread-outline" size={19} color="#0E2321" /><Text style={styles.inviteBannerText}>{pendingInvites.length === 1 ? `${pendingInvites[0].title} is waiting for your answer` : `${pendingInvites.length} activity invites are waiting for your answer`}</Text><AppIcon name="chevron-forward" size={17} color="#0E2321" /></Pressable> : null}
      <View style={styles.agendaHead}>
        <View style={styles.agendaDateBadge}><Text style={styles.agendaMonth}>{formatDayLabel(selectedKey, { month: 'short' }).toUpperCase()}</Text><Text style={styles.agendaNumber}>{Number(selectedKey.slice(8))}</Text></View>
        <View style={styles.flex}><Text accessibilityRole="header" style={styles.agendaDay}>{selectedKey === todayKey ? 'Today' : selectedKey === shiftDayKey(todayKey, 1) ? 'Tomorrow' : formatDayLabel(selectedKey, { weekday: 'long' })}</Text><Text style={styles.agendaDate}>{formatDayLabel(selectedKey, { month: 'long', day: 'numeric' })} · {dayEntries.length} {dayEntries.length === 1 ? 'session' : 'sessions'}</Text></View>
      </View>
      {loading && !allEntries.length ? <View style={styles.loadingBox}><ActivityIndicator color={palette.teal} /><Text style={styles.helperText}>Loading your schedule…</Text></View>
        : dayEntries.length ? dayEntries.map((entry) => <EntryCard key={entry.id} entry={entry} past={new Date(entry.endsAt).getTime() < Date.now()} onPress={() => setOpenEntryId(entry.id)} />)
          : <View style={styles.empty}>
            <View style={styles.emptyIcon}><AppIcon name="calendar-clear-outline" size={24} color={palette.teal} /></View>
            <Text style={styles.emptyTitle}>{hasFilteredEntries ? 'Your filters are hiding sessions' : selectedKey === todayKey ? 'No plans for today' : 'A little room to play'}</Text>
            <Text style={styles.emptyText}>{hasFilteredEntries ? 'Show all session types to see your plans for this day.' : selectedKey < todayKey ? 'No sessions were scheduled for this day.' : 'Plan an activity, or find an open spot with other players.'}</Text>
            {hasFilteredEntries ? <Pressable accessibilityRole="button" onPress={() => setHiddenKinds([])} style={({ pressed }) => [styles.secondary, styles.emptyAction, pressed && styles.pressed]}><Text style={styles.secondaryText}>Reset filters</Text></Pressable>
              : selectedKey >= todayKey ? <><Pressable accessibilityRole="button" onPress={() => setNewGameDay(selectedKey)} style={({ pressed }) => [styles.primary, styles.emptyAction, pressed && styles.pressed]}><AppIcon name="add" size={16} color="#0E2321" /><Text style={styles.primaryText}>Plan an activity</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setView('discover')} style={({ pressed }) => [styles.discoverLink, pressed && styles.pressed]}><Text style={styles.secondaryText}>Discover activities</Text><AppIcon name="arrow-forward" size={14} color={palette.teal} /></Pressable></> : null}
          </View>}
      {upcoming.length ? <><Text style={styles.groupLabel}>{view === 'mine' ? 'COMING UP' : 'MORE THIS MONTH'}</Text>{upcoming.map((entry) => <Pressable key={`up-${entry.id}`} accessibilityRole="button" onPress={() => { selectDay(dayKey(entry.startsAt)); setOpenEntryId(entry.id); }} style={({ pressed }) => [styles.upcomingRow, pressed && styles.pressed]}><View style={styles.upcomingDate}><Text style={styles.upcomingMonth}>{formatDayLabel(dayKey(entry.startsAt), { month: 'short' }).toUpperCase()}</Text><Text style={styles.upcomingDay}>{Number(dayKey(entry.startsAt).slice(8))}</Text></View><View style={[styles.legendDot, { backgroundColor: kindColor(entry.kind, isDark), borderColor: kindColor(entry.kind, isDark) }]} /><View style={styles.flex}><Text numberOfLines={1} style={styles.rosterName}>{entry.title}</Text><Text numberOfLines={1} style={styles.helperInline}>{formatTime(entry.startsAt)} · {entry.place}</Text></View><AppIcon name="chevron-forward" size={17} color={palette.ink40} /></Pressable>)}</> : null}
    </View>
  );

  const discover = (
    <View style={[styles.agenda, styles.discoverAgenda]}>
      <View style={styles.agendaHead}>
        <View style={styles.flex}><Text style={styles.agendaDay}>Find your next activity</Text><Text style={styles.agendaDate}>Games and activities you can join</Text></View>
        <Text style={styles.agendaCount}>{discoverDays.length ? `${discoverDays.reduce((total, [, rows]) => total + rows.length, 0)} upcoming` : ''}</Text>
      </View>
      {loading && !allEntries.length ? <View style={styles.loadingBox}><ActivityIndicator color={palette.teal} /><Text style={styles.helperText}>Finding games and events…</Text></View>
        : discoverDays.length ? discoverDays.map(([key, rows]) => (
          <View key={key}>
            <Text style={styles.groupLabel}>{(key === todayKey ? 'Today' : key === shiftDayKey(todayKey, 1) ? 'Tomorrow' : formatDayLabel(key, { weekday: 'long', month: 'short', day: 'numeric' })).toUpperCase()}</Text>
            {rows.map((entry) => <EntryCard key={entry.id} entry={entry} onPress={() => setOpenEntryId(entry.id)} />)}
          </View>
        ))
          : <View style={styles.empty}><View style={styles.emptyIcon}><AppIcon name="compass-outline" size={24} color={palette.teal} /></View><Text style={styles.emptyTitle}>Nothing open to join right now</Text><Text style={styles.emptyText}>Activities hosted by players will appear here as they’re posted. Anything you’ve joined is under My schedule.</Text><Pressable accessibilityRole="button" onPress={() => setNewGameDay(todayKey)} style={({ pressed }) => [styles.secondary, styles.emptyAction, pressed && styles.pressed]}><AppIcon name="add" size={16} color={palette.teal} /><Text style={styles.secondaryText}>Plan an activity</Text></Pressable></View>}
    </View>
  );

  return (
    <SafeAreaView onLayout={({ nativeEvent }) => setLayoutWidth(nativeEvent.layout.width)} style={styles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={isDark ? DARK_CONTENT_COLORS.paper : LIGHT_CONTENT_COLORS.paper} />
      <ScrollView contentContainerStyle={[styles.content, wide && styles.contentWide]} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={palette.teal} colors={[palette.teal]} />}>
        {header}
        <View style={styles.scheduleToolbar}>
          <View style={[styles.flex, layoutWidth >= 600 && styles.scheduleTabsWide]}><Segmented accessibilityLabel="Schedule view" styles={styles} value={view} onChange={setView} options={[{ value: 'mine', label: 'My schedule' }, { value: 'discover', label: 'Discover' }]} /></View>
          {layoutWidth < 600 ? newGameButton : <View style={styles.timeZone}><AppIcon name="time-outline" size={13} color={palette.ink40} /><Text style={styles.helperInline}>Philippine time</Text></View>}
        </View>
        {error ? <View style={styles.errorBox}><AppIcon name="cloud-offline-outline" size={17} color={palette.brick} /><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={() => load({ refresh: true })}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
        {view === 'discover' ? <>{legend}{discover}</> : (
          <View {...webLayout('schedule-columns')} style={styles.columns}>
            <View style={styles.calendarColumn}><ScheduleCalendar monthKey={monthKey} selectedKey={selectedKey} todayKey={todayKey} byDay={byDay} monthOpen={monthOpen} onToggleMonth={() => setMonthOpen((value) => !value)} onSelect={selectDay} onMonth={changeMonth} onOpenEntry={(entry) => setOpenEntryId(entry.id)} expanded={layoutWidth >= 680} kindColor={kindColor} filters={legend} /></View>
            <View style={styles.mainColumn}>{agenda}</View>
          </View>
        )}
      </ScrollView>
      {openEntry ? <EntrySheet entry={openEntry} onClose={() => setOpenEntryId(null)} onChanged={() => load()} onStart={startGame} onOpenEvent={openEvent} /> : null}
      <NewActivitySheet visible={Boolean(newGameDay)} initialDay={newGameDay || todayKey} todayKey={todayKey} onClose={() => setNewGameDay(null)} onCreated={(key, kind, id) => { setNewGameDay(null); setView('mine'); setHiddenKinds((current) => current.filter((item) => item !== kind)); selectDay(key); if (key.startsWith(monthKey)) load(); if (id) setOpenEntryId(`game:${id}`); }} />
    </SafeAreaView>
  );
}

const C = LIGHT_CONTENT_COLORS;
const markerStyles = StyleSheet.create({
  row: { height: 5, marginTop: 2, flexDirection: 'row', justifyContent: 'center', gap: 2 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 120 },
  contentWide: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 32 },
  flex: { flex: 1, minWidth: 0 },
  header: { minHeight: 72, marginBottom: 22, flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '700', letterSpacing: 1.05 },
  h1: { marginTop: 2, color: C.ink, fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  headerSubtitle: { marginTop: 3, color: C.ink40, fontSize: 12, lineHeight: 18 },
  newButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, backgroundColor: C.optic },
  newButtonText: { color: '#0E2321', fontSize: 12, fontWeight: '900' },
  scheduleToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  scheduleTabsWide: { maxWidth: 290 },
  timeZone: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  segmented: { padding: 4, flexDirection: 'row', borderRadius: 12, backgroundColor: '#E7EBE6' },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  segmentActive: { backgroundColor: C.surface, shadowColor: C.ink, shadowOpacity: .08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segmentText: { color: C.ink40, fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: C.ink, fontWeight: '900' },
  columns: { marginTop: 20, gap: 18 },
  calendarColumn: { width: '100%', minWidth: 0 },
  mainColumn: { width: '100%', minWidth: 0 },
  calendar: { marginTop: 16, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  calendarHead: { marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  calendarTitle: { flex: 1, minWidth: 0, color: C.ink, fontSize: 17, lineHeight: 23, fontWeight: '800' },
  calendarNav: { flexDirection: 'row', gap: 6 },
  calendarNavButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  weekdayRow: { flexDirection: 'row' },
  weekday: { flex: 1, paddingVertical: 6, color: C.ink40, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  dayGrid: { gap: 4 },
  dayWeekRow: { flexDirection: 'row' },
  dayCell: { flex: 1, minWidth: 0, minHeight: 44, aspectRatio: 1, padding: 2 },
  day: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  dayBusy: { backgroundColor: C.paper },
  dayPressed: { backgroundColor: C.tealWash },
  daySelected: { backgroundColor: C.ink },
  dayText: { color: C.ink, fontSize: 13, fontWeight: '700' },
  dayTextMuted: { color: C.line },
  dayTextDisabled: { color: C.line },
  dayTextToday: { color: C.teal, fontWeight: '900' },
  dayTextSelected: { color: C.paper, fontWeight: '900' },
  legendScroll: { flexGrow: 0, marginTop: 16 },
  legend: { paddingVertical: 3, paddingHorizontal: 1, flexDirection: 'row', gap: 8 },
  legendItem: { minHeight: 54, paddingLeft: 7, paddingRight: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: 'transparent', backgroundColor: C.paper },
  legendItemActive: { backgroundColor: C.surface, borderColor: C.line },
  legendIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  legendCheck: { position: 'absolute', right: -3, bottom: -2, width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: C.ink40, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  legendDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  legendText: { color: C.ink, fontSize: 14, fontWeight: '700' },
  legendTextOff: { color: C.ink40 },
  agenda: { padding: 16, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  discoverAgenda: { marginTop: 18 },
  inviteBanner: { minHeight: 52, marginBottom: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, backgroundColor: C.optic },
  inviteBannerText: { flex: 1, color: '#0E2321', fontSize: 12, fontWeight: '800' },
  agendaHead: { marginBottom: 12, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  agendaDateBadge: { width: 48, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.tealWash },
  agendaMonth: { color: C.teal, fontSize: 9, lineHeight: 14, letterSpacing: .8, fontWeight: '800' },
  agendaNumber: { color: C.ink, fontSize: 24, lineHeight: 29, fontWeight: '800', letterSpacing: -.6 },
  agendaDay: { color: C.ink, fontSize: 20, fontWeight: '800', letterSpacing: -.3 },
  agendaDate: { marginTop: 2, color: C.ink40, fontSize: 12, fontWeight: '600' },
  agendaCount: { color: C.ink40, fontSize: 11, fontWeight: '800' },
  entry: { marginTop: 8, padding: 13, overflow: 'hidden', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  entryMuted: { opacity: .6 },
  entryTime: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  entryTimeStart: { flexShrink: 1, color: C.ink70, fontSize: 10, lineHeight: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  entryBody: { minWidth: 0, marginTop: 10 },
  entryTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  entryTitle: { color: C.ink, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  strike: { textDecorationLine: 'line-through' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: C.paper },
  badgeAttention: { backgroundColor: C.optic },
  badgeText: { color: C.ink70, fontSize: 9, fontWeight: '900', letterSpacing: .3 },
  badgeTextAttention: { color: '#0E2321' },
  entryMeta: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 4 },
  entryMetaText: { flex: 1, color: C.ink40, fontSize: 11 },
  entryFoot: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  kindTag: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindTagText: { flexShrink: 1, fontSize: 10, fontWeight: '900' },
  avatarStack: { flexDirection: 'row' },
  avatarRing: { borderRadius: 13, borderWidth: 2, borderColor: C.surface },
  avatarOverlap: { marginLeft: -8 },
  loadingBox: { minHeight: 140, alignItems: 'center', justifyContent: 'center', gap: 8 },
  empty: { paddingHorizontal: 14, paddingVertical: 26, alignItems: 'center', borderRadius: 16, backgroundColor: C.paper },
  emptyIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: C.tealWash },
  emptyTitle: { marginTop: 14, color: C.ink, fontSize: 16, lineHeight: 22, fontWeight: '800', textAlign: 'center' },
  emptyText: { maxWidth: 320, marginTop: 5, color: C.ink40, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  emptyAction: { maxWidth: '100%', marginTop: 18, paddingHorizontal: 14 },
  discoverLink: { minHeight: 44, marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  upcomingRow: { minHeight: 58, marginTop: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  upcomingDate: { width: 38, alignItems: 'center' },
  upcomingMonth: { color: C.brick, fontSize: 8, fontWeight: '900', letterSpacing: .6 },
  upcomingDay: { color: C.ink, fontSize: 17, fontWeight: '900' },
  groupLabel: { marginTop: 20, marginBottom: 8, color: C.ink40, fontSize: 10, fontWeight: '900', letterSpacing: .9 },
  helperText: { marginTop: 6, color: C.ink40, fontSize: 11, lineHeight: 16 },
  helperInline: { marginTop: 2, color: C.ink40, fontSize: 11 },
  errorBox: { marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: C.brickWash },
  errorText: { flex: 1, color: C.brick, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  retryText: { color: C.brick, fontSize: 11, fontWeight: '900' },
  backdrop: { flex: 1, paddingHorizontal: 16, paddingTop: 16, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.7)' },
  sheet: { width: '100%', maxWidth: 480, maxHeight: '90%', paddingTop: 12, overflow: 'hidden', borderRadius: 24, backgroundColor: C.paper },
  newGameSheet: { height: '90%' },
  newGameSheetWide: { height: 'auto', maxWidth: 640 },
  handle: { alignSelf: 'center', width: 38, height: 4, marginBottom: 6, borderRadius: 2, backgroundColor: C.line },
  sheetHead: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetTitle: { marginTop: 2, color: C.ink, fontSize: 21, fontWeight: '800', letterSpacing: -.3 },
  sheetContent: { paddingHorizontal: 18, paddingBottom: 24 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: C.surface },
  kindIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  factList: { marginTop: 14, padding: 14, gap: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  factText: { flex: 1, color: C.ink, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  rosterRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rosterName: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '800' },
  rosterStatus: { color: C.ink40, fontSize: 11, fontWeight: '800' },
  rosterGoing: { color: C.teal },
  rosterOpen: { color: C.ink40, fontSize: 12, fontWeight: '700' },
  openSeat: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 },
  pickRow: { marginTop: 6, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  pickRowActive: { borderColor: C.teal, backgroundColor: C.tealWash },
  sharePanel: { gap: 8 },
  shareRow: { flexDirection: 'row', gap: 8 },
  shareButton: { flex: 1, minHeight: 64, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  shareButtonActive: { borderColor: C.teal, backgroundColor: C.tealWash },
  shareButtonText: { color: C.teal, fontSize: 11, fontWeight: '900', textAlign: 'center' },
  shareNotice: { color: C.teal, fontSize: 12, fontWeight: '800' },
  chipRow: { marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { maxWidth: 200, minHeight: 32, paddingLeft: 5, paddingRight: 9, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 1, borderColor: C.teal, backgroundColor: C.tealWash },
  chipText: { flexShrink: 1, color: C.ink, fontSize: 11, fontWeight: '800' },
  search: { minHeight: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 10, color: C.ink, fontSize: 13, fontWeight: '600' },
  field: { minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 13, fontWeight: '600' },
  fieldMultiline: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },
  spacer: { height: 8 },
  sheetActions: { marginTop: 18, gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  primary: { minHeight: 50, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic },
  primaryText: { color: '#0E2321', fontSize: 13, fontWeight: '900' },
  secondary: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  secondaryText: { color: C.teal, fontSize: 12, fontWeight: '900' },
  destructive: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.brick },
  destructiveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  textButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  textButtonDanger: { color: C.brick, fontSize: 12, fontWeight: '900' },
  confirmBox: { padding: 12, gap: 10, borderRadius: 14, backgroundColor: C.brickWash },
  confirmText: { color: C.brick, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  submit: { marginTop: 22 },
  disabled: { opacity: .45 },
  pressed: { opacity: .8 },
  newGameWhen: { gap: 4 },
  activityTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activityType: { flexBasis: '45%', flexGrow: 1, minWidth: 0, minHeight: 54, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  activityTypeActive: { backgroundColor: C.tealWash },
  activityTypeName: { flex: 1, minWidth: 0, color: C.ink, fontSize: 12, lineHeight: 18, fontWeight: '800' },
  newGameWhenWide: { flexDirection: 'row', alignItems: 'flex-start', gap: 22 },
  newGameCalendarCol: { width: 340 },
  slotCol: { marginTop: 18 },
  slotColWide: { flex: 1, marginTop: 16 },
  slotHover: { borderColor: C.teal },
  timeNudges: { flexDirection: 'row', gap: 6 },
  timeNudge: { width: 38, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(14,35,33,.25)', backgroundColor: 'rgba(255,255,255,.35)' },
  timeCard: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  timeCardSet: { borderColor: '#D6E94A', backgroundColor: '#D6E94A' },
  timeCardHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  timeCardEyebrow: { flex: 1, color: C.ink40, fontSize: 10, fontWeight: '900', letterSpacing: .9 },
  timeCardInk: { color: '#0E2321' },
  timeEntryRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeEntry: { flex: 1, minWidth: 0, paddingVertical: 4, color: C.ink, fontSize: 44, fontWeight: '900', letterSpacing: -1, fontVariant: ['tabular-nums'], outlineStyle: 'none' },
  meridiemToggle: { padding: 3, flexDirection: 'row', borderRadius: 12, backgroundColor: C.paper, gap: 3 },
  meridiemToggleSet: { backgroundColor: 'rgba(255,255,255,.4)' },
  meridiemButton: { width: 46, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  meridiemButtonActive: { backgroundColor: '#0E2321' },
  meridiemText: { color: C.ink70, fontSize: 12, fontWeight: '900', letterSpacing: .5 },
  meridiemTextActive: { color: '#D6E94A' },
  meridiemButtonOnLime: { backgroundColor: '#0E2321' },
  meridiemTextOnLime: { color: '#D6E94A' },
  timeCardFoot: { marginTop: 10, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeCardSub: { flex: 1, color: C.ink40, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  timeCardError: { color: C.brick },
  durationStepper: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  durationButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.paper },
  durationValue: { flex: 1, alignItems: 'center' },
  durationEntryRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 4 },
  durationEntry: { width: 56, paddingVertical: 0, color: C.ink, fontSize: 22, fontWeight: '900', textAlign: 'right', fontVariant: ['tabular-nums'], outlineStyle: 'none' },
  durationValueText: { color: C.ink, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  durationValueSub: { color: C.ink40, fontSize: 11, fontWeight: '700' },
  durationPresets: { marginTop: 8, flexDirection: 'row', gap: 6 },
  durationPreset: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  durationPresetActive: { backgroundColor: '#0E2321', borderColor: '#0E2321' },
  durationPresetTextActive: { color: '#D6E94A' },
  durationPresetText: { color: C.ink70, fontSize: 12, fontWeight: '800' },
  slotNext: { marginTop: 14 },
  slotNextIdle: { borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  slotNextIdleText: { color: C.ink70 },
  summaryCard: { minHeight: 52, marginTop: 6, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  summaryText: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '800' },
  summaryEdit: { color: C.teal, fontSize: 12, fontWeight: '900' },
  courtButton: { minHeight: 64, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: C.teal, backgroundColor: C.surface },
  courtButtonChosen: { borderStyle: 'solid', borderColor: C.line },
  courtButtonIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.teal },
});
// Dark mode: lime cards and chips keep dark ink, the chosen day turns lime to stand
// out on the dark sheet, and past days stay readable instead of fading into it.
const darkStyles = {
  ...createDarkStyleSheet(lightStyles),
  ...StyleSheet.create({
    timeCardSet: { borderColor: '#D6E94A', backgroundColor: '#D6E94A' },
    timeCardInk: { color: '#0E2321' },
    meridiemButtonActive: { backgroundColor: '#D6E94A' },
    meridiemTextActive: { color: '#0E2321' },
    meridiemToggleSet: { backgroundColor: 'rgba(14,35,33,.12)' },
    meridiemButtonOnLime: { backgroundColor: '#0E2321' },
    meridiemTextOnLime: { color: '#D6E94A' },
    daySelected: { backgroundColor: '#D6E94A' },
    dayTextSelected: { color: '#0E2321', fontWeight: '900' },
    dayTextMuted: { color: '#5E7771' },
    dayTextDisabled: { color: '#5E7771' },
    durationPresetActive: { backgroundColor: '#D6E94A', borderColor: '#D6E94A' },
    durationPresetTextActive: { color: '#0E2321' },
    // Lime surfaces keep dark ink; the active segment turns lime so it reads on the dark track.
    newButtonText: { color: '#0E2321', fontSize: 12, fontWeight: '900' },
    inviteBannerText: { flex: 1, color: '#0E2321', fontSize: 12, fontWeight: '800' },
    badgeTextAttention: { color: '#0E2321' },
    segmentActive: { backgroundColor: '#D6E94A' },
    segmentTextActive: { color: '#0E2321', fontWeight: '900' },
  }),
};
