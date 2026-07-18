import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import OpenPlayScreen from './OpenPlayScreen';
import ScrollView from '../components/FocusResetScrollView';
import { useOpenPlaySession } from '../context/OpenPlaySessionContext';
import { useOrganizerPass } from '../context/OrganizerPassContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { cancelOpenPlayRegistration, checkInOpenPlayPlayer, inviteOpenPlayPlayer, reviewOpenPlayRegistration, searchOpenPlayInviteCandidates } from '../services/openPlayRegistration';
import { listManagedVenues } from '../services/database';
import { listVenueStaff, removeVenueStaff, setVenueStaffRole } from '../services/realtimeOperations';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;
function Icon({ name, size = 20, color = C.ink }) { return <Ionicons name={name} size={size} color={color} />; }
function KitchenLine() {
  const { isDark } = useTheme();
  return <View style={styles.kitchen}><View style={[styles.solid, isDark && styles.solidDark]} /><View style={[styles.dashed, isDark && styles.dashedDark]} /></View>;
}
function Header({ eyebrow, title }) { return <><View style={styles.header}><View><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.h1}>{title}</Text></View><View style={styles.modePill}><Icon name="key-outline" size={14} color={C.teal} /><Text style={styles.modeText}>ORGANIZER</Text></View></View><KitchenLine /></>; }
function useOrganizerTheme() { const { isDark } = useTheme(); C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C; styles = isDark ? darkStyles : lightStyles; return isDark; }
function Shell({ children, eyebrow, title }) { const { isDark } = useTheme(); return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><Header eyebrow={eyebrow} title={title} />{children}</ScrollView></SafeAreaView>; }

function SessionCard({ session, onPress }) {
  const playing = session?.courts.filter((court) => court.match).length || 0;
  if (!session) return <View style={styles.emptyCard}><View style={styles.emptyIcon}><Icon name="calendar-outline" color={C.teal} /></View><Text style={styles.emptyTitle}>No active open play</Text><Text style={styles.emptyMeta}>Create a session to start checking in players and assigning courts.</Text></View>;
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.sessionCard, pressed && styles.pressed]}><View style={styles.sessionHead}><View><Text style={styles.liveLabel}>● LIVE SESSION</Text><Text style={styles.sessionTitle}>Today’s open play</Text></View><Icon name="chevron-forward" color={C.teal} /></View><View style={styles.stats}><View style={styles.stat}><Text style={styles.statValue}>{session.courts.length}</Text><Text style={styles.statLabel}>COURTS</Text></View><View style={styles.stat}><Text style={styles.statValue}>{playing}</Text><Text style={styles.statLabel}>IN PLAY</Text></View><View style={styles.stat}><Text style={styles.statValue}>{session.queue.length}</Text><Text style={styles.statLabel}>WAITING</Text></View><View style={styles.stat}><Text style={styles.statValue}>{session.completedMatches.length}</Text><Text style={styles.statLabel}>FINISHED</Text></View></View></Pressable>;
}

