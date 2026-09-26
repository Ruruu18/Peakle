import React, { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';
import ProfilePhoto from './ProfilePhoto';
import { dropShadow } from '../utils/shadow';

const LIGHT = {
  ink: '#0E2321', muted: '#65716B', ring: '#C4D5CA', avatar: '#F7F8F5',
  glow: '#DDEB9C', floorTop: '#EAF0E7', floorFront: '#CCD9CE', floorEdge: '#B9CBBE',
  floorLine: '#FFFFFF', shadow: '#173E30',
  second: { top: '#F0F5ED', start: '#DCE8DD', end: '#B7CEC0', side: '#96B4A2', edge: '#F7FAF3' },
  third: { top: '#F0F0E5', start: '#E1E4D5', end: '#C3CBB5', side: '#A2AF95', edge: '#F9FAEE' },
};
const DARK = {
  ink: '#F3F5EF', muted: '#A3B5AE', ring: '#547166', avatar: '#17302D',
  glow: '#748E36', floorTop: '#28443A', floorFront: '#1A322B', floorEdge: '#112A23',
  floorLine: '#5F7F69', shadow: '#020E09',
  second: { top: '#527365', start: '#3C5D50', end: '#253F34', side: '#193529', edge: '#72917A' },
  third: { top: '#616E51', start: '#4A5840', end: '#303E2C', side: '#24311F', edge: '#818E6A' },
};
const CHAMPION = { top: '#EEF9AD', start: '#E0F16A', end: '#B8D439', side: '#8EA827', edge: '#FAFFCF' };

function Crown() {
  return (
    <Svg width={24} height={22} viewBox="0 0 24 22" aria-hidden accessible={false}>
      <Path d="m3 6 4.5 3.5L12 3l4.5 6.5L21 6l-2.5 11h-13L3 6Z" fill="#D6E94A" stroke="#8EA827" strokeWidth={1.1} strokeLinejoin="round" />
      <Path d="M6 20h12" stroke="#A2B731" strokeWidth={1.8} strokeLinecap="round" />
      <Path d="m10 12 2-2 2 2-2 2-2-2Z" fill="#F9FFD4" />
    </Svg>
  );
}

function StageFloor({ palette, id }) {
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.floor, { pointerEvents: 'none' }]}>
      <Svg width="100%" height="100%" viewBox="0 0 520 70" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`${id}-floor`} x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor={palette.floorTop} />
            <Stop offset="1" stopColor={palette.floorFront} />
          </LinearGradient>
          <RadialGradient id={`${id}-shadow`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={palette.shadow} stopOpacity={0.26} />
            <Stop offset="0.65" stopColor={palette.shadow} stopOpacity={0.12} />
            <Stop offset="1" stopColor={palette.shadow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx="260" cy="51" rx="258" ry="19" fill={`url(#${id}-shadow)`} />
        <Path d="M8 36 36 9h448l28 27v10H8Z" fill={palette.floorEdge} />
        <Polygon points="8,36 36,9 484,9 512,36" fill={`url(#${id}-floor)`} />
        <Path d="M8 36h504" stroke={palette.floorLine} strokeOpacity={0.6} />
        <Path d="M9 38h502v4H9Z" fill={palette.floorFront} />
      </Svg>
    </View>
  );
}

