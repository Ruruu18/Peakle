import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useOpenPlaySession } from '../context/OpenPlaySessionContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { listVenues, syncOpenPlay } from '../services/database';
import { completeFairPlayMatch, createOpenPlaySession, recordFairPlayAssignment } from '../services/openPlayRegistration';
import { buildFairPlayAssignment, estimateWaitMinutes, playersPerMatch, rankFairPlayQueue, rebalanceFairPlayQueue } from '../services/fairPlayEngine';
import { useOperations } from '../context/OperationsContext';
import { publishOpenPlayAnnouncement } from '../services/realtimeOperations';
import ConnectionStatus from '../components/ConnectionStatus';

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
  return <Ionicons name={name} size={size} color={color} />;
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

function Stepper({ value, onChange }) {
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityLabel="Remove a court" disabled={value <= 1} onPress={() => onChange(value - 1)} style={[styles.stepButton, value <= 1 && styles.disabled]}><Icon name="remove" /></Pressable>
      <View style={styles.stepValue}><Text style={styles.stepNumber}>{value}</Text><Text style={styles.stepLabel}>{value === 1 ? 'COURT' : 'COURTS'}</Text></View>
      <Pressable accessibilityLabel="Add a court" disabled={value >= 8} onPress={() => onChange(value + 1)} style={[styles.stepButton, styles.stepButtonAdd, value >= 8 && styles.disabled]}><Icon name="add" /></Pressable>
    </View>
  );
}

function ChoiceGroup({ label, value, options, onChange }) {
  return <><Text style={styles.sectionLabel}>{label}</Text><View style={styles.choiceGroup}>{options.map((option) => {
    const active = value === option.value;
    return <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.choice, active && styles.choiceActive]}><Icon name={option.icon} size={15} color={active ? '#0E2321' : C.ink40} /><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{option.label}</Text></Pressable>;
  })}</View></>;
}

function defaultSchedule() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const date = start.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const clock = (value) => value.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false });
  return { date, startTime: clock(start), endTime: clock(end) };
}