export function OrganizerOverviewScreen({ navigation }) {
  useOrganizerTheme();
  const { session } = useOpenPlaySession();
  const { hasOrganizerAccess } = useOrganizerPass();
  const openSession = () => navigation.navigate(session || hasOrganizerAccess ? 'Monitor' : 'Pass');
  return <Shell eyebrow="ORGANIZER WORKSPACE" title="Overview">
    <View style={styles.hero}><View style={styles.heroIcon}><Icon name="grid-outline" size={25} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.heroTitle}>Courts without the clipboard.</Text><Text style={styles.heroMeta}>Run registration, rotations, scorers, and live court monitoring from one workspace.</Text></View></View>
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>TODAY</Text><Text style={styles.h2}>{session ? 'Active session' : 'Your sessions'}</Text></View>{session && <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>}</View>
    <SessionCard session={session} onPress={() => navigation.navigate('Monitor')} />
    <Pressable onPress={openSession} style={styles.primaryButton}><Text style={styles.primaryText}>{session ? 'Open court monitor' : hasOrganizerAccess ? 'Create open play' : 'View Organizer Pass'}</Text><Icon name={session || hasOrganizerAccess ? 'arrow-forward' : 'lock-closed-outline'} color="#0E2321" /></Pressable>
    <View style={styles.quickGrid}><Pressable onPress={() => navigation.navigate('Sessions')} style={styles.quickCard}><Icon name="calendar-outline" color={C.teal} /><Text style={styles.quickTitle}>Sessions</Text><Text style={styles.quickMeta}>Create or resume open play.</Text></Pressable><Pressable onPress={() => navigation.navigate('Players')} style={styles.quickCard}><Icon name="people-outline" color={C.teal} /><Text style={styles.quickTitle}>Players</Text><Text style={styles.quickMeta}>See attendance and queue status.</Text></Pressable></View>
  </Shell>;
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
  return <Shell eyebrow="ORGANIZER WORKSPACE" title="Sessions">
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>OPEN PLAY</Text><Text style={styles.h2}>Session control</Text></View></View>
    <SessionCard session={session} onPress={() => navigation.navigate('Monitor')} />
    {session ? <Pressable onPress={() => navigation.navigate('Monitor')} style={styles.primaryButton}><Text style={styles.primaryText}>Resume session</Text><Icon name="play" color="#0E2321" /></Pressable> : <Pressable onPress={startNew} style={styles.primaryButton}><Text style={styles.primaryText}>{hasOrganizerAccess ? 'Set up open play' : 'Unlock session setup'}</Text><Icon name={hasOrganizerAccess ? 'add' : 'lock-closed-outline'} color="#0E2321" /></Pressable>}
    <Text style={styles.sectionLabel}>HOW IT WORKS</Text><View style={styles.stepsCard}>{[['1', 'Check in players'], ['2', 'Assign the next four'], ['3', 'Monitor every court']].map(([number, label], index) => <View key={number} style={[styles.step, index > 0 && styles.rowBorder]}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View><Text style={styles.stepText}>{label}</Text><Icon name="checkmark-circle-outline" color={C.teal} /></View>)}</View>
  </Shell>;
}

