import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useOpenPlaySession } from '../context/OpenPlaySessionContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

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

function Setup({ organizerName, onBack, onStart }) {
  const [courtCount, setCourtCount] = useState(2);
  const [names, setNames] = useState('');
  const [includeOrganizer, setIncludeOrganizer] = useState(true);
  const parsedNames = useMemo(() => [...new Set(names.split(/[\n,]+/).map((name) => name.trim()).filter(Boolean))], [names]);
  const registeredNames = useMemo(() => includeOrganizer && !parsedNames.some((name) => name.toLowerCase() === organizerName.toLowerCase()) ? [organizerName, ...parsedNames] : parsedNames, [includeOrganizer, organizerName, parsedNames]);
  const canStart = registeredNames.length >= 4;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <TopBar eyebrow="ORGANIZER MODE" title="Run open play" onBack={onBack} right={<View style={styles.rolePill}><Icon name="key-outline" size={14} color={C.teal} /><Text style={styles.roleText}>ORGANIZER</Text></View>} />

      <View style={styles.heroCard}>
        <View style={styles.heroIcon}><Icon name="people" size={25} /></View>
        <View style={styles.flex}><Text style={styles.heroTitle}>One queue. Every court.</Text><Text style={styles.heroBody}>Set up the courts and check in everyone playing today.</Text></View>
      </View>

      <Text style={styles.sectionLabel}>BOOKED COURTS</Text>
      <Stepper value={courtCount} onChange={setCourtCount} />

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
      <Text style={styles.helper}>You need at least four checked-in players. Duplicate names are removed automatically.</Text>

      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: includeOrganizer }} onPress={() => setIncludeOrganizer((value) => !value)} style={[styles.joinCard, includeOrganizer && styles.joinCardActive]}>
        <View style={[styles.joinCheck, includeOrganizer && styles.joinCheckActive]}><Icon name={includeOrganizer ? 'checkmark' : 'person-outline'} size={17} color={includeOrganizer ? '#0E2321' : C.teal} /></View>
        <View style={styles.flex}><Text style={styles.joinTitle}>I’m playing too</Text><Text style={styles.joinMeta}>Add {organizerName} to the queue while keeping organizer access.</Text></View>
      </Pressable>

      <View style={styles.rulesCard}>
        <View style={styles.rulesIcon}><Icon name="options-outline" color={C.teal} /></View>
        <View style={styles.flex}><Text style={styles.rulesTitle}>Open play rules</Text><Text style={styles.rulesMeta}>Doubles · 1 game · First to 11 · Win by 2</Text></View>
        <Icon name="checkmark-circle" color={C.teal} />
      </View>

      <Pressable disabled={!canStart} onPress={() => onStart({ courtCount, names: registeredNames })} style={({ pressed }) => [styles.primaryButton, !canStart && styles.disabledButton, pressed && canStart && styles.pressed]}>
        <Text style={styles.primaryText}>{canStart ? 'Start open play' : 'Add at least 4 players'}</Text><Icon name="arrow-forward" color="#0E2321" />
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
        <View style={styles.openPrompt}><View style={styles.openPlus}><Icon name="add" size={21} /></View><View style={styles.flex}><Text style={styles.openTitle}>Assign next four</Text><Text style={styles.openMeta}>Build the lineup and choose an on-court scorer.</Text></View><Icon name="chevron-forward" color={C.teal} /></View>
      )}
    </Pressable>
  );
}

function Queue({ queue, players, onDone }) {
  return (
    <View style={styles.queueCard}>
      {!queue.length && <View style={styles.emptyQueue}><Icon name="hourglass-outline" size={26} color={C.ink40} /><Text style={styles.emptyTitle}>No players waiting</Text><Text style={styles.emptyMeta}>Players return here when their match ends.</Text></View>}
      {queue.map((id, index) => {
        const player = players.find((item) => item.id === id);
        return (
          <View key={id} style={[styles.queueRow, index > 0 && styles.rowBorder]}>
            <Text style={styles.queuePosition}>{index + 1}</Text>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(player.name)}</Text></View>
            <View style={styles.flex}><Text style={styles.playerName}>{player.name}</Text><Text style={styles.playerMeta}>{player.gamesPlayed} {player.gamesPlayed === 1 ? 'game' : 'games'} played</Text></View>
            <Pressable accessibilityLabel={`Mark ${player.name} done`} onPress={() => onDone(id)} style={styles.doneButton}><Text style={styles.doneText}>Done</Text></Pressable>
          </View>
        );
      })}
    </View>
  );
}