function Setup({ organizerName, onBack, onStart }) {
  const defaults = useMemo(defaultSchedule, []);
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [sessionName, setSessionName] = useState('Community open play');
  const [courtCount, setCourtCount] = useState(2);
  const [capacity, setCapacity] = useState('24');
  const [visibility, setVisibility] = useState('public');
  const [approvalMode, setApprovalMode] = useState('automatic');
  const [matchFormat, setMatchFormat] = useState('doubles');
  const [averageMatchMinutes, setAverageMatchMinutes] = useState('15');
  const [maxConsecutiveGames, setMaxConsecutiveGames] = useState('2');
  const [restMinutes, setRestMinutes] = useState('0');
  const [date, setDate] = useState(defaults.date);
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [endTime, setEndTime] = useState(defaults.endTime);
  const [skillMin, setSkillMin] = useState('');
  const [skillMax, setSkillMax] = useState('');
  const [fee, setFee] = useState('0');
  const [rules, setRules] = useState('Doubles · First to 11 · Win by 2');
  const [cancellationPolicy, setCancellationPolicy] = useState('Cancel before the session starts so a waitlisted player can take your place.');
  const [names, setNames] = useState('');
  const [includeOrganizer, setIncludeOrganizer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parsedNames = useMemo(() => [...new Set(names.split(/[\n,]+/).map((name) => name.trim()).filter(Boolean))], [names]);
  const registeredNames = useMemo(() => includeOrganizer && !parsedNames.some((name) => name.toLowerCase() === organizerName.toLowerCase()) ? [organizerName, ...parsedNames] : parsedNames, [includeOrganizer, organizerName, parsedNames]);
  const capacityNumber = Number(capacity);
  const feeNumber = Number(fee);
  const averageMatchMinutesNumber = Number(averageMatchMinutes);
  const maxConsecutiveGamesNumber = Number(maxConsecutiveGames);
  const restMinutesNumber = Number(restMinutes);
  const skillMinNumber = skillMin.trim() ? Number(skillMin) : null;
  const skillMaxNumber = skillMax.trim() ? Number(skillMax) : null;
  const scheduledStart = new Date(`${date}T${startTime}:00+08:00`);
  const scheduledEnd = new Date(`${date}T${endTime}:00+08:00`);
  const validSkill = (skillMinNumber == null || Number.isFinite(skillMinNumber) && skillMinNumber >= 1 && skillMinNumber <= 5.5) && (skillMaxNumber == null || Number.isFinite(skillMaxNumber) && skillMaxNumber >= 1 && skillMaxNumber <= 5.5) && (skillMinNumber == null || skillMaxNumber == null || skillMinNumber <= skillMaxNumber);
  const canStart = venueId && sessionName.trim().length >= 3 && rules.trim() && cancellationPolicy.trim() && validSkill && Number.isInteger(capacityNumber) && capacityNumber >= 4 && capacityNumber <= 200 && registeredNames.length <= capacityNumber && Number.isFinite(feeNumber) && feeNumber >= 0 && Number.isInteger(averageMatchMinutesNumber) && averageMatchMinutesNumber >= 5 && averageMatchMinutesNumber <= 90 && Number.isInteger(maxConsecutiveGamesNumber) && maxConsecutiveGamesNumber >= 0 && maxConsecutiveGamesNumber <= 10 && Number.isInteger(restMinutesNumber) && restMinutesNumber >= 0 && restMinutesNumber <= 120 && !Number.isNaN(scheduledStart.getTime()) && scheduledEnd > scheduledStart && scheduledEnd > new Date();

  useEffect(() => {
    listVenues().then((rows) => {
      setVenues(rows);
      if (rows[0]) setVenueId((current) => current || rows[0].id);
    }).catch((loadError) => setError(loadError.message || 'Verified venues could not be loaded.'));
  }, []);

  const submit = async () => {
    if (!canStart || busy) return;
    setBusy(true); setError('');
    try {
      await onStart({
        name: sessionName.trim(), venueId, courtCount, capacity: capacityNumber, visibility, approvalMode,
        skillMin: skillMinNumber,
        skillMax: skillMaxNumber,
        feeAmount: feeNumber, scheduledStart: scheduledStart.toISOString(), scheduledEnd: scheduledEnd.toISOString(),
        rules,
        cancellationPolicy,
        matchFormat,
        averageMatchMinutes: averageMatchMinutesNumber,
        maxConsecutiveGames: maxConsecutiveGamesNumber,
        restMinutes: restMinutesNumber,
        names: registeredNames,
      });
    } catch (submitError) { setError(submitError.message || 'The session could not be published.'); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <TopBar eyebrow="ORGANIZER MODE" title="Run open play" onBack={onBack} right={<View style={styles.rolePill}><Icon name="key-outline" size={14} color={C.teal} /><Text style={styles.roleText}>ORGANIZER</Text></View>} />

      <View style={styles.heroCard}>
        <View style={styles.heroIcon}><Icon name="people" size={25} /></View>
        <View style={styles.flex}><Text style={styles.heroTitle}>One queue. Every court.</Text><Text style={styles.heroBody}>Set up the courts and check in everyone playing today.</Text></View>
      </View>

      <Text style={styles.sectionLabel}>SESSION NAME</Text>
      <TextInput value={sessionName} onChangeText={setSessionName} maxLength={80} placeholder="Community open play" placeholderTextColor={C.ink40} style={styles.singleInput} />

      <Text style={styles.sectionLabel}>VERIFIED VENUE</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.venueChoices}>{venues.map((venue) => <Pressable key={venue.id} onPress={() => setVenueId(venue.id)} style={[styles.venueChoice, venueId === venue.id && styles.venueChoiceActive]}><Icon name={venueId === venue.id ? 'checkmark-circle' : 'location-outline'} color={venueId === venue.id ? C.teal : C.ink40} /><Text numberOfLines={1} style={styles.venueChoiceName}>{venue.name}</Text><Text numberOfLines={1} style={styles.venueChoiceArea}>{venue.area}</Text></Pressable>)}</ScrollView>

      <Text style={styles.sectionLabel}>DATE & SCHEDULE</Text>
      <View style={styles.scheduleRow}><TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.ink40} style={[styles.singleInput, styles.dateInput]} /><TextInput value={startTime} onChangeText={setStartTime} placeholder="09:00" placeholderTextColor={C.ink40} style={[styles.singleInput, styles.timeInput]} /><Text style={styles.timeDash}>–</Text><TextInput value={endTime} onChangeText={setEndTime} placeholder="12:00" placeholderTextColor={C.ink40} style={[styles.singleInput, styles.timeInput]} /></View>

      <ChoiceGroup label="WHO CAN JOIN" value={visibility} onChange={setVisibility} options={[{ value: 'public', label: 'Public', icon: 'earth-outline' }, { value: 'private', label: 'Private', icon: 'key-outline' }, { value: 'invite_only', label: 'Invite only', icon: 'mail-outline' }]} />
      <ChoiceGroup label="APPROVAL" value={approvalMode} onChange={setApprovalMode} options={[{ value: 'automatic', label: 'Automatic', icon: 'flash-outline' }, { value: 'manual', label: 'Review requests', icon: 'person-add-outline' }]} />

      <ChoiceGroup label="FAIR PLAY FORMAT" value={matchFormat} onChange={setMatchFormat} options={[{ value: 'doubles', label: 'Doubles', icon: 'people-outline' }, { value: 'singles', label: 'Singles', icon: 'person-outline' }]} />
      <Text style={styles.helper}>Lineups balance wait time, game counts, rest, ratings, and repeat matchups.</Text>

      <Text style={styles.sectionLabel}>ROTATION CONTROLS</Text>
      <View style={styles.numericRow}><View style={styles.numericField}><Text style={styles.numericLabel}>AVG MATCH MIN</Text><TextInput keyboardType="number-pad" value={averageMatchMinutes} onChangeText={setAverageMatchMinutes} style={styles.numericInput} /></View><View style={styles.numericField}><Text style={styles.numericLabel}>MAX IN A ROW</Text><TextInput keyboardType="number-pad" value={maxConsecutiveGames} onChangeText={setMaxConsecutiveGames} style={styles.numericInput} /></View><View style={styles.numericField}><Text style={styles.numericLabel}>REST MIN</Text><TextInput keyboardType="number-pad" value={restMinutes} onChangeText={setRestMinutes} style={styles.numericInput} /></View></View>

      <Text style={styles.sectionLabel}>BOOKED COURTS</Text>
      <Stepper value={courtCount} onChange={setCourtCount} />

      <Text style={styles.sectionLabel}>CAPACITY, SKILL & FEE</Text>
      <View style={styles.numericRow}><View style={styles.numericField}><Text style={styles.numericLabel}>PLAYERS</Text><TextInput keyboardType="number-pad" value={capacity} onChangeText={setCapacity} style={styles.numericInput} /></View><View style={styles.numericField}><Text style={styles.numericLabel}>MIN RATING</Text><TextInput keyboardType="decimal-pad" value={skillMin} onChangeText={setSkillMin} placeholder="Any" placeholderTextColor={C.ink40} style={styles.numericInput} /></View><View style={styles.numericField}><Text style={styles.numericLabel}>MAX RATING</Text><TextInput keyboardType="decimal-pad" value={skillMax} onChangeText={setSkillMax} placeholder="Any" placeholderTextColor={C.ink40} style={styles.numericInput} /></View><View style={styles.numericField}><Text style={styles.numericLabel}>FEE ₱</Text><TextInput keyboardType="decimal-pad" value={fee} onChangeText={setFee} style={styles.numericInput} /></View></View>

      <View style={styles.fieldHead}><Text style={styles.sectionLabel}>REGISTRATION LIST</Text><Text style={styles.countText}>{registeredNames.length} ADDED</Text></View>
      <TextInput
        accessibilityLabel="Player registration list"
        multiline
        value={names}
        onChangeText={setNames}
        placeholder={'Paste or type player names\nOne name per line'}
        placeholderTextColor={C.ink40}
        style={styles.nameInput}
      />
      <Text style={styles.helper}>Optional walk-ins are checked in immediately. Registered Peakle players can join after publication.</Text>

      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: includeOrganizer }} onPress={() => setIncludeOrganizer((value) => !value)} style={[styles.joinCard, includeOrganizer && styles.joinCardActive]}>
        <View style={[styles.joinCheck, includeOrganizer && styles.joinCheckActive]}><Icon name={includeOrganizer ? 'checkmark' : 'person-outline'} size={17} color={includeOrganizer ? '#0E2321' : C.teal} /></View>
        <View style={styles.flex}><Text style={styles.joinTitle}>I’m playing too</Text><Text style={styles.joinMeta}>Add {organizerName} to the queue while keeping organizer access.</Text></View>
      </Pressable>

      <Text style={styles.sectionLabel}>RULES & CANCELLATION</Text>
      <TextInput value={rules} onChangeText={setRules} maxLength={180} placeholder="Session rules" placeholderTextColor={C.ink40} style={styles.singleInput} />
      <TextInput multiline value={cancellationPolicy} onChangeText={setCancellationPolicy} maxLength={300} placeholder="Cancellation policy" placeholderTextColor={C.ink40} style={[styles.nameInput, styles.policyInput]} />

      {error ? <View style={styles.setupError}><Icon name="alert-circle" color={C.brick} /><Text style={styles.setupErrorText}>{error}</Text></View> : null}
      <Pressable disabled={!canStart || busy} onPress={submit} style={({ pressed }) => [styles.primaryButton, (!canStart || busy) && styles.disabledButton, pressed && canStart && styles.pressed]}>
        {busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.primaryText}>{canStart ? 'Publish open play' : 'Complete the session details'}</Text><Icon name="arrow-forward" color="#0E2321" /></>}
      </Pressable>
    </ScrollView>
  );
}

