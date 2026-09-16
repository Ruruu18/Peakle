import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import ScrollView from '../components/FocusResetScrollView';
import ProfilePhoto from '../components/ProfilePhoto';
import BlinkingDot from '../components/BlinkingDot';
import { useTheme } from '../context/ThemeContext';
import { requireSupabase } from '../lib/supabase';
import { loadCompetitionDivisionDetail } from '../services/pickleball';

const LIGHT = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', tealDeep: '#12514D', brick: '#B6472E', ink70: '#3C4A45',
  ink40: '#7C8983', line: '#DDE3DA', wash: '#E5F0ED', hero: '#103D39', gold: '#D5A928',
};

const DARK = {
  ink: '#F3F5EF', paper: '#0E2321', surface: '#17302D', optic: '#D6E94A',
  teal: '#72C7BE', tealDeep: '#A7DDD7', brick: '#FF9A80', ink70: '#C6D2CC',
  ink40: '#9FB3AC', line: '#304743', wash: '#203B37', hero: '#091F1D', gold: '#E9C75E',
};

const shadow = Platform.select({
  ios: { shadowColor: '#071C1A', shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 7 } },
  android: { elevation: 4 },
});

const PARTICIPANT_DIVISION_LABELS = { open: 'Open', women: 'Women’s', men: 'Men’s', mixed: 'Mixed' };
const SKILL_CATEGORY_LABELS = { open: 'Open level', novice: 'Novice', intermediate: 'Intermediate', advanced: 'Advanced' };

const formatDate = (value, time = true) => new Date(value).toLocaleString('en-PH', time ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' });

function entryName(entry) {
  if (!entry) return 'TBD';
  return entry.profiles?.display_name || entry.teams?.name || 'Entrant';
}

function roundLabel(roundNumber, totalRounds) {
  const fromFinal = totalRounds - roundNumber;
  if (fromFinal <= 0) return 'Final';
  if (fromFinal === 1) return 'Semifinal';
  if (fromFinal === 2) return 'Quarterfinal';
  return `Round ${roundNumber}`;
}

function Tab({ active, label, onPress, palette }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, active && { backgroundColor: palette.optic }, pressed && styles.pressed]}
    >
      <Text style={[styles.tabText, { color: active ? LIGHT.ink : palette.ink40 }]}>{label}</Text>
    </Pressable>
  );
}

function StandingRow({ entry, rank, mine, palette }) {
  const record = `${entry.won}–${entry.lost}`;
  return (
    <View style={[styles.standingRow, mine && { backgroundColor: palette.wash }]}>
      <View style={[styles.rankBadge, rank <= 3 && { backgroundColor: rank === 1 ? palette.optic : palette.wash }]}>
        <Text style={[styles.rankText, { color: rank === 1 ? LIGHT.ink : palette.ink }]}>{rank}</Text>
      </View>
      <ProfilePhoto photo={entry.profiles?.avatar_url} name={entryName(entry)} size={40} />
      <View style={styles.standingCopy}>
        <View style={styles.standingNameLine}>
          <Text numberOfLines={1} style={[styles.standingName, { color: palette.ink }]}>{entryName(entry)}</Text>
          {mine ? <View style={[styles.youBadge, { backgroundColor: palette.optic }]}><Text style={styles.youText}>YOU</Text></View> : null}
        </View>
        <Text style={[styles.standingMeta, { color: palette.ink40 }]}>{record} record · {entry.played} played</Text>
      </View>
      <View style={styles.standingRating}>
        <Text style={[styles.standingRatingValue, { color: palette.ink }]}>{entry.standing_points}</Text>
        <Text style={[styles.standingRatingLabel, { color: palette.ink40 }]}>PTS</Text>
      </View>
    </View>
  );
}

function PodiumEntry({ entry, place, mine, palette }) {
  const champion = place === 1;
  return (
    <View style={[styles.podiumEntry, champion && styles.podiumChampion]}>
      <View style={[styles.podiumBadge, { backgroundColor: champion ? palette.optic : palette.wash, borderColor: champion ? palette.optic : palette.line }]}>
        <Text style={[styles.podiumBadgeText, { color: champion ? LIGHT.ink : palette.ink }]}>{place}</Text>
      </View>
      <View style={[styles.podiumAvatar, { borderColor: champion ? palette.optic : palette.line }]}>
        <ProfilePhoto photo={entry.profiles?.avatar_url} name={entryName(entry)} size={champion ? 58 : 48} />
      </View>
      <Text numberOfLines={1} style={[styles.podiumName, { color: palette.ink }]}>{mine ? 'You' : entryName(entry)}</Text>
      <Text style={[styles.podiumPoints, { color: palette.ink }]}>{entry.standing_points} PTS</Text>
      <Text style={[styles.podiumRecord, { color: palette.ink40 }]}>{entry.won}–{entry.lost}</Text>
    </View>
  );
}