export function OrganizerPlayersScreen() {
  useOrganizerTheme();
  const { session, registrations, refreshRegistrations } = useOpenPlaySession();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  useFocusEffect(useCallback(() => { refreshRegistrations().catch((loadError) => setError(loadError.message || 'Registration could not be refreshed.')); }, [refreshRegistrations]));
  const run = async (id, operation) => {
    setBusyId(id); setError('');
    try { await operation(); await refreshRegistrations(); }
    catch (actionError) { setError(actionError.message || 'The registration could not be updated.'); }
    finally { setBusyId(null); }
  };
  const search = async () => {
    setError('');
    try { setCandidates(await searchOpenPlayInviteCandidates(query)); }
    catch (searchError) { setError(searchError.message || 'Player search failed.'); }
  };
  const statusLabel = (player) => player.playStatus === 'playing' ? 'ON COURT' : player.playStatus === 'done' ? 'DONE' : player.status === 'requested' ? 'REQUESTED' : player.status === 'waitlisted' ? 'WAITLIST' : player.status === 'rejected' ? 'DECLINED' : player.status === 'cancelled' ? 'CANCELLED' : player.checkedInAt ? 'CHECKED IN' : 'APPROVED';
  return <Shell eyebrow="ORGANIZER WORKSPACE" title="Players">
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>CURRENT SESSION</Text><Text style={styles.h2}>{registrations.length ? `${registrations.length} registered` : 'Registration'}</Text></View>{session?.code ? <View style={styles.codePill}><Text style={styles.codePillText}>{session.code}</Text></View> : null}</View>
    {error ? <View style={styles.errorCard}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
    {!registrations.length ? <View style={styles.emptyCard}><View style={styles.emptyIcon}><Icon name="people-outline" color={C.teal} /></View><Text style={styles.emptyTitle}>No active registration</Text><Text style={styles.emptyMeta}>Share the session code or wait for public players to join.</Text></View> : <View style={styles.playersCard}>{registrations.map((player, index) => <View key={player.id} style={[styles.registrationRow, index > 0 && styles.rowBorder]}><View style={styles.registrationMain}><View style={styles.avatar}><Text style={styles.avatarText}>{player.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}</Text></View><View style={styles.flex}><Text style={styles.playerName}>{player.name}</Text><Text style={styles.playerMeta}>{player.skill ? `Rating ${Number(player.skill).toFixed(1)} · ` : ''}{player.checkedInAt ? 'Arrived' : 'Not checked in'}</Text></View><View style={[styles.status, player.checkedInAt && styles.statusPlaying, ['rejected', 'cancelled'].includes(player.status) && styles.statusDone]}><Text style={[styles.statusText, player.checkedInAt && styles.statusTextPlaying, ['rejected', 'cancelled'].includes(player.status) && styles.statusTextDone]}>{statusLabel(player)}</Text></View></View>
      {busyId === player.id ? <ActivityIndicator color={C.teal} style={styles.rowLoader} /> : <View style={styles.registrationActions}>
        {['requested', 'waitlisted'].includes(player.status) && <Pressable onPress={() => run(player.id, () => reviewOpenPlayRegistration(player.id, true))} style={styles.approveButton}><Text style={styles.approveText}>Approve</Text></Pressable>}
        {player.status === 'requested' && <Pressable onPress={() => run(player.id, () => reviewOpenPlayRegistration(player.id, false))} style={styles.declineButton}><Text style={styles.declineText}>Decline</Text></Pressable>}
        {player.status === 'approved' && !player.checkedInAt && <Pressable onPress={() => run(player.id, () => checkInOpenPlayPlayer(player.id))} style={styles.approveButton}><Text style={styles.approveText}>Check in</Text></Pressable>}
        {['requested', 'waitlisted', 'approved'].includes(player.status) && player.playStatus !== 'playing' && <Pressable onPress={() => run(player.id, () => cancelOpenPlayRegistration(player.id))} style={styles.removeButton}><Text style={styles.removeText}>Remove</Text></Pressable>}
      </View>}
    </View>)}</View>}
    {session?.visibility === 'invite_only' ? <><Text style={styles.sectionLabel}>INVITE PEAKLE PLAYERS</Text><View style={styles.inviteSearch}><TextInput value={query} onChangeText={setQuery} placeholder="Search player name" placeholderTextColor={C.ink40} style={styles.inviteInput} /><Pressable disabled={query.trim().length < 2} onPress={search} style={styles.inviteSearchButton}><Icon name="search" size={17} color="#0E2321" /></Pressable></View>{candidates.map((candidate) => <View key={candidate.id} style={styles.candidateRow}><View style={styles.flex}><Text style={styles.playerName}>{candidate.display_name}</Text><Text style={styles.playerMeta}>{candidate.home_area || 'Peakle player'}{candidate.skill_rating ? ` · ${candidate.skill_rating}` : ''}</Text></View><Pressable onPress={() => run(candidate.id, () => inviteOpenPlayPlayer(session.id, candidate.id))} style={styles.approveButton}><Text style={styles.approveText}>Invite</Text></Pressable></View>)}</> : null}
  </Shell>;
}

export function OrganizerMoreScreen({ navigation }) {
  useOrganizerTheme();
  const destinations = [
    { route: 'Pickleball', icon: 'trophy-outline', title: 'Programs & insights', detail: 'Clinics, leagues, recurring sessions, memberships, and venue reports.' },
    { route: 'Pass', icon: 'card-outline', title: 'Subscription & access', detail: 'Plan status and payment-free demo controls.' },
    { route: 'Venue', icon: 'business-outline', title: 'Venue management', detail: 'Manage courts, availability, pricing, and operations.' },
    { route: 'Staff', icon: 'key-outline', title: 'Staff access', detail: 'Assign managers, front desk, monitors, scorers, and viewers.' },
    { route: 'Profile', icon: 'person-outline', title: 'Profile & settings', detail: 'Account, workspace mode, notifications, and preferences.' },
  ];
  return <Shell eyebrow="ORGANIZER WORKSPACE" title="More">
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>WORKSPACE</Text><Text style={styles.h2}>Management tools</Text></View></View>
    <View style={styles.moreCard}>{destinations.map((item, index) => <Pressable key={item.route} accessibilityRole="button" onPress={() => navigation.navigate(item.route)} style={({ pressed }) => [styles.moreRow, index > 0 && styles.rowBorder, pressed && styles.pressed]}><View style={styles.moreIcon}><Icon name={item.icon} color={C.teal} /></View><View style={styles.flex}><Text style={styles.moreTitle}>{item.title}</Text><Text style={styles.moreMeta}>{item.detail}</Text></View><Icon name="chevron-forward" size={18} color={C.ink40} /></Pressable>)}</View>
  </Shell>;
}

const STAFF_ROLES = [
  ['manager', 'Manager'], ['front_desk', 'Front desk'], ['court_monitor', 'Court monitor'], ['scorer', 'Scorer'], ['viewer', 'Read only'],
];

export function OrganizerStaffScreen({ navigation }) {
  useOrganizerTheme();
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState(null);
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [role, setRole] = useState('court_monitor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async (selectedVenue = venueId) => {
    if (!selectedVenue) return;
    setStaff(await listVenueStaff(selectedVenue));
  }, [venueId]);
  useFocusEffect(useCallback(() => {
    listManagedVenues().then((rows) => { setVenues(rows); const selected = venueId || rows[0]?.id; setVenueId(selected); return refresh(selected); }).catch((loadError) => setError(loadError.message || 'Staff access could not be loaded.'));
  }, [refresh, venueId]));
  const search = async () => {
    setError('');
    try { setCandidates(await searchOpenPlayInviteCandidates(query)); } catch (searchError) { setError(searchError.message || 'Search failed.'); }
  };
  const assign = async (userId, nextRole = role) => {
    setBusy(true); setError('');
    try { await setVenueStaffRole(venueId, userId, nextRole); await refresh(); setCandidates([]); setQuery(''); }
    catch (assignError) { setError(assignError.message || 'Staff access could not be updated.'); }
    finally { setBusy(false); }
  };
  const remove = async (userId) => {
    setBusy(true); setError('');
    try { await removeVenueStaff(venueId, userId); await refresh(); }
    catch (removeError) { setError(removeError.message || 'Staff member could not be removed.'); }
    finally { setBusy(false); }
  };
  return <Shell eyebrow="VENUE OPERATIONS" title="Staff access">
    <Pressable onPress={() => navigation.navigate('More')} style={styles.secondaryButton}><Icon name="arrow-back" color={C.teal} /><Text style={styles.secondaryText}>Back to workspace</Text></Pressable>
    {venues.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.staffVenueRow}>{venues.map((venue) => <Pressable key={venue.id} onPress={() => { setVenueId(venue.id); refresh(venue.id).catch(() => {}); }} style={[styles.staffVenue, venue.id === venueId && styles.staffVenueActive]}><Text style={[styles.staffVenueText, venue.id === venueId && styles.staffVenueTextActive]}>{venue.name}</Text></Pressable>)}</ScrollView> : null}
    {error ? <View style={[styles.errorCard, { marginTop: 12 }]}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
    <Text style={styles.sectionLabel}>CURRENT TEAM</Text>
    {!staff.length ? <View style={styles.emptyCard}><Icon name="key-outline" size={28} color={C.teal} /><Text style={styles.emptyTitle}>No staff assigned</Text><Text style={styles.emptyMeta}>Search for a Peakle account below to grant venue access.</Text></View> : <View style={styles.playersCard}>{staff.map((member, index) => <View key={member.user_id} style={[styles.staffRow, index > 0 && styles.rowBorder]}><View style={styles.flex}><Text style={styles.playerName}>{member.profiles?.display_name || 'Venue staff'}</Text><Text style={styles.playerMeta}>{STAFF_ROLES.find(([value]) => value === member.role)?.[1] || member.role}</Text></View>{member.role !== 'owner' ? <><Pressable disabled={busy} onPress={() => { const current = STAFF_ROLES.findIndex(([value]) => value === member.role); assign(member.user_id, STAFF_ROLES[(current + 1) % STAFF_ROLES.length][0]); }} style={styles.roleCycle}><Icon name="swap-horizontal" size={15} color={C.teal} /><Text style={styles.roleCycleText}>Change</Text></Pressable><Pressable disabled={busy} onPress={() => remove(member.user_id)} style={styles.staffRemove}><Icon name="trash-outline" size={16} color={C.brick} /></Pressable></> : <View style={styles.ownerPill}><Text style={styles.ownerText}>OWNER</Text></View>}</View>)}</View>}
    <Text style={styles.sectionLabel}>ADD STAFF MEMBER</Text>
    <View style={styles.inviteSearch}><TextInput value={query} onChangeText={setQuery} placeholder="Search player name" placeholderTextColor={C.ink40} style={styles.inviteInput} /><Pressable disabled={query.trim().length < 2 || !venueId} onPress={search} style={styles.inviteSearchButton}><Icon name="search" size={17} color="#0E2321" /></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roleChoices}>{STAFF_ROLES.map(([value, label]) => <Pressable key={value} onPress={() => setRole(value)} style={[styles.roleChoice, role === value && styles.roleChoiceActive]}><Text style={[styles.roleChoiceText, role === value && styles.roleChoiceTextActive]}>{label}</Text></Pressable>)}</ScrollView>
    {candidates.map((candidate) => <View key={candidate.id} style={styles.candidateRow}><View style={styles.flex}><Text style={styles.playerName}>{candidate.display_name}</Text><Text style={styles.playerMeta}>{candidate.home_area || 'Peakle account'}</Text></View><Pressable disabled={busy} onPress={() => assign(candidate.id)} style={styles.approveButton}><Text style={styles.approveText}>Add as {STAFF_ROLES.find(([value]) => value === role)?.[1]}</Text></Pressable></View>)}
  </Shell>;
}