function Dashboard({ session, now, onCourt, onPlayerDone, onAddPlayer, onEndSession }) {
  const activeCount = session.courts.filter((court) => court.match).length;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TopBar eyebrow="OPEN PLAY · LIVE" title="Court monitor" right={<Pressable onPress={onEndSession} style={styles.endSessionButton}><Text style={styles.endSessionText}>End</Text></Pressable>} />
      <View style={styles.sessionStats}>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.courts.length}</Text><Text style={styles.sessionLabel}>COURTS</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{activeCount}</Text><Text style={styles.sessionLabel}>IN PLAY</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.queue.length}</Text><Text style={styles.sessionLabel}>WAITING</Text></View>
        <View style={styles.sessionStat}><Text style={styles.sessionNumber}>{session.completedMatches.length}</Text><Text style={styles.sessionLabel}>FINISHED</Text></View>
      </View>

      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>ALL BOOKED COURTS</Text><Text style={styles.h2}>Live courts</Text></View><View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View></View>
      {session.courts.map((court) => <CourtCard key={court.id} court={court} players={session.players} now={now} onPress={() => onCourt(court.id)} />)}

      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>ROTATION ORDER</Text><Text style={styles.h2}>Waiting pool</Text></View><View style={styles.queueHeadActions}><Text style={styles.queueCount}>{session.queue.length} WAITING</Text><Pressable accessibilityLabel="Check in a player" onPress={onAddPlayer} style={styles.addPlayerButton}><Icon name="person-add-outline" size={15} color="#0E2321" /><Text style={styles.addPlayerText}>Check in</Text></Pressable></View></View>
      <Queue queue={session.queue} players={session.players} onDone={onPlayerDone} />
    </ScrollView>
  );
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
  const suggested = session.queue.slice(0, 4);
  const [selected, setSelected] = useState(suggested);
  const [scorerId, setScorerId] = useState(suggested[0] || null);
  const toggle = (id) => {
    setSelected((current) => {
      if (current.includes(id)) {
        const next = current.filter((item) => item !== id);
        if (scorerId === id) setScorerId(next[0] || null);
        return next;
      }
      if (current.length >= 4) return current;
      return [...current, id];
    });
  };
  const court = session.courts.find((item) => item.id === courtId);
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TopBar eyebrow={`COURT ${court.number} · OPEN`} title="Build the lineup" onBack={onBack} />
      <Text style={styles.lead}>The first four waiting players are selected. Tap names to adjust their order.</Text>

      <View style={styles.teamsCard}>
        {[0, 1].map((team) => (
          <View key={team} style={[styles.lineupTeam, team === 1 && styles.lineupTeamAway]}>
            <Text style={styles.teamLabel}>TEAM {team + 1}</Text>
            {[0, 1].map((slot) => {
              const id = selected[team * 2 + slot];
              return <View key={slot} style={styles.lineupSlot}>{id ? <><View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>{initials(playerName(session.players, id))}</Text></View><Text numberOfLines={1} style={styles.lineupName}>{playerName(session.players, id)}</Text></> : <Text style={styles.openSlot}>Open spot</Text>}</View>;
            })}
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>CHOOSE 4 PLAYERS · {selected.length}/4</Text>
      <View style={styles.pickerCard}>
        {session.queue.map((id, index) => {
          const chosen = selected.includes(id);
          return <Pressable key={id} onPress={() => toggle(id)} style={[styles.pickerRow, index > 0 && styles.rowBorder]}><Text style={styles.queuePosition}>{index + 1}</Text><View style={styles.flex}><Text style={styles.playerName}>{playerName(session.players, id)}</Text><Text style={styles.playerMeta}>{index < 4 ? 'Suggested next' : 'Waiting'}</Text></View><Icon name={chosen ? 'checkmark-circle' : 'ellipse-outline'} color={chosen ? C.teal : C.ink40} /></Pressable>;
        })}
      </View>

      <Text style={styles.sectionLabel}>ON-COURT SCORER</Text>
      <Text style={styles.helperTop}>The scorer stays a player. This assignment only lasts for this match.</Text>
      <View style={styles.scorerGrid}>
        {selected.map((id) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: scorerId === id }} onPress={() => setScorerId(id)} style={[styles.scorerChoice, scorerId === id && styles.scorerChoiceActive]}><View style={[styles.smallAvatar, scorerId === id && styles.scorerAvatarActive]}><Text style={styles.smallAvatarText}>{initials(playerName(session.players, id))}</Text></View><Text numberOfLines={1} style={styles.scorerName}>{playerName(session.players, id)}</Text>{scorerId === id && <Icon name="phone-portrait-outline" size={15} color={C.teal} />}</Pressable>)}
      </View>

      <Pressable disabled={selected.length !== 4 || !scorerId} onPress={() => onStart(selected, scorerId)} style={({ pressed }) => [styles.primaryButton, (selected.length !== 4 || !scorerId) && styles.disabledButton, pressed && selected.length === 4 && styles.pressed]}><Text style={styles.primaryText}>Start match</Text><Icon name="play" color="#0E2321" /></Pressable>
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
  const { screen, setScreen, session, setSession, courtId, setCourtId, resetSession } = useOpenPlaySession();
  const [showEndMatch, setShowEndMatch] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!session || screen === 'setup' || screen === 'summary') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [screen, session]);

  const updateCourt = (id, update) => setSession((current) => ({ ...current, courts: current.courts.map((court) => court.id === id ? update(court) : court) }));
  const startSession = ({ courtCount, names }) => {
    const players = names.map((name) => ({ id: uid('player'), name, status: 'waiting', gamesPlayed: 0 }));
    setSession({ id: uid('session'), players, queue: players.map((player) => player.id), courts: Array.from({ length: courtCount }, (_, index) => ({ id: uid('court'), number: index + 1, match: null })), completedMatches: [] });
    setScreen('dashboard');
  };
  const openCourt = (id) => {
    setCourtId(id);
    const court = session.courts.find((item) => item.id === id);
    setScreen(court.match ? 'live' : 'assign');
  };
  const startMatch = (playerIds, scorerId) => {
    const match = { id: uid('match'), playerIds, teams: [playerIds.slice(0, 2), playerIds.slice(2, 4)], scorerId, scores: [0, 0], history: [], startedAt: Date.now(), complete: false, winner: null };
    setSession((current) => ({ ...current, queue: current.queue.filter((id) => !playerIds.includes(id)), players: current.players.map((player) => playerIds.includes(player.id) ? { ...player, status: 'playing' } : player), courts: current.courts.map((court) => court.id === courtId ? { ...court, match } : court) }));
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
  const finishMatch = (doneIds) => {
    const court = session.courts.find((item) => item.id === courtId);
    const returned = court.match.playerIds.filter((id) => !doneIds.includes(id));
    const result = { ...court.match, endedAt: Date.now(), courtNumber: court.number };
    setSession((current) => ({ ...current, queue: [...current.queue, ...returned], players: current.players.map((player) => court.match.playerIds.includes(player.id) ? { ...player, status: doneIds.includes(player.id) ? 'done' : 'waiting', gamesPlayed: player.gamesPlayed + 1 } : player), courts: current.courts.map((item) => item.id === courtId ? { ...item, match: null } : item), completedMatches: [...current.completedMatches, result] }));
    setShowEndMatch(false);
    setCourtId(null);
    setScreen('dashboard');
  };
  const markDone = (id) => setSession((current) => ({ ...current, queue: current.queue.filter((playerId) => playerId !== id), players: current.players.map((player) => player.id === id ? { ...player, status: 'done' } : player) }));
  const addPlayer = (name) => {
    const player = { id: uid('player'), name, status: 'waiting', gamesPlayed: 0 };
    setSession((current) => ({ ...current, players: [...current.players, player], queue: [...current.queue, player.id] }));
    setShowAddPlayer(false);
  };

  const exitFlow = () => { resetSession(); onExit?.(); };
  if (screen === 'setup') return <Setup organizerName={user?.name || 'Organizer'} onBack={onExit} onStart={startSession} />;
  if (screen === 'summary') return <Summary session={session} onDone={exitFlow} />;
  if (screen === 'assign') return <Assignment session={session} courtId={courtId} onBack={() => setScreen('dashboard')} onStart={startMatch} />;
  if (screen === 'live') {
    const match = session.courts.find((court) => court.id === courtId)?.match;
    return <><LiveCourt session={session} courtId={courtId} now={now} onBack={() => setScreen('dashboard')} onScore={score} onUndo={undo} onScorer={changeScorer} onEnd={() => setShowEndMatch(true)} /><EndMatchModal visible={showEndMatch} match={match} players={session.players} onCancel={() => setShowEndMatch(false)} onConfirm={finishMatch} /></>;
  }
  return <><Dashboard session={session} now={now} onCourt={openCourt} onPlayerDone={markDone} onAddPlayer={() => setShowAddPlayer(true)} onEndSession={() => setScreen('summary')} /><AddPlayerModal visible={showAddPlayer} players={session.players} onCancel={() => setShowAddPlayer(false)} onAdd={addPlayer} /></>;
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .08, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, android: { elevation: 3 } });
const lightStyles = StyleSheet.create({
  flex: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 44 }, pressed: { opacity: .78, transform: [{ scale: .99 }] }, disabled: { opacity: .38 },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 }, topCopy: { flex: 1 }, iconButton: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, eyebrow: { color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -.7 }, h2: { marginTop: 2, color: C.ink, fontSize: 21, fontWeight: '900' }, kitchen: { height: 7, marginTop: 16, marginBottom: 20 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 },
  rolePill: { minHeight: 32, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 16, backgroundColor: '#E5F0ED' }, roleText: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, heroCard: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, heroIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.45)' }, heroTitle: { color: C.ink, fontSize: 14, fontWeight: '900' }, heroBody: { marginTop: 4, color: C.ink70, fontSize: 10, lineHeight: 15 },
  sectionLabel: { marginTop: 22, marginBottom: 9, color: C.ink, fontSize: 10, fontWeight: '900', letterSpacing: .9 }, stepper: { height: 80, padding: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, stepButton: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }, stepButtonAdd: { backgroundColor: C.optic }, stepValue: { alignItems: 'center' }, stepNumber: { color: C.ink, fontSize: 30, lineHeight: 33, fontWeight: '900', fontVariant: ['tabular-nums'] }, stepLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  fieldHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, countText: { marginBottom: 9, color: C.teal, fontSize: 8, fontWeight: '900' }, nameInput: { minHeight: 142, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 13, lineHeight: 21, textAlignVertical: 'top' }, helper: { marginTop: 7, color: C.ink40, fontSize: 8, lineHeight: 12 }, helperTop: { marginTop: -4, marginBottom: 9, color: C.ink40, fontSize: 9, lineHeight: 13 },
  rulesCard: { minHeight: 70, marginTop: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, rulesIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, rulesTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, rulesMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, primaryButton: { minHeight: 58, marginTop: 18, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: C.optic }, disabledButton: { opacity: .42 }, primaryText: { color: C.ink, fontSize: 12, fontWeight: '900' },
  joinCard: { minHeight: 68, marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, joinCardActive: { borderColor: C.teal, backgroundColor: '#F4F9F7' }, joinCheck: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, joinCheckActive: { backgroundColor: C.optic }, joinTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, joinMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  endSessionButton: { minWidth: 48, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#E2C4BC', backgroundColor: '#FFF5F2' }, endSessionText: { color: C.brick, fontSize: 9, fontWeight: '900' }, sessionStats: { paddingVertical: 14, flexDirection: 'row', borderRadius: 18, backgroundColor: C.ink }, sessionStat: { flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.18)' }, sessionNumber: { color: C.surface, fontSize: 21, fontWeight: '900', fontVariant: ['tabular-nums'] }, sessionLabel: { marginTop: 3, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .7 }, sectionHead: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, livePill: { paddingHorizontal: 9, minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: '#E5F0ED' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, liveText: { color: C.teal, fontSize: 7, fontWeight: '900' },
  courtCard: { marginBottom: 10, padding: 14, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, openCourtCard: { borderStyle: 'dashed', borderColor: C.teal, shadowOpacity: 0 }, courtCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, courtNumber: { color: C.ink, fontSize: 12, fontWeight: '900', letterSpacing: .5 }, courtStatus: { marginTop: 3, color: C.ink40, fontSize: 8 }, statusPill: { minHeight: 25, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13 }, statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.surface }, statusText: { color: C.surface, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, compactScore: { marginTop: 12, flexDirection: 'row', alignItems: 'stretch' }, compactTeam: { flex: 1, alignItems: 'center' }, compactNames: { width: '100%', color: C.ink70, textAlign: 'center', fontSize: 8, fontWeight: '800' }, compactNumber: { marginTop: 2, color: C.ink, fontSize: 32, lineHeight: 37, fontWeight: '900', fontVariant: ['tabular-nums'] }, scoreDivider: { width: 1, marginHorizontal: 10, backgroundColor: C.line }, courtFoot: { marginTop: 8, paddingTop: 9, borderTopWidth: 1, borderColor: C.line, flexDirection: 'row', justifyContent: 'space-between' }, scorerMeta: { color: C.teal, fontSize: 8, fontWeight: '800' }, timer: { color: C.ink, fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] }, openPrompt: { minHeight: 58, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, openPlus: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, openTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, openMeta: { marginTop: 3, color: C.ink40, fontSize: 8 },
  queueHeadActions: { alignItems: 'flex-end', gap: 5 }, queueCount: { color: C.teal, fontSize: 7, fontWeight: '900' }, addPlayerButton: { minHeight: 31, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, backgroundColor: C.optic }, addPlayerText: { color: C.ink, fontSize: 7, fontWeight: '900' }, queueCard: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, queueRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 9 }, rowBorder: { borderTopWidth: 1, borderColor: C.line }, queuePosition: { width: 20, color: C.ink40, textAlign: 'center', fontSize: 9, fontWeight: '900' }, avatar: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, avatarText: { color: C.surface, fontSize: 9, fontWeight: '900' }, playerName: { color: C.ink, fontSize: 11, fontWeight: '900' }, playerMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, doneButton: { minWidth: 48, minHeight: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, doneText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, emptyQueue: { minHeight: 130, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { marginTop: 7, color: C.ink, fontSize: 11, fontWeight: '900' }, emptyMeta: { marginTop: 4, color: C.ink40, fontSize: 8 },
  lead: { marginTop: -5, marginBottom: 15, color: C.ink70, fontSize: 10, lineHeight: 15 }, teamsCard: { flexDirection: 'row', gap: 9 }, lineupTeam: { flex: 1, padding: 12, borderRadius: 18, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, backgroundColor: '#E5F0ED' }, lineupTeamAway: { backgroundColor: '#F8EDE9' }, teamLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, lineupSlot: { minHeight: 50, marginTop: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 11, backgroundColor: C.surface }, smallAvatar: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink }, smallAvatarText: { color: C.surface, fontSize: 7, fontWeight: '900' }, lineupName: { flex: 1, color: C.ink, fontSize: 8, fontWeight: '800' }, openSlot: { color: C.ink40, fontSize: 8 }, pickerCard: { paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, pickerRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8 }, scorerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, scorerChoice: { width: '48%', minHeight: 54, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, scorerChoiceActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, scorerAvatarActive: { backgroundColor: C.teal }, scorerName: { flex: 1, color: C.ink, fontSize: 8, fontWeight: '800' },
  timerPill: { minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 17, backgroundColor: C.ink }, timerText: { color: C.surface, fontSize: 9, fontWeight: '900', fontVariant: ['tabular-nums'] }, matchPointBanner: { minHeight: 48, marginBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: C.optic }, matchPointText: { flex: 1, color: C.ink, fontSize: 9, fontWeight: '900' }, finishedBanner: { minHeight: 48, marginBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: C.teal }, finishedText: { flex: 1, color: C.surface, fontSize: 9, fontWeight: '800' }, scoreCard: { flexDirection: 'row', gap: 9 }, scoreTeam: { minHeight: 280, flex: 1, padding: 13, alignItems: 'center', borderRadius: 21, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, scoreTeamAway: { backgroundColor: '#FFFDFC' }, scoreNames: { minHeight: 38, marginTop: 9, color: C.ink, textAlign: 'center', fontSize: 10, lineHeight: 14, fontWeight: '900' }, bigScore: { marginTop: 13, color: C.ink, fontSize: 72, lineHeight: 80, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -4 }, pointButton: { width: '100%', minHeight: 54, marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 13, backgroundColor: C.teal }, pointButtonAway: { backgroundColor: C.brick }, pointText: { color: C.surface, fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  scorerCard: { marginTop: 13, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, scorerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scorerTitle: { marginTop: 3, color: C.ink, fontSize: 14, fontWeight: '900' }, assignmentPill: { paddingHorizontal: 7, minHeight: 24, justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, assignmentText: { color: C.teal, fontSize: 6, fontWeight: '900' }, scorerHelp: { marginTop: 6, color: C.ink40, fontSize: 8 }, scorerChips: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, scorerChip: { minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 11, backgroundColor: C.paper }, scorerChipActive: { borderWidth: 1, borderColor: C.teal, backgroundColor: '#E5F0ED' }, scorerChipText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, scorerChipTextActive: { color: C.teal, fontWeight: '900' }, liveActions: { marginTop: 13, flexDirection: 'row', gap: 9 }, secondaryButton: { minHeight: 49, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, secondaryText: { color: C.teal, fontSize: 9, fontWeight: '900' }, endMatchButton: { minHeight: 49, flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 13, backgroundColor: C.ink }, endMatchText: { color: C.surface, fontSize: 9, fontWeight: '900' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.5)' }, sheet: { padding: 20, paddingBottom: 32, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: C.paper }, sheetHandle: { width: 42, height: 4, alignSelf: 'center', marginBottom: 18, borderRadius: 2, backgroundColor: C.line }, sheetTitle: { marginTop: 3, color: C.ink, fontSize: 23, fontWeight: '900' }, sheetLead: { marginTop: 5, marginBottom: 11, color: C.ink40, fontSize: 9, lineHeight: 14 }, singleInput: { minHeight: 52, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 12, fontWeight: '700' }, inputError: { marginTop: 6, color: C.brick, fontSize: 8, fontWeight: '800' }, endPlayerRow: { minHeight: 59, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderColor: C.line }, returnPill: { minHeight: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E5F0ED' }, returnText: { color: C.teal, fontSize: 6, fontWeight: '900' }, donePill: { backgroundColor: '#F8EDE9' }, donePillText: { color: C.brick }, sheetActions: { marginTop: 16, flexDirection: 'row', gap: 9 }, confirmButton: { minHeight: 49, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.ink }, confirmText: { color: C.surface, fontSize: 9, fontWeight: '900' },
  summaryContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' }, summaryIcon: { width: 72, height: 72, marginBottom: 18, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, summaryTitle: { marginTop: 5, color: C.ink, fontSize: 28, fontWeight: '900' }, summaryLead: { maxWidth: 300, marginTop: 7, color: C.ink40, textAlign: 'center', fontSize: 10, lineHeight: 16 }, summaryWarning: { marginTop: 10, color: C.brick, fontSize: 8, fontWeight: '800' }, summaryStats: { width: '100%', marginTop: 23, paddingVertical: 17, flexDirection: 'row', borderRadius: 18, backgroundColor: C.surface }, summaryStat: { flex: 1, alignItems: 'center' }, summaryNumber: { color: C.ink, fontSize: 27, fontWeight: '900' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
