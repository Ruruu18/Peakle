import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { distanceInKm, formatDistance, useUserLocation } from '../context/LocationContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import {
  cancelOpenPlayRegistration,
  checkInOpenPlayPlayer,
  completeOpenPlayMatchByScorer,
  getOpenPlaySession,
  joinOpenPlaySession,
  listDiscoverableOpenPlaySessions,
  recordOpenPlayRally,
  undoOpenPlayRally,
  updateOpenPlayMatchScore,
} from '../services/openPlayRegistration';
import { requireSupabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useOperations } from '../context/OperationsContext';
import ConnectionStatus from '../components/ConnectionStatus';
import ScrollView from '../components/FocusResetScrollView';
import { peekCachedData, readCachedData, withTimeout, writeCachedData } from '../lib/asyncData';
import { openPlaySessionsCacheKey } from '../lib/cacheKeys';
import { skillRangeLabel } from '../utils/skillCategories';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;

function Icon({ name, size = 20, color = C.ink }) { return <Ionicons name={name} size={size} color={color} />; }
function money(value) { return Number(value) > 0 ? `₱${Number(value).toLocaleString('en-PH')}` : 'Free'; }
function discoveryErrorMessage(error, fallback = 'Live games are unavailable right now.') {
  const message = error?.message || '';
  if (/network request failed|failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Can’t reach live games right now. Check your connection—Peakle will retry automatically.';
  }
  return message || fallback;
}
function schedule(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  return `${from.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })} · ${from.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}–${to.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
}
function isMissingRallyRpc(error) {
  return error?.code === 'PGRST202' || /record_open_play_rally|undo_open_play_rally|could not find the function|schema cache/i.test(error?.message || '');
}
const skillRange = (session) => skillRangeLabel(session.skillMin, session.skillMax);

function StatusCard({ registration, liveState }) {
  if (!registration) return null;
  const config = {
    requested: ['time-outline', 'Approval pending', 'The organizer will review your request.'],
    waitlisted: ['hourglass-outline', 'You’re on the waitlist', 'Peakle will keep your place if capacity opens.'],
    approved: registration.checkedInAt
      ? registration.playStatus === 'playing'
        ? ['tennisball', 'Court assigned', 'Your match is live. Follow the court and score below.']
        : ['checkmark-done', 'You’re in the queue', liveState?.queue_position ? `You’re #${liveState.queue_position}. The organizer will assign your court.` : 'The organizer will assign you when a full lineup and court are ready.']
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

function AnimatedOpenPlayCourt({ teams, matchFormat, scores, serverSide, servingPosition, serviceNumber, scorerName, scorerMessage, canScore, paused, pointAnnouncement, celebration, rallyTravel, ballBounce }) {
  const doubles = matchFormat === 'doubles';
  const rallyStops = doubles
    ? [0, .06, .23, .25, .29, .48, .5, .54, .73, .75, .79, .98, 1]
    : [0, .08, .46, .5, .54, .92, 1];
  const rallyX = rallyTravel.interpolate({
    inputRange: rallyStops,
    outputRange: doubles
      ? [-70, -64, 64, 70, 64, 70, 70, 64, -64, -70, -64, -70, -70]
      : [0, -7, 7, 0, 7, -7, 0],
  });
  const rallyY = rallyTravel.interpolate({
    inputRange: rallyStops,
    outputRange: doubles
      ? [-60, -51, 47, 58, 47, -51, -60, -51, 47, 58, 47, -51, -60]
      : [-60, -51, 47, 58, 47, -51, -60],
  });
  const ballSquash = ballBounce.interpolate({ inputRange: [0, .78, 1], outputRange: [1, 1.05, .9] });
  const ballScaleY = Animated.multiply(rallyTravel.interpolate({
    inputRange: rallyStops,
    outputRange: doubles
      ? [.72, 1, 1, .72, 1, 1, .72, 1, 1, .72, 1, 1, .72]
      : [.72, 1, 1, .72, 1, 1, .72],
  }), ballSquash);
  const shadowScale = ballBounce.interpolate({ inputRange: [0, 1], outputRange: [1, .45] });
  const shadowOpacity = ballBounce.interpolate({ inputRange: [0, 1], outputRange: [.24, .08] });
  const playerOpacity = celebration.interpolate({ inputRange: [0, .1, .88, 1], outputRange: [1, 0, 0, 1] });
  const liveShadowOpacity = Animated.multiply(shadowOpacity, playerOpacity);
  const announcementOpacity = celebration.interpolate({ inputRange: [0, .1, .88, 1], outputRange: [0, 1, 1, 0] });
  const announcementScale = celebration.interpolate({ inputRange: [0, .18, .82, 1], outputRange: [.86, 1, 1, .94] });
  const rallyRotation = rallyTravel.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const servingPlayer = teams[serverSide]?.find((player) => player.position === servingPosition);
  const playerLabel = (player) => player?.isMe ? 'You' : player?.name || 'Player';
  const scorerInitials = (scorerName || 'Player').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  return <View style={styles.openPlayLiveCourtCard}>
    <View style={styles.openPlayLiveCourtHead}><View><Text style={styles.openPlayLiveCourtEyebrow}>ON COURT NOW</Text><Text style={styles.openPlayLiveCourtTitle}>Live court</Text></View><View style={styles.openPlayLiveNowPill}><View style={styles.openPlayLiveNowDot} /><Text style={styles.openPlayLiveNowText}>{paused ? 'PAUSED' : 'PLAYING'}</Text></View></View>
    <View style={styles.openPlayPlayCourt}>
      <View style={styles.openPlayPlayCourtBounds} /><View style={styles.openPlayPlayCourtCenterTop} /><View style={styles.openPlayPlayCourtCenterBottom} /><View style={styles.openPlayPlayCourtKitchenTop} /><View style={styles.openPlayPlayCourtKitchenBottom} /><View style={styles.openPlayPlayCourtNet} />
      <View style={styles.openPlayCourtScoreBar}><View style={styles.openPlayCourtScoreTeam}><Text style={styles.openPlayCourtScoreTag}>T1</Text><Text style={styles.openPlayCourtScoreNumber}>{scores[0]}</Text></View><View style={styles.openPlayCourtGamePill}><Text style={styles.openPlayCourtGameText}>LIVE SCORE</Text></View><View style={styles.openPlayCourtScoreTeam}><Text style={styles.openPlayCourtScoreNumber}>{scores[1]}</Text><Text style={[styles.openPlayCourtScoreTag, styles.openPlayCourtScoreTagAway]}>T2</Text></View></View>
      {[0, 1].map((side) => <Animated.View key={side} style={[styles.openPlayPlayCourtTeam, side === 1 && styles.openPlayPlayCourtTeamAway, { opacity: playerOpacity }]}>{teams[side].map((player) => <View key={player.id} style={styles.openPlayPlayCourtPlayer}><View style={[styles.openPlayPlayPlayerMarker, side === 1 && styles.openPlayPlayPlayerMarkerAway, serverSide === side && servingPosition === player.position && styles.openPlayPlayPlayerServing]}><Text style={styles.openPlayPlayPlayerInitials}>{player.isMe ? 'YOU' : player.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</Text></View><Text numberOfLines={1} style={styles.openPlayPlayPlayerName}>{playerLabel(player)}</Text></View>)}</Animated.View>)}
      {pointAnnouncement ? <Animated.View accessibilityRole="alert" accessibilityLiveRegion="assertive" pointerEvents="none" style={[styles.openPlayPlayAnnouncement, { opacity: announcementOpacity, transform: [{ scale: announcementScale }] }]}><Text style={styles.openPlayPlayAnnouncementPlayer}>{pointAnnouncement.player}</Text><Text numberOfLines={1} style={styles.openPlayPlayAnnouncementTeam}>{pointAnnouncement.team}</Text><Text style={styles.openPlayPlayAnnouncementText}>{pointAnnouncement.action}</Text><Text style={styles.openPlayPlayAnnouncementScore}>{pointAnnouncement.score}</Text><Text numberOfLines={2} style={styles.openPlayPlayAnnouncementServe}>{pointAnnouncement.note}</Text></Animated.View> : null}
      <Animated.View pointerEvents="none" style={[styles.openPlayPlayBallShadow, { opacity: liveShadowOpacity, transform: [{ translateX: rallyX }, { translateY: rallyY }, { scaleX: shadowScale }] }]} />
      <Animated.View accessibilityLabel="Pickleball rallying from player to player" pointerEvents="none" style={[styles.openPlayPlayBall, { opacity: playerOpacity, transform: [{ translateX: rallyX }, { translateY: rallyY }, { rotate: rallyRotation }, { scaleY: ballScaleY }] }]}><View style={styles.openPlayPlayBallHoleOne} /><View style={styles.openPlayPlayBallHoleTwo} /><View style={styles.openPlayPlayBallHoleThree} /></Animated.View>
    </View>
    <View style={styles.openPlayScorerBooth}><View style={styles.openPlayScorerBoothAvatar}><Text style={styles.openPlayScorerBoothInitials}>{scorerInitials}</Text><View style={styles.openPlayScorerOnline} /></View><View style={styles.openPlayScorerBoothCopy}><Text style={styles.openPlayScorerBoothLabel}>PLAYER SCORER</Text><Text style={styles.openPlayScorerBoothName}>{scorerName}</Text><Text accessibilityLiveRegion="polite" numberOfLines={1} style={styles.openPlayScorerMessage}>{scorerMessage}</Text><Text style={styles.openPlayScorerServing}>{playerLabel(servingPlayer)} serving{doubles ? ` · Server ${serviceNumber}` : ''}</Text></View><View style={styles.openPlayScorerControlBadge}><Icon name={canScore ? 'create-outline' : 'eye-outline'} size={14} color={C.teal} /><Text style={styles.openPlayScorerControlText}>{canScore ? 'SCORING' : 'WATCHING'}</Text></View></View>
  </View>;
}

function OpenPlayLiveMatch({ session, onRefresh, onBack }) {
  const match = session.liveState?.activeMatch;
  const teams = useMemo(() => [0, 1].map((side) => (match?.players || []).filter((player) => player.side === side).sort((a, b) => a.position - b.position)), [match?.players]);
  const teamName = useCallback((side) => teams[side].map((player) => player.isMe ? 'You' : player.name).join(' + ') || `Team ${side + 1}`, [teams]);
  const [scores, setScores] = useState(match?.scores || [0, 0]);
  const [serverSide, setServerSide] = useState(match?.serverSide || 0);
  const [servingPosition, setServingPosition] = useState(match?.servingPosition || 0);
  const [serviceNumber, setServiceNumber] = useState(match?.serviceNumber || 1);
  const [canUndo, setCanUndo] = useState(Boolean(match?.canUndo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pointAnnouncement, setPointAnnouncement] = useState(null);
  const [paused, setPaused] = useState(false);
  const [scorerMessage, setScorerMessage] = useState('Match started · scoring is live for every player.');
  const ballBounce = useRef(new Animated.Value(0)).current;
  const rallyTravel = useRef(new Animated.Value(0)).current;
  const celebration = useRef(new Animated.Value(0)).current;
  const announcedEventRef = useRef(match?.lastEvent?.id || null);
  const appliedEventIdRef = useRef(Number(match?.lastEvent?.id || 0));
  const activeMatchIdRef = useRef(match?.id || null);
  const legacyHistoryRef = useRef([]);

  const applyRallyState = useCallback((event) => {
    if (!event) return;
    const eventId = Number(event.id || 0);
    if (eventId) appliedEventIdRef.current = Math.max(appliedEventIdRef.current, eventId);
    setScores([Number(event.home_score || 0), Number(event.away_score || 0)]);
    setServerSide(Number(event.server_side || 0));
    setServingPosition(Number(event.serving_position || 0));
    setServiceNumber(Number(event.service_number || 1));
    if (typeof event.can_undo === 'boolean') setCanUndo(event.can_undo);
  }, []);

  const bounceBall = useCallback(() => {
    ballBounce.stopAnimation();
    ballBounce.setValue(0);
    Animated.sequence([
      Animated.timing(ballBounce, { toValue: 1, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(ballBounce, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [ballBounce]);

  const announceRally = useCallback((event, onComplete = null) => {
    if (!event) return;
    const winningSide = Number(event.winning_side ?? event.rally_winner_side ?? 0);
    const action = event.action === 'point' ? 'SCORES!' : event.action === 'second_server' ? 'SECOND SERVER' : event.action === 'undo' ? 'POINT UNDONE' : 'SIDE OUT';
    const nextServer = Number(event.server_side ?? 0);
    const nextPlayer = teams[nextServer]?.find((player) => player.position === Number(event.serving_position || 0));
    const note = event.action === 'point'
      ? 'Score recorded for every player'
      : event.action === 'undo'
        ? 'Previous rally restored'
        : `${nextPlayer?.isMe ? 'You' : nextPlayer?.name || teamName(nextServer)} serving${teams[nextServer]?.length > 1 ? ` · Server ${Number(event.service_number || 1)}` : ''}`;
    const scoringPlayer = teams[winningSide]?.find((player) => player.position === Number(event.serving_position || 0));
    const announcementPlayer = event.action === 'point' ? (scoringPlayer?.isMe ? 'You' : scoringPlayer?.name || teamName(winningSide)) : event.action === 'undo' ? 'Score corrected' : teamName(winningSide);
    const announcementTeam = event.action === 'point' ? teamName(winningSide) : event.action === 'undo' ? 'Previous rally restored' : 'wins the rally';
    announcedEventRef.current = event.id || null;
    setScorerMessage(event.action === 'point' ? `Point to ${teamName(winningSide)} · ${Number(event.home_score || 0)}–${Number(event.away_score || 0)}` : event.action === 'undo' ? `Last rally removed · ${Number(event.home_score || 0)}–${Number(event.away_score || 0)}` : `${teamName(winningSide)} won the rally · ${note}`);
    setPointAnnouncement({ player: announcementPlayer, team: announcementTeam, action, score: `${Number(event.home_score || 0)} – ${Number(event.away_score || 0)}`, note });
    bounceBall();
    celebration.stopAnimation();
    celebration.setValue(0);
    Animated.timing(celebration, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(() => {
      setPointAnnouncement(null);
      celebration.setValue(0);
      onComplete?.();
    });
  }, [bounceBall, celebration, teamName, teams]);

  useEffect(() => {
    rallyTravel.stopAnimation();
    if (paused || pointAnnouncement) return undefined;
    rallyTravel.setValue(0);
    const travelStops = match?.matchFormat === 'doubles' ? [.25, .5, .75, 1] : [.5, 1];
    const legDuration = match?.matchFormat === 'doubles' ? 1150 : 1350;
    const rally = Animated.loop(Animated.sequence(travelStops.map((toValue) => Animated.timing(rallyTravel, { toValue, duration: legDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }))));
    rally.start();
    bounceBall();
    return () => rally.stop();
  }, [bounceBall, match?.matchFormat, paused, pointAnnouncement, rallyTravel]);

  useEffect(() => () => {
    ballBounce.stopAnimation();
    celebration.stopAnimation();
  }, [ballBounce, celebration]);

  useEffect(() => {
    if (!match) return;
    const matchChanged = activeMatchIdRef.current !== match.id;
    const incomingEventId = Number(match.lastEvent?.id || 0);
    if (!matchChanged && appliedEventIdRef.current > 0 && incomingEventId < appliedEventIdRef.current) return;
    if (matchChanged) {
      activeMatchIdRef.current = match.id;
      appliedEventIdRef.current = incomingEventId;
      announcedEventRef.current = match.lastEvent?.id || null;
    } else if (incomingEventId) {
      appliedEventIdRef.current = Math.max(appliedEventIdRef.current, incomingEventId);
    }
    setScores(match.scores || [0, 0]);
    setServerSide(match.serverSide || 0);
    setServingPosition(match.servingPosition || 0);
    setServiceNumber(match.serviceNumber || 1);
    setCanUndo(Boolean(match.canUndo));
    if (match.lastEvent?.id && match.lastEvent.id !== announcedEventRef.current) announceRally(match.lastEvent);
  }, [announceRally, match?.id, match?.scores?.[0], match?.scores?.[1], match?.serverSide, match?.servingPosition, match?.serviceNumber, match?.canUndo, match?.lastEvent?.id]);
  if (!match) return null;

  const lead = Math.abs(scores[0] - scores[1]);
  const canFinish = Math.max(...scores) >= 11 && lead >= 2;
  const gamePoint = Math.max(...scores) >= 10 && scores[0] !== scores[1];
  const servingPlayer = teams[serverSide]?.find((player) => player.position === servingPosition);

  const persistFinishedMatch = async (finalScores) => {
    setBusy(true);
    setError('');
    try {
      await completeOpenPlayMatchByScorer(match.id, finalScores);
      await onRefresh();
    } catch (finishError) {
      setError(`${finishError.message || 'The match could not be recorded.'} Tap Finish & record to retry.`);
    } finally { setBusy(false); }
  };

  const recordRally = async (side) => {
    if (!match.canScore || busy || paused || pointAnnouncement || canFinish) return;
    setBusy(true);
    setError('');
    try {
      let event;
      try {
        event = await recordOpenPlayRally(match.id, side);
        console.info('[OpenPlayScore] rally confirmed', { matchId: match.id, side, event });
      } catch (rallyError) {
        console.warn('[OpenPlayScore] primary rally RPC failed', { matchId: match.id, side, code: rallyError?.code, message: rallyError?.message, details: rallyError?.details, hint: rallyError?.hint });
        if (!isMissingRallyRpc(rallyError)) throw rallyError;
        const previous = { scores: [...scores], serverSide, servingPosition, serviceNumber };
        const nextScores = [...scores];
        let nextServer = serverSide;
        let nextPosition = servingPosition;
        let nextService = match.matchFormat === 'doubles' ? serviceNumber : 1;
        let action = 'point';
        if (side === serverSide) {
          nextScores[side] += 1;
        } else if (match.matchFormat === 'doubles' && serviceNumber === 1) {
          nextPosition = servingPosition === 0 ? 1 : 0;
          nextService = 2;
          action = 'second_server';
        } else {
          nextServer = 1 - serverSide;
          nextPosition = 0;
          nextService = 1;
          action = 'side_out';
        }
        await updateOpenPlayMatchScore(match.id, nextScores);
        console.info('[OpenPlayScore] legacy score confirmed', { matchId: match.id, side, nextScores, action });
        legacyHistoryRef.current = [...legacyHistoryRef.current.slice(-14), previous];
        event = {
          id: Date.now(),
          winning_side: side,
          action,
          home_score: nextScores[0],
          away_score: nextScores[1],
          server_side: nextServer,
          serving_position: nextPosition,
          service_number: nextService,
          can_undo: true,
          legacy: true,
        };
      }
      applyRallyState(event);
      setCanUndo(true);
      const eventScores = [Number(event.home_score || 0), Number(event.away_score || 0)];
      const eventComplete = Math.max(...eventScores) >= 11 && Math.abs(eventScores[0] - eventScores[1]) >= 2;
      announceRally(event, eventComplete ? () => persistFinishedMatch(eventScores) : null);
      if (!event.legacy) await onRefresh();
    } catch (scoreError) {
      console.error('[OpenPlayScore] rally rejected', { matchId: match.id, side, code: scoreError?.code, message: scoreError?.message, details: scoreError?.details, hint: scoreError?.hint });
      setError(scoreError.message || 'The rally could not be recorded. The displayed score was not changed.');
      await onRefresh().catch(() => {});
    } finally { setBusy(false); }
  };

  const undo = async () => {
    if (!canUndo || busy || paused || pointAnnouncement) return;
    setBusy(true);
    setError('');
    try {
      let event;
      try {
        event = await undoOpenPlayRally(match.id);
      } catch (undoRpcError) {
        if (!isMissingRallyRpc(undoRpcError)) throw undoRpcError;
        const previous = legacyHistoryRef.current[legacyHistoryRef.current.length - 1];
        if (!previous) throw new Error('There is no rally to undo.');
        await updateOpenPlayMatchScore(match.id, previous.scores);
        legacyHistoryRef.current = legacyHistoryRef.current.slice(0, -1);
        event = {
          id: Date.now(),
          winning_side: previous.serverSide,
          action: 'undo',
          home_score: previous.scores[0],
          away_score: previous.scores[1],
          server_side: previous.serverSide,
          serving_position: previous.servingPosition,
          service_number: previous.serviceNumber,
          can_undo: legacyHistoryRef.current.length > 0,
          legacy: true,
        };
      }
      applyRallyState(event);
      announceRally(event);
      if (!event.legacy) await onRefresh();
    } catch (undoError) {
      setError(undoError.message || 'The last rally could not be undone.');
      await onRefresh().catch(() => {});
    } finally { setBusy(false); }
  };

  const finish = () => {
    if (!canFinish || busy) return;
    const winner = scores[0] > scores[1] ? teamName(0) : teamName(1);
    Alert.alert('Finish this Open Play match?', `${winner} wins ${scores[0]}–${scores[1]}. Everyone will return to the fair-play queue.`, [
      { text: 'Keep playing', style: 'cancel' },
      { text: 'Finish match', onPress: () => persistFinishedMatch(scores) },
    ]);
  };

  return <ScrollView contentContainerStyle={styles.liveMatchContent} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={busy} onRefresh={onRefresh} tintColor={C.optic} />}>
    <View style={styles.liveMatchHero}>
      <View style={styles.liveMatchHeader}><Pressable accessibilityLabel="Back to session" onPress={onBack} style={styles.liveMatchBack}><Icon name="chevron-back" color={C.surface} /></Pressable><View style={styles.flex}><Text style={styles.liveMatchEyebrow}>OPEN PLAY · LIVE MATCH</Text><Text numberOfLines={1} style={styles.liveMatchTitle}>{match.courtName}</Text></View><View style={styles.liveMatchPill}><View style={styles.liveMatchDot} /><Text style={styles.liveMatchPillText}>LIVE</Text></View></View>
      <View style={styles.liveMatchRuleRow}><Text style={styles.liveMatchRule}>FIRST TO 11</Text><View style={styles.liveMatchRuleDot} /><Text style={styles.liveMatchRule}>WIN BY 2</Text><View style={styles.liveMatchRuleDot} /><Text style={styles.liveMatchRule}>{match.matchFormat.toUpperCase()}</Text></View>
    </View>

    {!match.canScore ? <View style={styles.liveScoreNotice}><Icon name="eye-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.liveScoreNoticeTitle}>Watching the match live</Text><Text style={styles.liveScoreNoticeText}>{match.scorerName} is the assigned player scorer. Every point appears here automatically.</Text></View></View> : <View style={styles.liveScoreNotice}><Icon name="phone-portrait-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.liveScoreNoticeTitle}>You’re the player scorer</Text><Text style={styles.liveScoreNoticeText}>Keep your phone courtside and tap the team that won each rally.</Text></View></View>}

    <AnimatedOpenPlayCourt teams={teams} matchFormat={match.matchFormat} scores={scores} serverSide={serverSide} servingPosition={servingPosition} serviceNumber={serviceNumber} scorerName={match.scorerName} scorerMessage={paused ? 'Match paused · resume when players are ready.' : gamePoint ? `Game point · ${scores[0]}–${scores[1]}` : scorerMessage} canScore={match.canScore} paused={paused} pointAnnouncement={pointAnnouncement} celebration={celebration} rallyTravel={rallyTravel} ballBounce={ballBounce} />

    {error ? <View style={styles.errorCard}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
    {match.canScore ? <><View style={styles.openPlayPlayScorerActions}><View style={styles.openPlayPlayScorerActionHead}><View><Text style={styles.eyebrow}>WHO WON THE RALLY?</Text><Text style={styles.openPlayPlayScorerActionTitle}>One tap updates score and serve</Text><Text accessibilityLiveRegion="polite" style={styles.openPlayPlayScorerActionMeta}>{servingPlayer?.isMe ? 'You' : servingPlayer?.name || teamName(serverSide)} serving{teams[serverSide]?.length > 1 ? ` · Server ${serviceNumber}` : ''}</Text></View><View style={[styles.openPlayPlayTeamBadge, serverSide === 1 && styles.openPlayPlayTeamBadgeAway]}><Text style={styles.openPlayPlayTeamBadgeText}>T{serverSide + 1}</Text></View></View><View style={styles.openPlayPlayRallyButtons}>{[0, 1].map((side) => { const scoringLocked = busy || paused || Boolean(pointAnnouncement) || canFinish; return <Pressable key={side} accessibilityLabel={`${teamName(side)} won the rally`} disabled={scoringLocked} onPress={() => recordRally(side)} style={({ pressed }) => [styles.openPlayPlayRallyButton, side === 1 && styles.openPlayPlayRallyButtonAway, scoringLocked && styles.openPlayPlayPointDisabled, pressed && !scoringLocked && styles.pressed]}><Text style={styles.openPlayPlayRallyTag}>TEAM {side + 1}</Text><Text numberOfLines={2} style={styles.openPlayPlayRallyName}>{teamName(side)}</Text><Text style={styles.openPlayPlayRallyAction}>WON RALLY</Text></Pressable>; })}</View><Text style={styles.openPlayPlayAutoServeHint}><Icon name="flash-outline" size={11} color={C.teal} /> Serving rotation updates automatically</Text></View><View style={styles.openPlayPlayControls}><Pressable accessibilityRole="button" accessibilityLabel="Undo last rally" disabled={busy || paused || Boolean(pointAnnouncement) || !canUndo} onPress={undo} style={({ pressed }) => [styles.openPlayPlayControlButton, (busy || paused || pointAnnouncement || !canUndo) && styles.openPlayPlayControlDisabled, pressed && styles.pressed]}><Icon name="arrow-undo-outline" color={busy || paused || pointAnnouncement || !canUndo ? C.ink40 : C.teal} /><Text style={[styles.openPlayPlayControlText, (busy || paused || pointAnnouncement || !canUndo) && styles.openPlayPlayControlTextDisabled]}>Undo</Text></Pressable>{canFinish ? <Pressable accessibilityRole="button" disabled={busy || Boolean(pointAnnouncement)} onPress={finish} style={({ pressed }) => [styles.openPlayPlayControlButton, styles.openPlayPlayFinishButton, (busy || pointAnnouncement) && styles.openPlayPlayControlDisabled, pressed && !busy && !pointAnnouncement && styles.pressed]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Icon name="checkmark-circle" color="#0E2321" /><Text style={styles.openPlayPlayFinishText}>Finish & record</Text></>}</Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={paused ? 'Resume match' : 'Pause match'} disabled={busy || Boolean(pointAnnouncement)} onPress={() => setPaused((value) => !value)} style={({ pressed }) => [styles.openPlayPlayControlButton, styles.openPlayPlayFinishButton, (busy || pointAnnouncement) && styles.openPlayPlayControlDisabled, pressed && !busy && !pointAnnouncement && styles.pressed]}><Icon name={paused ? 'play' : 'pause'} color="#0E2321" /><Text style={styles.openPlayPlayFinishText}>{paused ? 'Resume' : 'Pause'}</Text></Pressable>}</View></> : null}
  </ScrollView>;
}

function SessionCard({ session, userLocation, onPress }) {
  const distance = distanceInKm(userLocation, session.venue);
  const full = session.registeredCount >= session.capacity;
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.sessionCard, pressed && styles.pressed]}>
    <View style={styles.cardHead}><View style={styles.verifiedPill}><Icon name="shield-checkmark" size={12} color={C.teal} /><Text style={styles.verifiedText}>VERIFIED VENUE</Text></View><Text style={styles.fee}>{money(session.feeAmount)}</Text></View>
    <Text style={styles.sessionName}>{session.name}</Text>
    <Text style={styles.venueName}>{session.venue?.name} · {session.venue?.area}</Text>
    <View style={styles.metaRow}><Icon name="calendar-outline" size={14} color={C.ink40} /><Text style={styles.metaText}>{schedule(session.scheduledStart, session.scheduledEnd)}</Text></View>
    <View style={styles.metaRow}><Icon name="podium-outline" size={14} color={C.ink40} /><Text style={styles.metaText}>{skillRange(session)}</Text></View>
    <View style={styles.cardFoot}><Text style={styles.distance}>{formatDistance(distance)}</Text><View style={[styles.spotsPill, full && styles.fullPill]}><Text style={[styles.spotsText, full && styles.fullText]}>{full ? 'WAITLIST' : `${session.capacity - session.registeredCount} SPOTS`}</Text></View></View>
  </Pressable>;
}

export default function PlayerOpenPlayScreen({ onBack, onDetailBack = null, initialCode = '', initialSession = null, initialSessionId = null, navigationToken = null }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { userLocation } = useUserLocation();
  const { user } = useAuth();
  const { online, reportRealtime } = useOperations();
  const userSessionsCacheKey = openPlaySessionsCacheKey(user?.id || 'guest');
  const [sessions, setSessions] = useState(() => peekCachedData(userSessionsCacheKey) || []);
  const [selected, setSelected] = useState(initialSession);
  const [code, setCode] = useState(initialCode || '');
  const [resolvedCode, setResolvedCode] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessionFilter, setSessionFilter] = useState('nearby');
  const sessionsRef = useRef(sessions);
  const loadRequestRef = useRef(null);
  const realtimeRefreshTimer = useRef(null);
  const selectedRefreshRevisionRef = useRef(0);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const hasUserLocation = [userLocation?.latitude, userLocation?.longitude].every(Number.isFinite);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const sessionMatchesFilter = useCallback((session, filter) => {
    if (filter === 'today') return new Date(session.scheduledStart).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) === today;
    if (filter === 'nearby') {
      if (!hasUserLocation) return true;
      const distance = distanceInKm(userLocation, session.venue);
      return distance != null && distance <= 25;
    }
    if (filter === 'spots') return session.registeredCount < session.capacity;
    return true;
  }, [hasUserLocation, today, userLocation]);
  const visibleSessions = useMemo(() => sessions
    .filter((session) => sessionMatchesFilter(session, sessionFilter))
    .sort((a, b) => (distanceInKm(userLocation, a.venue) ?? Number.MAX_VALUE) - (distanceInKm(userLocation, b.venue) ?? Number.MAX_VALUE)), [sessionFilter, sessionMatchesFilter, sessions, userLocation]);

  const loadSessions = useCallback(async ({ showRefresh = false } = {}) => {
    if (loadRequestRef.current) return loadRequestRef.current;
    if (showRefresh) setRefreshing(true);
    if (!online) {
      setRefreshing(false);
      setError(`You’re offline. Peakle will reconnect automatically.${sessionsRef.current.length ? ' Showing saved nearby games.' : ''}`);
      return sessionsRef.current;
    }
    const request = withTimeout(
      listDiscoverableOpenPlaySessions(),
      12000,
      'Open-play sessions took too long to refresh.',
    ).then((rows) => {
      sessionsRef.current = rows;
      setSessions(rows);
      setError('');
      writeCachedData(userSessionsCacheKey, rows);
      return rows;
    }).catch((loadError) => {
      setError(`${discoveryErrorMessage(loadError)}${sessionsRef.current.length ? ' Showing saved nearby games.' : ''}`);
      return sessionsRef.current;
    }).finally(() => {
      setRefreshing(false);
      loadRequestRef.current = null;
    });
    loadRequestRef.current = request;
    return request;
  }, [online, userSessionsCacheKey]);

  const resolveCode = useCallback(async (value) => {
    const clean = value.trim().toUpperCase();
    if (clean.length !== 6) { setError('Enter the six-character session code.'); return; }
    if (!online) {
      setError('You’re offline. Reconnect to look up a play code.');
      return;
    }
    setBusy(true); setError('');
    try {
      const session = await withTimeout(
        getOpenPlaySession({ code: clean }),
        12000,
        'The play code lookup took too long. Please try again.',
      );
      if (!session?.id) throw new Error('That play code was not found.');
      setResolvedCode(clean);
      setSelected(session);
    } catch (lookupError) { setError(discoveryErrorMessage(lookupError, 'That play code was not found.')); }
    finally { setBusy(false); }
  }, [online]);

  useEffect(() => {
    let active = true;
    loadSessions();
    readCachedData(userSessionsCacheKey).then((cached) => {
      if (!active || sessionsRef.current.length) return;
      if (cached !== null && !sessionsRef.current.length) {
        sessionsRef.current = cached;
        setSessions(cached);
      }
    });
    return () => { active = false; };
  }, [loadSessions, userSessionsCacheKey]);
  useEffect(() => {
    if (initialCode?.trim().length === 6) resolveCode(initialCode);
  }, [initialCode, resolveCode]);
  useEffect(() => {
    if (initialSession?.id) setSelected(initialSession);
  }, [initialSession]);
  useEffect(() => {
    if (!navigationToken) return;
    if (!initialSessionId) {
      setSelected(null);
      setResolvedCode('');
      setError('');
      return;
    }
    let active = true;
    setBusy(true);
    setError('');
    getOpenPlaySession({ sessionId: initialSessionId })
      .then((session) => {
        if (!active) return;
        if (!session?.id) throw new Error('That open-play session is no longer available.');
        setResolvedCode('');
        setSelected(session);
      })
      .catch((lookupError) => {
        if (active) setError(lookupError.message || 'That open-play session could not be opened.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, [initialSessionId, navigationToken]);

  useEffect(() => {
    if (!online || !user?.id) return undefined;
    const client = requireSupabase();
    let active = true;
    let invalidationChannel = null;
    const refreshDiscovery = () => {
      clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = setTimeout(() => loadSessions(), 180);
    };
    const channel = client.channel(`open-play-discovery-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_sessions' }, refreshDiscovery)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_players' }, refreshDiscovery)
      .subscribe((status) => reportRealtime(`open-play-discovery-${user.id}`, status));
    client.from('open_play_discovery_events').select('topic').limit(1).then(({ error: discoveryError }) => {
      if (!active || discoveryError) return;
      invalidationChannel = client.channel(`open-play-invalidation-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_discovery_events' }, refreshDiscovery)
        .subscribe((status) => reportRealtime(`open-play-invalidation-${user.id}`, status));
    });
    return () => {
      active = false;
      clearTimeout(realtimeRefreshTimer.current);
      client.removeChannel(channel);
      reportRealtime(`open-play-discovery-${user.id}`, 'REMOVE');
      if (invalidationChannel) {
        client.removeChannel(invalidationChannel);
        reportRealtime(`open-play-invalidation-${user.id}`, 'REMOVE');
      }
    };
  }, [loadSessions, online, reportRealtime, user?.id]);
  useEffect(() => {
    if (!selected?.id) return undefined;
    const sessionId = selected.id;
    const refreshFromRealtime = () => {
      const revision = ++selectedRefreshRevisionRef.current;
      getOpenPlaySession({ sessionId, code: resolvedCode || null })
        .then((session) => { if (revision === selectedRefreshRevisionRef.current) setSelected(session); })
        .catch(() => {});
    };
    const channel = requireSupabase()
      .channel(`player-open-play-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_players', filter: `session_id=eq.${sessionId}` }, () => {
        refreshFromRealtime();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'open_play_sessions', filter: `id=eq.${sessionId}` }, () => {
        refreshFromRealtime();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_matches', filter: `session_id=eq.${sessionId}` }, () => {
        refreshFromRealtime();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'open_play_rotation_decisions', filter: `session_id=eq.${sessionId}` }, () => {
        refreshFromRealtime();
      })
      .subscribe((status) => reportRealtime(`player-${sessionId}`, status));
    return () => { requireSupabase().removeChannel(channel); reportRealtime(`player-${sessionId}`, 'REMOVE'); };
  }, [reportRealtime, resolvedCode, selected?.id]);

  const refreshSelected = async () => {
    if (!selected) return;
    const revision = ++selectedRefreshRevisionRef.current;
    const refreshed = await getOpenPlaySession({ sessionId: selected.id, code: resolvedCode || null });
    if (revision === selectedRefreshRevisionRef.current) setSelected(refreshed);
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
    const canCancel = registration && ['requested', 'waitlisted', 'approved'].includes(registration.status) && registration.playStatus !== 'playing' && !registration.departedAt;
    const canCheckIn = registration?.status === 'approved' && !registration.checkedInAt;
    if (registration?.playStatus === 'playing' && selected.liveState?.activeMatch) return <OpenPlayLiveMatch session={selected} onRefresh={refreshSelected} onBack={() => { if (onDetailBack) { onDetailBack(); return; } setSelected(null); }} />;
    return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => run(async () => {})} tintColor={C.teal} />}>
      <View style={styles.header}><Pressable accessibilityLabel={onDetailBack ? 'Back' : 'Back to open play'} onPress={() => { if (onDetailBack) { onDetailBack(); return; } setSelected(null); setError(''); }} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.flex}><Text style={styles.eyebrow}>OPEN PLAY</Text><Text style={styles.h1}>Session details</Text></View></View>
      <ConnectionStatus />
      <View style={styles.detailHero}><View style={styles.verifiedPill}><Icon name="shield-checkmark" size={12} color={C.teal} /><Text style={styles.verifiedText}>VERIFIED VENUE</Text></View><Text style={styles.detailTitle}>{selected.name}</Text><Text style={styles.detailVenue}>{selected.venue?.name}</Text><Text style={styles.detailAddress}>{selected.venue?.address}</Text></View>
      <StatusCard registration={registration} liveState={selected.liveState} />
      <LiveRotationCard session={selected} />
      <View style={styles.detailCard}>
        {[
          ['calendar-outline', 'SCHEDULE', schedule(selected.scheduledStart, selected.scheduledEnd)],
          ['person-outline', 'ORGANIZER', selected.organizer?.name || 'Peakle organizer'],
          ['podium-outline', 'SKILL RANGE', skillRange(selected)],
          ['people-outline', 'CAPACITY', `${selected.registeredCount}/${selected.capacity} approved`],
          ['git-compare-outline', 'MATCH FORMAT', selected.matchFormat === 'mixed' ? 'Singles & doubles' : selected.matchFormat === 'singles' ? 'Singles' : 'Doubles'],
          ['wallet-outline', 'SESSION FEE', money(selected.feeAmount)],
          ['options-outline', 'RULES', selected.rules],
        ].map(([icon, label, value], index) => <View key={label} style={[styles.detailRow, index > 0 && styles.rowBorder]}><View style={styles.detailIcon}><Icon name={icon} color={C.teal} /></View><View style={styles.flex}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View></View>)}
      </View>
      <View style={styles.policyCard}><Icon name="document-text-outline" color={C.ink40} /><View style={styles.flex}><Text style={styles.policyTitle}>Cancellation policy</Text><Text style={styles.policyText}>{selected.cancellationPolicy}</Text></View></View>
      {error ? <View style={styles.errorCard}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
      {canJoin && <Pressable disabled={busy} onPress={() => run(() => joinOpenPlaySession(selected.id, resolvedCode))} style={({ pressed }) => [styles.primaryButton, busy && styles.disabled, pressed && styles.pressed]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.primaryText}>{selected.approvalMode === 'manual' ? 'Request to join' : selected.registeredCount >= selected.capacity ? 'Join waitlist' : 'Join session'}</Text><Icon name="arrow-forward" color="#0E2321" /></>}</Pressable>}
      {canCheckIn && <Pressable disabled={busy} onPress={() => run(() => checkInOpenPlayPlayer(registration.id))} style={({ pressed }) => [styles.primaryButton, busy && styles.disabled, pressed && styles.pressed]}><Text style={styles.primaryText}>Check in now</Text><Icon name="checkmark-done" color="#0E2321" /></Pressable>}
      {canCancel && <Pressable disabled={busy} onPress={() => run(() => cancelOpenPlayRegistration(registration.id))} style={({ pressed }) => [styles.cancelButton, busy && styles.disabled, pressed && styles.pressed]}><Text style={styles.cancelText}>Cancel registration</Text></Pressable>}
    </ScrollView>;
  }

  return <View style={styles.flex}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadSessions({ showRefresh: true })} tintColor={C.teal} />}>
    <View style={styles.header}><Pressable accessibilityLabel="Back" onPress={onBack} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.flex}><Text style={styles.eyebrow}>PLAY TOGETHER</Text><Text style={styles.h1}>Join open play</Text></View></View>
    <ConnectionStatus />
    <View style={styles.hero}><View style={styles.heroIcon}><Icon name="people" size={25} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.heroTitle}>Find your next rotation.</Text><Text style={styles.heroMeta}>Discover verified public sessions or enter an invitation code.</Text></View></View>
    <Text style={styles.sectionLabel}>SESSION CODE</Text>
    <View style={styles.codeRow}><TextInput accessibilityLabel="Six-character session code" autoCapitalize="characters" maxLength={6} value={code} onChangeText={(value) => setCode(value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())} placeholder="ABC123" placeholderTextColor={C.ink40} style={styles.codeInput} /><Pressable disabled={busy || code.length !== 6} onPress={() => resolveCode(code)} style={[styles.codeButton, (busy || code.length !== 6) && styles.disabled]}>{busy ? <ActivityIndicator color="#0E2321" /> : <Icon name="arrow-forward" color="#0E2321" />}</Pressable></View>
    {error ? <View style={styles.errorCard}><Icon name="alert-circle" color={C.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
    <View style={styles.sectionHead}><View style={styles.flex}><Text style={styles.eyebrow}>NEAR YOU · LIVE</Text><Text style={styles.h2}>Games near you</Text><Text style={styles.liveLocationText}>{hasUserLocation ? `${userLocation.label || 'Current location'} · within 25 km` : 'Location will apply automatically when available'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Refresh nearby games" onPress={() => loadSessions()} style={styles.refreshButton}><Icon name="refresh" size={16} color={C.teal} /></Pressable></View>
    {!!sessions.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{[['all', 'All'], ['today', 'Today'], ['nearby', 'Within 25 km'], ['spots', 'Open spots']].map(([value, label]) => { const count = sessions.filter((session) => sessionMatchesFilter(session, value)).length; return <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: sessionFilter === value }} onPress={() => setSessionFilter(value)} style={[styles.filterChip, sessionFilter === value && styles.filterChipActive]}><Text style={[styles.filterChipText, sessionFilter === value && styles.filterChipTextActive]}>{label}</Text><Text style={[styles.filterCount, sessionFilter === value && styles.filterCountActive]}>{count}</Text></Pressable>; })}</ScrollView>}
    {visibleSessions.length ? visibleSessions.map((session) => <SessionCard key={session.id} session={session} userLocation={userLocation} onPress={() => { setResolvedCode(''); setSelected(session); setError(''); }} />) : sessions.length ? <View style={styles.empty}><Icon name="location-outline" size={28} color={C.ink40} /><Text style={styles.emptyTitle}>{sessionFilter === 'nearby' ? 'No nearby games right now' : 'No sessions match this filter'}</Text><Text style={styles.emptyMeta}>{sessionFilter === 'nearby' ? 'Peakle is watching live within 25 km. New nearby sessions will appear automatically.' : 'Choose another view to see more available open-play sessions.'}</Text></View> : <View style={styles.empty}><Icon name="calendar-outline" size={28} color={C.ink40} /><Text style={styles.emptyTitle}>No sessions available yet</Text><Text style={styles.emptyMeta}>Peakle is watching for nearby games live. You can also enter a play code.</Text></View>}
  </ScrollView></View>;
}

const lightStyles = createMobileStyleSheet({
  flex: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 65 }, pressed: { opacity: .78, transform: [{ scale: .99 }] }, disabled: { opacity: .42 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 }, backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, eyebrow: { color: LIGHT_C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, h1: { marginTop: 2, color: LIGHT_C.ink, fontSize: 27, fontWeight: '900' }, h2: { marginTop: 2, color: LIGHT_C.ink, fontSize: 20, fontWeight: '900' },
  hero: { marginTop: 18, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: LIGHT_C.optic }, heroIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: 'rgba(255,255,255,.48)' }, heroTitle: { color: '#0E2321', fontSize: 14, fontWeight: '900' }, heroMeta: { marginTop: 4, color: '#3C4A45', fontSize: 9, lineHeight: 14 },
  sectionLabel: { marginTop: 22, marginBottom: 8, color: LIGHT_C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, codeRow: { flexDirection: 'row', gap: 8 }, codeInput: { minHeight: 54, flex: 1, paddingHorizontal: 15, borderRadius: 14, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface, color: LIGHT_C.ink, fontSize: 18, fontWeight: '900', letterSpacing: 5 }, codeButton: { width: 55, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: LIGHT_C.optic },
  sectionHead: { marginTop: 25, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, liveLocationText: { marginTop: 4, color: LIGHT_C.ink40, fontSize: 8, lineHeight: 12 }, refreshButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: LIGHT_C.surface }, filterRow: { paddingBottom: 11, gap: 7 }, filterChip: { minHeight: 44, paddingLeft: 13, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 22, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, filterChipActive: { borderColor: LIGHT_C.teal, backgroundColor: LIGHT_C.teal }, filterChipText: { color: LIGHT_C.ink40, fontSize: 9, fontWeight: '800' }, filterChipTextActive: { color: LIGHT_C.surface, fontWeight: '900' }, filterCount: { minWidth: 27, height: 27, lineHeight: 27, paddingHorizontal: 6, textAlign: 'center', textAlignVertical: 'center', borderRadius: 14, overflow: 'hidden', color: LIGHT_C.ink40, backgroundColor: LIGHT_C.paper, fontSize: 8, fontWeight: '900' }, filterCountActive: { color: LIGHT_C.surface, backgroundColor: 'rgba(255,255,255,.18)' },
  sessionCard: { marginBottom: 10, padding: 14, borderRadius: 19, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, verifiedPill: { alignSelf: 'flex-start', minHeight: 25, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13, backgroundColor: '#E5F0ED' }, verifiedText: { color: LIGHT_C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .45 }, fee: { color: LIGHT_C.ink, fontSize: 11, fontWeight: '900' }, sessionName: { marginTop: 11, color: LIGHT_C.ink, fontSize: 16, fontWeight: '900' }, venueName: { marginTop: 3, color: LIGHT_C.teal, fontSize: 9, fontWeight: '800' }, metaRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }, metaText: { color: LIGHT_C.ink70, fontSize: 8 }, cardFoot: { marginTop: 12, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: LIGHT_C.line }, distance: { color: LIGHT_C.ink40, fontSize: 8, fontWeight: '800' }, spotsPill: { minHeight: 25, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 13, backgroundColor: LIGHT_C.optic }, spotsText: { color: '#0E2321', fontSize: 6, fontWeight: '900' }, fullPill: { backgroundColor: '#F7EAE6' }, fullText: { color: LIGHT_C.brick },
  empty: { minHeight: 180, padding: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, emptyTitle: { marginTop: 8, color: LIGHT_C.ink, fontSize: 12, fontWeight: '900' }, emptyMeta: { maxWidth: 280, marginTop: 4, color: LIGHT_C.ink40, textAlign: 'center', fontSize: 8, lineHeight: 12 },
  detailHero: { marginTop: 18, padding: 17, borderRadius: 21, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: LIGHT_C.ink }, detailTitle: { marginTop: 13, color: LIGHT_C.surface, fontSize: 23, lineHeight: 29, fontWeight: '900' }, detailVenue: { marginTop: 7, color: LIGHT_C.optic, fontSize: 11, fontWeight: '900' }, detailAddress: { marginTop: 3, color: '#CBD7D2', fontSize: 8, lineHeight: 12 }, statusCard: { marginTop: 12, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 15, backgroundColor: '#F4F1E7' }, statusApproved: { backgroundColor: '#E5F0ED' }, statusNegative: { backgroundColor: '#F7EAE6' }, statusTitle: { color: LIGHT_C.ink, fontSize: 11, fontWeight: '900' }, statusMeta: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 8, lineHeight: 12 },
  detailCard: { marginTop: 13, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, detailRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 10 }, rowBorder: { borderTopWidth: 1, borderColor: LIGHT_C.line }, detailIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, detailLabel: { color: LIGHT_C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .6 }, detailValue: { marginTop: 3, color: LIGHT_C.ink, fontSize: 10, lineHeight: 14, fontWeight: '800' }, policyCard: { marginTop: 11, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 15, backgroundColor: LIGHT_C.surface }, policyTitle: { color: LIGHT_C.ink, fontSize: 9, fontWeight: '900' }, policyText: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 8, lineHeight: 12 },
  errorCard: { marginTop: 11, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#F7EAE6' }, errorText: { flex: 1, color: LIGHT_C.brick, fontSize: 8, lineHeight: 12, fontWeight: '800' }, primaryButton: { minHeight: 56, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, backgroundColor: LIGHT_C.optic }, primaryText: { color: '#0E2321', fontSize: 11, fontWeight: '900' }, cancelButton: { minHeight: 56, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, backgroundColor: '#F7EAE6' }, cancelText: { color: LIGHT_C.brick, fontSize: 11, fontWeight: '900' },
  rotationCard: { marginTop: 12, padding: 15, borderRadius: 19, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: LIGHT_C.ink }, rotationHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, rotationEyebrow: { color: LIGHT_C.optic, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, rotationTitle: { marginTop: 3, color: LIGHT_C.surface, fontSize: 17, fontWeight: '900' }, positionBubble: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: LIGHT_C.optic }, positionNumber: { color: '#0E2321', fontSize: 18, fontWeight: '900' }, rotationWait: { marginTop: 12, color: LIGHT_C.surface, fontSize: 10, fontWeight: '900' }, rotationWhy: { marginTop: 5, color: '#B9C8C2', fontSize: 8, lineHeight: 13 }, nearlyPill: { alignSelf: 'flex-start', minHeight: 28, marginTop: 11, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: LIGHT_C.optic }, nearlyText: { color: '#0E2321', fontSize: 6, fontWeight: '900', letterSpacing: .5 }, liveCourts: { marginTop: 12, borderTopWidth: 1, borderColor: '#304743' }, liveCourt: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: '#304743' }, courtDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: LIGHT_C.brick }, courtDotOpen: { backgroundColor: LIGHT_C.optic }, liveCourtTitle: { color: LIGHT_C.surface, fontSize: 8, fontWeight: '900' }, liveCourtPlayers: { marginTop: 2, color: '#9FB3AC', fontSize: 7 },
  liveMatchContent: { paddingBottom: 65, backgroundColor: LIGHT_C.paper }, liveMatchHero: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 19, backgroundColor: LIGHT_C.ink }, liveMatchHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, liveMatchBack: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#233B37' }, liveMatchEyebrow: { color: LIGHT_C.optic, fontSize: 7, fontWeight: '900', letterSpacing: .75 }, liveMatchTitle: { marginTop: 3, color: LIGHT_C.surface, fontSize: 20, fontWeight: '900' }, liveMatchPill: { minHeight: 27, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: LIGHT_C.optic }, liveMatchDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LIGHT_C.teal }, liveMatchPillText: { color: '#0E2321', fontSize: 6, fontWeight: '900', letterSpacing: .6 }, liveMatchRuleRow: { marginTop: 16, paddingTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderTopWidth: 1, borderColor: '#304743' }, liveMatchRule: { color: '#B9C8C2', fontSize: 7, fontWeight: '900', letterSpacing: .45 }, liveMatchRuleDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: LIGHT_C.optic },
  liveScoreNotice: { marginHorizontal: 20, marginTop: 12, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, backgroundColor: LIGHT_C.surface }, liveScoreNoticeTitle: { color: LIGHT_C.ink, fontSize: 10, fontWeight: '900' }, liveScoreNoticeText: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 8, lineHeight: 12 },
  openPlayCourt: { height: 330, marginHorizontal: 20, marginTop: 12, overflow: 'hidden', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: LIGHT_C.teal }, openPlayCourtOutline: { position: 'absolute', top: 12, right: 12, bottom: 12, left: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,.72)' }, openPlayKitchenTop: { position: 'absolute', left: 12, right: 12, top: 119, height: 46, borderTopWidth: 2, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,.72)', backgroundColor: 'rgba(214,233,74,.09)' }, openPlayKitchenBottom: { position: 'absolute', left: 12, right: 12, top: 165, height: 46, borderTopWidth: 1, borderBottomWidth: 2, borderColor: 'rgba(255,255,255,.72)', backgroundColor: 'rgba(214,233,74,.09)' }, openPlayCenterTop: { position: 'absolute', left: '50%', top: 12, height: 107, borderLeftWidth: 1, borderColor: 'rgba(255,255,255,.68)' }, openPlayCenterBottom: { position: 'absolute', left: '50%', top: 211, bottom: 12, borderLeftWidth: 1, borderColor: 'rgba(255,255,255,.68)' }, openPlayNet: { position: 'absolute', left: 5, right: 5, top: 162, height: 10, justifyContent: 'center' }, openPlayNetSolid: { height: 3, backgroundColor: LIGHT_C.surface, shadowColor: '#000', shadowOpacity: .3, shadowRadius: 4, shadowOffset: { width: 0, height: 3 } }, openPlayNetDash: { marginTop: 2, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.65)' }, openPlayCourtTeam: { position: 'absolute', left: 25, right: 25, top: 38, flexDirection: 'row', justifyContent: 'space-around' }, openPlayCourtTeamAway: { top: 'auto', bottom: 31 }, openPlayCourtPlayer: { width: 100, alignItems: 'center' }, openPlayPlayerBall: { width: 47, height: 47, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 3, borderColor: 'rgba(255,255,255,.9)', backgroundColor: LIGHT_C.surface, shadowColor: '#000', shadowOpacity: .2, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } }, openPlayPlayerBallMe: { backgroundColor: LIGHT_C.optic }, openPlayPlayerServing: { borderColor: LIGHT_C.optic, borderWidth: 5 }, openPlayPlayerInitials: { color: '#0E2321', fontSize: 9, fontWeight: '900' }, openPlayCourtPlayerName: { maxWidth: 96, marginTop: 6, color: LIGHT_C.surface, textAlign: 'center', fontSize: 8, fontWeight: '900' }, openPlayScorerTag: { marginTop: 3, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden', borderRadius: 5, color: '#0E2321', backgroundColor: LIGHT_C.optic, fontSize: 5, fontWeight: '900' }, openPlayPointAnnouncement: { position: 'absolute', top: 82, right: 34, bottom: 82, left: 34, zIndex: 6, alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 22, backgroundColor: 'rgba(14,35,33,.94)' }, openPlayPointTeam: { color: LIGHT_C.optic, textAlign: 'center', fontSize: 10, fontWeight: '900', letterSpacing: .6 }, openPlayPointAction: { marginTop: 5, color: LIGHT_C.surface, textAlign: 'center', fontSize: 27, lineHeight: 32, fontWeight: '900' }, openPlayPointScore: { marginTop: 3, color: LIGHT_C.surface, fontSize: 31, lineHeight: 36, fontWeight: '900' }, openPlayPointNote: { marginTop: 8, color: '#B9C8C2', textAlign: 'center', fontSize: 8, lineHeight: 12, fontWeight: '800' }, openPlayLiveBallShadow: { position: 'absolute', zIndex: 3, top: '50%', left: '50%', width: 28, height: 9, marginLeft: -14, marginTop: -5, borderRadius: 14, backgroundColor: 'rgba(0,0,0,.22)' }, openPlayLiveBall: { position: 'absolute', zIndex: 4, top: '50%', left: '50%', width: 30, height: 30, marginLeft: -15, marginTop: -15, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(14,35,33,.25)', backgroundColor: LIGHT_C.optic, shadowColor: '#000', shadowOpacity: .28, shadowRadius: 5, shadowOffset: { width: 0, height: 4 } }, openPlayBallHoleOne: { position: 'absolute', width: 5, height: 5, top: 5, left: 9, borderRadius: 3, backgroundColor: 'rgba(14,35,33,.5)' }, openPlayBallHoleTwo: { position: 'absolute', width: 4, height: 4, top: 13, right: 5, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.5)' }, openPlayBallHoleThree: { position: 'absolute', width: 5, height: 5, bottom: 4, left: 7, borderRadius: 3, backgroundColor: 'rgba(14,35,33,.5)' },
  openPlayScoreCard: { marginHorizontal: 20, marginTop: 12, padding: 15, borderWidth: 1, borderColor: LIGHT_C.line, borderRadius: 18, backgroundColor: LIGHT_C.surface }, openPlayScoreHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, openPlayScoreTitle: { marginTop: 2, color: LIGHT_C.ink, fontSize: 17, fontWeight: '900' }, openPlayCourtLabel: { color: LIGHT_C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, openPlayScoreboard: { marginTop: 15, flexDirection: 'row', gap: 8 }, openPlayScoreTeam: { minWidth: 0, flex: 1, minHeight: 105, padding: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: LIGHT_C.paper }, openPlayScoreName: { minHeight: 26, color: LIGHT_C.ink70, textAlign: 'center', fontSize: 8, lineHeight: 12, fontWeight: '900' }, openPlayScoreNumber: { marginTop: 5, color: LIGHT_C.ink, fontSize: 43, lineHeight: 48, fontWeight: '900' },
  openPlayScorerPanel: { marginHorizontal: 20, marginTop: 12, padding: 15, borderRadius: 19, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: LIGHT_C.ink }, openPlayScorerTitle: { marginTop: 3, color: LIGHT_C.surface, fontSize: 16, fontWeight: '900' }, openPlayServingMeta: { marginTop: 5, color: '#B9C8C2', fontSize: 8, lineHeight: 12, fontWeight: '800' }, openPlayRallyButtons: { marginTop: 14, flexDirection: 'row', gap: 8 }, openPlayRallyButton: { minWidth: 0, minHeight: 115, flex: 1, padding: 11, justifyContent: 'space-between', borderRadius: 15, backgroundColor: LIGHT_C.optic }, openPlayRallyButtonAway: { backgroundColor: LIGHT_C.surface }, openPlayRallyTag: { color: LIGHT_C.ink70, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, openPlayRallyTagAccent: { color: LIGHT_C.ink70 }, openPlayRallyName: { color: LIGHT_C.ink, fontSize: 11, lineHeight: 15, fontWeight: '900' }, openPlayRallyNameAccent: { color: '#0E2321' }, openPlayRallyAction: { color: LIGHT_C.ink, fontSize: 7, fontWeight: '900', letterSpacing: .45 }, openPlayRallyActionAccent: { color: '#0E2321' }, openPlayMatchActions: { marginTop: 10, flexDirection: 'row', gap: 8 }, openPlayUndo: { width: 82, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13, backgroundColor: '#233B37' }, openPlayUndoText: { color: LIGHT_C.surface, fontSize: 9, fontWeight: '900' }, openPlayFinish: { minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13, backgroundColor: LIGHT_C.optic }, openPlayFinishPending: { backgroundColor: LIGHT_C.tealWash }, openPlayFinishText: { color: '#0E2321', fontSize: 9, fontWeight: '900' }, openPlayFinishTextPending: { color: LIGHT_C.ink70 },
  openPlayLiveCourtCard: { marginHorizontal: 20, marginTop: 16, overflow: 'hidden', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, openPlayLiveCourtHead: { minHeight: 62, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, openPlayLiveCourtEyebrow: { color: LIGHT_C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, openPlayLiveCourtTitle: { marginTop: 1, color: LIGHT_C.ink, fontSize: 17, fontWeight: '900' }, openPlayLiveNowPill: { minHeight: 27, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: LIGHT_C.ink }, openPlayLiveNowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIGHT_C.optic }, openPlayLiveNowText: { color: LIGHT_C.surface, fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  openPlayPlayCourt: { height: 220, marginHorizontal: 10, overflow: 'hidden', borderRadius: 15, backgroundColor: LIGHT_C.teal }, openPlayPlayCourtBounds: { ...StyleSheet.absoluteFillObject, margin: 13, borderWidth: 2, borderColor: 'rgba(255,255,255,.72)' }, openPlayPlayCourtCenterTop: { position: 'absolute', top: 13, alignSelf: 'center', width: 2, height: 68, backgroundColor: 'rgba(255,255,255,.55)' }, openPlayPlayCourtCenterBottom: { position: 'absolute', top: 139, bottom: 13, alignSelf: 'center', width: 2, backgroundColor: 'rgba(255,255,255,.55)' }, openPlayPlayCourtKitchenTop: { position: 'absolute', top: 80, left: 13, right: 13, height: 2, backgroundColor: 'rgba(255,255,255,.72)' }, openPlayPlayCourtKitchenBottom: { position: 'absolute', top: 138, left: 13, right: 13, height: 2, backgroundColor: 'rgba(255,255,255,.72)' }, openPlayPlayCourtNet: { position: 'absolute', zIndex: 2, top: 107, left: 5, right: 5, height: 7, borderTopWidth: 3, borderBottomWidth: 1, borderColor: LIGHT_C.surface, backgroundColor: 'rgba(14,35,33,.42)' },
  openPlayPlayCourtTeam: { position: 'absolute', zIndex: 3, top: 20, left: 24, right: 24, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, openPlayPlayCourtTeamAway: { top: 148 }, openPlayPlayCourtPlayer: { maxWidth: '46%', alignItems: 'center' }, openPlayPlayPlayerMarker: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, borderWidth: 2, borderColor: LIGHT_C.surface, backgroundColor: LIGHT_C.ink }, openPlayPlayPlayerMarkerAway: { backgroundColor: LIGHT_C.brick }, openPlayPlayPlayerServing: { borderWidth: 4, borderColor: LIGHT_C.optic }, openPlayPlayPlayerInitials: { color: LIGHT_C.surface, fontSize: 8, fontWeight: '900' }, openPlayPlayPlayerName: { maxWidth: 105, marginTop: 3, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden', borderRadius: 7, color: LIGHT_C.surface, backgroundColor: 'rgba(14,35,33,.78)', fontSize: 6, fontWeight: '800' },
  openPlayCourtScoreBar: { position: 'absolute', zIndex: 8, top: 90, alignSelf: 'center', minWidth: 150, height: 40, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 2, borderColor: 'rgba(255,255,255,.35)', backgroundColor: 'rgba(14,35,33,.9)' }, openPlayCourtScoreTeam: { flexDirection: 'row', alignItems: 'center', gap: 6 }, openPlayCourtScoreTag: { color: LIGHT_C.optic, fontSize: 7, fontWeight: '900' }, openPlayCourtScoreTagAway: { color: '#F5A58F' }, openPlayCourtScoreNumber: { width: 25, color: LIGHT_C.surface, textAlign: 'center', fontSize: 21, fontWeight: '900' }, openPlayCourtGamePill: { marginHorizontal: 6, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(255,255,255,.1)' }, openPlayCourtGameText: { color: 'rgba(255,255,255,.62)', fontSize: 5, fontWeight: '900', letterSpacing: .4 },
  openPlayPlayAnnouncement: { position: 'absolute', zIndex: 12, left: 22, right: 22, top: 35, bottom: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(14,35,33,.92)' }, openPlayPlayAnnouncementPlayer: { color: LIGHT_C.optic, fontSize: 16, fontWeight: '900', textAlign: 'center' }, openPlayPlayAnnouncementTeam: { maxWidth: '90%', marginTop: 3, color: LIGHT_C.surface, fontSize: 10, fontWeight: '800', textAlign: 'center' }, openPlayPlayAnnouncementText: { marginTop: 6, color: 'rgba(255,255,255,.58)', fontSize: 8, fontWeight: '900', letterSpacing: 1.2 }, openPlayPlayAnnouncementScore: { marginTop: 3, color: LIGHT_C.surface, fontSize: 25, fontWeight: '900' }, openPlayPlayAnnouncementServe: { maxWidth: '92%', marginTop: 5, color: LIGHT_C.optic, textAlign: 'center', fontSize: 8, fontWeight: '800' },
  openPlayPlayBall: { position: 'absolute', zIndex: 6, top: 98, left: '50%', marginLeft: -12, width: 25, height: 25, borderRadius: 13, borderWidth: 2, borderColor: 'rgba(14,35,33,.18)', backgroundColor: LIGHT_C.optic }, openPlayPlayBallShadow: { position: 'absolute', zIndex: 5, top: 119, left: '50%', marginLeft: -13, width: 26, height: 7, borderRadius: 13, backgroundColor: LIGHT_C.ink }, openPlayPlayBallHoleOne: { position: 'absolute', top: 5, left: 6, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.36)' }, openPlayPlayBallHoleTwo: { position: 'absolute', top: 12, right: 5, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.36)' }, openPlayPlayBallHoleThree: { position: 'absolute', bottom: 4, left: 8, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.36)' },
  openPlayScorerBooth: { minHeight: 86, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, openPlayScorerBoothAvatar: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: LIGHT_C.ink }, openPlayScorerBoothInitials: { color: LIGHT_C.surface, fontSize: 11, fontWeight: '900' }, openPlayScorerOnline: { position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: 7, borderWidth: 3, borderColor: LIGHT_C.surface, backgroundColor: LIGHT_C.optic }, openPlayScorerBoothCopy: { flex: 1, minWidth: 0 }, openPlayScorerBoothLabel: { color: LIGHT_C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .7 }, openPlayScorerBoothName: { marginTop: 2, color: LIGHT_C.ink, fontSize: 11, fontWeight: '900' }, openPlayScorerMessage: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 7 }, openPlayScorerServing: { marginTop: 3, color: LIGHT_C.teal, fontSize: 7, fontWeight: '800' }, openPlayScorerControlBadge: { paddingHorizontal: 7, minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 9, backgroundColor: LIGHT_C.tealWash }, openPlayScorerControlText: { color: LIGHT_C.teal, fontSize: 5, fontWeight: '900', letterSpacing: .4 },
  openPlayPlayScorerActions: { marginHorizontal: 20, marginTop: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, openPlayPlayScorerActionHead: { marginBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, openPlayPlayScorerActionTitle: { color: LIGHT_C.ink, fontSize: 14, fontWeight: '900' }, openPlayPlayScorerActionMeta: { marginTop: 3, color: LIGHT_C.teal, fontSize: 8, fontWeight: '800' }, openPlayPlayTeamBadge: { width: 31, height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: LIGHT_C.teal }, openPlayPlayTeamBadgeAway: { backgroundColor: LIGHT_C.brick }, openPlayPlayTeamBadgeText: { color: LIGHT_C.surface, fontSize: 8, fontWeight: '900' }, openPlayPlayRallyButtons: { flexDirection: 'row', gap: 8 }, openPlayPlayRallyButton: { minHeight: 82, flex: 1, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: LIGHT_C.teal }, openPlayPlayRallyButtonAway: { backgroundColor: LIGHT_C.brick }, openPlayPlayRallyTag: { color: 'rgba(255,255,255,.58)', fontSize: 6, fontWeight: '900', letterSpacing: .7 }, openPlayPlayRallyName: { minHeight: 27, marginTop: 3, color: LIGHT_C.surface, textAlign: 'center', fontSize: 9, lineHeight: 13, fontWeight: '900' }, openPlayPlayRallyAction: { marginTop: 3, color: LIGHT_C.surface, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, openPlayPlayAutoServeHint: { marginTop: 10, color: LIGHT_C.teal, textAlign: 'center', fontSize: 8, fontWeight: '800' }, openPlayPlayPointDisabled: { opacity: .4 },
  openPlayPlayControls: { marginHorizontal: 20, marginTop: 12, flexDirection: 'row', gap: 8 }, openPlayPlayControlButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, openPlayPlayControlText: { color: LIGHT_C.teal, fontSize: 8, fontWeight: '800' }, openPlayPlayControlDisabled: { opacity: .48 }, openPlayPlayControlTextDisabled: { color: LIGHT_C.ink40 }, openPlayPlayFinishButton: { borderColor: LIGHT_C.optic, backgroundColor: LIGHT_C.optic }, openPlayPlayFinishPending: { borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.tealWash }, openPlayPlayFinishText: { color: '#0E2321', fontSize: 8, fontWeight: '900' }, openPlayPlayFinishTextPending: { color: LIGHT_C.ink70 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
