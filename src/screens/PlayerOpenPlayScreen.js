import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { distanceInKm, formatDistance, useUserLocation } from '../context/LocationContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import {
  cancelOpenPlayRegistration,
  checkInOpenPlayPlayer,
  getOpenPlaySession,
  joinOpenPlaySession,
  listDiscoverableOpenPlaySessions,
} from '../services/openPlayRegistration';
import { requireSupabase } from '../lib/supabase';
import { useOperations } from '../context/OperationsContext';
import ConnectionStatus from '../components/ConnectionStatus';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;

function Icon({ name, size = 20, color = C.ink }) { return <Ionicons name={name} size={size} color={color} />; }
function money(value) { return Number(value) > 0 ? `₱${Number(value).toLocaleString('en-PH')}` : 'Free'; }
function schedule(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  return `${from.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })} · ${from.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}–${to.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
}
function skillRange(session) {
  if (session.skillMin == null && session.skillMax == null) return 'Open level';
  if (session.skillMin == null) return `Up to ${session.skillMax.toFixed(1)}`;
  if (session.skillMax == null) return `${session.skillMin.toFixed(1)} and above`;
  return `${session.skillMin.toFixed(1)}–${session.skillMax.toFixed(1)}`;
}

function StatusCard({ registration }) {
  if (!registration) return null;
  const config = {
    requested: ['time-outline', 'Approval pending', 'The organizer will review your request.'],
    waitlisted: ['hourglass-outline', 'You’re on the waitlist', 'Peakle will keep your place if capacity opens.'],
    approved: registration.checkedInAt
      ? ['checkmark-done', 'Checked in', 'You are eligible to enter the live rotation queue.']
      : ['checkmark-circle', 'You’re approved', 'Check in when you arrive to enter the rotation queue.'],
    rejected: ['close-circle-outline', 'Request declined', 'Contact the organizer if you need more information.'],
    cancelled: ['remove-circle-outline', 'Registration cancelled', 'You can join again while registration is open.'],
  }[registration.status] || ['information-circle-outline', registration.status, ''];
  return <View style={[styles.statusCard, registration.status === 'approved' && styles.statusApproved, ['rejected', 'cancelled'].includes(registration.status) && styles.statusNegative]}><Icon name={config[0]} color={registration.status === 'approved' ? C.teal : registration.status === 'rejected' ? C.brick : C.ink70} /><View style={styles.flex}><Text style={styles.statusTitle}>{config[1]}</Text><Text style={styles.statusMeta}>{config[2]}</Text></View></View>;
}

function LiveRotationCard({ session }) {
  const live = session.liveState;
  if (!live || !session.registration?.checkedInAt) return null;
  const position = live.queue_position;
  const estimate = live.estimated_wait_minutes;
  const latestDecision = live.latest_decision;
  const explanation = latestDecision?.overridden && latestDecision?.override_reason
    ? `Organizer override: ${latestDecision.override_reason}`
    : latestDecision?.explanation?.reason;
  return <View style={styles.rotationCard}>
    <View style={styles.rotationHead}><View><Text style={styles.rotationEyebrow}>FAIR PLAY · LIVE</Text><Text style={styles.rotationTitle}>{position ? `Queue position ${position}` : session.registration.playStatus === 'playing' ? 'You’re on court' : 'Rotation updating'}</Text></View>{position ? <View style={styles.positionBubble}><Text style={styles.positionNumber}>{position}</Text></View> : <Icon name="tennisball" color={C.optic} />}</View>
    <Text style={styles.rotationWait}>{estimate === 0 ? 'A court is ready — stay nearby.' : estimate == null ? 'Your wait estimate will appear when you return to the queue.' : `Estimated wait: about ${estimate} min`}</Text>
    <Text style={styles.rotationWhy}>{explanation || 'Your place uses waiting time, games played, consecutive games, rest, skill balance, and repeat matchups.'}</Text>
    {live.nearly_on_court ? <View style={styles.nearlyPill}><Icon name="notifications" size={13} color="#0E2321" /><Text style={styles.nearlyText}>YOU’RE NEARLY ON COURT</Text></View> : null}
    <View style={styles.liveCourts}>{(live.courts || []).map((court) => <View key={court.id} style={styles.liveCourt}><View style={[styles.courtDot, court.status === 'open' && styles.courtDotOpen]} /><View style={styles.flex}><Text style={styles.liveCourtTitle}>Court {court.number} · {court.status === 'open' ? 'Open' : `${court.score?.[0] || 0}–${court.score?.[1] || 0}`}</Text><Text numberOfLines={1} style={styles.liveCourtPlayers}>{court.status === 'open' ? 'Ready for the next fair lineup' : (court.players || []).join(' · ')}</Text></View></View>)}</View>
  </View>;
}

function SessionCard({ session, userLocation, onPress }) {
  const distance = distanceInKm(userLocation, session.venue);
  const full = session.registeredCount >= session.capacity;
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.sessionCard, pressed && styles.pressed]}>
    <View style={styles.cardHead}><View style={styles.verifiedPill}><Icon name="shield-checkmark" size={12} color={C.teal} /><Text style={styles.verifiedText}>VERIFIED VENUE</Text></View><Text style={styles.fee}>{money(session.feeAmount)}</Text></View>
    <Text style={styles.sessionName}>{session.name}</Text>
    <Text style={styles.venueName}>{session.venue?.name} · {session.venue?.area}</Text>
    <View style={styles.metaRow}><Icon name="calendar-outline" size={14} color={C.ink40} /><Text style={styles.metaText}>{schedule(session.scheduledStart, session.scheduledEnd)}</Text></View>
    <View style={styles.cardFoot}><Text style={styles.distance}>{formatDistance(distance)}</Text><View style={[styles.spotsPill, full && styles.fullPill]}><Text style={[styles.spotsText, full && styles.fullText]}>{full ? 'WAITLIST' : `${session.capacity - session.registeredCount} SPOTS`}</Text></View></View>
  </Pressable>;
}

export default function PlayerOpenPlayScreen({ onBack, initialCode = '' }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { userLocation } = useUserLocation();
  const { reportRealtime } = useOperations();
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [code, setCode] = useState(initialCode || '');
  const [resolvedCode, setResolvedCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadSessions = useCallback(async () => {
    setError('');
    try { setSessions(await listDiscoverableOpenPlaySessions()); }
    catch (loadError) { setError(loadError.message || 'Open-play sessions are unavailable.'); }
    finally { setLoading(false); }
  }, []);

  const resolveCode = useCallback(async (value) => {
    const clean = value.trim().toUpperCase();
    if (clean.length !== 6) { setError('Enter the six-character session code.'); return; }
    setBusy(true); setError('');
    try {
      const session = await getOpenPlaySession({ code: clean });
      setResolvedCode(clean);
      setSelected(session);
    } catch (lookupError) { setError(lookupError.message || 'That session code was not found.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => {
    if (initialCode?.trim().length === 6) resolveCode(initialCode);
  }, [initialCode, resolveCode]);

  useEffect(() => {
    if (!selected?.id) return undefined;
    const sessionId = selected.id;
    const channel = requireSupabase()
      .channel(`player-open-play-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_players', filter: `session_id=eq.${sessionId}` }, () => {
        getOpenPlaySession({ sessionId, code: resolvedCode || null }).then(setSelected).catch(() => {});
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'open_play_sessions', filter: `id=eq.${sessionId}` }, () => {
        getOpenPlaySession({ sessionId, code: resolvedCode || null }).then(setSelected).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_matches', filter: `session_id=eq.${sessionId}` }, () => {
        getOpenPlaySession({ sessionId, code: resolvedCode || null }).then(setSelected).catch(() => {});
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'open_play_rotation_decisions', filter: `session_id=eq.${sessionId}` }, () => {
        getOpenPlaySession({ sessionId, code: resolvedCode || null }).then(setSelected).catch(() => {});
      })
      .subscribe((status) => reportRealtime(`player-${sessionId}`, status));
    return () => { requireSupabase().removeChannel(channel); reportRealtime(`player-${sessionId}`, 'REMOVE'); };
  }, [reportRealtime, resolvedCode, selected?.id]);

  const refreshSelected = async () => {
    if (!selected) return;
    const refreshed = await getOpenPlaySession({ sessionId: selected.id, code: resolvedCode || null });
    setSelected(refreshed);
  };

  const run = async (operation) => {
    setBusy(true); setError('');
    try { await operation(); await refreshSelected(); await loadSessions(); }
    catch (actionError) { setError(actionError.message || 'The request could not be completed.'); }
    finally { setBusy(false); }
  };

  if (selected) {
    const registration = selected.registration;
    const canJoin = !registration || ['cancelled', 'rejected'].includes(registration.status);
    const canCancel = registration && ['requested', 'waitlisted', 'approved'].includes(registration.status) && !registration.departedAt;
    const canCheckIn = registration?.status === 'approved' && !registration.checkedInAt;
    return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => run(async () => {})} tintColor={C.teal} />}>
      <View style={styles.header}><Pressable accessibilityLabel="Back to open play" onPress={() => { setSelected(null); setError(''); }} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.flex}><Text style={styles.eyebrow}>OPEN PLAY</Text><Text style={styles.h1}>Session details</Text></View></View>
      <ConnectionStatus />
      <View style={styles.detailHero}><View style={styles.verifiedPill}><Icon name="shield-checkmark" size={12} color={C.teal} /><Text style={styles.verifiedText}>VERIFIED VENUE</Text></View><Text style={styles.detailTitle}>{selected.name}</Text><Text style={styles.detailVenue}>{selected.venue?.name}</Text><Text style={styles.detailAddress}>{selected.venue?.address}</Text></View>
      <StatusCard registration={registration} />
      <LiveRotationCard session={selected} />
      <View style={styles.detailCard}>
        {[
          ['calendar-outline', 'SCHEDULE', schedule(selected.scheduledStart, selected.scheduledEnd)],
          ['person-outline', 'ORGANIZER', selected.organizer?.name || 'Peakle organizer'],
          ['podium-outline', 'SKILL RANGE', skillRange(selected)],
          ['people-outline', 'CAPACITY', `${selected.registeredCount}/${selected.capacity} approved`],
          ['wallet-outline', 'SESSION FEE', money(selected.feeAmount)],
          ['options-outline', 'RULES', selected.rules],
        ].map(([icon, label, value], index) => <View key={label} style={[styles.detailRow, index > 0 && styles.rowBorder]}><View style={styles.detailIcon}><Icon name={icon} color={C.teal} /></View><View style={styles.flex}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View></View>)}
      </View>
      <View style={styles.policyCard}><Icon name="document-text-outline" color={C.ink40} /><View style={styles.flex}><Text style={styles.policyTitle}>Cancellation policy</Text><Text style={styles.policyText}>{selected.cancellationPolicy}</Text></View></View>
      {error ? <View style={styles.errorCard}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
      {canJoin && <Pressable disabled={busy} onPress={() => run(() => joinOpenPlaySession(selected.id, resolvedCode))} style={[styles.primaryButton, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.primaryText}>{selected.approvalMode === 'manual' ? 'Request to join' : selected.registeredCount >= selected.capacity ? 'Join waitlist' : 'Join session'}</Text><Icon name="arrow-forward" color="#0E2321" /></>}</Pressable>}
      {canCheckIn && <Pressable disabled={busy} onPress={() => run(() => checkInOpenPlayPlayer(registration.id))} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryText}>Check in now</Text><Icon name="checkmark-done" color="#0E2321" /></Pressable>}
      {canCancel && <Pressable disabled={busy} onPress={() => run(() => cancelOpenPlayRegistration(registration.id))} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel registration</Text></Pressable>}
    </ScrollView>;
  }

  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={!loading && busy} onRefresh={loadSessions} tintColor={C.teal} />}>
    <View style={styles.header}><Pressable accessibilityLabel="Back" onPress={onBack} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.flex}><Text style={styles.eyebrow}>PLAY TOGETHER</Text><Text style={styles.h1}>Join open play</Text></View></View>
    <ConnectionStatus />
    <View style={styles.hero}><View style={styles.heroIcon}><Icon name="people" size={25} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.heroTitle}>Find your next rotation.</Text><Text style={styles.heroMeta}>Discover verified public sessions or enter an invitation code.</Text></View></View>
    <Text style={styles.sectionLabel}>SESSION CODE</Text>
    <View style={styles.codeRow}><TextInput accessibilityLabel="Six-character session code" autoCapitalize="characters" maxLength={6} value={code} onChangeText={(value) => setCode(value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())} placeholder="ABC123" placeholderTextColor={C.ink40} style={styles.codeInput} /><Pressable disabled={busy || code.length !== 6} onPress={() => resolveCode(code)} style={[styles.codeButton, (busy || code.length !== 6) && styles.disabled]}>{busy ? <ActivityIndicator color="#0E2321" /> : <Icon name="arrow-forward" color="#0E2321" />}</Pressable></View>
    {error ? <View style={styles.errorCard}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>NEAR YOU</Text><Text style={styles.h2}>Available sessions</Text></View><Pressable onPress={loadSessions} style={styles.refreshButton}><Icon name="refresh" size={16} color={C.teal} /></Pressable></View>
    {loading ? <View style={styles.loading}><ActivityIndicator color={C.teal} /><Text style={styles.loadingText}>Finding open play…</Text></View> : sessions.length ? [...sessions].sort((a, b) => (distanceInKm(userLocation, a.venue) ?? Number.MAX_VALUE) - (distanceInKm(userLocation, b.venue) ?? Number.MAX_VALUE)).map((session) => <SessionCard key={session.id} session={session} userLocation={userLocation} onPress={() => { setResolvedCode(''); setSelected(session); setError(''); }} />) : <View style={styles.empty}><Icon name="calendar-outline" size={28} color={C.ink40} /><Text style={styles.emptyTitle}>No sessions available yet</Text><Text style={styles.emptyMeta}>Try a session code or check again when organizers publish nearby open play.</Text></View>}
  </ScrollView>;
}