function PodiumStep({ player, palette, wide, id }) {
  const champion = player.rank === 1;
  const material = champion ? CHAMPION : player.rank === 2 ? palette.second : palette.third;
  const height = ({ 1: wide ? 148 : 116, 2: wide ? 110 : 86, 3: wide ? 80 : 62 })[player.rank] || 62;
  const depth = wide ? 24 : 18;
  const totalHeight = height + depth;

  return (
    <View testID={`podium-step-${player.id}`} style={[styles.step, { height: totalHeight }]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox={`0 0 120 ${totalHeight}`} preserveAspectRatio="none" aria-hidden accessible={false}>
        <Defs>
          <LinearGradient id={`${id}-front`} x1="0%" y1="0%" x2="80%" y2="100%">
            <Stop offset="0" stopColor={material.start} />
            <Stop offset="1" stopColor={material.end} />
          </LinearGradient>
          <LinearGradient id={`${id}-side`} x1="0%" y1="0%" x2="100%" y2="80%">
            <Stop offset="0" stopColor={material.side} />
            <Stop offset="1" stopColor={material.end} />
          </LinearGradient>
          <LinearGradient id={`${id}-top`} x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor={material.top} />
            <Stop offset="1" stopColor={material.start} />
          </LinearGradient>
        </Defs>
        {/* A shared projection keeps the top and right faces consistent at every rank. */}
        <Polygon points={`2,${depth} 16,1 118,1 104,${depth}`} fill={`url(#${id}-top)`} />
        <Polygon points={`104,${depth} 118,1 118,${height} 104,${totalHeight - 1}`} fill={`url(#${id}-side)`} />
        <Path d={`M2 ${depth}h102v${height - 1}H2Z`} fill={`url(#${id}-front)`} />
        <Path d={`M2 ${depth} 16 1h102M2 ${depth}h102L118 1`} fill="none" stroke={material.edge} strokeWidth={0.8} strokeLinejoin="round" />
        <Path d={`M3 ${depth + 1}v${height - 3}`} stroke={material.edge} strokeOpacity={0.55} />
        <Path d={`M104 ${depth + 1}v${height - 2}`} stroke={material.side} strokeOpacity={0.45} />
        <Path d={`M3 ${totalHeight - 2}h100`} stroke={material.side} strokeOpacity={0.35} />
      </Svg>
      <View style={[styles.face, { top: depth, right: '13%' }]}>
        <Text style={[styles.rank, wide && styles.rankWide, { color: champion ? '#294518' : palette.ink }]}>{player.rank}</Text>
        <View style={[styles.rankUnderline, { backgroundColor: champion ? '#668020' : palette.ring }]} />
      </View>
    </View>
  );
}

function PodiumPlayer({ player, currentUserId, palette, wide, id }) {
  const champion = player.rank === 1;
  const isYou = player.isMember || player.id === currentUserId;
  // Teams rank by record rather than rating, so rows may carry their own display value.
  const rating = player.display ?? player.rating.toFixed(3);

  return (
    <View
      testID={`podium-player-${player.id}`}
      accessible
      accessibilityLabel={`Rank ${player.rank}, ${player.name}${isYou ? (player.isMember ? ', your team' : ', you') : ''}${player.display == null ? `, rating ${rating}` : ''}, ${player.wins} wins and ${player.losses} losses`}
      style={styles.player}
    >
      <View style={[styles.identity, wide && styles.identityWide]}>
        {champion ? <View style={styles.crown}><Crown /></View> : null}
        <View style={[
          styles.avatarRing,
          { borderColor: champion ? '#A7BD35' : palette.ring, backgroundColor: palette.avatar },
          champion && styles.championRing,
        ]}>
          <ProfilePhoto photo={player.avatar} name={player.name} size={wide ? (champion ? 64 : 52) : (champion ? 52 : 44)} />
        </View>
        <Text numberOfLines={2} style={[styles.name, wide && styles.nameWide, { color: palette.ink }]}>{player.name}{isYou ? (player.isMember ? ' · Your team' : ' · You') : ''}</Text>
        <Text style={[styles.rating, wide && styles.ratingWide, { color: palette.ink }]}>{rating}</Text>
      </View>
      <PodiumStep player={player} palette={palette} wide={wide} id={id} />
    </View>
  );
}

export default function LeaderboardPodium({ players, currentUserId, isDark, wide = false, tieNote = 'Equal ratings share a rank.' }) {
  const id = `podium-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (!players.length) return null;
  const palette = isDark ? DARK : LIGHT;
  // Keep the leader centered with one or two entries. Actual ranks determine
  // the heights and materials, so tied players receive equal podium heights.
  const ordered = [players[1], players[0], players[2]];
  const tied = new Set(players.slice(0, 3).map((player) => player.rank)).size < Math.min(players.length, 3);

  return (
    <View testID="leaderboard-podium" style={styles.container}>
      <View style={[styles.stage, wide && styles.stageWide]}>
        <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.spotlight, { pointerEvents: 'none' }]}>
          <Svg width="100%" height="100%" viewBox="0 0 520 340" preserveAspectRatio="none">
            <Defs>
              <RadialGradient id={`${id}-glow`} cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor={palette.glow} stopOpacity={isDark ? 0.22 : 0.36} />
                <Stop offset="1" stopColor={palette.glow} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx="260" cy="170" rx="248" ry="165" fill={`url(#${id}-glow)`} />
          </Svg>
        </View>
        <StageFloor palette={palette} id={id} />
        <View style={[styles.players, wide && styles.playersWide]}>
          {ordered.map((player, index) => player ? (
            <PodiumPlayer key={player.id} player={player} currentUserId={currentUserId} palette={palette} wide={wide} id={`${id}-${index}`} />
          ) : <View key={`empty-${index}`} style={styles.player} />)}
        </View>
      </View>
      {tied ? <Text style={[styles.tieNote, { color: palette.muted }]}>{tieNote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  stage: { width: '100%', maxWidth: 440, alignSelf: 'center', paddingTop: 32, paddingBottom: 32 },
  stageWide: { maxWidth: 540, paddingTop: 36 },
  spotlight: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 32 },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  players: { marginHorizontal: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  playersWide: { marginHorizontal: 22, gap: 4 },
  player: { flex: 1, minWidth: 0, alignItems: 'center' },
  identity: { width: '100%', paddingHorizontal: 2, paddingBottom: 12, alignItems: 'center' },
  identityWide: { paddingHorizontal: 5, paddingBottom: 16 },
  crown: { position: 'absolute', top: -28, alignSelf: 'center' },
  avatarRing: { padding: 4, borderWidth: 1, borderRadius: 50 },
  championRing: { ...dropShadow({ color: '#758B26', opacity: 0.18, radius: 9, y: 4 }) },
  name: { width: '100%', marginTop: 9, minHeight: 32, textAlign: 'center', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  nameWide: { fontSize: 14, lineHeight: 19, minHeight: 38 },
  rating: { marginTop: 4, fontSize: 19, lineHeight: 24, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  ratingWide: { marginTop: 6, fontSize: 23, lineHeight: 28 },
  step: { width: '100%' },
  face: { position: 'absolute', left: 2, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  rank: { fontSize: 40, lineHeight: 48, fontWeight: '700', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  rankWide: { fontSize: 54, lineHeight: 62, letterSpacing: -3 },
  rankUnderline: { width: 18, height: 2, borderRadius: 1, marginTop: 3, opacity: 0.45 },
  tieNote: { marginTop: 4, textAlign: 'center', fontSize: 11, lineHeight: 16 },
});
