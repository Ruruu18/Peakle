import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { webLayout } from '../utils/webLayout';
import { useTheme } from '../context/ThemeContext';
import { loadLeaderboard } from '../services/leaderboard';

const LIGHT = {
  ink: '#0E2321', paper: '#F7F8F5', surface: '#FFFFFF', muted: '#65716B',
  teal: '#1C6B66', line: '#E2E6DF', wash: '#EDF4F1', control: '#EEF0EB',
  gold: '#856520', goldWash: '#F5EEDB', silver: '#5C6870', silverWash: '#EEF0F2',
  bronze: '#8B624B', bronzeWash: '#F4ECE5',
};

const DARK = {
  ink: '#F3F5EF', paper: '#0E2321', surface: '#17302D', muted: '#A3B5AE',
  teal: '#83CFC4', line: '#304743', wash: '#203B37', control: '#203632',
  gold: '#E3C77D', goldWash: '#3E3928', silver: '#C0CAD1', silverWash: '#2E3C40',
  bronze: '#DDB497', bronzeWash: '#3E332D',
};

function ScopeControl({ active, icon, label, onPress, palette, compact }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} rankings`}
      aria-pressed={active}
      onPress={onPress}
      style={({ pressed }) => [
        styles.scopeControl,
        active && { backgroundColor: palette.surface, borderColor: palette.line },
        pressed && styles.pressed,
      ]}
    >
      {!compact ? <Ionicons name={icon} size={15} color={active ? palette.ink : palette.muted} /> : null}
      <Text style={[styles.controlText, { color: active ? palette.ink : palette.muted }]}>{label}</Text>
    </Pressable>
  );
}

function FormatControl({ active, label, onPress, palette }) {
  return (
    <Pressable
      accessibilityRole="tab"
      aria-selected={active}
      onPress={onPress}
      style={({ pressed }) => [
        styles.formatControl,
        { borderBottomColor: active ? palette.teal : 'transparent' },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.formatText, { color: active ? palette.ink : palette.muted }]}>{label}</Text>
    </Pressable>
  );
}

function YourStanding({ player, formatLabel, areaLabel, palette, wide, featured }) {
  const ranked = player?.rank != null;
  const stats = [
    { label: 'Rating', value: player?.rating != null ? player.rating.toFixed(3) : '—' },
    { label: 'Win–loss', value: `${player?.wins || 0}–${player?.losses || 0}` },
    { label: 'Verified', value: player?.verifiedMatches || 0 },
  ];

  if (featured) {
    return (
      <View testID="leaderboard-standing" style={[styles.featuredStanding, { backgroundColor: palette.surface, borderColor: palette.line }]}>
        <View style={styles.featuredHeading}>
          <Text style={[styles.personalTitle, { color: palette.ink }]}>Your standing</Text>
          <Ionicons name="person-outline" size={17} color={palette.muted} />
        </View>
        <View style={styles.featuredIdentity}>
          <ProfilePhoto photo={player?.avatar} name={player?.name} size={38} />
          <View style={styles.personalCopy}>
            <Text numberOfLines={1} style={[styles.personalTitle, { color: palette.ink }]}>{player?.name || 'Player'}</Text>
            <Text numberOfLines={1} style={[styles.personalContext, { color: palette.muted }]}>{formatLabel} · {areaLabel}</Text>
          </View>
        </View>
        <View style={styles.featuredRankRow}>
          <Text style={[styles.featuredRank, { color: palette.ink }]}>{ranked ? `#${player.rank}` : '—'}</Text>
          <Text style={[styles.featuredRankLabel, { color: palette.muted }]}>{ranked ? 'Your rank' : 'Unranked'}</Text>
        </View>
        <View style={[styles.featuredStats, { borderColor: palette.line }]}>
          {stats.map(({ label, value }) => (
            <View key={label} style={styles.featuredStat}>
              <Text style={[styles.personalStatValue, { color: palette.ink }]}>{value}</Text>
              <Text style={[styles.personalStatLabel, { color: palette.muted }]}>{label}</Text>
            </View>
          ))}
        </View>
        {!ranked ? <Text style={[styles.unrankedHint, { color: palette.muted }]}>Complete a verified match to earn your place.</Text> : null}
      </View>
    );
  }

  return (
    <View testID="leaderboard-standing" style={[styles.personalCard, wide && styles.personalCardWide, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={[styles.personalIdentity, wide && styles.personalIdentityWide]}>
        <ProfilePhoto photo={player?.avatar} name={player?.name} size={40} />
        <View style={styles.personalCopy}>
          <Text style={[styles.personalTitle, { color: palette.ink }]}>Your standing</Text>
          <Text numberOfLines={1} style={[styles.personalContext, { color: palette.muted }]}>{formatLabel} · {areaLabel}</Text>
        </View>
        <View style={styles.personalRank}>
          <Text style={[styles.personalRankValue, { color: palette.teal }]}>{ranked ? `#${player.rank}` : '—'}</Text>
          <Text style={[styles.personalRankLabel, { color: palette.muted }]}>{ranked ? 'Rank' : 'Unranked'}</Text>
        </View>
      </View>
      <View style={[
        styles.personalStats,
        { borderColor: palette.line },
        wide && styles.personalStatsWide,
      ]}>
        {stats.map(({ label, value }) => (
          <View key={label} style={styles.personalStat}>
            <Text style={[styles.personalStatValue, { color: palette.ink }]}>{value}</Text>
            <Text style={[styles.personalStatLabel, { color: palette.muted }]}>{label}</Text>
          </View>
        ))}
      </View>
      {!ranked ? <Text style={[styles.unrankedHint, wide && styles.unrankedHintWide, { color: palette.muted }]}>Complete a verified match to earn your place.</Text> : null}
    </View>
  );
}

function RankNumber({ rank, palette }) {
  const medal = {
    1: { color: palette.gold, backgroundColor: palette.goldWash },
    2: { color: palette.silver, backgroundColor: palette.silverWash },
    3: { color: palette.bronze, backgroundColor: palette.bronzeWash },
  }[rank];
  return (
    <View style={styles.rankColumn}>
      <View style={[styles.rankNumber, medal && { backgroundColor: medal.backgroundColor }]}>
        <Text style={[styles.rankText, { color: medal?.color || palette.muted }]}>{rank}</Text>
      </View>
    </View>
  );
}

function StandingRow({ player, currentUserId, palette, wide }) {
  const isYou = player.id === currentUserId;
  return (
    <View style={[
      styles.standingRow,
      wide && styles.standingRowWide,
      { borderTopColor: palette.line },
      isYou && { backgroundColor: palette.wash },
    ]}>
      {isYou ? <View style={[styles.currentPlayerMarker, { backgroundColor: palette.teal }]} /> : null}
      <RankNumber rank={player.rank} palette={palette} />
      <View style={styles.playerColumn}>
        <ProfilePhoto photo={player.avatar} name={player.name} size={36} />
        <View style={styles.standingCopy}>
          <View style={styles.standingNameLine}>
            <Text numberOfLines={1} style={[styles.standingName, { color: palette.ink }]}>{player.name}</Text>
            {isYou ? <Text style={[styles.youLabel, { color: palette.teal }]}>You</Text> : null}
          </View>
          <Text numberOfLines={1} style={[styles.standingMeta, { color: palette.muted }]}>
            {wide ? (player.area || '—') : `${player.wins}–${player.losses} · ${player.verifiedMatches} verified`}
          </Text>
        </View>
      </View>
      {wide ? <>
        <Text style={[styles.matchesColumn, styles.tableNumber, { color: palette.muted }]}>{player.verifiedMatches}</Text>
        <Text style={[styles.recordColumn, styles.tableNumber, { color: palette.ink }]}>{player.wins}–{player.losses}</Text>
      </> : null}
      <Text style={[styles.ratingColumn, styles.standingRating, { color: palette.ink }]}>{player.rating.toFixed(3)}</Text>
    </View>
  );
}

function Standings({ standings, currentUserId, palette, wide }) {
  return (
    <View testID="leaderboard-table" style={[styles.standingsCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={[styles.tableHeader, wide && styles.tableHeaderWide]}>
        <Text style={[styles.rankColumn, styles.columnLabel, { color: palette.muted }]}>#</Text>
        <Text style={[styles.playerColumn, styles.columnLabel, { color: palette.muted }]}>Player</Text>
        {wide ? <>
          <Text style={[styles.matchesColumn, styles.columnLabel, { color: palette.muted }]}>Verified</Text>
          <Text style={[styles.recordColumn, styles.columnLabel, { color: palette.muted }]}>Win–loss</Text>
        </> : null}
        <View style={[styles.ratingColumn, styles.ratingHeading]}>
          <Text style={[styles.columnLabel, { color: palette.muted }]}>Rating</Text>
          <Ionicons name="arrow-down" size={12} color={palette.muted} />
        </View>
      </View>
      {standings.map((player) => (
        <StandingRow key={player.id} player={player} currentUserId={currentUserId} palette={palette} wide={wide} />
      ))}
    </View>
  );
}

function EmptyState({ format, palette }) {
  return (
    <View style={[styles.stateCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <Ionicons name="podium-outline" size={30} color={palette.teal} />
      <Text style={[styles.stateTitle, { color: palette.ink }]}>No rankings yet</Text>
      <Text style={[styles.stateText, { color: palette.muted }]}>Players will appear here after their first verified {format} match.</Text>
    </View>
  );
}

export default function LeaderboardScreen({ navigation, route }) {
  const { isDark } = useTheme();
  const palette = isDark ? DARK : LIGHT;
  const width = useResponsiveWidth();
  const wide = width >= 760;
  const defaultFormat = route?.params?.defaultFormat === 'singles' ? 'singles' : 'doubles';
  const [scope, setScope] = useState('local');
  const [format, setFormat] = useState(defaultFormat);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let active = true;
    const refreshOnly = Boolean(data);
    if (refreshOnly) setRefreshing(true);
    else setLoading(true);
    setError('');
    loadLeaderboard({ scope, format })
      .then((next) => { if (active) setData(next); })
      .catch((nextError) => { if (active) setError(nextError.message || 'The leaderboard could not be loaded.'); })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => { active = false; };
  }, [format, request, scope]);

  const refresh = useCallback(() => setRequest((value) => value + 1), []);
  const changeScope = useCallback((nextScope) => {
    if (nextScope === scope) return;
    setLoading(true);
    setData(null);
    setScope(nextScope);
  }, [scope]);
  const changeFormat = useCallback((nextFormat) => {
    if (nextFormat === format) return;
    setLoading(true);
    setData(null);
    setFormat(nextFormat);
  }, [format]);
  const standings = data?.standings || [];
  const effectiveScope = data?.scope || scope;
  const areaLabel = effectiveScope === 'local' ? (data?.homeArea || data?.area || 'Local area') : 'Global';
  const formatLabel = format === 'singles' ? 'Singles' : 'Doubles';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={palette.paper} />
      <View style={[styles.topbar, styles.container, wide && styles.topbarWide]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={22} color={palette.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>Leaderboard</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh leaderboard" aria-disabled={loading || refreshing} disabled={loading || refreshing} onPress={refresh} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          {loading || refreshing ? <ActivityIndicator size="small" color={palette.teal} /> : <Ionicons name="refresh-outline" size={21} color={palette.muted} />}
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, styles.container, wide && styles.contentWide]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.teal} colors={[palette.teal]} progressBackgroundColor={palette.surface} />}
      >
        <Text style={[styles.intro, { color: palette.muted }]}>Player rankings from verified match results.</Text>
        <View style={[styles.filters, { borderBottomColor: palette.line }, wide && styles.filtersWide]}>
          <View accessibilityRole="tablist" accessibilityLabel="Match format" style={styles.formatBar}>
            <FormatControl active={format === 'doubles'} label="Doubles" onPress={() => changeFormat('doubles')} palette={palette} />
            <FormatControl active={format === 'singles'} label="Singles" onPress={() => changeFormat('singles')} palette={palette} />
          </View>
          <View accessibilityLabel="Ranking area" style={[styles.scopeControls, { backgroundColor: palette.control }]}>
            <ScopeControl active={effectiveScope === 'local'} icon="location-outline" label="Local" onPress={() => changeScope('local')} palette={palette} compact={width < 360} />
            <ScopeControl active={effectiveScope === 'global'} icon="globe-outline" label="Global" onPress={() => changeScope('global')} palette={palette} compact={width < 360} />
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={palette.teal} />
            <Text accessibilityLiveRegion="polite" style={[styles.loadingText, { color: palette.muted }]}>Loading rankings…</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View accessibilityLiveRegion="polite" style={[styles.stateCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
            <Ionicons name="cloud-offline-outline" size={30} color={palette.teal} />
            <Text style={[styles.stateTitle, { color: palette.ink }]}>Standings unavailable</Text>
            <Text style={[styles.stateText, { color: palette.muted }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refresh} style={({ pressed }) => [styles.retryButton, { backgroundColor: palette.teal }, pressed && styles.pressed]}>
              <Text style={[styles.retryText, { color: palette.surface }]}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && data ? (
          <View {...webLayout('leaderboard')}>
            <View style={[styles.overview, wide && standings.length > 0 && styles.overviewWide]}>
              {standings.length ? (
                <View style={styles.podiumSection}>
                  <View style={styles.podiumHeading}>
                    <View style={styles.sectionCopy}>
                      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.ink }]}>Top competitors</Text>
                      <Text style={[styles.sectionMeta, { color: palette.muted }]}>{formatLabel} · {areaLabel}</Text>
                    </View>
                    <Text style={[styles.podiumRatingLabel, { color: palette.muted }]}>PLAYER RATING</Text>
                  </View>
                  <LeaderboardPodium players={standings.slice(0, 3)} currentUserId={data.user?.id} isDark={isDark} wide={wide} />
                </View>
              ) : null}
              <YourStanding player={data.user} formatLabel={formatLabel} areaLabel={areaLabel} palette={palette} wide={wide} featured={wide && standings.length > 0} />
            </View>
            <View style={styles.sectionHead}>
              <View style={styles.sectionCopy}>
                <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.ink }]}>{formatLabel} standings</Text>
                <Text style={[styles.sectionMeta, { color: palette.muted }]}>{areaLabel} · {standings.length} {standings.length === 1 ? 'player' : 'players'} shown</Text>
              </View>
              <View style={styles.verifiedLabel}>
                <Ionicons name="shield-checkmark-outline" size={15} color={palette.teal} />
                <Text style={[styles.verifiedText, { color: palette.muted }]}>Verified</Text>
              </View>
            </View>
            {standings.length ? (
              <Standings standings={standings} currentUserId={data.user?.id} palette={palette} wide={wide} />
            ) : <EmptyState format={format} palette={palette} />}
            <Text style={[styles.integrityText, { color: palette.muted }]}>Ranked by rating. Only confirmed competitive matches count.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  container: { width: '100%', maxWidth: 1040, alignSelf: 'center' },
  topbar: { minHeight: 74, paddingTop: 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  topbarWide: { paddingTop: 20, paddingHorizontal: 24, minHeight: 88 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 26, lineHeight: 34, fontWeight: '600', letterSpacing: -0.8 },
  content: { paddingHorizontal: 20, paddingBottom: 36 },
  contentWide: { paddingHorizontal: 32, paddingBottom: 48 },
  intro: { fontSize: 13, lineHeight: 20, marginBottom: 20 },
  filters: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, marginBottom: 24, gap: 8, paddingBottom: 0 },
  filtersWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 0 },
  formatBar: { flexDirection: 'row', gap: 18 },
  formatControl: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, paddingHorizontal: 2 },
  formatText: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  scopeControls: { flexDirection: 'row', borderRadius: 9, padding: 3 },
  scopeControl: { minHeight: 40, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 7, borderWidth: 1, borderColor: 'transparent' },
  controlText: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  overview: { gap: 24 },
  overviewWide: { flexDirection: 'row', alignItems: 'center', gap: 36 },
  podiumSection: { flex: 1, minWidth: 0 },
  podiumHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  podiumRatingLabel: { fontSize: 9, lineHeight: 14, fontWeight: '600', letterSpacing: 0.7 },
  featuredStanding: { width: 272, padding: 22, borderWidth: 1, borderRadius: 16, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  featuredHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  featuredIdentity: { marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 10 },
  featuredRankRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 26, marginBottom: 24 },
  featuredRank: { fontSize: 54, lineHeight: 60, fontWeight: '600', letterSpacing: -2.5, fontVariant: ['tabular-nums'] },
  featuredRankLabel: { fontSize: 11, lineHeight: 16 },
  featuredStats: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 20, gap: 8 },
  featuredStat: { flex: 1, gap: 5 },
  personalCard: { padding: 16, borderWidth: 1, borderRadius: 12 },
  personalCardWide: { padding: 22, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 24 },
  personalIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personalIdentityWide: { flex: 1, minWidth: 0 },
  personalCopy: { flex: 1, minWidth: 0 },
  personalTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  personalContext: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  personalRank: { alignItems: 'flex-end' },
  personalRankValue: { fontSize: 26, lineHeight: 30, fontWeight: '600', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  personalRankLabel: { marginTop: 2, fontSize: 10, lineHeight: 14 },
  personalStats: { flexDirection: 'row', borderTopWidth: 1, marginTop: 16, paddingTop: 14 },
  personalStatsWide: { flex: 1, borderTopWidth: 0, borderLeftWidth: 1, marginTop: 0, paddingTop: 0, paddingLeft: 16 },
  personalStat: { flex: 1, alignItems: 'center', gap: 4 },
  personalStatValue: { fontSize: 18, lineHeight: 23, fontWeight: '600', fontVariant: ['tabular-nums'] },
  personalStatLabel: { fontSize: 11, lineHeight: 16 },
  unrankedHint: { marginTop: 14, fontSize: 12, lineHeight: 18 },
  unrankedHintWide: { width: '100%' },
  sectionHead: { marginTop: 28, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 19, lineHeight: 26, fontWeight: '600', letterSpacing: -0.35 },
  sectionMeta: { marginTop: 4, fontSize: 12, lineHeight: 18 },
  verifiedLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifiedText: { fontSize: 11, lineHeight: 16 },
  standingsCard: { overflow: 'hidden', borderWidth: 1, borderRadius: 12 },
  tableHeader: { minHeight: 42, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  tableHeaderWide: { paddingHorizontal: 20, gap: 16, minHeight: 46 },
  columnLabel: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  rankColumn: { width: 28, textAlign: 'center', alignItems: 'center' },
  rankNumber: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 13, lineHeight: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  playerColumn: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  matchesColumn: { width: 76, textAlign: 'right' },
  recordColumn: { width: 86, textAlign: 'right' },
  ratingColumn: { width: 58, textAlign: 'right' },
  ratingHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  standingRow: { minHeight: 76, paddingHorizontal: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  standingRowWide: { paddingHorizontal: 20, gap: 16 },
  currentPlayerMarker: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  standingCopy: { flex: 1, minWidth: 0 },
  standingNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  standingName: { flexShrink: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  youLabel: { fontSize: 10, lineHeight: 16, fontWeight: '600' },
  standingMeta: { marginTop: 3, fontSize: 10, lineHeight: 16 },
  tableNumber: { fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
  standingRating: { fontSize: 15, lineHeight: 21, fontWeight: '600', fontVariant: ['tabular-nums'] },
  integrityText: { marginTop: 16, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  loadingState: { minHeight: 300, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 13, lineHeight: 20 },
  stateCard: { minHeight: 230, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  stateTitle: { marginTop: 16, textAlign: 'center', fontSize: 18, lineHeight: 24, fontWeight: '600' },
  stateText: { maxWidth: 300, marginTop: 8, textAlign: 'center', fontSize: 13, lineHeight: 20 },
  retryButton: { minHeight: 44, marginTop: 20, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  retryText: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