function Podium({ topEntries, isMine, palette }) {
  if (!topEntries.length) return null;
  const ordered = topEntries.length === 3 ? [topEntries[1], topEntries[0], topEntries[2]] : topEntries;
  return (
    <View style={[styles.podiumCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={styles.podiumGlow} />
      {ordered.map((entry) => <PodiumEntry key={entry.id} entry={entry} place={topEntries.indexOf(entry) + 1} mine={isMine(entry)} palette={palette} />)}
    </View>
  );
}

function bracketSlotState(slot) {
  if (slot.status === 'completed') return 'completed';
  if (slot.status === 'bye') return 'bye';
  const match = slot.matches;
  if (slot.status === 'live' || match?.status === 'live') return 'live';
  if (match?.status === 'scheduled') return 'scheduled';
  if (slot.status === 'ready') return 'ready';
  return 'pending';
}

function BracketSlot({ slot, showPosition, mine, palette }) {
  const state = bracketSlotState(slot);
  const game = slot.matches?.match_games?.[0];
  const homeWinner = slot.winner_entry_id && slot.winner_entry_id === slot.home_entry_id;
  const awayWinner = slot.winner_entry_id && slot.winner_entry_id === slot.away_entry_id;
  const badge = {
    completed: { label: 'COMPLETED', bg: palette.wash, fg: palette.teal },
    live: { label: 'LIVE NOW', bg: palette.wash, fg: palette.teal, dot: true },
    scheduled: { label: slot.matches?.scheduled_at ? formatDate(slot.matches.scheduled_at) : 'SCHEDULED', bg: palette.wash, fg: palette.teal },
    ready: { label: 'READY TO SCHEDULE', bg: palette.wash, fg: palette.ink70 },
    bye: { label: 'BYE', bg: palette.wash, fg: palette.ink40 },
    pending: { label: 'AWAITING PREVIOUS ROUND', bg: palette.wash, fg: palette.ink40 },
  }[state];

  return (
    <View style={[styles.bracketSlot, { backgroundColor: palette.surface, borderColor: mine ? palette.teal : state === 'live' ? palette.teal : palette.line }]}>
      <View style={styles.bracketHead}>
        {showPosition || mine ? (
          <View style={styles.bracketTagRow}>
            {showPosition ? <Text style={[styles.bracketPositionLabel, { color: palette.ink40 }]}>MATCH {slot.position}</Text> : null}
            {mine ? <View style={[styles.youBadge, { backgroundColor: palette.optic }]}><Text style={styles.youText}>YOUR MATCH</Text></View> : null}
          </View>
        ) : <View style={styles.flex1} />}
        <View style={[styles.bracketBadge, { backgroundColor: badge.bg }]}>{badge.dot ? <BlinkingDot style={[styles.bracketLiveDot, { backgroundColor: badge.fg }]} /> : null}<Text style={[styles.bracketBadgeText, { color: badge.fg }]}>{badge.label}</Text></View>
      </View>
      <View style={styles.bracketSides}>
        <Text numberOfLines={1} style={[styles.bracketSideName, { color: palette.ink }, homeWinner && styles.bracketWinner]}>{entryName(slot.homeEntry)}</Text>
        <Text style={[styles.bracketScore, { color: palette.ink }]}>{game ? `${game.home_score}–${game.away_score}` : 'vs'}</Text>
        <Text numberOfLines={1} style={[styles.bracketSideName, { color: palette.ink }, awayWinner && styles.bracketWinner]}>{entryName(slot.awayEntry)}</Text>
      </View>
    </View>
  );
}

function EmptyCard({ icon, title, detail, palette }) {
  return (
    <View style={[styles.emptyCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.wash }]}><Ionicons name={icon} size={26} color={palette.teal} /></View>
      <Text style={[styles.emptyTitle, { color: palette.ink }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: palette.ink40 }]}>{detail}</Text>
    </View>
  );
}