const lightStyles = StyleSheet.create({
  flex: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 46 }, pressed: { opacity: .78, transform: [{ scale: .99 }] }, disabled: { opacity: .42 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 }, backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, eyebrow: { color: LIGHT_C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, h1: { marginTop: 2, color: LIGHT_C.ink, fontSize: 27, fontWeight: '900' }, h2: { marginTop: 2, color: LIGHT_C.ink, fontSize: 20, fontWeight: '900' },
  hero: { marginTop: 18, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: LIGHT_C.optic }, heroIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: 'rgba(255,255,255,.48)' }, heroTitle: { color: '#0E2321', fontSize: 14, fontWeight: '900' }, heroMeta: { marginTop: 4, color: '#3C4A45', fontSize: 9, lineHeight: 14 },
  sectionLabel: { marginTop: 22, marginBottom: 8, color: LIGHT_C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, codeRow: { flexDirection: 'row', gap: 8 }, codeInput: { minHeight: 54, flex: 1, paddingHorizontal: 15, borderRadius: 14, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface, color: LIGHT_C.ink, fontSize: 18, fontWeight: '900', letterSpacing: 5 }, codeButton: { width: 55, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: LIGHT_C.optic },
  sectionHead: { marginTop: 25, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, refreshButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: LIGHT_C.surface },
  sessionCard: { marginBottom: 10, padding: 14, borderRadius: 19, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, verifiedPill: { alignSelf: 'flex-start', minHeight: 25, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13, backgroundColor: '#E5F0ED' }, verifiedText: { color: LIGHT_C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .45 }, fee: { color: LIGHT_C.ink, fontSize: 11, fontWeight: '900' }, sessionName: { marginTop: 11, color: LIGHT_C.ink, fontSize: 16, fontWeight: '900' }, venueName: { marginTop: 3, color: LIGHT_C.teal, fontSize: 9, fontWeight: '800' }, metaRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }, metaText: { color: LIGHT_C.ink70, fontSize: 8 }, cardFoot: { marginTop: 12, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: LIGHT_C.line }, distance: { color: LIGHT_C.ink40, fontSize: 8, fontWeight: '800' }, spotsPill: { minHeight: 25, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 13, backgroundColor: LIGHT_C.optic }, spotsText: { color: '#0E2321', fontSize: 6, fontWeight: '900' }, fullPill: { backgroundColor: '#F7EAE6' }, fullText: { color: LIGHT_C.brick },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' }, loadingText: { marginTop: 9, color: LIGHT_C.ink40, fontSize: 9, fontWeight: '800' }, empty: { minHeight: 180, padding: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, emptyTitle: { marginTop: 8, color: LIGHT_C.ink, fontSize: 12, fontWeight: '900' }, emptyMeta: { maxWidth: 280, marginTop: 4, color: LIGHT_C.ink40, textAlign: 'center', fontSize: 8, lineHeight: 12 },
  detailHero: { marginTop: 18, padding: 17, borderRadius: 21, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: LIGHT_C.ink }, detailTitle: { marginTop: 13, color: LIGHT_C.surface, fontSize: 23, lineHeight: 29, fontWeight: '900' }, detailVenue: { marginTop: 7, color: LIGHT_C.optic, fontSize: 11, fontWeight: '900' }, detailAddress: { marginTop: 3, color: '#CBD7D2', fontSize: 8, lineHeight: 12 }, statusCard: { marginTop: 12, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 15, backgroundColor: '#F4F1E7' }, statusApproved: { backgroundColor: '#E5F0ED' }, statusNegative: { backgroundColor: '#F7EAE6' }, statusTitle: { color: LIGHT_C.ink, fontSize: 11, fontWeight: '900' }, statusMeta: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 8, lineHeight: 12 },
  detailCard: { marginTop: 13, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, detailRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 10 }, rowBorder: { borderTopWidth: 1, borderColor: LIGHT_C.line }, detailIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, detailLabel: { color: LIGHT_C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .6 }, detailValue: { marginTop: 3, color: LIGHT_C.ink, fontSize: 10, lineHeight: 14, fontWeight: '800' }, policyCard: { marginTop: 11, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 15, backgroundColor: LIGHT_C.surface }, policyTitle: { color: LIGHT_C.ink, fontSize: 9, fontWeight: '900' }, policyText: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 8, lineHeight: 12 },
  errorCard: { marginTop: 11, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#F7EAE6' }, errorText: { flex: 1, color: LIGHT_C.brick, fontSize: 8, lineHeight: 12, fontWeight: '800' }, primaryButton: { minHeight: 56, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, backgroundColor: LIGHT_C.optic }, primaryText: { color: '#0E2321', fontSize: 11, fontWeight: '900' }, cancelButton: { minHeight: 47, marginTop: 8, alignItems: 'center', justifyContent: 'center' }, cancelText: { color: LIGHT_C.brick, fontSize: 9, fontWeight: '900' },
  rotationCard: { marginTop: 12, padding: 15, borderRadius: 19, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: LIGHT_C.ink }, rotationHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, rotationEyebrow: { color: LIGHT_C.optic, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, rotationTitle: { marginTop: 3, color: LIGHT_C.surface, fontSize: 17, fontWeight: '900' }, positionBubble: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: LIGHT_C.optic }, positionNumber: { color: '#0E2321', fontSize: 18, fontWeight: '900' }, rotationWait: { marginTop: 12, color: LIGHT_C.surface, fontSize: 10, fontWeight: '900' }, rotationWhy: { marginTop: 5, color: '#B9C8C2', fontSize: 8, lineHeight: 13 }, nearlyPill: { alignSelf: 'flex-start', minHeight: 28, marginTop: 11, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: LIGHT_C.optic }, nearlyText: { color: '#0E2321', fontSize: 6, fontWeight: '900', letterSpacing: .5 }, liveCourts: { marginTop: 12, borderTopWidth: 1, borderColor: '#304743' }, liveCourt: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: '#304743' }, courtDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: LIGHT_C.brick }, courtDotOpen: { backgroundColor: LIGHT_C.optic }, liveCourtTitle: { color: LIGHT_C.surface, fontSize: 8, fontWeight: '900' }, liveCourtPlayers: { marginTop: 2, color: '#9FB3AC', fontSize: 7 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