function CourtCard({ court, players, now, onPress }) {
  const match = court.match;
  const matchPoint = match && !match.complete && [0, 1].some((team) => match.scores[team] + 1 >= 11 && match.scores[team] + 1 - match.scores[1 - team] >= 2);
  const status = !match ? 'OPEN' : match.complete ? 'FINISHED' : matchPoint ? 'MATCH POINT' : 'IN PLAY';
  const statusColor = !match ? C.teal : match.complete ? C.brick : matchPoint ? C.ink : C.brick;
  const elapsed = match ? Math.max(0, Math.floor((now - match.startedAt) / 1000)) : 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.courtCard, !match && styles.openCourtCard, pressed && styles.pressed]}>
      <View style={styles.courtCardHead}>
        <View><Text style={styles.courtNumber}>COURT {court.number}</Text><Text style={styles.courtStatus}>{match ? 'Match underway' : 'Ready for players'}</Text></View>
        <View style={[styles.statusPill, { backgroundColor: statusColor }]}><View style={[styles.statusDot, !match && { backgroundColor: C.optic }]} /><Text style={styles.statusText}>{status}</Text></View>
      </View>
      {match ? (
        <>
          <View style={styles.compactScore}>
            <View style={styles.compactTeam}><Text numberOfLines={1} style={styles.compactNames}>{match.teams[0].map((id) => playerName(players, id)).join(' / ')}</Text><Text style={styles.compactNumber}>{match.scores[0]}</Text></View>
            <View style={styles.scoreDivider} />
            <View style={styles.compactTeam}><Text numberOfLines={1} style={styles.compactNames}>{match.teams[1].map((id) => playerName(players, id)).join(' / ')}</Text><Text style={styles.compactNumber}>{match.scores[1]}</Text></View>
          </View>
          <View style={styles.courtFoot}><Text style={styles.scorerMeta}>Scorer · {playerName(players, match.scorerId)}</Text><Text style={styles.timer}>{formatTime(elapsed)}</Text></View>
        </>
      ) : (
        <View style={styles.openPrompt}><View style={styles.openPlus}><Icon name="add" size={21} /></View><View style={styles.flex}><Text style={styles.openTitle}>Assign fair lineup</Text><Text style={styles.openMeta}>Use the recommendation or record an override.</Text></View><Icon name="chevron-forward" color={C.teal} /></View>
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

function Dashboard({ session, now, onCourt, onPlayerDone, onPlayerPriority, onAddPlayer, onAnnouncement, onTV, onEndSession }) {
  const activeCount = session.courts.filter((court) => court.match).length;
  const next = buildFairPlayAssignment(session, now);
  const lastDecision = session.assignmentHistory?.[0];
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TopBar eyebrow="OPEN PLAY · LIVE" title="Court monitor" right={<View style={styles.monitorActions}><Pressable accessibilityLabel="Publish venue announcement" onPress={onAnnouncement} style={styles.monitorIcon}><Icon name="megaphone-outline" size={18} /></Pressable><Pressable accessibilityLabel="Open venue TV display" onPress={onTV} style={styles.monitorIcon}><Icon name="tv-outline" size={18} /></Pressable><Pressable onPress={onEndSession} style={styles.endSessionButton}><Text style={styles.endSessionText}>End</Text></Pressable></View>} />
      <ConnectionStatus />
      {session.code ? <View style={styles.inviteCard}><View style={styles.inviteCode}><Text style={styles.inviteCodeLabel}>SESSION CODE</Text><Text style={styles.inviteCodeValue}>{session.code}</Text></View><View style={styles.flex}><Text style={styles.inviteTitle}>{session.visibility === 'public' ? 'Public registration is live' : session.visibility === 'private' ? 'Share the private code' : 'Invite selected players'}</Text><Text style={styles.inviteMeta}>Players join at peakle://open-play/{session.code}</Text></View><Pressable accessibilityLabel="Share session invitation" onPress={() => Share.share({ message: `Join ${session.name} on Peakle. Use code ${session.code} or open peakle://open-play/${session.code}` })} style={styles.shareButton}><Icon name="share-social-outline" color="#0E2321" /></Pressable></View> : null}
      <View style={styles.sessionStats}>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.courts.length}</Text><Text style={styles.sessionLabel}>COURTS</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{activeCount}</Text><Text style={styles.sessionLabel}>IN PLAY</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.queue.length}</Text><Text style={styles.sessionLabel}>WAITING</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.completedMatches.length}</Text><Text style={styles.sessionLabel}>FINISHED</Text></View>
      </View>

      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>ALL BOOKED COURTS</Text><Text style={styles.h2}>Live courts</Text></View><View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View></View>
      {session.courts.map((court) => <CourtCard key={court.id} court={court} players={session.players} now={now} onPress={() => onCourt(court.id)} />)}

      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>ROTATION ORDER</Text><Text style={styles.h2}>Waiting pool</Text></View><View style={styles.queueHeadActions}><Text style={styles.queueCount}>{session.queue.length} WAITING</Text><Pressable accessibilityLabel="Check in a player" onPress={onAddPlayer} style={styles.addPlayerButton}><Icon name="person-add-outline" size={15} color="#0E2321" /><Text style={styles.addPlayerText}>Check in</Text></Pressable></View></View>
      {next.ready ? <View style={styles.fairCard}><View style={styles.fairIcon}><Icon name="sparkles" color={C.teal} /></View><View style={styles.flex}><Text style={styles.fairTitle}>Fair Play recommendation ready</Text><Text style={styles.fairMeta}>{next.reason}</Text></View></View> : null}
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
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}><View style={styles.modalBackdrop}><View style={styles.sheet}><View style={styles.sheetHandle} /><Text style={styles.eyebrow}>VENUE ANNOUNCEMENT</Text><Text style={styles.sheetTitle}>Message everyone</Text><Text style={styles.sheetLead}>Checked-in players receive this in their inbox and by push notification when enabled.</Text><TextInput autoFocus multiline maxLength={280} value={body} onChangeText={setBody} placeholder="Court 2 is reopening in five minutes." placeholderTextColor={C.ink40} style={[styles.singleInput, styles.announcementInput]} /><View style={styles.sheetActions}><Pressable disabled={busy} onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable><Pressable disabled={busy || body.trim().length < 3} onPress={publish} style={[styles.confirmButton, (busy || body.trim().length < 3) && styles.disabled]}>{busy ? <ActivityIndicator color={C.surface} /> : <Text style={styles.confirmText}>Publish</Text>}</Pressable></View></View></View></Modal>;
}

