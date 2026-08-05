import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import OpenPlayScreen from './OpenPlayScreen';
import ScrollView from '../components/FocusResetScrollView';
import WorkspaceSwitchModal from '../components/WorkspaceSwitchModal';
import { useOpenPlaySession } from '../context/OpenPlaySessionContext';
import { useAppMode } from '../context/AppModeContext';
import { useOrganizerPass } from '../context/OrganizerPassContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { cancelOpenPlayRegistration, checkInOpenPlayPlayer, inviteOpenPlayPlayer, reviewOpenPlayRegistration, searchOpenPlayInviteCandidates } from '../services/openPlayRegistration';
import { getOrganizerPassPlan } from '../services/organizerPass';
import { listManagedVenues, verifiedPublishingVenues } from '../services/database';
import { loadOrganizerPickleballHub } from '../services/pickleball';
import { listVenueStaff, removeVenueStaff, setVenueStaffRole } from '../services/realtimeOperations';
import BlinkingDot from '../components/BlinkingDot';

const BALL_IMAGE = require('../../public/images/ball.png');
const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;
function Icon({ name, size = 20, color = C.ink }) { return name === 'pickleball' ? <Image source={BALL_IMAGE} style={{ width: size, height: size, tintColor: color }} resizeMode="contain" /> : <Ionicons name={name} size={size} color={color} />; }
function KitchenLine() {
  const { isDark } = useTheme();
  return <View style={styles.kitchen}><View style={[styles.solid, isDark && styles.solidDark]} /><View style={[styles.dashed, isDark && styles.dashedDark]} /></View>;
}
function Header({ eyebrow, title, onBack }) { return <><View style={styles.header}><View style={styles.headerLeading}>{onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back to organizer workspace" onPress={onBack} style={styles.headerBack}><Icon name="arrow-back" size={20} /></Pressable> : null}<View style={styles.flex}><Text style={styles.eyebrow}>{eyebrow}</Text><Text numberOfLines={1} style={styles.h1}>{title}</Text></View></View><View style={styles.modePill}><Icon name="key-outline" size={14} color={C.teal} /><Text style={styles.modeText}>ORGANIZER</Text></View></View><KitchenLine /></>; }
function useOrganizerTheme() { const { isDark } = useTheme(); C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C; styles = isDark ? darkStyles : lightStyles; return isDark; }
function Shell({ children, eyebrow, title, onBack }) { const { isDark } = useTheme(); return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><Header eyebrow={eyebrow} title={title} onBack={onBack} />{children}</ScrollView></SafeAreaView>; }

function formatDateShort(value) {
  if (!value) return '—';
  const date = new Date(value);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear().toString().slice(-2);
  return `${month}/${year}`;
}

function SessionCard({ session, onPress }) {
  const courts = Array.isArray(session?.courts) ? session.courts : [];
  const queue = Array.isArray(session?.queue) ? session.queue : [];
  const completedMatches = Array.isArray(session?.completedMatches) ? session.completedMatches : [];
  const playing = courts.filter((court) => court?.match).length;
  if (!session) return <View style={styles.emptyCard}><View style={styles.emptyIcon}><Icon name="calendar-outline" color={C.teal} /></View><Text style={styles.emptyTitle}>No active open play</Text><Text style={styles.emptyMeta}>Create a session to start checking in players and assigning courts.</Text></View>;
  return <Pressable accessibilityRole="button" accessibilityLabel="Open live court monitor" onPress={onPress} style={({ pressed }) => [styles.sessionCard, pressed && styles.pressed]}><View style={styles.sessionHead}><View><Text style={styles.liveLabel}>● LIVE SESSION</Text><Text style={styles.sessionTitle}>{session.name || 'Today’s open play'}</Text></View><Icon name="chevron-forward" color={C.teal} /></View><View style={styles.stats}><View style={styles.stat}><Text style={styles.statValue}>{courts.length}</Text><Text style={styles.statLabel}>COURTS</Text></View><View style={styles.stat}><Text style={styles.statValue}>{playing}</Text><Text style={styles.statLabel}>IN PLAY</Text></View><View style={styles.stat}><Text style={styles.statValue}>{queue.length}</Text><Text style={styles.statLabel}>WAITING</Text></View><View style={styles.stat}><Text style={styles.statValue}>{completedMatches.length}</Text><Text style={styles.statLabel}>FINISHED</Text></View></View></Pressable>;
}

function organizerActivities(data) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const programs = (data?.programs || [])
    .filter((program) => program.registration_status !== 'cancelled' && new Date(program.ends_at) >= now)
    .map((program) => ({
      id: `program-${program.id}`,
      type: 'program',
      title: program.name,
      sortAt: new Date(program.starts_at).getTime(),
      status: new Date(program.starts_at) <= now ? 'HAPPENING NOW' : program.registration_status === 'open' ? 'REGISTRATION OPEN' : 'UPCOMING',
      meta: `${String(program.kind || 'program').replaceAll('_', ' ')} · ${new Date(program.starts_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
      route: 'Programs',
      icon: 'school-outline',
    }));
  const competitions = (data?.competitions || [])
    .filter((competition) => ['registration', 'active'].includes(competition.status) && (!competition.ends_on || competition.ends_on >= today))
    .map((competition) => ({
      id: `competition-${competition.id}`,
      type: 'competition',
      title: competition.name,
      sortAt: new Date(`${competition.starts_on}T00:00:00`).getTime(),
      status: competition.status === 'active' ? 'ACTIVE' : 'REGISTRATION OPEN',
      meta: `${String(competition.kind || 'competition').replaceAll('_', ' ')} · ${new Date(`${competition.starts_on}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      route: 'Competition',
      icon: 'trophy-outline',
    }));
  return [...programs, ...competitions]
    .sort((left, right) => {
      const leftLive = ['HAPPENING NOW', 'ACTIVE'].includes(left.status);
      const rightLive = ['HAPPENING NOW', 'ACTIVE'].includes(right.status);
      return leftLive === rightLive ? left.sortAt - right.sortAt : leftLive ? -1 : 1;
    })
    .slice(0, 4);
}

function PublishedActivityCard({ activities, loading, error, onPress }) {
  if (loading) return <View style={styles.activityLoading}><ActivityIndicator color={C.teal} /><Text style={styles.activityLoadingText}>Loading organizer activities…</Text></View>;
  if (error) return <View style={styles.errorCard}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View>;
  if (!activities.length) return <View style={styles.emptyCard}><View style={styles.emptyIcon}><Icon name="calendar-outline" color={C.teal} /></View><Text style={styles.emptyTitle}>No active activities</Text><Text style={styles.emptyMeta}>Create an Open Play session, program, or competition and it will appear here.</Text></View>;
  return <View style={styles.activityCard}>{activities.map((activity, index) => <Pressable key={activity.id} accessibilityRole="button" accessibilityLabel={`Open ${activity.title}`} onPress={() => onPress(activity)} style={({ pressed }) => [styles.activityRow, index > 0 && styles.rowBorder, pressed && styles.pressed]}><View style={styles.activityIcon}><Icon name={activity.icon} color={C.teal} /></View><View style={styles.flex}><Text style={styles.activityStatus}>{activity.status}</Text><Text numberOfLines={1} style={styles.activityTitle}>{activity.title}</Text><Text numberOfLines={1} style={styles.activityMeta}>{activity.meta}</Text></View><Icon name="chevron-forward" color={C.teal} /></Pressable>)}</View>;
}

function OrganizerCreateSheet({ visible, hasActiveSession, onClose, onOpenPlay, onProgram, onCompetition, onMembership }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close create menu" onPress={onClose} style={styles.createChoiceBackdrop}>
      <Pressable onPress={(event) => event.stopPropagation()} style={styles.createChoiceSheet}>
        <View style={styles.createChoiceHandle} />
        <View style={styles.createChoiceHeader}><View style={styles.flex}><Text style={styles.createChoiceEyebrow}>CREATE</Text><Text style={styles.createChoiceTitle}>What are you organizing?</Text><Text style={styles.createChoiceMeta}>Choose a format. Peakle will take you directly to the right setup.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.createChoiceClose}><Icon name="close" size={20} color={C.ink40} /></Pressable></View>
        <ScrollView style={styles.createChoiceScroll} contentContainerStyle={styles.createChoiceList} showsVerticalScrollIndicator={false}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open play" onPress={onOpenPlay} style={[styles.createChoiceCard, styles.createChoiceOpenPlay]}><View style={styles.createChoiceIcon}><Icon name="pickleball" size={25} color="#0E2321" /></View><View style={styles.flex}><Text style={[styles.createChoiceCardTitle, { color: '#0E2321' }]}>{hasActiveSession ? 'Open Play sessions' : 'Open Play'}</Text><Text style={[styles.createChoiceCardMeta, { color: 'rgba(14,35,33,.72)' }]}>{hasActiveSession ? 'Resume today’s session or manage your open-play schedule.' : 'Run registration, queues, rotations, courts, and live scores.'}</Text></View><Icon name="arrow-forward" color="#0E2321" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Program" onPress={onProgram} style={styles.createChoiceCard}><View style={[styles.createChoiceIcon, styles.createChoiceProgramIcon]}><Icon name="school-outline" size={24} color={C.teal} /></View><View style={styles.flex}><Text style={styles.createChoiceCardTitle}>Program</Text><Text style={styles.createChoiceCardMeta}>Publish coaching, clinics, camps, or recurring sessions.</Text></View><Icon name="arrow-forward" color={C.teal} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Competition" onPress={onCompetition} style={styles.createChoiceCard}><View style={[styles.createChoiceIcon, styles.createChoiceCompetitionIcon]}><Icon name="trophy-outline" size={24} color={C.teal} /></View><View style={styles.flex}><Text style={styles.createChoiceCardTitle}>Competition</Text><Text style={styles.createChoiceCardMeta}>Create a tournament, league, ladder, or season with divisions.</Text></View><Icon name="arrow-forward" color={C.teal} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Membership or package" onPress={onMembership} style={styles.createChoiceCard}><View style={[styles.createChoiceIcon, styles.createChoiceMembershipIcon]}><Icon name="card-outline" size={24} color={C.teal} /></View><View style={styles.flex}><Text style={styles.createChoiceCardTitle}>Membership or package</Text><Text style={styles.createChoiceCardMeta}>Offer memberships, court packs, credits, and discounts.</Text></View><Icon name="arrow-forward" color={C.teal} /></Pressable>
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.createChoiceCancel}><Text style={styles.createChoiceCancelText}>Cancel</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
}

export function OrganizerOverviewScreen({ navigation }) {
  useOrganizerTheme();
  const { session } = useOpenPlaySession();
  const { hasOrganizerAccess } = useOrganizerPass();
  const [createOpen, setCreateOpen] = useState(false);
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true;
    setActivitiesLoading(true);
    setActivitiesError('');
    listManagedVenues()
      .then(verifiedPublishingVenues)
      .then(loadOrganizerPickleballHub)
      .then((data) => { if (active) setActivities(organizerActivities(data)); })
      .catch((loadError) => {
        if (!active) return;
        setActivities([]);
        setActivitiesError(loadError.message || 'Organizer activities could not be loaded.');
      })
      .finally(() => { if (active) setActivitiesLoading(false); });
    return () => { active = false; };
  }, []));
  const openPrimary = () => {
    if (!hasOrganizerAccess) { navigation.navigate('Pass'); return; }
    if (session) { navigation.navigate('Monitor'); return; }
    setCreateOpen(true);
  };
  const openCreateMenu = () => {
    if (!hasOrganizerAccess) { navigation.navigate('Pass'); return; }
    setCreateOpen(true);
  };
  const chooseOpenPlay = () => {
    setCreateOpen(false);
    navigation.navigate('Sessions');
  };
  const chooseHubActivity = (routeName) => {
    setCreateOpen(false);
    navigation.navigate(routeName, { ownerTab: 'Overview' });
  };
  const chooseProgram = () => chooseHubActivity('CreateProgram');
  const chooseCompetition = () => {
    chooseHubActivity('CreateCompetition');
  };
  const chooseMembership = () => chooseHubActivity('CreateMembership');
  const primaryIcon = !hasOrganizerAccess ? 'lock-closed-outline' : session ? 'arrow-forward' : 'add';
  const hasPublishedActivities = activities.length > 0;
  return <><Shell eyebrow="ORGANIZER WORKSPACE" title="Overview">
    <View style={styles.hero}><View style={styles.heroIcon}><Icon name="grid-outline" size={25} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.heroTitle}>Courts without the clipboard.</Text><Text style={styles.heroMeta}>Run registration, rotations, scorers, and live court monitoring from one workspace.</Text></View></View>
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>{session ? 'HAPPENING NOW' : 'ORGANIZER ACTIVITY'}</Text><Text style={styles.h2}>{session ? 'Active open play' : hasPublishedActivities ? 'Active & upcoming' : 'Your activities'}</Text></View>{session && <View style={styles.livePill}><BlinkingDot style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>}</View>
    {session ? <><SessionCard session={session} onPress={() => navigation.navigate('Monitor')} />{hasPublishedActivities ? <><Text style={styles.sectionLabel}>OTHER ACTIVE &amp; UPCOMING</Text><PublishedActivityCard activities={activities} loading={false} error="" onPress={(activity) => navigation.navigate(activity.route, { ownerTab: 'Overview' })} /></> : null}</> : <PublishedActivityCard activities={activities} loading={activitiesLoading} error={activitiesError} onPress={(activity) => navigation.navigate(activity.route, { ownerTab: 'Overview' })} />}
    <Pressable accessibilityRole="button" onPress={openPrimary} style={styles.primaryButton}><Text style={styles.primaryText}>{session ? 'Open court monitor' : hasOrganizerAccess ? 'Create activity' : 'View Organizer Pass'}</Text><Icon name={primaryIcon} color="#0E2321" /></Pressable>
    {session && hasOrganizerAccess ? <Pressable accessibilityRole="button" onPress={openCreateMenu} style={styles.secondaryButton}><Icon name="add-circle-outline" size={18} color={C.teal} /><Text style={styles.secondaryText}>Create another activity</Text></Pressable> : null}
    <View style={styles.quickGrid}><Pressable accessibilityRole="button" accessibilityLabel="Open Open Play" onPress={() => navigation.navigate('Sessions')} style={styles.quickCard}><Icon name="calendar-outline" color={C.teal} /><Text style={styles.quickTitle}>Open Play</Text><Text style={styles.quickMeta}>Set up or resume a session.</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Manage open-play players" onPress={() => navigation.navigate('Players')} style={styles.quickCard}><Icon name="people-outline" color={C.teal} /><Text style={styles.quickTitle}>Players</Text><Text style={styles.quickMeta}>See attendance and queue status.</Text></Pressable></View>
  </Shell><OrganizerCreateSheet visible={createOpen} hasActiveSession={Boolean(session)} onClose={() => setCreateOpen(false)} onOpenPlay={chooseOpenPlay} onProgram={chooseProgram} onCompetition={chooseCompetition} onMembership={chooseMembership} /></>;
}

export function OrganizerSessionsScreen({ navigation }) {
  useOrganizerTheme();
  const { session, resetSession } = useOpenPlaySession();
  const { hasOrganizerAccess } = useOrganizerPass();
  const startNew = () => {
    if (!hasOrganizerAccess) { navigation.navigate('Pass'); return; }
    resetSession();
    navigation.navigate('Monitor');
  };
  return <Shell eyebrow="ORGANIZER WORKSPACE" title="Open Play">
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>{session ? 'HAPPENING NOW' : 'OPEN PLAY'}</Text><Text style={styles.h2}>{session ? 'Your live session' : 'Run a friendly session'}</Text></View>{session ? <View style={styles.livePill}><BlinkingDot style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View> : null}</View>
    <SessionCard session={session} onPress={() => navigation.navigate('Monitor')} />
    {session ? <><Pressable accessibilityRole="button" onPress={() => navigation.navigate('Monitor')} style={styles.primaryButton}><Text style={styles.primaryText}>Open live monitor</Text><Icon name="play" color="#0E2321" /></Pressable><View style={styles.quickGrid}><Pressable accessibilityRole="button" accessibilityLabel="Manage players" onPress={() => navigation.navigate('Players')} style={styles.quickCard}><Icon name="people-outline" color={C.teal} /><Text style={styles.quickTitle}>Manage players</Text><Text style={styles.quickMeta}>Approve, check in, and view the queue.</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="View courts" onPress={() => navigation.navigate('Monitor')} style={styles.quickCard}><Icon name="grid-outline" color={C.teal} /><Text style={styles.quickTitle}>View courts</Text><Text style={styles.quickMeta}>Follow rotations and live matches.</Text></Pressable></View></> : <><Pressable accessibilityRole="button" onPress={startNew} style={styles.primaryButton}><Text style={styles.primaryText}>{hasOrganizerAccess ? 'Set up open play' : 'Unlock open play'}</Text><Icon name={hasOrganizerAccess ? 'add' : 'lock-closed-outline'} color="#0E2321" /></Pressable><Text style={styles.sectionLabel}>THREE SIMPLE STEPS</Text><View style={styles.stepsCard}>{[['1', 'Choose the session details'], ['2', 'Invite or approve players'], ['3', 'Open the live court monitor']].map(([number, label], index) => <View key={number} style={[styles.step, index > 0 && styles.rowBorder]}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View><Text style={styles.stepText}>{label}</Text><Icon name="checkmark-circle-outline" color={C.teal} /></View>)}</View></>}
  </Shell>;
}

export function OrganizerPlayersScreen() {
  useOrganizerTheme();
  const { session, registrations, refreshRegistrations } = useOpenPlaySession();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [playerFilter, setPlayerFilter] = useState('all');
  const [actionPlayer, setActionPlayer] = useState(null);
  useFocusEffect(useCallback(() => { refreshRegistrations().catch((loadError) => setError(loadError.message || 'Registration could not be refreshed.')); }, [refreshRegistrations]));
  const run = async (id, operation) => {
    setBusyId(id); setError('');
    try { await operation(); await refreshRegistrations(); }
    catch (actionError) { setError(actionError.message || 'The registration could not be updated.'); }
    finally { setBusyId(null); }
  };
  const search = async () => {
    setError(''); setSearching(true);
    try { setCandidates(await searchOpenPlayInviteCandidates(query.trim())); }
    catch (searchError) { setError(searchError.message || 'Player search failed.'); }
    finally { setSearching(false); }
  };
  const statusLabel = (player) => player.playStatus === 'playing' ? 'ON COURT' : player.playStatus === 'done' ? 'DONE' : player.status === 'requested' ? 'REQUESTED' : player.status === 'waitlisted' ? 'WAITLIST' : player.status === 'rejected' ? 'DECLINED' : player.status === 'cancelled' ? 'CANCELLED' : player.checkedInAt ? 'CHECKED IN' : 'APPROVED';
  const statusKey = (player) => player.playStatus === 'playing' ? 'playing' : player.playStatus === 'done' || ['rejected', 'cancelled'].includes(player.status) ? 'done' : ['requested', 'waitlisted'].includes(player.status) ? 'needs_action' : player.checkedInAt ? 'checked_in' : 'approved';
  const filterOptions = [
    ['all', 'All'],
    ['needs_action', 'Needs action'],
    ['checked_in', 'Checked in'],
    ['playing', 'On court'],
    ['done', 'Done'],
  ];
  const visibleRegistrations = playerFilter === 'all' ? registrations : registrations.filter((player) => statusKey(player) === playerFilter);
  const secondaryActionsAvailable = (player) => player?.status === 'requested' || (['requested', 'waitlisted', 'approved'].includes(player?.status) && player?.playStatus !== 'playing');
  const closeActions = () => setActionPlayer(null);
  const runSheetAction = (operation) => {
    const player = actionPlayer;
    closeActions();
    if (player) run(player.id, operation);
  };
  return <><Shell eyebrow="ORGANIZER WORKSPACE" title="Players">
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>CURRENT SESSION</Text><Text style={styles.h2}>{registrations.length ? `${registrations.length} registered` : 'Registration'}</Text></View>{session?.code ? <View style={styles.codePill}><Text style={styles.codePillText}>{session.code}</Text></View> : null}</View>
    {error ? <View style={styles.errorCard}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
    {!!registrations.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playerFilters}>{filterOptions.map(([value, label]) => { const count = value === 'all' ? registrations.length : registrations.filter((player) => statusKey(player) === value).length; return <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: playerFilter === value }} onPress={() => setPlayerFilter(value)} style={[styles.playerFilter, playerFilter === value && styles.playerFilterActive]}><Text style={[styles.playerFilterText, playerFilter === value && styles.playerFilterTextActive]}>{label}</Text><View style={[styles.playerFilterCount, playerFilter === value && styles.playerFilterCountActive]}><Text style={[styles.playerFilterCountText, playerFilter === value && styles.playerFilterCountTextActive]}>{count}</Text></View></Pressable>; })}</ScrollView>}
    {!registrations.length ? <View style={styles.emptyCard}><View style={styles.emptyIcon}><Icon name="people-outline" color={C.teal} /></View><Text style={styles.emptyTitle}>{session ? 'No players registered' : 'No active session'}</Text><Text style={styles.emptyMeta}>{session ? 'Share the session code or wait for public players to join.' : 'Create an open-play session first, then registrations and check-ins will appear here.'}</Text></View> : !visibleRegistrations.length ? <View style={styles.filteredEmpty}><Icon name="filter-outline" color={C.teal} /><Text style={styles.filteredEmptyText}>No players in this view.</Text></View> : <View style={styles.playersCard}>{visibleRegistrations.map((player, index) => {
      const hasPrimaryAction = ['requested', 'waitlisted'].includes(player.status) || (player.status === 'approved' && !player.checkedInAt);
      return <View key={player.id} style={[styles.registrationRow, index > 0 && styles.rowBorder]}><View style={styles.registrationMain}><View style={styles.avatar}><Text style={styles.avatarText}>{(player.name || 'Guest').split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}</Text></View><View style={styles.flex}><Text style={styles.playerName}>{player.name || 'Guest player'}</Text><Text style={styles.playerMeta}>{player.skill != null ? `Rating ${Number(player.skill).toFixed(1)} · ` : ''}{player.checkedInAt ? 'Arrived' : 'Not checked in'}</Text></View>
      {hasPrimaryAction ? <Pressable disabled={busyId === player.id} onPress={() => {
        if (['requested', 'waitlisted'].includes(player.status)) run(player.id, () => reviewOpenPlayRegistration(player.id, true));
        else if (player.status === 'approved' && !player.checkedInAt) run(player.id, () => checkInOpenPlayPlayer(player.id));
      }} style={styles.inlineActionPill}>{busyId === player.id ? <ActivityIndicator size="small" color="#0E2321" /> : <Text style={styles.inlineActionPillText}>{['requested', 'waitlisted'].includes(player.status) ? 'APPROVE' : 'CHECK IN'}</Text>}</Pressable> : <View style={[styles.status, player.checkedInAt && styles.statusPlaying, ['rejected', 'cancelled'].includes(player.status) && styles.statusDone]}><Text style={[styles.statusText, player.checkedInAt ? { color: '#0E2321' } : {}, ['rejected', 'cancelled'].includes(player.status) && styles.statusTextDone]}>{statusLabel(player)}</Text></View>}
      {secondaryActionsAvailable(player) && <Pressable accessibilityRole="button" accessibilityLabel={`More actions for ${player.name || 'player'}`} onPress={() => setActionPlayer(player)} style={styles.playerOverflowInline}><Icon name="ellipsis-horizontal" size={20} color={C.teal} /></Pressable>}
      </View></View>; })}</View>}
    {session?.visibility === 'invite_only' ? <><Text style={styles.sectionLabel}>INVITE PEAKLE PLAYERS</Text><View style={styles.inviteSearch}><TextInput accessibilityLabel="Search players to invite" returnKeyType="search" onSubmitEditing={query.trim().length >= 2 ? search : undefined} value={query} onChangeText={(value) => { setQuery(value); if (candidates.length) setCandidates([]); }} placeholder="Search player name" placeholderTextColor={C.ink40} style={styles.inviteInput} /><Pressable accessibilityRole="button" accessibilityLabel="Search players" accessibilityState={{ disabled: query.trim().length < 2 || searching }} disabled={query.trim().length < 2 || searching} onPress={search} style={({ pressed }) => [styles.inviteSearchButton, (query.trim().length < 2 || searching) && styles.disabled, pressed && styles.pressed]}>{searching ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name="search" size={18} color="#0E2321" />}</Pressable></View>{candidates.map((candidate) => <View key={candidate.id} style={styles.candidateRow}><View style={styles.flex}><Text style={styles.playerName}>{candidate.display_name}</Text><Text style={styles.playerMeta}>{candidate.home_area || 'Peakle player'}{candidate.skill_rating != null ? ` · ${candidate.skill_rating}` : ''}</Text></View><Pressable disabled={busyId != null} onPress={() => run(candidate.id, () => inviteOpenPlayPlayer(session.id, candidate.id))} style={styles.approveButton}><Text style={[styles.approveText, { color: '#0E2321' }]}>Invite</Text></Pressable></View>)}</> : null}
  </Shell><Modal visible={!!actionPlayer} transparent animationType="fade" onRequestClose={closeActions}><Pressable accessibilityRole="button" accessibilityLabel="Close player actions" onPress={closeActions} style={styles.actionSheetBackdrop}><Pressable onPress={(event) => event.stopPropagation()} style={styles.actionSheet}>
    <View style={styles.actionSheetHandle} /><Text style={styles.actionSheetEyebrow}>PLAYER ACTIONS</Text><Text style={styles.actionSheetTitle}>{actionPlayer?.name || 'Guest player'}</Text><Text style={styles.actionSheetMeta}>Use the main row button for the most common next step. Less frequent actions stay here.</Text>
    {actionPlayer?.status === 'requested' && <Pressable disabled={busyId != null} onPress={() => runSheetAction(() => reviewOpenPlayRegistration(actionPlayer.id, false))} style={styles.actionSheetRow}><View style={styles.actionSheetIcon}><Icon name="close-circle-outline" color={C.brick} /></View><View style={styles.flex}><Text style={styles.actionSheetRowTitle}>Decline request</Text><Text style={styles.actionSheetRowMeta}>The player will not be added to this session.</Text></View></Pressable>}
    {actionPlayer && ['requested', 'waitlisted', 'approved'].includes(actionPlayer.status) && actionPlayer.playStatus !== 'playing' && <Pressable disabled={busyId != null} onPress={() => runSheetAction(() => cancelOpenPlayRegistration(actionPlayer.id))} style={styles.actionSheetRow}><View style={styles.actionSheetIcon}><Icon name="trash-outline" color={C.brick} /></View><View style={styles.flex}><Text style={styles.actionSheetRowTitle}>Remove from session</Text><Text style={styles.actionSheetRowMeta}>Their registration and queue spot will be removed.</Text></View></Pressable>}
    <Pressable onPress={closeActions} style={styles.actionSheetCancel}><Text style={styles.actionSheetCancelText}>Cancel</Text></Pressable>
  </Pressable></Pressable></Modal></>;
}

export function OrganizerMoreScreen({ navigation }) {
  const isDark = useOrganizerTheme();
  const { toggleColorMode } = useTheme();
  const { setMode } = useAppMode();
  const [pendingMode, setPendingMode] = useState(null);
  const { entitlement, hasOrganizerAccess, hasPassCapability, hydrated, isAdminAccess, passTier } = useOrganizerPass();
  const activePlan = hasOrganizerAccess && !isAdminAccess ? getOrganizerPassPlan(entitlement.planId) : null;
  const passName = !hydrated ? 'Organizer Pass' : isAdminAccess ? 'Administrator' : hasOrganizerAccess ? `Organizer ${passTier ? passTier.charAt(0).toUpperCase() + passTier.slice(1) : 'Pass'}` : 'Organizer Pass';
  const passDetail = !hydrated
    ? 'Checking your organizer access…'
    : isAdminAccess
      ? 'Full organizer access · No expiration'
      : hasOrganizerAccess
        ? `${activePlan.name} plan · ${entitlement.autoRenews ? 'Renews' : 'Ends'} ${new Date(entitlement.currentPeriodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : 'Choose a plan to unlock organizer tools';
  const passStatus = !hydrated ? 'CHECKING' : hasOrganizerAccess ? 'ACTIVE' : 'LOCKED';
  const isPro = passTier === 'pro' || isAdminAccess;
  const sections = [
    {
      title: 'RUN YOUR VENUE',
      items: [
        { route: 'Venue', icon: 'business-outline', title: 'Venue', detail: 'Courts, hours, pricing and availability' },
        { route: 'Staff', icon: 'people-outline', title: 'Staff & permissions', detail: hasPassCapability('staff_access') ? 'Manage team roles and access' : 'Pro · Manage team roles and access', locked: !hasPassCapability('staff_access') },
        { route: 'Programs', params: { ownerTab: 'More' }, icon: 'school-outline', title: 'Programs', detail: 'Clinics, coaching, camps and recurring sessions' },
        { route: 'Competition', params: { ownerTab: 'More' }, icon: 'trophy-outline', title: 'Competition', detail: 'Tournaments, leagues, ladders and divisions' },
        { route: 'Memberships', params: { ownerTab: 'More' }, icon: 'card-outline', title: 'Memberships & packages', detail: 'Memberships, court packs, credits and discounts' },
      ],
    },
    {
      title: 'INSIGHTS & REPORTS',
      items: [
        { route: 'Analytics', params: { ownerTab: 'More' }, icon: 'analytics-outline', title: 'Venue analytics', detail: hasPassCapability('advanced_analytics') ? 'Revenue, utilization, attendance and retention' : 'Pro · Revenue, utilization, attendance and retention' },
      ],
    },
    {
      title: 'ACCOUNT',
      items: [
        { route: 'Profile', icon: 'person-outline', title: 'Organizer profile', detail: 'Host identity, alerts and organizer preferences' },
        {
          key: 'dark-mode',
          kind: 'theme',
          icon: isDark ? 'moon' : 'sunny-outline',
          title: 'Dark mode',
          detail: isDark ? 'On · Easier on your eyes at night' : 'Off · Tap for a darker workspace',
          active: isDark,
          onPress: toggleColorMode,
        },
        {
          key: 'switch-player',
          icon: 'pickleball',
          title: 'Switch to Player',
          detail: 'Bookings, matches, teams and player statistics',
          switchTarget: 'PLAYER',
          onPress: () => setPendingMode('player'),
        },
      ],
    },
  ];
  return <><Shell eyebrow="ORGANIZER WORKSPACE" title="More">
    <Pressable accessibilityRole="button" accessibilityLabel={`Organizer Pass, ${passStatus.toLowerCase()}`} accessibilityHint="View plan and organizer access" onPress={() => navigation.navigate('Pass')} style={({ pressed }) => [styles.passSummaryCard, isPro && styles.passSummaryCardPro, pressed && styles.pressed]}>
      {isPro && (
        <Svg style={StyleSheet.absoluteFillObject} viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="gradSum" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={LIGHT_C.optic} stopOpacity="1" />
              <Stop offset="1" stopColor="#1C6B66" stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill="url(#gradSum)" />
        </Svg>
      )}
      <View style={styles.passSummaryContent}>
        <View style={styles.passSummaryHead}>
          <View style={[styles.passSummaryIcon, isPro && styles.passSummaryIconPro]}><Icon name="diamond-outline" size={17} color={isPro ? '#FFFFFF' : LIGHT_C.optic} /></View>
          <View style={styles.flex}>
            <Text style={[styles.passSummaryEyebrow, isPro && styles.passSummaryEyebrowPro]}>ORGANIZER ACCESS</Text>
            <Text numberOfLines={1} style={[styles.passSummaryTitle, isPro && styles.passSummaryTitlePro]}>{passName}</Text>
          </View>
          <View style={[styles.passStatus, isPro && styles.passStatusPro]}><View style={[styles.passStatusDot, isPro && styles.passStatusDotPro]} /><Text style={[styles.passStatusText, isPro && styles.passStatusTextPro]}>{passStatus}</Text></View>
        </View>
        <Text style={[styles.passSummaryMeta, isPro && styles.passSummaryMetaPro]}>{passDetail}</Text>
        <View style={[styles.passSummaryFooter, isPro && styles.passSummaryFooterPro]}>
          <View style={styles.passBenefit}>
            <Icon name={hasOrganizerAccess ? 'shield-checkmark-outline' : 'lock-closed-outline'} size={14} color="#0E2321" />
            <Text style={[styles.passBenefitText, isPro && styles.passBenefitTextPro]}>{hasOrganizerAccess ? 'Organizer workspace unlocked' : 'Unlock organizer tools'}</Text>
          </View>
          <View style={styles.passSummaryAction}>
            <Text style={[styles.passSummaryActionText, isPro && styles.passSummaryActionTextPro]}>{hasOrganizerAccess ? 'Manage' : 'View plans'}</Text>
            <Icon name="chevron-forward" size={14} color="#0E2321" />
          </View>
        </View>
      </View>
    </Pressable>
    {sections.map((section) => <View key={section.title} style={styles.moreSection}>
      <Text style={styles.moreSectionLabel}>{section.title}</Text>
      <View style={styles.moreCard}>{section.items.map((item, index) => <Pressable key={item.key || item.route} accessibilityRole={item.kind === 'theme' ? 'switch' : 'button'} accessibilityState={item.kind === 'theme' ? { checked: item.active } : undefined} accessibilityLabel={item.title} accessibilityHint={item.detail} onPress={item.onPress || (() => navigation.navigate(item.locked ? 'Pass' : item.route, item.params))} style={({ pressed }) => [styles.moreRow, index > 0 && styles.rowBorder, pressed && styles.pressed]}><View style={[styles.moreIcon, item.switchTarget && styles.switchIcon, item.kind === 'theme' && item.active && styles.themeIconActive]}><Icon name={item.locked ? 'lock-closed-outline' : item.icon} color={item.switchTarget || (item.kind === 'theme' && item.active) ? '#0E2321' : C.teal} /></View><View style={styles.flex}><Text style={styles.moreTitle}>{item.title}</Text><Text style={styles.moreMeta}>{item.detail}</Text></View>{item.kind === 'theme' ? <View style={[styles.themeToggle, item.active && styles.themeToggleOn]}><View style={[styles.themeKnob, item.active && styles.themeKnobOn]} /></View> : item.switchTarget ? <View style={styles.switchDestination}><Text style={styles.switchDestinationText}>{item.switchTarget}</Text><Icon name="swap-horizontal" size={15} color="#0E2321" /></View> : <View style={styles.moreChevron}><Icon name={item.locked ? 'diamond-outline' : 'chevron-forward'} size={16} color={C.teal} /></View>}</Pressable>)}</View>
    </View>)}
  </Shell><WorkspaceSwitchModal nextMode={pendingMode} onCancel={() => setPendingMode(null)} onConfirm={() => { const nextMode = pendingMode; setPendingMode(null); setMode(nextMode); }} /></>;
}

const STAFF_ROLES = [
  ['manager', 'Manager'], ['front_desk', 'Front desk'], ['court_monitor', 'Court monitor'], ['scorer', 'Scorer'], ['viewer', 'Read only'],
];
const STAFF_ROLE_DETAILS = {
  manager: 'Full venue operations, staff, sessions, and reports.',
  front_desk: 'Registration, bookings, player check-in, and attendance.',
  court_monitor: 'Live queues, rotations, court assignments, and results.',
  scorer: 'Enter and update scores without venue administration.',
  viewer: 'View venue activity without making changes.',
};

export function OrganizerStaffScreen({ navigation }) {
  const isDark = useOrganizerTheme();
  const { hydrated, hasPassCapability } = useOrganizerPass();
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState(null);
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [role, setRole] = useState('court_monitor');
  const [roleEditor, setRoleEditor] = useState(null);
  const [draftRole, setDraftRole] = useState('court_monitor');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async (selectedVenue) => {
    if (!selectedVenue) return;
    setStaff(await listVenueStaff(selectedVenue));
  }, []);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setError('');
    listManagedVenues().then(async (rows) => {
      if (!active) return;
      setVenues(rows);
      const selected = rows[0]?.id || null;
      setVenueId(selected);
      if (selected) await refresh(selected);
      else setStaff([]);
    }).catch((loadError) => { if (active) setError(loadError.message || 'Staff access could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]));
  const search = async () => {
    setError('');
    try { setCandidates(await searchOpenPlayInviteCandidates(query)); } catch (searchError) { setError(searchError.message || 'Search failed.'); }
  };
  const assign = async (userId, nextRole = role) => {
    setBusy(true); setError('');
    try { await setVenueStaffRole(venueId, userId, nextRole); await refresh(venueId); setCandidates([]); setQuery(''); }
    catch (assignError) { setError(assignError.message || 'Staff access could not be updated.'); }
    finally { setBusy(false); }
  };
  const remove = async (userId) => {
    setBusy(true); setError('');
    try { await removeVenueStaff(venueId, userId); await refresh(venueId); }
    catch (removeError) { setError(removeError.message || 'Staff member could not be removed.'); }
    finally { setBusy(false); }
  };
  const confirmRemove = (member) => Alert.alert(
    'Remove staff access?',
    `${member.profiles?.display_name || 'This staff member'} will immediately lose access to this venue.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => remove(member.user_id) }],
  );
  const openRoleEditor = (member = null) => {
    const nextRole = member?.role || role;
    setDraftRole(STAFF_ROLES.some(([value]) => value === nextRole) ? nextRole : 'viewer');
    setRoleEditor(member || { addMode: true });
  };
  const saveRole = async () => {
    if (roleEditor?.user_id) await assign(roleEditor.user_id, draftRole);
    else setRole(draftRole);
    setRoleEditor(null);
  };
  if (!hydrated) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><View style={styles.locked}><ActivityIndicator color={C.teal} /><Text style={styles.loadingText}>Checking staff access…</Text></View></SafeAreaView>;
  if (!hasPassCapability('staff_access')) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><View style={styles.locked}><View style={styles.lockedIcon}><Icon name="diamond-outline" size={27} color={C.teal} /></View><Text style={styles.lockedEyebrow}>ORGANIZER PRO</Text><Text style={styles.lockedTitle}>Staff tools are a Pro feature</Text><Text style={styles.lockedMeta}>Upgrade to assign managers, front desk staff, court monitors, scorers, and read-only roles.</Text><Pressable onPress={() => navigation.navigate('Pass')} style={[styles.primaryButton, styles.lockedButton]}><Text style={styles.primaryText}>View Pro plan</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable><Pressable onPress={() => navigation.navigate('More')} style={[styles.secondaryButton, styles.lockedButton]}><Text style={styles.secondaryText}>Back to workspace</Text></Pressable></View></SafeAreaView>;
  return <><Shell eyebrow="VENUE OPERATIONS" title="Staff access" onBack={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('More')}>
    {venues.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.staffVenueRow}>{venues.map((venue) => <Pressable key={venue.id} onPress={() => { setVenueId(venue.id); setCandidates([]); setLoading(true); refresh(venue.id).catch((loadError) => setError(loadError.message || 'Staff access could not be loaded.')).finally(() => setLoading(false)); }} style={[styles.staffVenue, venue.id === venueId && styles.staffVenueActive]}><Text style={[styles.staffVenueText, venue.id === venueId && styles.staffVenueTextActive]}>{venue.name}</Text></Pressable>)}</ScrollView> : null}
    {error ? <View style={[styles.errorCard, { marginTop: 12 }]}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
    <Text style={styles.sectionLabel}>CURRENT TEAM</Text>
    {loading ? <ActivityIndicator style={styles.sectionLoader} color={C.teal} /> : !venues.length ? <View style={styles.emptyCard}><Icon name="business-outline" size={28} color={C.teal} /><Text style={styles.emptyTitle}>No managed venue</Text><Text style={styles.emptyMeta}>Create or join a verified venue before assigning staff permissions.</Text></View> : !staff.length ? <View style={styles.emptyCard}><Icon name="key-outline" size={28} color={C.teal} /><Text style={styles.emptyTitle}>No staff assigned</Text><Text style={styles.emptyMeta}>Search for a Peakle account below to grant venue access.</Text></View> : <View style={styles.playersCard}>{staff.map((member, index) => <View key={member.user_id} style={[styles.staffRow, index > 0 && styles.rowBorder]}><View style={styles.flex}><Text style={styles.playerName}>{member.profiles?.display_name || 'Venue staff'}</Text><Text style={styles.playerMeta}>{STAFF_ROLES.find(([value]) => value === member.role)?.[1] || member.role}</Text></View>{member.role !== 'owner' ? <><Pressable accessibilityRole="button" accessibilityLabel={`Change role for ${member.profiles?.display_name || 'staff member'}`} disabled={busy} onPress={() => openRoleEditor(member)} style={styles.roleCycle}><Icon name="key-outline" size={15} color={C.teal} /><Text style={styles.roleCycleText}>Role</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${member.profiles?.display_name || 'staff member'}`} disabled={busy} onPress={() => confirmRemove(member)} style={styles.staffRemove}><Icon name="trash-outline" size={18} color={C.brick} /></Pressable></> : <View style={styles.ownerPill}><Text style={styles.ownerText}>OWNER</Text></View>}</View>)}</View>}
    {venues.length ? <><Text style={styles.sectionLabel}>ADD STAFF MEMBER</Text>
    <View style={styles.inviteSearch}><TextInput value={query} onChangeText={setQuery} placeholder="Search player name" placeholderTextColor={C.ink40} style={styles.inviteInput} /><Pressable disabled={query.trim().length < 2 || !venueId} onPress={search} style={styles.inviteSearchButton}><Icon name="search" size={17} color="#0E2321" /></Pressable></View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Selected role: ${STAFF_ROLES.find(([value]) => value === role)?.[1]}. Change role`} onPress={() => openRoleEditor()} style={styles.selectedRoleField}><View style={styles.selectedRoleIcon}><Icon name="key-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.selectedRoleLabel}>ROLE &amp; PERMISSIONS</Text><Text style={styles.selectedRoleTitle}>{STAFF_ROLES.find(([value]) => value === role)?.[1]}</Text><Text style={styles.selectedRoleMeta}>{STAFF_ROLE_DETAILS[role]}</Text></View><Icon name="chevron-forward" color={C.teal} /></Pressable>
    {candidates.map((candidate) => <View key={candidate.id} style={styles.candidateRow}><View style={styles.flex}><Text style={styles.playerName}>{candidate.display_name}</Text><Text style={styles.playerMeta}>{candidate.home_area || 'Peakle account'}</Text></View><Pressable disabled={busy} onPress={() => assign(candidate.id)} style={styles.approveButton}><Text style={[styles.approveText, { color: '#0E2321' }]}>Add as {STAFF_ROLES.find(([value]) => value === role)?.[1]}</Text></Pressable></View>)}</> : null}
  </Shell><Modal visible={!!roleEditor} transparent animationType="slide" onRequestClose={() => setRoleEditor(null)}><View style={styles.actionSheetBackdrop}><View style={styles.roleSheet}><View style={styles.actionSheetHandle} /><Text style={styles.actionSheetEyebrow}>STAFF PERMISSIONS</Text><Text style={styles.actionSheetTitle}>{roleEditor?.user_id ? `Choose ${roleEditor.profiles?.display_name || 'staff'}’s role` : 'Choose a role'}</Text><Text style={styles.actionSheetMeta}>Pick one clear access level. You can change it later without removing the account.</Text>
    <View style={styles.roleOptionList}>{STAFF_ROLES.map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: draftRole === value }} onPress={() => setDraftRole(value)} style={[styles.roleOption, draftRole === value && styles.roleOptionActive]}><View style={[styles.roleRadio, draftRole === value && styles.roleRadioActive]}>{draftRole === value && <View style={styles.roleRadioDot} />}</View><View style={styles.flex}><Text style={[styles.roleOptionTitle, draftRole === value && styles.roleOptionTitleActive]}>{label}</Text><Text style={styles.roleOptionMeta}>{STAFF_ROLE_DETAILS[value]}</Text></View></Pressable>)}</View>
    <View style={styles.roleSheetActions}><Pressable disabled={busy} onPress={() => setRoleEditor(null)} style={styles.roleSheetCancel}><Text style={styles.roleSheetCancelText}>Cancel</Text></Pressable><Pressable disabled={busy} onPress={saveRole} style={styles.roleSheetSave}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.primaryText}>{roleEditor?.user_id ? 'Save role' : 'Use this role'}</Text><Icon name="checkmark" color="#0E2321" /></>}</Pressable></View>
  </View></View></Modal></>;
}

export function OrganizerMonitorScreen({ navigation }) {
  const isDark = useOrganizerTheme();
  const { session } = useOpenPlaySession();
  const { hydrated, hasOrganizerAccess } = useOrganizerPass();
  if (!hydrated) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><View style={styles.locked}><ActivityIndicator color={C.teal} /><Text style={styles.loadingText}>Checking Organizer Pass…</Text></View></SafeAreaView>;
  if (hydrated && !hasOrganizerAccess && !session) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><View style={styles.locked}><View style={styles.lockedIcon}><Icon name="lock-closed-outline" size={27} color={C.teal} /></View><Text style={styles.lockedEyebrow}>ORGANIZER PASS</Text><Text style={styles.lockedTitle}>Session setup is locked</Text><Text style={styles.lockedMeta}>Activate the payment-free demo to test registration, rotations, scoring, and live court monitoring.</Text><Pressable onPress={() => navigation.navigate('Pass')} style={[styles.primaryButton, styles.lockedButton]}><Text style={styles.primaryText}>View demo plans</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable></View></SafeAreaView>;
  return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><OpenPlayScreen onExit={() => navigation.navigate('Sessions')} /></SafeAreaView>;
}

const lightStyles = createMobileStyleSheet({
  safe: { flex: 1, backgroundColor: C.paper }, content: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 48 }, flex: { flex: 1, minWidth: 0 }, pressed: { opacity: .78, transform: [{ scale: .99 }] }, disabled: { opacity: .45 }, header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, headerLeading: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }, headerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, eyebrow: { color: C.ink40, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 29, lineHeight: 35, fontWeight: '900' }, h2: { marginTop: 2, color: C.ink, fontSize: 21, fontWeight: '900' }, kitchen: { height: 7, marginTop: 16, marginBottom: 20 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, solidDark: { backgroundColor: 'rgba(243,245,239,.32)' }, dashedDark: { borderColor: 'rgba(243,245,239,.22)' }, modePill: { minHeight: 36, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 18, backgroundColor: '#E5F0ED' }, modeText: { color: C.teal, fontSize: 9, fontWeight: '900' },
  hero: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, heroIcon: { width: 49, height: 49, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.48)' }, heroTitle: { color: C.ink, fontSize: 14, fontWeight: '900' }, heroMeta: { marginTop: 4, color: C.ink70, fontSize: 9, lineHeight: 14 }, sectionHead: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, livePill: { minHeight: 27, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: '#FFF5F2' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.brick }, liveText: { color: C.brick, fontSize: 7, fontWeight: '900' },
  emptyCard: { minHeight: 170, padding: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderWidth: 1, borderStyle: 'dashed', borderColor: C.teal, backgroundColor: C.surface }, emptyIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, emptyTitle: { marginTop: 10, color: C.ink, fontSize: 13, fontWeight: '900' }, emptyMeta: { maxWidth: 255, marginTop: 4, color: C.ink40, textAlign: 'center', fontSize: 9, lineHeight: 14 }, sessionCard: { padding: 15, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, sessionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, sessionTitle: { marginTop: 3, color: C.ink, fontSize: 14, fontWeight: '900' }, stats: { marginTop: 14, paddingTop: 12, flexDirection: 'row', borderTopWidth: 1, borderColor: C.line }, stat: { flex: 1, alignItems: 'center' }, statValue: { color: C.ink, fontSize: 20, fontWeight: '900' }, statLabel: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '900' },
  activityCard: { paddingHorizontal: 12, borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, activityRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 10 }, activityIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E5F0ED' }, activityStatus: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .55 }, activityTitle: { marginTop: 2, color: C.ink, fontSize: 12, fontWeight: '900' }, activityMeta: { marginTop: 3, color: C.ink40, fontSize: 8, textTransform: 'capitalize' }, activityLoading: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, activityLoadingText: { color: C.ink40, fontSize: 9, fontWeight: '800' },
  primaryButton: { minHeight: 56, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, backgroundColor: C.optic }, primaryText: { color: C.ink, fontSize: 13, fontWeight: '900' }, secondaryButton: { minHeight: 48, marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, secondaryText: { color: C.teal, fontSize: 11, fontWeight: '900' }, quickGrid: { marginTop: 12, flexDirection: 'row', gap: 9 }, quickCard: { flex: 1, minHeight: 120, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, quickTitle: { marginTop: 10, color: C.ink, fontSize: 13, fontWeight: '900' }, quickMeta: { marginTop: 4, color: C.ink40, fontSize: 10, lineHeight: 15 }, sectionLabel: { marginTop: 23, marginBottom: 9, color: C.ink40, fontSize: 10, fontWeight: '900', letterSpacing: .8 }, sectionLoader: { marginVertical: 44 }, stepsCard: { paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, step: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10 }, stepNumber: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, stepNumberText: { color: C.ink, fontSize: 12, fontWeight: '900' }, stepText: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '800' }, rowBorder: { borderTopWidth: 1, borderColor: C.line },
  createChoiceBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.58)' },
  createChoiceSheet: { maxHeight: '92%', paddingHorizontal: 18, paddingTop: 9, paddingBottom: 18, borderTopLeftRadius: 27, borderTopRightRadius: 27, backgroundColor: C.paper },
  createChoiceHandle: { width: 42, height: 4, marginBottom: 15, alignSelf: 'center', borderRadius: 2, backgroundColor: C.line },
  createChoiceHeader: { marginBottom: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  createChoiceEyebrow: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .9 },
  createChoiceTitle: { marginTop: 3, color: C.ink, fontSize: 22, fontWeight: '900' },
  createChoiceMeta: { marginTop: 5, color: C.ink40, fontSize: 9, lineHeight: 14 },
  createChoiceClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.surface },
  createChoiceScroll: { flexShrink: 1 },
  createChoiceList: { paddingBottom: 2 },
  createChoiceCard: { minHeight: 92, marginTop: 9, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, borderBottomLeftRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  createChoiceOpenPlay: { borderColor: C.optic, backgroundColor: C.optic },
  createChoiceIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: 'rgba(255,255,255,.5)' },
  createChoiceProgramIcon: { backgroundColor: '#E5F0ED' },
  createChoiceCompetitionIcon: { backgroundColor: '#E5F0ED' },
  createChoiceMembershipIcon: { backgroundColor: '#E5F0ED' },
  createChoiceCardTitle: { color: C.ink, fontSize: 14, fontWeight: '900' },
  createChoiceCardMeta: { marginTop: 4, color: C.ink70, fontSize: 9, lineHeight: 14 },
  createChoiceOpenPlayText: { color: '#0E2321' },
  createChoiceOpenPlayMetaText: { color: 'rgba(14,35,33,.72)' },
  createChoiceCancel: { minHeight: 48, marginTop: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  createChoiceCancelText: { color: C.ink40, fontSize: 10, fontWeight: '900' },
  playersCard: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, playerRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 9 }, avatar: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, avatarText: { color: C.surface, fontSize: 9, fontWeight: '900' }, playerName: { color: C.ink, fontSize: 11, fontWeight: '900' }, playerMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, status: { minHeight: 25, paddingHorizontal: 7, justifyContent: 'center', borderRadius: 13, backgroundColor: C.paper }, statusPlaying: { backgroundColor: C.optic }, statusDone: { backgroundColor: '#F7EAE6' }, statusText: { color: C.ink40, fontSize: 6, fontWeight: '900' }, statusTextPlaying: { color: C.ink }, statusTextDone: { color: C.brick },
  playerFilters: { paddingVertical: 12, gap: 7 }, playerFilter: { minHeight: 44, paddingLeft: 13, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, playerFilterActive: { borderColor: C.teal, backgroundColor: C.teal }, playerFilterText: { color: C.ink40, fontSize: 9, fontWeight: '800' }, playerFilterTextActive: { color: C.surface, fontWeight: '900' }, playerFilterCount: { minWidth: 27, height: 27, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.paper }, playerFilterCountActive: { backgroundColor: 'rgba(255,255,255,.18)' }, playerFilterCountText: { color: C.ink40, fontSize: 8, fontWeight: '900' }, playerFilterCountTextActive: { color: C.surface }, filteredEmpty: { minHeight: 92, alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, filteredEmptyText: { color: C.ink40, fontSize: 9, fontWeight: '800' }, playerOverflow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, actionSheetBackdrop: { flex: 1, justifyContent: 'flex-end', padding: 12, backgroundColor: 'rgba(14,35,33,.55)' }, actionSheet: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 18, borderRadius: 24, backgroundColor: C.paper }, actionSheetHandle: { width: 42, height: 4, alignSelf: 'center', marginBottom: 18, borderRadius: 2, backgroundColor: C.line }, actionSheetEyebrow: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, actionSheetTitle: { marginTop: 4, color: C.ink, fontSize: 21, fontWeight: '900' }, actionSheetMeta: { marginTop: 5, marginBottom: 12, color: C.ink40, fontSize: 9, lineHeight: 14 }, actionSheetRow: { minHeight: 68, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.line }, actionSheetIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#F7EAE6' }, actionSheetRowTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, actionSheetRowMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 }, actionSheetCancel: { minHeight: 50, marginTop: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, actionSheetCancelText: { color: C.teal, fontSize: 10, fontWeight: '900' },
  codePill: { minHeight: 34, paddingHorizontal: 11, justifyContent: 'center', borderRadius: 17, backgroundColor: C.ink }, codePillText: { color: C.optic, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, errorCard: { marginBottom: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#F7EAE6' }, errorText: { flex: 1, color: C.brick, fontSize: 10, lineHeight: 15, fontWeight: '800' }, registrationRow: { paddingVertical: 11 }, registrationMain: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9 }, registrationActions: { marginTop: 8, marginLeft: 48, flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, rowLoader: { marginVertical: 10 }, approveButton: { minHeight: 44, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.optic }, approveText: { color: '#0E2321', fontSize: 10, fontWeight: '900' }, declineButton: { minHeight: 44, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#E2C4BC', backgroundColor: '#FFF5F2' }, declineText: { color: C.brick, fontSize: 10, fontWeight: '900' }, removeButton: { minHeight: 44, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.paper }, removeText: { color: C.ink40, fontSize: 10, fontWeight: '900' }, inviteSearch: { flexDirection: 'row', gap: 7 }, inviteInput: { minHeight: 50, flex: 1, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 12, fontWeight: '800' }, inviteSearchButton: { width: 50, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.optic }, candidateRow: { minHeight: 68, marginTop: 7, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, playerOverflowInline: { padding: 4, marginLeft: 2 }, inlineActionPill: { minHeight: 25, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 13, backgroundColor: C.optic }, inlineActionPillText: { color: '#0E2321', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  moreSection: { marginTop: 19 }, moreSectionLabel: { marginBottom: 8, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, moreCard: { paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, moreRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 11 }, moreIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, switchIcon: { backgroundColor: C.optic }, themeIconActive: { backgroundColor: C.optic }, moreTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, moreMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 }, moreChevron: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, themeToggle: { width: 44, height: 26, padding: 3, borderRadius: 13, backgroundColor: '#C9D0CB' }, themeToggleOn: { backgroundColor: C.optic }, themeKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' }, themeKnobOn: { transform: [{ translateX: 18 }], backgroundColor: '#0E2321' }, switchDestination: { minHeight: 30, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 10, backgroundColor: C.optic }, switchDestinationText: { color: '#0E2321', fontSize: 6.5, fontWeight: '900', letterSpacing: .6 },
  passSummaryCard: { marginTop: 13, borderRadius: 20, backgroundColor: LIGHT_C.optic, overflow: 'hidden' },
  passSummaryContent: { padding: 16 },
  passSummaryHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  passSummaryIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0E2321' },
  passSummaryEyebrow: { color: '#0E2321', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  passSummaryBrand: { marginTop: 2, color: '#0E2321', fontSize: 7, fontWeight: '900', letterSpacing: 1.2 },
  passSummaryBody: { marginTop: 20, marginBottom: 20 },
  passSummaryTitle: { marginTop: 2, color: '#0E2321', fontSize: 17, lineHeight: 22, fontWeight: '900' },
  passSummaryMeta: { marginTop: 11, color: '#0E2321', fontSize: 10, lineHeight: 14 },
  passStatus: { minHeight: 25, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 13, backgroundColor: '#0E2321' },
  passStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIGHT_C.optic },
  passStatusText: { color: '#FFFFFF', fontSize: 7, fontWeight: '900' },
  passSummaryFooter: { paddingTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9, borderTopWidth: 1, borderColor: 'rgba(14, 35, 33, 0.1)' },
  passBenefit: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  passBenefitText: { color: '#0E2321', fontSize: 9, fontWeight: '800' },
  passSummaryAction: { minHeight: 28, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  passSummaryActionText: { color: '#0E2321', fontSize: 9, fontWeight: '900' },
  passSummaryCardPro: { backgroundColor: LIGHT_C.optic, overflow: 'hidden' }, passSummaryIconPro: { backgroundColor: '#0E2321' }, passSummaryEyebrowPro: { color: '#0E2321' }, passSummaryBrandPro: { color: '#0E2321' }, passSummaryTitlePro: { color: '#0E2321' }, passSummaryMetaPro: { color: '#0E2321' }, passStatusPro: { backgroundColor: 'rgba(14, 35, 33, 0.05)' }, passStatusDotPro: { backgroundColor: '#0E2321' }, passStatusTextPro: { color: '#0E2321' }, passSummaryFooterPro: { borderColor: 'rgba(14, 35, 33, 0.1)' }, passBenefitTextPro: { color: '#0E2321' }, passSummaryActionTextPro: { color: '#0E2321' },
  staffVenueRow: { paddingTop: 13, gap: 7 }, staffVenue: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, staffVenueActive: { borderColor: C.teal, backgroundColor: C.optic }, staffVenueText: { color: C.ink40, fontSize: 10, fontWeight: '800' }, staffVenueTextActive: { color: '#0E2321', fontWeight: '900' }, staffRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 7 }, roleCycle: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 11, backgroundColor: '#E5F0ED' }, roleCycleText: { color: C.teal, fontSize: 9, fontWeight: '900' }, staffRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#F7EAE6' }, ownerPill: { minHeight: 30, paddingHorizontal: 9, justifyContent: 'center', borderRadius: 15, backgroundColor: C.optic }, ownerText: { color: '#0E2321', fontSize: 8, fontWeight: '900' }, roleChoices: { paddingTop: 9, paddingBottom: 2, gap: 6 }, roleChoice: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, roleChoiceActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, roleChoiceText: { color: C.ink40, fontSize: 10, fontWeight: '800' }, roleChoiceTextActive: { color: C.teal, fontWeight: '900' },
  selectedRoleField: { minHeight: 92, marginTop: 9, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, selectedRoleIcon: { width: 42, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, selectedRoleLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, selectedRoleTitle: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, selectedRoleMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 }, roleSheet: { maxHeight: '92%', paddingHorizontal: 18, paddingTop: 9, paddingBottom: 18, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: C.paper }, roleOptionList: { gap: 7 }, roleOption: { minHeight: 68, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, roleOptionActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, roleRadio: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 2, borderColor: C.line }, roleRadioActive: { borderColor: C.teal }, roleRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.teal }, roleOptionTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, roleOptionTitleActive: { color: C.teal }, roleOptionMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 }, roleSheetActions: { marginTop: 12, flexDirection: 'row', gap: 8 }, roleSheetCancel: { minHeight: 52, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, roleSheetCancelText: { color: C.teal, fontSize: 10, fontWeight: '900' }, roleSheetSave: { minHeight: 52, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic },
  locked: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' }, loadingText: { marginTop: 11, color: C.ink40, fontSize: 9, fontWeight: '800' }, lockedIcon: { width: 61, height: 61, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#E5F0ED' }, lockedEyebrow: { marginTop: 17, color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, lockedTitle: { marginTop: 4, color: C.ink, fontSize: 23, fontWeight: '900' }, lockedMeta: { maxWidth: 310, marginTop: 7, color: C.ink40, textAlign: 'center', fontSize: 9, lineHeight: 14 }, lockedButton: { width: '100%', marginTop: 19 },
});
const darkStyles = {
  ...createDarkStyleSheet(lightStyles),
  passSummaryEyebrow: { ...lightStyles.passSummaryEyebrow, color: '#0E2321' },
  passSummaryBrand: { ...lightStyles.passSummaryBrand, color: '#0E2321' },
  passSummaryTitle: { ...lightStyles.passSummaryTitle, color: '#0E2321' },
  passSummaryMeta: { ...lightStyles.passSummaryMeta, color: '#0E2321' },
  passBenefitText: { ...lightStyles.passBenefitText, color: '#0E2321' },
  passSummaryActionText: { ...lightStyles.passSummaryActionText, color: '#0E2321' },
  switchDestinationText: { ...lightStyles.switchDestinationText, color: '#0E2321' },
  passSummaryIcon: { ...lightStyles.passSummaryIcon, backgroundColor: '#0E2321' },
  passStatus: { ...lightStyles.passStatus, backgroundColor: '#0E2321' },
  passStatusText: { ...lightStyles.passStatusText, color: '#FFFFFF' },
  passSummaryCardPro: { ...lightStyles.passSummaryCardPro },
  passSummaryIconPro: { ...lightStyles.passSummaryIconPro },
  passSummaryEyebrowPro: { ...lightStyles.passSummaryEyebrowPro },
  passSummaryBrandPro: { ...lightStyles.passSummaryBrandPro },
  passSummaryTitlePro: { ...lightStyles.passSummaryTitlePro },
  passSummaryMetaPro: { ...lightStyles.passSummaryMetaPro },
  passStatusPro: { ...lightStyles.passStatusPro },
  passStatusDotPro: { ...lightStyles.passStatusDotPro },
  passStatusTextPro: { ...lightStyles.passStatusTextPro },
  passSummaryFooterPro: { ...lightStyles.passSummaryFooterPro },
  passBenefitTextPro: { ...lightStyles.passBenefitTextPro },
  passSummaryActionTextPro: { ...lightStyles.passSummaryActionTextPro },
};
let styles = lightStyles;
