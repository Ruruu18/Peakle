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
import useResponsiveWidth from '../hooks/useResponsiveWidth';
import { useTheme } from '../context/ThemeContext';
import { loadLeaderboard } from '../services/leaderboard';

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
    <View style={[styles.hero, { backgroundColor: palette.hero }]}>
      <View pointerEvents="none" style={styles.heroCourt}>
        <View style={styles.heroCourtLine} />
        <View style={[styles.heroCourtLine, styles.heroCourtLineMiddle]} />
        <View style={[styles.heroCourtLine, styles.heroCourtLineVertical]} />
      </View>
      <View style={styles.heroTop}>
        <View style={styles.heroIdentity}>
          <View style={styles.heroAvatar}>
            <ProfilePhoto photo={player?.avatar} name={player?.name} size={54} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>YOUR {format.toUpperCase()} STANDING</Text>
            <Text numberOfLines={1} style={styles.heroName}>{player?.name || 'Player'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.heroRankRow}>
        <Text style={styles.heroRank}>{ranked ? `#${player.rank}` : '—'}</Text>
        <View style={styles.heroRankCopy}>
          <Text style={styles.heroRankLabel}>{ranked ? `IN ${areaLabel.toUpperCase()}` : 'NOT RANKED YET'}</Text>
          <Text style={styles.heroRankHint}>{ranked ? 'Based on verified match results' : 'Complete a verified match to enter the standings'}</Text>
        </View>
      </View>

      <View style={styles.heroStats}>
        <View style={styles.heroStat}>
          <Text style={styles.heroStatValue}>{rating}</Text>
          <Text style={styles.heroStatLabel}>RATING</Text>
        </View>
        <View style={styles.heroStatDivider} />
        <View style={styles.heroStat}>
          <Text style={styles.heroStatValue}>{record}</Text>
          <Text style={styles.heroStatLabel}>RECORD</Text>
        </View>
        <View style={styles.heroStatDivider} />
        <View style={styles.heroStat}>
          <Text style={styles.heroStatValue}>{player?.verifiedMatches || 0}</Text>
          <Text style={styles.heroStatLabel}>VERIFIED</Text>
        </View>
      </View>
    </View>
  );
}

function PodiumPlayer({ player, currentUserId, place, palette }) {
  const champion = player.rank === 1;
  const isYou = player.id === currentUserId;
  return (
    <View style={[styles.podiumPlayer, champion && styles.podiumChampion]}>
      <View style={[styles.placeBadge, { backgroundColor: champion ? palette.optic : palette.wash, borderColor: champion ? palette.optic : palette.line }]}>
        <Text style={[styles.placeText, { color: champion ? LIGHT.ink : palette.ink }]}>{place}</Text>
      </View>
      <View style={[styles.podiumAvatar, { borderColor: champion ? palette.optic : palette.line }]}>
        <ProfilePhoto photo={player.avatar} name={player.name} size={champion ? 60 : 50} />
      </View>
      <Text numberOfLines={1} style={[styles.podiumName, { color: palette.ink }]}>{isYou ? 'You' : player.name}</Text>
      <Text style={[styles.podiumRating, { color: palette.ink }]}>{player.rating.toFixed(3)}</Text>
      <Text style={[styles.podiumMeta, { color: palette.ink40 }]}>{player.wins}–{player.losses}</Text>
    </View>
  );
}

