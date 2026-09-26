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
import LeaderboardPodium from '../components/LeaderboardPodium';
import useResponsiveWidth from '../hooks/useResponsiveWidth';
import useMatchVerificationSync from '../hooks/useMatchVerificationSync';
import { webLayout } from '../utils/webLayout';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadLeaderboard, loadTeamLeaderboard, unrankedHint } from '../services/leaderboard';

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

function Control({ active, icon, label, onPress, palette }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        active && { backgroundColor: palette.ink },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={15} color={active ? palette.paper : palette.ink40} />
      <Text style={[styles.controlText, { color: active ? palette.paper : palette.ink40 }]}>{label}</Text>
    </Pressable>
  );
}

function FormatControl({ active, label, onPress, palette }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.formatControl,
        active && { backgroundColor: palette.optic },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.formatText, { color: active ? LIGHT.ink : palette.ink40 }]}>{label}</Text>
    </Pressable>
  );
}

function RankHero({ data, format, areaLabel, palette }) {
  const player = data.user;
  const ranked = player?.rank != null;
  const rating = player?.rating != null ? player.rating.toFixed(3) : '—';
  const record = `${player?.wins || 0}–${player?.losses || 0}`;

  return (
    <View style={[styles.hero, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={styles.heroTop}>
        <View style={styles.heroIdentity}>
          <ProfilePhoto photo={player?.avatar} name={player?.name} size={40} />
          <View style={styles.heroCopy}>
            <Text style={[styles.heroName, { color: palette.ink }]}>Your standing</Text>
            <Text numberOfLines={1} style={[styles.heroContext, { color: palette.ink40 }]}>{format === 'singles' ? 'Singles' : 'Doubles'} · {areaLabel}</Text>
          </View>
        </View>
        <View style={styles.heroRankCopy}>
          <Text style={[styles.heroRank, { color: palette.teal }]}>{ranked ? `#${player.rank}` : '—'}</Text>
          <Text style={[styles.heroContext, { color: palette.ink40 }]}>{ranked ? 'Rank' : 'Unranked'}</Text>
        </View>
      </View>

      <View style={[styles.heroStats, { borderColor: palette.line }]}>
        <View style={styles.heroStat}>
          <Text style={[styles.heroStatValue, { color: palette.ink }]}>{rating}</Text>
          <Text style={[styles.heroStatLabel, { color: palette.ink40 }]}>Rating</Text>
        </View>
        <View style={styles.heroStat}>
          <Text style={[styles.heroStatValue, { color: palette.ink }]}>{record}</Text>
          <Text style={[styles.heroStatLabel, { color: palette.ink40 }]}>Win–loss</Text>
        </View>
        <View style={styles.heroStat}>
          <Text style={[styles.heroStatValue, { color: palette.ink }]}>{player?.verifiedMatches || 0}</Text>
          <Text style={[styles.heroStatLabel, { color: palette.ink40 }]}>Verified</Text>
        </View>
      </View>
      {!ranked ? <Text style={[styles.heroHint, { color: palette.ink40 }]}>{unrankedHint(player)}</Text> : null}
    </View>
  );
}

function StandingRow({ player, currentUserId, palette, divider }) {
  const isYou = player.id === currentUserId;
  const medal = player.rank <= 3;
  return (
    <View style={[
      styles.standingRow,
      divider && { borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth },
      isYou && { backgroundColor: palette.wash },
    ]}>
      <View style={[styles.rankBadge, medal && { backgroundColor: player.rank === 1 ? palette.optic : palette.wash }]}>
        <Text style={[styles.rankText, { color: medal && player.rank === 1 ? LIGHT.ink : palette.ink }]}>{player.rank}</Text>
      </View>
      <ProfilePhoto photo={player.avatar} name={player.name} size={42} />
      <View style={styles.standingCopy}>
        <View style={styles.standingNameLine}>
          <Text numberOfLines={1} style={[styles.standingName, { color: palette.ink }]}>{player.name}</Text>
          {isYou ? <View style={[styles.youBadge, { backgroundColor: palette.optic }]}><Text style={styles.youText}>YOU</Text></View> : null}
        </View>
        <Text style={[styles.standingMeta, { color: palette.ink40 }]}>{player.wins}–{player.losses} record · {player.verifiedMatches} verified</Text>
      </View>
      <View style={styles.standingRating}>
        <Text style={[styles.standingRatingValue, { color: palette.ink }]}>{player.rating.toFixed(3)}</Text>
        <Text style={[styles.standingRatingLabel, { color: palette.ink40 }]}>RATING</Text>
      </View>
    </View>
  );
}

function EmptyState({ format, palette }) {
  return (
    <View style={[styles.emptyCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.wash }]}>
        <Ionicons name="podium-outline" size={27} color={palette.teal} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.ink }]}>The field is open</Text>
      <Text style={[styles.emptyText, { color: palette.ink40 }]}>Verified {format} players will appear after their first confirmed match.</Text>
    </View>
  );
}