export function OrganizerMonitorScreen({ navigation }) {
  const isDark = useOrganizerTheme();
  const { session } = useOpenPlaySession();
  const { hydrated, hasOrganizerAccess } = useOrganizerPass();
  if (!hydrated) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><View style={styles.locked}><ActivityIndicator color={C.teal} /><Text style={styles.loadingText}>Checking Organizer Pass…</Text></View></SafeAreaView>;
  if (hydrated && !hasOrganizerAccess && !session) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><View style={styles.locked}><View style={styles.lockedIcon}><Icon name="lock-closed-outline" size={27} color={C.teal} /></View><Text style={styles.lockedEyebrow}>ORGANIZER PASS</Text><Text style={styles.lockedTitle}>Session setup is locked</Text><Text style={styles.lockedMeta}>Activate the payment-free demo to test registration, rotations, scoring, and live court monitoring.</Text><Pressable onPress={() => navigation.navigate('Pass')} style={[styles.primaryButton, styles.lockedButton]}><Text style={styles.primaryText}>View demo plans</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable></View></SafeAreaView>;
  return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><OpenPlayScreen onExit={() => navigation.navigate('Sessions')} /></SafeAreaView>;
}

const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper }, content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 44 }, flex: { flex: 1 }, pressed: { opacity: .78, transform: [{ scale: .99 }] }, header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 29, lineHeight: 35, fontWeight: '900' }, h2: { marginTop: 2, color: C.ink, fontSize: 21, fontWeight: '900' }, kitchen: { height: 7, marginTop: 18, marginBottom: 22 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, solidDark: { backgroundColor: 'rgba(243,245,239,.32)' }, dashedDark: { borderColor: 'rgba(243,245,239,.22)' }, modePill: { minHeight: 32, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 16, backgroundColor: '#E5F0ED' }, modeText: { color: C.teal, fontSize: 7, fontWeight: '900' },
  hero: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, heroIcon: { width: 49, height: 49, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.48)' }, heroTitle: { color: C.ink, fontSize: 14, fontWeight: '900' }, heroMeta: { marginTop: 4, color: C.ink70, fontSize: 9, lineHeight: 14 }, sectionHead: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, livePill: { minHeight: 27, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: '#E5F0ED' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, liveText: { color: C.teal, fontSize: 7, fontWeight: '900' },
  emptyCard: { minHeight: 170, padding: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderWidth: 1, borderStyle: 'dashed', borderColor: C.teal, backgroundColor: C.surface }, emptyIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, emptyTitle: { marginTop: 10, color: C.ink, fontSize: 13, fontWeight: '900' }, emptyMeta: { maxWidth: 255, marginTop: 4, color: C.ink40, textAlign: 'center', fontSize: 9, lineHeight: 14 }, sessionCard: { padding: 15, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, sessionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, sessionTitle: { marginTop: 3, color: C.ink, fontSize: 14, fontWeight: '900' }, stats: { marginTop: 14, paddingTop: 12, flexDirection: 'row', borderTopWidth: 1, borderColor: C.line }, stat: { flex: 1, alignItems: 'center' }, statValue: { color: C.ink, fontSize: 20, fontWeight: '900' }, statLabel: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '900' },
  primaryButton: { minHeight: 56, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, backgroundColor: C.optic }, primaryText: { color: C.ink, fontSize: 11, fontWeight: '900' }, secondaryButton: { minHeight: 48, marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, secondaryText: { color: C.teal, fontSize: 9, fontWeight: '900' }, quickGrid: { marginTop: 12, flexDirection: 'row', gap: 9 }, quickCard: { flex: 1, minHeight: 115, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, quickTitle: { marginTop: 10, color: C.ink, fontSize: 11, fontWeight: '900' }, quickMeta: { marginTop: 4, color: C.ink40, fontSize: 8, lineHeight: 12 }, sectionLabel: { marginTop: 23, marginBottom: 9, color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: .8 }, stepsCard: { paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, step: { minHeight: 59, flexDirection: 'row', alignItems: 'center', gap: 10 }, stepNumber: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, stepNumberText: { color: C.ink, fontSize: 10, fontWeight: '900' }, stepText: { flex: 1, color: C.ink, fontSize: 10, fontWeight: '800' }, rowBorder: { borderTopWidth: 1, borderColor: C.line },
  playersCard: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, playerRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 9 }, avatar: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, avatarText: { color: C.surface, fontSize: 9, fontWeight: '900' }, playerName: { color: C.ink, fontSize: 11, fontWeight: '900' }, playerMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, status: { minHeight: 25, paddingHorizontal: 7, justifyContent: 'center', borderRadius: 13, backgroundColor: C.paper }, statusPlaying: { backgroundColor: C.optic }, statusDone: { backgroundColor: '#F7EAE6' }, statusText: { color: C.ink40, fontSize: 6, fontWeight: '900' }, statusTextPlaying: { color: C.ink }, statusTextDone: { color: C.brick },
  codePill: { minHeight: 30, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 15, backgroundColor: C.ink }, codePillText: { color: C.optic, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, errorCard: { marginBottom: 10, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#F7EAE6' }, errorText: { flex: 1, color: C.brick, fontSize: 8, lineHeight: 12, fontWeight: '800' }, registrationRow: { paddingVertical: 10 }, registrationMain: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9 }, registrationActions: { marginTop: 7, marginLeft: 48, flexDirection: 'row', gap: 6 }, rowLoader: { marginVertical: 8 }, approveButton: { minHeight: 31, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.optic }, approveText: { color: '#0E2321', fontSize: 7, fontWeight: '900' }, declineButton: { minHeight: 31, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#E2C4BC', backgroundColor: '#FFF5F2' }, declineText: { color: C.brick, fontSize: 7, fontWeight: '900' }, removeButton: { minHeight: 31, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, removeText: { color: C.ink40, fontSize: 7, fontWeight: '900' }, inviteSearch: { flexDirection: 'row', gap: 7 }, inviteInput: { minHeight: 48, flex: 1, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 10, fontWeight: '800' }, inviteSearchButton: { width: 49, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.optic }, candidateRow: { minHeight: 58, marginTop: 7, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  moreCard: { paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, moreRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 11 }, moreIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, moreTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, moreMeta: { maxWidth: 250, marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  staffVenueRow: { paddingTop: 13, gap: 7 }, staffVenue: { minHeight: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, staffVenueActive: { borderColor: C.teal, backgroundColor: C.optic }, staffVenueText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, staffVenueTextActive: { color: '#0E2321', fontWeight: '900' }, staffRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 7 }, roleCycle: { minHeight: 32, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 10, backgroundColor: '#E5F0ED' }, roleCycleText: { color: C.teal, fontSize: 7, fontWeight: '900' }, staffRemove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#F7EAE6' }, ownerPill: { minHeight: 27, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 13, backgroundColor: C.optic }, ownerText: { color: '#0E2321', fontSize: 6, fontWeight: '900' }, roleChoices: { paddingTop: 9, paddingBottom: 2, gap: 6 }, roleChoice: { minHeight: 34, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, roleChoiceActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, roleChoiceText: { color: C.ink40, fontSize: 7, fontWeight: '800' }, roleChoiceTextActive: { color: C.teal, fontWeight: '900' },
  locked: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' }, loadingText: { marginTop: 11, color: C.ink40, fontSize: 9, fontWeight: '800' }, lockedIcon: { width: 61, height: 61, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#E5F0ED' }, lockedEyebrow: { marginTop: 17, color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, lockedTitle: { marginTop: 4, color: C.ink, fontSize: 23, fontWeight: '900' }, lockedMeta: { maxWidth: 310, marginTop: 7, color: C.ink40, textAlign: 'center', fontSize: 9, lineHeight: 14 }, lockedButton: { width: '100%', marginTop: 19 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