export default function CompetitionDivisionScreen({ navigation, route }) {
  const { isDark } = useTheme();
  const palette = isDark ? DARK : LIGHT;
  const { divisionId } = route?.params || {};
  const [tab, setTab] = useState('standings');
  const [userId, setUserId] = useState(null);
  const [mineTeamIds, setMineTeamIds] = useState(() => new Set());
  const [division, setDivision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);

  const refresh = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    const client = requireSupabase();
    client.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      setUserId(data.user.id);
      client.from('team_members').select('team_id').eq('user_id', data.user.id).then(({ data: rows }) => {
        if (active) setMineTeamIds(new Set((rows || []).map((row) => row.team_id)));
      });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!divisionId) return undefined;
    let active = true;
    const refreshOnly = Boolean(division);
    if (refreshOnly) setRefreshing(true);
    else setLoading(true);
    setError('');
    loadCompetitionDivisionDetail(divisionId)
      .then((next) => { if (active) setDivision(next); })
      .catch((nextError) => { if (active) setError(nextError.message || 'This division could not be loaded.'); })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionId, request]);

  useEffect(() => {
    if (!divisionId) return undefined;
    const client = requireSupabase();
    const channel = client.channel(`competition-division-${divisionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competition_entries', filter: `competition_division_id=eq.${divisionId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competition_bracket_matches', filter: `competition_division_id=eq.${divisionId}` }, refresh)
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [divisionId, refresh]);

  const entries = division?.competition_entries || [];
  const standings = useMemo(
    () => entries
      .filter((entry) => ['registered', 'active', 'completed', 'eliminated'].includes(entry.status) && entry.eligibility_status !== 'rejected')
      .sort((a, b) => b.standing_points - a.standing_points || b.won - a.won),
    [entries],
  );
  const isMine = useCallback((entry) => entry && (entry.user_id === userId || (entry.team_id && mineTeamIds.has(entry.team_id))), [userId, mineTeamIds]);
  const bracketRounds = useMemo(() => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const slots = [...(division?.competition_bracket_matches || [])]
      .sort((a, b) => a.round_number - b.round_number || a.position - b.position)
      .map((slot) => ({ ...slot, homeEntry: byId.get(slot.home_entry_id), awayEntry: byId.get(slot.away_entry_id) }));
    const totalRounds = slots.reduce((max, slot) => Math.max(max, slot.round_number), 0);
    const rounds = new Map();
    slots.forEach((slot) => {
      if (!rounds.has(slot.round_number)) rounds.set(slot.round_number, []);
      rounds.get(slot.round_number).push(slot);
    });
    return [...rounds.entries()].map(([roundNumber, roundSlots]) => ({
      roundNumber,
      label: roundLabel(roundNumber, totalRounds),
      slots: roundSlots,
    }));
  }, [division, entries]);
  const topStandings = useMemo(() => standings.slice(0, 3), [standings]);
  const myEntry = useMemo(() => standings.find((entry) => isMine(entry)), [standings, isMine]);
  const myRank = myEntry ? standings.indexOf(myEntry) + 1 : null;
  const isTournament = division?.competitions?.kind === 'tournament';
  const activeTab = isTournament ? tab : 'standings';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={palette.paper} />
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={({ pressed }) => [styles.iconButton, { backgroundColor: palette.surface, borderColor: palette.line }, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={20} color={palette.ink} />
        </Pressable>
        <View style={styles.titleCopy}>
          <Text style={[styles.eyebrow, { color: palette.teal }]}>{division?.competitions?.name?.toUpperCase() || 'COMPETITION'}</Text>
          <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{division?.name || 'Standings'}</Text>
        </View>
        {myEntry && division?.competitions?.id ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open community chat"
            onPress={() => navigation.navigate('CommunityChat', { eventKind: 'competition', eventId: division.competitions.id, title: division.competitions.name, ownerTab: 'Book' })}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: palette.surface, borderColor: palette.line }, pressed && styles.pressed]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={19} color={palette.ink} />
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={refresh} style={({ pressed }) => [styles.iconButton, { backgroundColor: palette.surface, borderColor: palette.line }, pressed && styles.pressed]}>
          {refreshing ? <ActivityIndicator size="small" color={palette.teal} /> : <Ionicons name="refresh" size={19} color={palette.ink} />}
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.teal} colors={[palette.teal]} progressBackgroundColor={palette.surface} />}
      >
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={palette.teal} />
            <Text style={[styles.loadingText, { color: palette.ink40 }]}>Getting the latest results…</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={[styles.emptyCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
            <View style={[styles.emptyIcon, { backgroundColor: palette.wash }]}><Ionicons name="cloud-offline-outline" size={26} color={palette.teal} /></View>
            <Text style={[styles.emptyTitle, { color: palette.ink }]}>Could not load</Text>
            <Text style={[styles.emptyText, { color: palette.ink40 }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refresh} style={({ pressed }) => [styles.retryButton, { backgroundColor: palette.optic }, pressed && styles.pressed]}><Text style={styles.retryText}>Try again</Text></Pressable>
          </View>
        ) : null}

        {!loading && !error && division ? (
          <>
            <View style={[styles.metaBar, { backgroundColor: palette.surface, borderColor: palette.line }]}>
              <Text style={[styles.metaText, { color: palette.ink70 }]}>{PARTICIPANT_DIVISION_LABELS[division.participant_division] || 'Open'} · {SKILL_CATEGORY_LABELS[division.skill_category] || 'Open level'} · {division.format}</Text>
              <View style={[styles.statusPill, { backgroundColor: palette.wash }]}><Text style={[styles.statusPillText, { color: palette.teal }]}>{(division.competitions?.status || division.status || '').toUpperCase()}</Text></View>
            </View>

            {myEntry ? (
              <View style={[styles.myStandingCard, { backgroundColor: palette.hero }]}>
                <View style={styles.myStandingLeft}>
                  <Text style={styles.myStandingEyebrow}>YOUR STANDING</Text>
                  <Text style={styles.myStandingRank}>#{myRank}</Text>
                </View>
                <View style={styles.myStandingDivider} />
                <View style={styles.myStandingStat}><Text style={styles.myStandingStatValue}>{myEntry.standing_points}</Text><Text style={styles.myStandingStatLabel}>POINTS</Text></View>
                <View style={styles.myStandingStat}><Text style={styles.myStandingStatValue}>{myEntry.won}–{myEntry.lost}</Text><Text style={styles.myStandingStatLabel}>RECORD</Text></View>
                <View style={styles.myStandingStat}><Text style={styles.myStandingStatValue}>{myEntry.played}</Text><Text style={styles.myStandingStatLabel}>PLAYED</Text></View>
              </View>
            ) : null}

            {isTournament ? (
              <View accessibilityRole="tablist" style={[styles.tabBar, { backgroundColor: palette.surface, borderColor: palette.line }]}>
                <Tab active={activeTab === 'standings'} label="Standings" onPress={() => setTab('standings')} palette={palette} />
                <Tab active={activeTab === 'bracket'} label="Bracket" onPress={() => setTab('bracket')} palette={palette} />
              </View>
            ) : null}

            {activeTab === 'standings' ? (
              standings.length ? (
                <>
                  <Podium topEntries={topStandings} isMine={isMine} palette={palette} />
                  <View style={[styles.standingsCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
                    {standings.map((entry, index) => <StandingRow key={entry.id} entry={entry} rank={index + 1} mine={isMine(entry)} palette={palette} />)}
                  </View>
                </>
              ) : <EmptyCard icon="podium-outline" title="No standings yet" detail="Once entries are approved and the first matches are played, standings will show up here." palette={palette} />
            ) : (
              bracketRounds.length ? (
                <View style={styles.bracketList}>
                  {bracketRounds.map((round) => (
                    <View key={round.roundNumber} style={styles.bracketRoundSection}>
                      <View style={styles.bracketRoundHead}>
                        <Text style={[styles.bracketRoundTitle, { color: palette.ink }]}>{round.label}</Text>
                        {round.label === 'Final' ? <Ionicons name="trophy" size={15} color={palette.gold} /> : null}
                      </View>
                      <View style={styles.bracketRoundSlots}>
                        {round.slots.map((slot) => <BracketSlot key={slot.id} slot={slot} showPosition={round.slots.length > 1} mine={isMine(slot.homeEntry) || isMine(slot.awayEntry)} palette={palette} />)}
                      </View>
                    </View>
                  ))}
                </View>
              ) : <EmptyCard icon="git-network-outline" title="Bracket coming soon" detail="Your organizer will seed the bracket once registration closes — check back soon." palette={palette} />
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  topbar: { minHeight: 76, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 15 },
  titleCopy: { flex: 1, minWidth: 0, paddingHorizontal: 13 },
  eyebrow: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 1.05 },
  title: { marginTop: 1, fontSize: 22, lineHeight: 27, fontWeight: '800', letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 48 },
  metaBar: { minHeight: 54, marginTop: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 18, ...shadow },
  metaText: { flex: 1, minWidth: 0, fontSize: 10, fontWeight: '700' },
  statusPill: { minHeight: 24, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  statusPillText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  tabBar: { height: 48, marginTop: 12, padding: 4, flexDirection: 'row', gap: 4, borderWidth: 1, borderRadius: 16 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  tabText: { fontSize: 11, fontWeight: '900' },
  myStandingCard: { minHeight: 88, marginTop: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderRadius: 20, ...shadow },
  myStandingLeft: { paddingRight: 14 },
  myStandingEyebrow: { color: 'rgba(243,245,239,.58)', fontSize: 7, lineHeight: 11, fontWeight: '900', letterSpacing: 0.8 },
  myStandingRank: { marginTop: 2, color: '#FFFFFF', fontSize: 26, lineHeight: 30, fontWeight: '900', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  myStandingDivider: { width: 1, height: 40, marginRight: 14, backgroundColor: 'rgba(243,245,239,.18)' },
  myStandingStat: { flex: 1, alignItems: 'center' },
  myStandingStatValue: { color: '#FFFFFF', fontSize: 15, lineHeight: 19, fontWeight: '900', fontVariant: ['tabular-nums'] },
  myStandingStatLabel: { marginTop: 2, color: 'rgba(243,245,239,.48)', fontSize: 6, fontWeight: '900', letterSpacing: 0.65 },
  podiumCard: { minHeight: 168, marginTop: 18, overflow: 'hidden', paddingHorizontal: 8, paddingTop: 16, flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, ...shadow },
  podiumGlow: { position: 'absolute', top: -80, left: '30%', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(214,233,74,.10)' },
  podiumEntry: { flex: 1, minWidth: 0, minHeight: 134, paddingBottom: 15, alignItems: 'center', justifyContent: 'flex-end' },
  podiumChampion: { minHeight: 152 },
  podiumBadge: { minWidth: 23, height: 23, marginBottom: -6, zIndex: 2, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  podiumBadgeText: { fontSize: 9, fontWeight: '900' },
  podiumAvatar: { padding: 2, borderWidth: 2, borderRadius: 34 },
  podiumName: { maxWidth: '92%', marginTop: 7, fontSize: 10, lineHeight: 14, fontWeight: '900' },
  podiumPoints: { marginTop: 3, fontSize: 13, lineHeight: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  podiumRecord: { marginTop: 1, fontSize: 7, lineHeight: 10, fontWeight: '700' },
  standingsCard: { marginTop: 18, overflow: 'hidden', paddingHorizontal: 10, borderWidth: 1, borderRadius: 23, ...shadow },
  standingRow: { minHeight: 72, paddingHorizontal: 5, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopColor: 'transparent' },
  rankBadge: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  rankText: { fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  standingCopy: { flex: 1, minWidth: 0 },
  standingNameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  standingName: { flexShrink: 1, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  standingMeta: { marginTop: 2, fontSize: 8, lineHeight: 12 },
  standingRating: { alignItems: 'flex-end' },
  standingRatingValue: { fontSize: 15, lineHeight: 19, fontWeight: '900', fontVariant: ['tabular-nums'] },
  standingRatingLabel: { marginTop: 1, fontSize: 6, fontWeight: '900', letterSpacing: 0.65 },
  youBadge: { minHeight: 17, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  youText: { color: LIGHT.ink, fontSize: 6, fontWeight: '900' },
  bracketList: { marginTop: 18, gap: 22 },
  bracketRoundSection: { gap: 10 },
  bracketRoundHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bracketRoundTitle: { fontSize: 15, lineHeight: 20, fontWeight: '900', letterSpacing: -0.2 },
  bracketRoundSlots: { gap: 10 },
  bracketSlot: { padding: 13, borderWidth: 1.5, borderRadius: 18, ...shadow },
  bracketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bracketTagRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  bracketPositionLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  flex1: { flex: 1 },
  bracketBadge: { minHeight: 22, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', borderRadius: 11 },
  bracketBadgeText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.4 },
  bracketLiveDot: { width: 5, height: 5, borderRadius: 3 },
  bracketSides: { marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bracketSideName: { flex: 1, fontSize: 12, fontWeight: '800' },
  bracketWinner: { fontWeight: '900', textDecorationLine: 'underline' },
  bracketScore: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  loadingState: { minHeight: 380, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 11, fontSize: 9, fontWeight: '800' },
  emptyCard: { minHeight: 220, marginTop: 24, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 25 },
  emptyIcon: { width: 54, height: 54, marginBottom: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  emptyTitle: { textAlign: 'center', fontSize: 16, lineHeight: 21, fontWeight: '900' },
  emptyText: { maxWidth: 290, marginTop: 6, textAlign: 'center', fontSize: 10, lineHeight: 16 },
  retryButton: { minHeight: 45, marginTop: 18, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  retryText: { color: LIGHT.ink, fontSize: 10, fontWeight: '900' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
});