function VenueTVDisplay({ session, onBack }) {
  const next = buildFairPlayAssignment(session);
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
      <View style={styles.modalBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} /><Text style={styles.eyebrow}>PLAYER CHECK-IN</Text><Text style={styles.sheetTitle}>Add to the waiting pool</Text><Text style={styles.sheetLead}>Walk-ins join at the end of the current rotation.</Text>
          <TextInput accessibilityLabel="Player name" autoFocus value={name} onChangeText={setName} placeholder="Player name" placeholderTextColor={C.ink40} returnKeyType="done" onSubmitEditing={() => canAdd && onAdd(name.trim())} style={styles.singleInput} />
          {duplicate && <Text style={styles.inputError}>That player is already registered.</Text>}
          <View style={styles.sheetActions}><Pressable onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable><Pressable disabled={!canAdd} onPress={() => onAdd(name.trim())} style={[styles.confirmButton, !canAdd && styles.disabled]}><Text style={styles.confirmText}>Check in</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function Assignment({ session, courtId, onBack, onStart }) {
  const decision = useMemo(() => buildFairPlayAssignment(session), [session]);
  const suggested = decision.playerIds;
  const required = playersPerMatch(session);
  const [selected, setSelected] = useState(suggested);
  const [scorerId, setScorerId] = useState(suggested[0] || null);
  const [overrideReason, setOverrideReason] = useState('');
  const overridden = selected.join('|') !== suggested.join('|');
  const toggle = (id) => {
    setSelected((current) => {
      if (current.includes(id)) {
        const next = current.filter((item) => item !== id);
        if (scorerId === id) setScorerId(next[0] || null);
        return next;
      }
      if (current.length >= required) return current;
      return [...current, id];
    });
  };
  const court = session.courts.find((item) => item.id === courtId);
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TopBar eyebrow={`COURT ${court.number} · OPEN`} title="Build the lineup" onBack={onBack} />
      <Text style={styles.lead}>Fair Play selects the next {required} from transparent rotation inputs. Tap names to make an audited override.</Text>

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

      <Text style={styles.sectionLabel}>CHOOSE {required} PLAYERS · {selected.length}/{required}</Text>
      <View style={styles.pickerCard}>
        {session.queue.map((id, index) => {
          const chosen = selected.includes(id);
          const ranking = decision.ranked.find((item) => item.player.id === id);
          return <Pressable key={id} onPress={() => toggle(id)} style={[styles.pickerRow, index > 0 && styles.rowBorder]}><Text style={styles.queuePosition}>{index + 1}</Text><View style={styles.flex}><Text style={styles.playerName}>{playerName(session.players, id)}</Text><Text style={styles.playerMeta}>{suggested.includes(id) ? 'Suggested · ' : ''}{ranking?.reasons?.[0] || 'Waiting'}</Text></View><Icon name={chosen ? 'checkmark-circle' : 'ellipse-outline'} color={chosen ? C.teal : C.ink40} /></Pressable>;
        })}
      </View>

      {overridden ? <><Text style={styles.sectionLabel}>OVERRIDE REASON</Text><Text style={styles.helperTop}>Required for the rotation audit. Be specific so players can understand the change.</Text><TextInput multiline value={overrideReason} onChangeText={setOverrideReason} maxLength={240} placeholder="Example: Alex needs to leave in 15 minutes." placeholderTextColor={C.ink40} style={[styles.nameInput, styles.overrideInput]} /></> : null}

      <Text style={styles.sectionLabel}>ON-COURT SCORER</Text>
      <Text style={styles.helperTop}>The scorer stays a player. This assignment only lasts for this match.</Text>
      <View style={styles.scorerGrid}>
        {selected.map((id) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: scorerId === id }} onPress={() => setScorerId(id)} style={[styles.scorerChoice, scorerId === id && styles.scorerChoiceActive]}><View style={[styles.smallAvatar, scorerId === id && styles.scorerAvatarActive]}><Text style={styles.smallAvatarText}>{initials(playerName(session.players, id))}</Text></View><Text numberOfLines={1} style={styles.scorerName}>{playerName(session.players, id)}</Text>{scorerId === id && <Icon name="phone-portrait-outline" size={15} color={C.teal} />}</Pressable>)}
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
      <View style={styles.modalBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} /><Text style={styles.eyebrow}>END MATCH</Text><Text style={styles.sheetTitle}>Where should players go?</Text><Text style={styles.sheetLead}>Everyone returns to the queue unless you mark them done for the day.</Text>
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
  const { screen, setScreen, session, setSession, courtId, setCourtId, resetSession } = useOpenPlaySession();
  const [showEndMatch, setShowEndMatch] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!session || screen === 'setup' || screen === 'summary') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [screen, session]);

  const updateCourt = (id, update) => setSession((current) => ({ ...current, courts: current.courts.map((court) => court.id === id ? update(court) : court) }));
  const startSession = async (details) => {
    const created = await createOpenPlaySession(details);
    const { courtCount, names } = details;
    const checkedInAt = new Date().toISOString();
    const players = names.map((name) => ({ id: uid('player'), name, status: 'waiting', gamesPlayed: 0, consecutiveGames: 0, checkedInAt, waitingSince: checkedInAt, playPreference: 'either', priorityBoost: 0 }));
    const nextSession = { id: created.id, name: created.name, code: created.session_code, venueId: created.venue_id, visibility: created.visibility, approvalMode: created.approval_mode, capacity: created.capacity, skillMin: created.skill_min, skillMax: created.skill_max, feeAmount: created.fee_amount, scheduledStart: created.scheduled_start, scheduledEnd: created.scheduled_end, rules: created.rules, cancellationPolicy: created.cancellation_policy, matchFormat: created.match_format || details.matchFormat, averageMatchMinutes: created.average_match_minutes || details.averageMatchMinutes, maxConsecutiveGames: created.max_consecutive_games ?? details.maxConsecutiveGames, restMinutes: created.rest_minutes ?? details.restMinutes, players, queue: players.map((player) => player.id), courts: Array.from({ length: courtCount }, (_, index) => ({ id: uid('court'), number: index + 1, match: null })), completedMatches: [], assignmentHistory: [] };
    await syncOpenPlay(nextSession);
    setSession(nextSession);
    setScreen('dashboard');
  };
  const openCourt = (id) => {
    setCourtId(id);
    const court = session.courts.find((item) => item.id === id);
    setScreen(court.match ? 'live' : 'assign');
  };
  const startMatch = async (playerIds, scorerId, decision) => {
    const match = { id: uid('match'), playerIds, teams: [playerIds.slice(0, 2), playerIds.slice(2, 4)], scorerId, scores: [0, 0], history: [], startedAt: Date.now(), complete: false, winner: null };
    if (playersPerMatch(session) === 2) match.teams = [[playerIds[0]], [playerIds[1]]];
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
  const score = (team) => updateCourt(courtId, (court) => {
    const nextScores = [...court.match.scores];
    nextScores[team] += 1;
    const won = nextScores[team] >= 11 && nextScores[team] - nextScores[1 - team] >= 2;
    return { ...court, match: { ...court.match, scores: nextScores, history: [...court.match.history, court.match.scores], complete: won, winner: won ? team : null } };
  });
  const undo = () => updateCourt(courtId, (court) => {
    if (!court.match.history.length) return court;
    return { ...court, match: { ...court.match, scores: court.match.history[court.match.history.length - 1], history: court.match.history.slice(0, -1), complete: false, winner: null } };
  });
  const changeScorer = (scorerId) => updateCourt(courtId, (court) => ({ ...court, match: { ...court.match, scorerId } }));
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

  const exitFlow = () => { resetSession(); onExit?.(); };
  if (screen === 'setup') return <Setup organizerName={user?.name || 'Organizer'} onBack={onExit} onStart={startSession} />;
  if (screen === 'summary') return <Summary session={session} onDone={exitFlow} />;
  if (screen === 'tv') return <VenueTVDisplay session={session} onBack={() => setScreen('dashboard')} />;
  if (screen === 'assign') return <Assignment session={session} courtId={courtId} onBack={() => setScreen('dashboard')} onStart={startMatch} />;
  if (screen === 'live') {
    const match = session.courts.find((court) => court.id === courtId)?.match;
    return <><LiveCourt session={session} courtId={courtId} now={now} onBack={() => setScreen('dashboard')} onScore={score} onUndo={undo} onScorer={changeScorer} onEnd={() => setShowEndMatch(true)} /><EndMatchModal visible={showEndMatch} match={match} players={session.players} onCancel={() => setShowEndMatch(false)} onConfirm={finishMatch} /></>;
  }
  return <><Dashboard session={session} now={now} onCourt={openCourt} onPlayerDone={markDone} onPlayerPriority={togglePriority} onAddPlayer={() => setShowAddPlayer(true)} onAnnouncement={() => setShowAnnouncement(true)} onTV={() => setScreen('tv')} onEndSession={() => setScreen('summary')} /><AddPlayerModal visible={showAddPlayer} players={session.players} onCancel={() => setShowAddPlayer(false)} onAdd={addPlayer} /><AnnouncementModal visible={showAnnouncement} onCancel={() => setShowAnnouncement(false)} onPublish={async (body) => { await publishOpenPlayAnnouncement(session.id, body); setShowAnnouncement(false); }} /></>;
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .08, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, android: { elevation: 3 } });
const lightStyles = StyleSheet.create({
  flex: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 44 }, pressed: { opacity: .78, transform: [{ scale: .99 }] }, disabled: { opacity: .38 },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 }, topCopy: { flex: 1 }, iconButton: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, eyebrow: { color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -.7 }, h2: { marginTop: 2, color: C.ink, fontSize: 21, fontWeight: '900' }, kitchen: { height: 7, marginTop: 16, marginBottom: 20 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 },
  rolePill: { minHeight: 32, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 16, backgroundColor: '#E5F0ED' }, roleText: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, heroCard: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, heroIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.45)' }, heroTitle: { color: C.ink, fontSize: 14, fontWeight: '900' }, heroBody: { marginTop: 4, color: C.ink70, fontSize: 10, lineHeight: 15 },
  sectionLabel: { marginTop: 22, marginBottom: 9, color: C.ink, fontSize: 10, fontWeight: '900', letterSpacing: .9 }, stepper: { height: 80, padding: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, stepButton: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }, stepButtonAdd: { backgroundColor: C.optic }, stepValue: { alignItems: 'center' }, stepNumber: { color: C.ink, fontSize: 30, lineHeight: 33, fontWeight: '900', fontVariant: ['tabular-nums'] }, stepLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  venueChoices: { gap: 8, paddingRight: 8 }, venueChoice: { width: 145, minHeight: 77, padding: 11, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, venueChoiceActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, venueChoiceName: { marginTop: 6, color: C.ink, fontSize: 10, fontWeight: '900' }, venueChoiceArea: { marginTop: 3, color: C.ink40, fontSize: 7 }, scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dateInput: { flex: 1.4 }, timeInput: { flex: .75, textAlign: 'center' }, timeDash: { color: C.ink40, fontSize: 12 }, choiceGroup: { flexDirection: 'row', gap: 7 }, choice: { minHeight: 45, flex: 1, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, choiceActive: { borderColor: C.teal, backgroundColor: C.optic }, choiceText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, choiceTextActive: { color: '#0E2321', fontWeight: '900' }, numericRow: { flexDirection: 'row', gap: 6 }, numericField: { flex: 1, minHeight: 67, padding: 8, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, numericLabel: { color: C.ink40, fontSize: 5.5, fontWeight: '900', letterSpacing: .35 }, numericInput: { flex: 1, padding: 0, color: C.ink, fontSize: 12, fontWeight: '900' }, setupError: { marginTop: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#F7EAE6' }, setupErrorText: { flex: 1, color: C.brick, fontSize: 8, lineHeight: 12, fontWeight: '800' },
  fieldHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, countText: { marginBottom: 9, color: C.teal, fontSize: 8, fontWeight: '900' }, nameInput: { minHeight: 142, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 13, lineHeight: 21, textAlignVertical: 'top' }, policyInput: { minHeight: 86, marginTop: 8, fontSize: 10, lineHeight: 15 }, helper: { marginTop: 7, color: C.ink40, fontSize: 8, lineHeight: 12 }, helperTop: { marginTop: -4, marginBottom: 9, color: C.ink40, fontSize: 9, lineHeight: 13 },
  rulesCard: { minHeight: 70, marginTop: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, rulesIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, rulesTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, rulesMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, primaryButton: { minHeight: 58, marginTop: 18, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: C.optic }, disabledButton: { opacity: .42 }, primaryText: { color: C.ink, fontSize: 12, fontWeight: '900' },
  joinCard: { minHeight: 68, marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, joinCardActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, joinCheck: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, joinCheckActive: { backgroundColor: C.optic }, joinTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, joinMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  endSessionButton: { minWidth: 48, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#E2C4BC', backgroundColor: '#FFF5F2' }, endSessionText: { color: C.brick, fontSize: 9, fontWeight: '900' }, sessionStats: { paddingVertical: 14, flexDirection: 'row', borderRadius: 18, backgroundColor: C.ink }, sessionStat: { flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.18)' }, sessionNumber: { color: C.surface, fontSize: 21, fontWeight: '900', fontVariant: ['tabular-nums'] }, sessionLabel: { marginTop: 3, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .7 }, sectionHead: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, livePill: { paddingHorizontal: 9, minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: '#E5F0ED' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, liveText: { color: C.teal, fontSize: 7, fontWeight: '900' },
  monitorActions: { flexDirection: 'row', alignItems: 'center', gap: 5 }, monitorIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  inviteCard: { marginBottom: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: C.teal, backgroundColor: C.surface }, inviteCode: { minWidth: 72, padding: 8, alignItems: 'center', borderRadius: 11, backgroundColor: C.ink }, inviteCodeLabel: { color: C.ink40, fontSize: 5, fontWeight: '900', letterSpacing: .4 }, inviteCodeValue: { marginTop: 2, color: C.optic, fontSize: 15, fontWeight: '900', letterSpacing: 1.2 }, inviteTitle: { color: C.ink, fontSize: 9, fontWeight: '900' }, inviteMeta: { marginTop: 3, color: C.ink40, fontSize: 6.5, lineHeight: 10 }, shareButton: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic },
  courtCard: { marginBottom: 10, padding: 14, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, openCourtCard: { borderStyle: 'dashed', borderColor: C.teal, shadowOpacity: 0 }, courtCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, courtNumber: { color: C.ink, fontSize: 12, fontWeight: '900', letterSpacing: .5 }, courtStatus: { marginTop: 3, color: C.ink40, fontSize: 8 }, statusPill: { minHeight: 25, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13 }, statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.surface }, statusText: { color: C.surface, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, compactScore: { marginTop: 12, flexDirection: 'row', alignItems: 'stretch' }, compactTeam: { flex: 1, alignItems: 'center' }, compactNames: { width: '100%', color: C.ink70, textAlign: 'center', fontSize: 8, fontWeight: '800' }, compactNumber: { marginTop: 2, color: C.ink, fontSize: 32, lineHeight: 37, fontWeight: '900', fontVariant: ['tabular-nums'] }, scoreDivider: { width: 1, marginHorizontal: 10, backgroundColor: C.line }, courtFoot: { marginTop: 8, paddingTop: 9, borderTopWidth: 1, borderColor: C.line, flexDirection: 'row', justifyContent: 'space-between' }, scorerMeta: { color: C.teal, fontSize: 8, fontWeight: '800' }, timer: { color: C.ink, fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] }, openPrompt: { minHeight: 58, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, openPlus: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, openTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, openMeta: { marginTop: 3, color: C.ink40, fontSize: 8 },
  queueHeadActions: { alignItems: 'flex-end', gap: 5 }, queueCount: { color: C.teal, fontSize: 7, fontWeight: '900' }, addPlayerButton: { minHeight: 31, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, backgroundColor: C.optic }, addPlayerText: { color: C.ink, fontSize: 7, fontWeight: '900' }, fairCard: { marginBottom: 9, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 14, backgroundColor: '#E5F0ED' }, fairIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.surface }, fairTitle: { color: C.ink, fontSize: 9, fontWeight: '900' }, fairMeta: { marginTop: 3, color: C.ink70, fontSize: 7.5, lineHeight: 12 }, overrideAudit: { marginBottom: 9, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 13, backgroundColor: '#F7EAE6' }, overrideAuditTitle: { color: C.brick, fontSize: 8, fontWeight: '900' }, overrideAuditMeta: { marginTop: 2, color: C.ink70, fontSize: 7, lineHeight: 11 }, queueCard: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, queueRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 7 }, rowBorder: { borderTopWidth: 1, borderColor: C.line }, queuePosition: { width: 20, color: C.ink40, textAlign: 'center', fontSize: 9, fontWeight: '900' }, avatar: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, avatarText: { color: C.surface, fontSize: 9, fontWeight: '900' }, playerName: { color: C.ink, fontSize: 11, fontWeight: '900' }, playerMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, priorityButton: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, priorityButtonActive: { backgroundColor: C.optic }, doneButton: { minWidth: 44, minHeight: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, doneText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, emptyQueue: { minHeight: 130, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { marginTop: 7, color: C.ink, fontSize: 11, fontWeight: '900' }, emptyMeta: { marginTop: 4, color: C.ink40, fontSize: 8 },
  lead: { marginTop: -5, marginBottom: 15, color: C.ink70, fontSize: 10, lineHeight: 15 }, explainCard: { marginBottom: 12, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 15, borderWidth: 1, borderColor: C.teal, backgroundColor: C.surface }, teamsCard: { flexDirection: 'row', gap: 9 }, lineupTeam: { flex: 1, padding: 12, borderRadius: 18, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, backgroundColor: '#E5F0ED' }, lineupTeamAway: { backgroundColor: '#F8EDE9' }, teamLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, lineupSlot: { minHeight: 50, marginTop: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 11, backgroundColor: C.surface }, smallAvatar: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink }, smallAvatarText: { color: C.surface, fontSize: 7, fontWeight: '900' }, lineupName: { flex: 1, color: C.ink, fontSize: 8, fontWeight: '800' }, openSlot: { color: C.ink40, fontSize: 8 }, pickerCard: { paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, pickerRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8 }, overrideInput: { minHeight: 82, fontSize: 10, lineHeight: 15 }, scorerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, scorerChoice: { width: '48%', minHeight: 54, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, scorerChoiceActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, scorerAvatarActive: { backgroundColor: C.teal }, scorerName: { flex: 1, color: C.ink, fontSize: 8, fontWeight: '800' },
  timerPill: { minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 17, backgroundColor: C.ink }, timerText: { color: C.surface, fontSize: 9, fontWeight: '900', fontVariant: ['tabular-nums'] }, matchPointBanner: { minHeight: 48, marginBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: C.optic }, matchPointText: { flex: 1, color: C.ink, fontSize: 9, fontWeight: '900' }, finishedBanner: { minHeight: 48, marginBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: C.teal }, finishedText: { flex: 1, color: C.surface, fontSize: 9, fontWeight: '800' }, scoreCard: { flexDirection: 'row', gap: 9 }, scoreTeam: { minHeight: 280, flex: 1, padding: 13, alignItems: 'center', borderRadius: 21, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, scoreTeamAway: { backgroundColor: '#FFFDFC' }, scoreNames: { minHeight: 38, marginTop: 9, color: C.ink, textAlign: 'center', fontSize: 10, lineHeight: 14, fontWeight: '900' }, bigScore: { marginTop: 13, color: C.ink, fontSize: 72, lineHeight: 80, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -4 }, pointButton: { width: '100%', minHeight: 54, marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 13, backgroundColor: C.teal }, pointButtonAway: { backgroundColor: C.brick }, pointText: { color: C.surface, fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  scorerCard: { marginTop: 13, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, scorerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scorerTitle: { marginTop: 3, color: C.ink, fontSize: 14, fontWeight: '900' }, assignmentPill: { paddingHorizontal: 7, minHeight: 24, justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, assignmentText: { color: C.teal, fontSize: 6, fontWeight: '900' }, scorerHelp: { marginTop: 6, color: C.ink40, fontSize: 8 }, scorerChips: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, scorerChip: { minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 11, backgroundColor: C.paper }, scorerChipActive: { borderWidth: 1, borderColor: C.teal, backgroundColor: '#E5F0ED' }, scorerChipText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, scorerChipTextActive: { color: C.teal, fontWeight: '900' }, liveActions: { marginTop: 13, flexDirection: 'row', gap: 9 }, secondaryButton: { minHeight: 49, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, secondaryText: { color: C.teal, fontSize: 9, fontWeight: '900' }, endMatchButton: { minHeight: 49, flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 13, backgroundColor: C.ink }, endMatchText: { color: C.surface, fontSize: 9, fontWeight: '900' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.5)' }, sheet: { padding: 20, paddingBottom: 32, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: C.paper }, sheetHandle: { width: 42, height: 4, alignSelf: 'center', marginBottom: 18, borderRadius: 2, backgroundColor: C.line }, sheetTitle: { marginTop: 3, color: C.ink, fontSize: 23, fontWeight: '900' }, sheetLead: { marginTop: 5, marginBottom: 11, color: C.ink40, fontSize: 9, lineHeight: 14 }, singleInput: { minHeight: 52, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 12, fontWeight: '700' }, inputError: { marginTop: 6, color: C.brick, fontSize: 8, fontWeight: '800' }, endPlayerRow: { minHeight: 59, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderColor: C.line }, returnPill: { minHeight: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E5F0ED' }, returnText: { color: C.teal, fontSize: 6, fontWeight: '900' }, donePill: { backgroundColor: '#F8EDE9' }, donePillText: { color: C.brick }, sheetActions: { marginTop: 16, flexDirection: 'row', gap: 9 }, confirmButton: { minHeight: 49, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.ink }, confirmText: { color: C.surface, fontSize: 9, fontWeight: '900' },
  announcementInput: { minHeight: 105, paddingTop: 13, textAlignVertical: 'top' },
  tvScreen: { flex: 1, padding: 24, backgroundColor: C.ink }, tvHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, tvBrand: { color: C.optic, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, tvTitle: { marginTop: 4, color: C.surface, fontSize: 28, fontWeight: '900' }, tvClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#304743' }, tvStats: { marginTop: 22, padding: 18, flexDirection: 'row', justifyContent: 'space-around', borderRadius: 18, backgroundColor: '#17302D' }, tvNumber: { color: C.surface, textAlign: 'center', fontSize: 30, fontWeight: '900' }, tvLabel: { marginTop: 3, color: '#9FB3AC', textAlign: 'center', fontSize: 7, fontWeight: '900', letterSpacing: .8 }, tvSection: { marginTop: 22, color: C.optic, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, tvCourts: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, tvCourt: { width: '48%', minHeight: 135, padding: 14, borderRadius: 17, backgroundColor: '#17302D' }, tvCourtOpen: { borderWidth: 1, borderColor: C.optic }, tvCourtName: { color: '#9FB3AC', fontSize: 8, fontWeight: '900' }, tvScore: { marginTop: 8, color: C.surface, fontSize: 36, fontWeight: '900' }, tvOpen: { marginTop: 13, color: C.optic, fontSize: 24, fontWeight: '900' }, tvPlayers: { marginTop: 5, color: '#C8D3CF', fontSize: 8, lineHeight: 12 }, tvNext: { marginTop: 'auto', padding: 18, borderRadius: 18, backgroundColor: C.optic }, tvNextNames: { marginTop: 8, color: '#0E2321', fontSize: 18, lineHeight: 24, fontWeight: '900' }, tvReason: { marginTop: 6, color: '#3C4A45', fontSize: 8, lineHeight: 12 },
  summaryContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' }, summaryIcon: { width: 72, height: 72, marginBottom: 18, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, summaryTitle: { marginTop: 5, color: C.ink, fontSize: 28, fontWeight: '900' }, summaryLead: { maxWidth: 300, marginTop: 7, color: C.ink40, textAlign: 'center', fontSize: 10, lineHeight: 16 }, summaryWarning: { marginTop: 10, color: C.brick, fontSize: 8, fontWeight: '800' }, summaryStats: { width: '100%', marginTop: 23, paddingVertical: 17, flexDirection: 'row', borderRadius: 18, backgroundColor: C.surface }, summaryStat: { flex: 1, alignItems: 'center' }, summaryNumber: { color: C.ink, fontSize: 27, fontWeight: '900' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