function Podium({ players, currentUserId, palette }) {
  if (!players.length) return null;
  const ordered = players.length === 3 ? [players[1], players[0], players[2]] : players;
  return (
    <View style={[styles.podiumCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={styles.podiumGlow} />
      {ordered.map((player) => (
        <PodiumPlayer key={player.id} player={player} currentUserId={currentUserId} place={player.rank} palette={palette} />
      ))}
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
  const topThree = useMemo(() => standings.slice(0, 3), [standings]);
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
          <Text style={[styles.eyebrow, { color: palette.teal }]}>VERIFIED PLAYER RANKINGS</Text>
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

        {!loading && !error && data ? (
          <>
            <RankHero data={data} format={format} areaLabel={areaLabel} palette={palette} />

            {standings.length ? (
              <>
                <View style={styles.sectionHead}>
                  <View>
                    <Text style={[styles.sectionEyebrow, { color: palette.teal }]}>THE PODIUM</Text>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>Top competitors</Text>
                  </View>
                  <View style={[styles.livePill, { backgroundColor: palette.wash }]}>
                    <View style={[styles.liveDot, { backgroundColor: palette.teal }]} />
                    <Text style={[styles.liveText, { color: palette.teal }]}>VERIFIED</Text>
                  </View>
                </View>
                <Podium players={topThree} currentUserId={data.user.id} palette={palette} />

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
              </>
            ) : <EmptyState format={format} palette={palette} />}

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
  wideContainer: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  topbar: { minHeight: 76, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 15 },
  titleCopy: { flex: 1, minWidth: 0, paddingHorizontal: 13 },
  eyebrow: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 1.05 },
  title: { marginTop: 1, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.7 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 48 },
  scopeBar: { minHeight: 66, padding: 7, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 20, ...shadow },
  scopeControls: { flexDirection: 'row', gap: 3 },
  control: { minHeight: 46, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 14 },
  controlText: { fontSize: 10, fontWeight: '900' },
  scopeDivider: { width: 1, height: 30, marginHorizontal: 10 },
  areaCopy: { flex: 1, minWidth: 0 },
  areaLabel: { fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: 0.8 },
  areaValue: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  formatBar: { height: 48, marginTop: 10, padding: 4, flexDirection: 'row', gap: 4, borderWidth: 1, borderRadius: 16 },
  formatControl: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  formatText: { fontSize: 11, fontWeight: '900' },
  hero: { minHeight: 264, marginTop: 18, overflow: 'hidden', padding: 20, borderRadius: 27, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, ...shadow },
  heroCourt: { position: 'absolute', right: -34, bottom: -34, width: 190, height: 190, opacity: 0.13, borderWidth: 2, borderColor: '#F3F5EF', transform: [{ rotate: '-8deg' }] },
  heroCourtLine: { position: 'absolute', top: '50%', right: 0, left: 0, height: 2, backgroundColor: '#F3F5EF' },
  heroCourtLineMiddle: { top: '27%' },
  heroCourtLineVertical: { top: 0, bottom: 0, left: '50%', width: 2, height: '100%' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  heroAvatar: { padding: 2, borderWidth: 2, borderColor: 'rgba(214,233,74,.9)', borderRadius: 31 },
  heroCopy: { flex: 1, minWidth: 0, marginLeft: 11 },
  heroEyebrow: { color: 'rgba(243,245,239,.58)', fontSize: 7, lineHeight: 11, fontWeight: '900', letterSpacing: 0.9 },
  heroName: { marginTop: 2, color: '#FFFFFF', fontSize: 14, lineHeight: 19, fontWeight: '900' },
  verifiedBadge: { minHeight: 29, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 15, backgroundColor: LIGHT.optic },
  verifiedText: { color: LIGHT.ink, fontSize: 6, fontWeight: '900', letterSpacing: 0.55 },
  heroRankRow: { marginTop: 24, flexDirection: 'row', alignItems: 'flex-end' },
  heroRank: { color: '#FFFFFF', fontSize: 55, lineHeight: 60, fontWeight: '900', letterSpacing: -2.8, fontVariant: ['tabular-nums'] },
  heroRankCopy: { flex: 1, minWidth: 0, marginLeft: 15, paddingBottom: 7 },
  heroRankLabel: { color: LIGHT.optic, fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 0.75 },
  heroRankHint: { marginTop: 3, color: 'rgba(243,245,239,.58)', fontSize: 8, lineHeight: 12 },
  heroStats: { minHeight: 64, marginTop: 18, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', borderRadius: 18, backgroundColor: 'rgba(255,255,255,.075)' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { color: '#FFFFFF', fontSize: 17, lineHeight: 21, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroStatLabel: { marginTop: 2, color: 'rgba(243,245,239,.48)', fontSize: 6, fontWeight: '900', letterSpacing: 0.75 },
  heroStatDivider: { width: 1, height: 27, backgroundColor: 'rgba(243,245,239,.14)' },
  sectionHead: { marginTop: 30, marginBottom: 11, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionEyebrow: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 0.95 },
  sectionTitle: { marginTop: 2, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.45 },
  livePill: { minHeight: 27, marginBottom: 3, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14 },
  liveDot: { width: 5, height: 5, borderRadius: 3 },
  liveText: { fontSize: 6, fontWeight: '900', letterSpacing: 0.65 },
  podiumCard: { minHeight: 190, overflow: 'hidden', paddingHorizontal: 8, paddingTop: 18, flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, ...shadow },
  podiumGlow: { position: 'absolute', top: -80, left: '30%', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(214,233,74,.10)' },
  podiumPlayer: { flex: 1, minWidth: 0, minHeight: 152, paddingBottom: 17, alignItems: 'center', justifyContent: 'flex-end' },
  podiumChampion: { minHeight: 172 },
  placeBadge: { minWidth: 25, height: 25, marginBottom: -6, zIndex: 2, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 13 },
  placeText: { fontSize: 9, fontWeight: '900' },
  podiumAvatar: { padding: 2, borderWidth: 2, borderRadius: 36 },
  podiumName: { maxWidth: '92%', marginTop: 8, fontSize: 10, lineHeight: 14, fontWeight: '900' },
  podiumRating: { marginTop: 3, fontSize: 14, lineHeight: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  podiumMeta: { marginTop: 1, fontSize: 7, lineHeight: 10, fontWeight: '700' },
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