function TeamHero({ teams, onFindTeam, palette }) {
  const team = teams[0];
  if (!team) {
    return (
      <View style={[styles.hero, { backgroundColor: palette.surface, borderColor: palette.line }]}>
        <Text style={[styles.heroName, { color: palette.ink }]}>Your team</Text>
        <Text style={[styles.heroHint, styles.teamHeroHint, { color: palette.ink40 }]}>Join or create a team, then challenge other teams to climb these standings.</Text>
        <Pressable accessibilityRole="button" onPress={onFindTeam} style={({ pressed }) => [styles.retryButton, styles.teamHeroButton, { backgroundColor: palette.optic }, pressed && styles.pressed]}><Text style={styles.retryText}>Find a team</Text></Pressable>
      </View>
    );
  }
  const ranked = team.rank != null;
  return (
    <View style={[styles.hero, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={styles.heroTop}>
        <View style={styles.heroIdentity}>
          <ProfilePhoto photo={team.avatar} name={team.name} size={40} />
          <View style={styles.heroCopy}>
            <Text numberOfLines={1} style={[styles.heroName, { color: palette.ink }]}>{team.name}</Text>
            <Text numberOfLines={1} style={[styles.heroContext, { color: palette.ink40 }]}>Your team{team.tag ? ` · ${team.tag}` : ''}</Text>
          </View>
        </View>
        <View style={styles.heroRankCopy}>
          <Text style={[styles.heroRank, { color: palette.teal }]}>{ranked ? `#${team.rank}` : '—'}</Text>
          <Text style={[styles.heroContext, { color: palette.ink40 }]}>{ranked ? 'Rank' : 'Unranked'}</Text>
        </View>
      </View>
      <View style={[styles.heroStats, { borderColor: palette.line }]}>
        <View style={styles.heroStat}>
          <Text style={[styles.heroStatValue, { color: palette.ink }]}>{team.wins}–{team.losses}</Text>
          <Text style={[styles.heroStatLabel, { color: palette.ink40 }]}>Win–loss</Text>
        </View>
        <View style={styles.heroStat}>
          <Text style={[styles.heroStatValue, { color: palette.ink }]}>{team.matches}</Text>
          <Text style={[styles.heroStatLabel, { color: palette.ink40 }]}>Challenges</Text>
        </View>
      </View>
      {!team.isPublic ? <Text style={[styles.heroHint, { color: palette.ink40 }]}>{team.name} is private. Make the team public to appear in the standings.</Text>
        : !ranked ? <Text style={[styles.heroHint, { color: palette.ink40 }]}>Finish a challenge match to earn your team a place.</Text> : null}
    </View>
  );
}

function TeamStandingRow({ team, palette, divider }) {
  const medal = team.rank <= 3;
  return (
    <View style={[
      styles.standingRow,
      divider && { borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth },
      team.isMember && { backgroundColor: palette.wash },
    ]}>
      <View style={[styles.rankBadge, medal && { backgroundColor: team.rank === 1 ? palette.optic : palette.wash }]}>
        <Text style={[styles.rankText, { color: medal && team.rank === 1 ? LIGHT.ink : palette.ink }]}>{team.rank}</Text>
      </View>
      <ProfilePhoto photo={team.avatar} name={team.name} size={42} />
      <View style={styles.standingCopy}>
        <View style={styles.standingNameLine}>
          <Text numberOfLines={1} style={[styles.standingName, { color: palette.ink }]}>{team.name}</Text>
          {team.isMember ? <View style={[styles.youBadge, { backgroundColor: palette.optic }]}><Text style={styles.youText}>YOUR TEAM</Text></View> : null}
        </View>
        <Text numberOfLines={1} style={[styles.standingMeta, { color: palette.ink40 }]}>{[team.tag, team.area, `${team.matches} ${team.matches === 1 ? 'challenge' : 'challenges'}`].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={styles.standingRating}>
        <Text style={[styles.standingRatingValue, { color: palette.ink }]}>{team.wins}–{team.losses}</Text>
        <Text style={[styles.standingRatingLabel, { color: palette.ink40 }]}>RECORD</Text>
      </View>
    </View>
  );
}

export default function LeaderboardScreen({ navigation, route }) {
  const { isDark } = useTheme();
  const palette = isDark ? DARK : LIGHT;
  const width = useResponsiveWidth();
  const wide = width >= 760;
  const defaultFormat = route?.params?.defaultFormat === 'singles' ? 'singles' : 'doubles';
  const [board, setBoard] = useState(route?.params?.defaultBoard === 'teams' ? 'teams' : 'players');
  const [scope, setScope] = useState('local');
  const [format, setFormat] = useState(defaultFormat);
  const [data, setData] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    let active = true;
    const teams = board === 'teams';
    const refreshOnly = Boolean(teams ? teamData : data);
    if (refreshOnly) setRefreshing(true);
    else setLoading(true);
    setError('');
    (teams ? loadTeamLeaderboard() : loadLeaderboard({ scope, format }))
      .then((next) => { if (active) (teams ? setTeamData : setData)(next); })
      .catch((nextError) => { if (active) setError(nextError.message || 'The leaderboard could not be loaded.'); })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => { active = false; };
  }, [board, format, request, scope]);

  const refresh = useCallback(() => setRequest((value) => value + 1), []);
  // Confirmed and verified results update the standings without a manual refresh.
  useMatchVerificationSync(user?.id, refresh);
  const changeScope = useCallback((nextScope) => {
    if (nextScope === scope) return;
    setLoading(true);
    setData(null);
    setScope(nextScope);
  }, [scope]);
  const changeBoard = useCallback((nextBoard) => {
    if (nextBoard === board) return;
    setLoading(true);
    setBoard(nextBoard);
  }, [board]);
  const changeFormat = useCallback((nextFormat) => {
    if (nextFormat === format) return;
    setLoading(true);
    setData(null);
    setFormat(nextFormat);
  }, [format]);
  const standings = data?.standings || [];
  const topThree = useMemo(() => standings.slice(0, 3), [standings]);
  const teamStandings = teamData?.standings || [];
  const teamPodium = useMemo(() => teamStandings.slice(0, 3).map((team) => ({ ...team, display: `${team.wins}–${team.losses}` })), [teamStandings]);
  const showTeams = board === 'teams';
  const effectiveScope = data?.scope || scope;
  const areaLabel = effectiveScope === 'local' ? (data?.homeArea || data?.area || 'Local area') : 'Global';
  const screenTitle = format === 'singles' ? 'Singles leaderboard' : 'Doubles leaderboard';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={palette.paper} />
      <View style={[styles.topbar, wide && styles.wideContainer]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={({ pressed }) => [styles.iconButton, { backgroundColor: palette.surface, borderColor: palette.line }, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={20} color={palette.ink} />
        </Pressable>
        <View style={styles.titleCopy}>
          <Text style={[styles.eyebrow, { color: palette.teal }]}>{showTeams ? 'TEAM CHALLENGE RANKINGS' : 'VERIFIED PLAYER RANKINGS'}</Text>
          <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>Leaderboard</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh leaderboard" onPress={refresh} style={({ pressed }) => [styles.iconButton, { backgroundColor: palette.surface, borderColor: palette.line }, pressed && styles.pressed]}>
          {refreshing ? <ActivityIndicator size="small" color={palette.teal} /> : <Ionicons name="refresh" size={19} color={palette.ink} />}
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, wide && styles.wideContainer]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.teal} colors={[palette.teal]} progressBackgroundColor={palette.surface} />}
      >
        <View accessibilityRole="tablist" style={[styles.formatBar, styles.boardBar, { backgroundColor: palette.surface, borderColor: palette.line }]}>
          <FormatControl active={!showTeams} label="Players" onPress={() => changeBoard('players')} palette={palette} />
          <FormatControl active={showTeams} label="Teams" onPress={() => changeBoard('teams')} palette={palette} />
        </View>

        {!showTeams ? <>
        <View style={[styles.scopeBar, { backgroundColor: palette.surface, borderColor: palette.line }]}>
          <View style={styles.scopeControls}>
            <Control active={effectiveScope === 'local'} icon="location-outline" label="Local" onPress={() => changeScope('local')} palette={palette} />
            <Control active={effectiveScope === 'global'} icon="globe-outline" label="Global" onPress={() => changeScope('global')} palette={palette} />
          </View>
          <View style={[styles.scopeDivider, { backgroundColor: palette.line }]} />
          <View style={styles.areaCopy}>
            <Text style={[styles.areaLabel, { color: palette.ink40 }]}>RANKING AREA</Text>
            <Text numberOfLines={1} style={[styles.areaValue, { color: palette.ink }]}>{areaLabel}</Text>
          </View>
        </View>

        <View accessibilityRole="tablist" style={[styles.formatBar, { backgroundColor: palette.surface, borderColor: palette.line }]}>
          <FormatControl active={format === 'doubles'} label="Doubles" onPress={() => changeFormat('doubles')} palette={palette} />
          <FormatControl active={format === 'singles'} label="Singles" onPress={() => changeFormat('singles')} palette={palette} />
        </View>
        </> : null}

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={palette.teal} />
            <Text style={[styles.loadingText, { color: palette.ink40 }]}>Building the verified standings…</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={[styles.errorCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
            <View style={[styles.emptyIcon, { backgroundColor: palette.wash }]}><Ionicons name="cloud-offline-outline" size={26} color={palette.teal} /></View>
            <Text style={[styles.emptyTitle, { color: palette.ink }]}>Standings unavailable</Text>
            <Text style={[styles.emptyText, { color: palette.ink40 }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refresh} style={({ pressed }) => [styles.retryButton, { backgroundColor: palette.optic }, pressed && styles.pressed]}><Text style={styles.retryText}>Try again</Text></Pressable>
          </View>
        ) : null}

        {!loading && !error && showTeams && teamData ? (
          <>
            <View {...webLayout('leaderboard')}>
            <View>
            {teamStandings.length ? <>
                <View style={styles.sectionHead}>
                  <View>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>Top teams</Text>
                    <Text style={[styles.podiumContext, { color: palette.ink40 }]}>Team challenges · All areas</Text>
                  </View>
                  <View style={[styles.livePill, { backgroundColor: palette.wash }]}>
                    <View style={[styles.liveDot, { backgroundColor: palette.teal }]} />
                    <Text style={[styles.liveText, { color: palette.teal }]}>SCORED LIVE</Text>
                  </View>
                </View>
                <LeaderboardPodium players={teamPodium} isDark={isDark} wide={wide} tieNote="Equal records share a rank." />
            </> : null}
            <TeamHero teams={teamData.mine} onFindTeam={() => navigation.navigate('Team')} palette={palette} />
            </View>
            <View>
            {teamStandings.length ? <>
                <View style={[styles.sectionHead, styles.standingsHead]}>
                  <View>
                    <Text style={[styles.sectionEyebrow, { color: palette.teal }]}>TOP {teamStandings.length}</Text>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>Team standings</Text>
                  </View>
                  <Text style={[styles.ratingColumnLabel, { color: palette.ink40 }]}>RECORD</Text>
                </View>
                <View style={[styles.standingsCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
                  {teamStandings.map((team, index) => <TeamStandingRow key={team.id} team={team} palette={palette} divider={index > 0} />)}
                </View>
            </> : (
              <View style={[styles.emptyCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
                <View style={[styles.emptyIcon, { backgroundColor: palette.wash }]}><Ionicons name="people-outline" size={27} color={palette.teal} /></View>
                <Text style={[styles.emptyTitle, { color: palette.ink }]}>No team results yet</Text>
                <Text style={[styles.emptyText, { color: palette.ink40 }]}>Public teams appear here after their first completed challenge match.</Text>
              </View>
            )}
            </View>
            </View>

            <View style={styles.integrityNote}>
              <Ionicons name="shield-checkmark-outline" size={16} color={palette.teal} />
              <Text style={[styles.integrityText, { color: palette.ink40 }]}>Only challenge matches scored live in Peakle count. Scrimmage details stay private.</Text>
            </View>
          </>
        ) : null}

        {!loading && !error && !showTeams && data ? (
          <>
            <View {...webLayout('leaderboard')}>
            <View>
            {standings.length ? <>
                <View style={styles.sectionHead}>
                  <View>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>Top competitors</Text>
                    <Text style={[styles.podiumContext, { color: palette.ink40 }]}>{format === 'singles' ? 'Singles' : 'Doubles'} · {areaLabel}</Text>
                  </View>
                  <View style={[styles.livePill, { backgroundColor: palette.wash }]}>
                    <View style={[styles.liveDot, { backgroundColor: palette.teal }]} />
                    <Text style={[styles.liveText, { color: palette.teal }]}>VERIFIED</Text>
                  </View>
                </View>
                <LeaderboardPodium players={topThree} currentUserId={data.user?.id} isDark={isDark} wide={wide} />
            </> : null}
            <RankHero data={data} format={format} areaLabel={areaLabel} palette={palette} />
            </View>
            <View>
            {standings.length ? <>
                <View style={[styles.sectionHead, styles.standingsHead]}>
                  <View>
                    <Text style={[styles.sectionEyebrow, { color: palette.teal }]}>TOP {standings.length}</Text>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>{screenTitle}</Text>
                  </View>
                  <Text style={[styles.ratingColumnLabel, { color: palette.ink40 }]}>RATING</Text>
                </View>
                <View style={[styles.standingsCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
                  {standings.map((player, index) => <StandingRow key={player.id} player={player} currentUserId={data.user.id} palette={palette} divider={index > 0} />)}
                </View>
            </> : <EmptyState format={format} palette={palette} />}
            </View>
            </View>

            <View style={styles.integrityNote}>
              <Ionicons name="shield-checkmark-outline" size={16} color={palette.teal} />
              <Text style={[styles.integrityText, { color: palette.ink40 }]}>Only confirmed competitive results count toward Peakle rankings.</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  wideContainer: { width: '100%', maxWidth: Platform.OS === 'web' ? 1040 : 760, alignSelf: 'center' },
  topbar: { minHeight: 76, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 15 },
  titleCopy: { flex: 1, minWidth: 0, paddingHorizontal: 13 },
  eyebrow: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 1.05 },
  title: { marginTop: 1, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.7 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 48 },
  scopeBar: { minHeight: 66, padding: 7, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 20, ...shadow },
  scopeControls: { flexDirection: 'row', gap: 3 },
  control: { minHeight: 46, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 14 },
  controlText: { fontSize: 12, fontWeight: '600' },
  scopeDivider: { width: 1, height: 30, marginHorizontal: 10 },
  areaCopy: { flex: 1, minWidth: 0 },
  areaLabel: { fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: 0.8 },
  areaValue: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  boardBar: { marginTop: 0, marginBottom: 10 },
  teamHeroHint: { marginTop: 6 },
  teamHeroButton: { marginTop: 14, alignSelf: 'flex-start' },
  formatBar: { height: 48, marginTop: 10, padding: 4, flexDirection: 'row', gap: 4, borderWidth: 1, borderRadius: 16 },
  formatControl: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  formatText: { fontSize: 14, fontWeight: '600' },
  hero: { marginTop: 24, padding: 16, borderWidth: 1, borderRadius: 16, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  heroCopy: { flex: 1, minWidth: 0, marginLeft: 11 },
  heroName: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  heroContext: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  heroRank: { fontSize: 28, lineHeight: 32, fontWeight: '600', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  heroRankCopy: { alignItems: 'flex-end' },
  heroStats: { marginTop: 16, paddingTop: 14, flexDirection: 'row', borderTopWidth: 1 },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { fontSize: 18, lineHeight: 23, fontWeight: '600', fontVariant: ['tabular-nums'] },
  heroStatLabel: { marginTop: 4, fontSize: 11, lineHeight: 16 },
  heroHint: { marginTop: 14, fontSize: 12, lineHeight: 18 },
  podiumContext: { marginTop: 4, fontSize: 12, lineHeight: 18 },
  sectionHead: { marginTop: 30, marginBottom: 11, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionEyebrow: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 0.95 },
  sectionTitle: { marginTop: 2, fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.4 },
  livePill: { minHeight: 27, marginBottom: 3, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14 },
  liveDot: { width: 5, height: 5, borderRadius: 3 },
  liveText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5 },
  standingsHead: { marginTop: 32 },
  ratingColumnLabel: { marginRight: 9, marginBottom: 5, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  standingsCard: { overflow: 'hidden', paddingHorizontal: 10, borderWidth: 1, borderRadius: 23, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, ...shadow },
  standingRow: { minHeight: 75, paddingHorizontal: 5, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankBadge: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  rankText: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  standingCopy: { flex: 1, minWidth: 0 },
  standingNameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  standingName: { flexShrink: 1, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  standingMeta: { marginTop: 2, fontSize: 8, lineHeight: 12 },
  standingRating: { alignItems: 'flex-end' },
  standingRatingValue: { fontSize: 15, lineHeight: 19, fontWeight: '900', fontVariant: ['tabular-nums'] },
  standingRatingLabel: { marginTop: 1, fontSize: 6, fontWeight: '900', letterSpacing: 0.65 },
  youBadge: { minHeight: 17, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  youText: { color: LIGHT.ink, fontSize: 6, fontWeight: '900' },
  loadingState: { minHeight: 380, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 11, fontSize: 9, fontWeight: '800' },
  errorCard: { minHeight: 310, marginTop: 18, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 26 },
  emptyCard: { minHeight: 250, marginTop: 24, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 25 },
  emptyIcon: { width: 54, height: 54, marginBottom: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  emptyTitle: { textAlign: 'center', fontSize: 18, lineHeight: 23, fontWeight: '900' },
  emptyText: { maxWidth: 290, marginTop: 6, textAlign: 'center', fontSize: 10, lineHeight: 16 },
  retryButton: { minHeight: 45, marginTop: 18, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  retryText: { color: LIGHT.ink, fontSize: 10, fontWeight: '900' },
  integrityNote: { maxWidth: 330, marginTop: 24, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  integrityText: { flexShrink: 1, fontSize: 8, lineHeight: 13 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
});
