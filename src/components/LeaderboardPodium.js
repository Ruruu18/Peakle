import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Polygon } from 'react-native-svg';
import ProfilePhoto from './ProfilePhoto';

const LIGHT = {
  ink: '#0E2321', muted: '#65716B', line: '#D9E2D9',
  step: '#DDE8E0', stepTop: '#EDF2EC', stepEdge: '#CDDBD1', ring: '#C4D5CA',
};
const DARK = {
  ink: '#F3F5EF', muted: '#A3B5AE', line: '#304743',
  step: '#2B4840', stepTop: '#3B584F', stepEdge: '#233E37', ring: '#547166',
};

function Crown({ color }) {
  return (
    <Svg width={22} height={18} viewBox="0 0 24 20" aria-hidden>
      <Path d="M3 5.5 7.5 9 12 2l4.5 7L21 5.5 18.5 16h-13L3 5.5Z" fill={color} />
      <Path d="M6 19h12" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

function PodiumPlayer({ player, currentUserId, palette, wide }) {
  const champion = player.rank === 1;
  const height = ({ 1: wide ? 124 : 96, 2: wide ? 90 : 70, 3: wide ? 64 : 50 })[player.rank] || 50;
  const isYou = player.id === currentUserId;
  const rating = player.rating.toFixed(3);
  const cap = champion ? '#E6F29B' : palette.stepTop;
  const face = champion ? '#D6E94A' : palette.step;
  const edge = champion ? '#C2D43C' : palette.stepEdge;

  return (
    <View
      testID={`podium-player-${player.id}`}
      accessible
      accessibilityLabel={`Rank ${player.rank}, ${player.name}${isYou ? ', you' : ''}, rating ${rating}, ${player.wins} wins and ${player.losses} losses`}
      style={styles.player}
    >
      <View style={[styles.identity, wide && styles.identityWide]}>
        {champion ? <View style={styles.crown}><Crown color={palette.ink} /></View> : null}
        <View style={[styles.avatarRing, { borderColor: champion ? '#A7B92E' : palette.ring }]}>
          <ProfilePhoto photo={player.avatar} name={player.name} size={wide ? (champion ? 64 : 52) : (champion ? 52 : 44)} />
        </View>
        <Text numberOfLines={2} style={[styles.name, wide && styles.nameWide, { color: palette.ink }]}>{player.name}{isYou ? ' · You' : ''}</Text>
        <Text style={[styles.rating, wide && styles.ratingWide, { color: palette.ink }]}>{rating}</Text>
      </View>
      <View testID={`podium-step-${player.id}`} style={styles.step}>
        <Svg width="100%" height={wide ? 12 : 9} viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
          <Polygon points="0,12 10,0 110,0 120,12" fill={cap} />
        </Svg>
        <View style={[styles.face, { height, backgroundColor: face }]}>
          <View style={[styles.edge, { backgroundColor: edge }]} />
          <Text style={[styles.rank, wide && styles.rankWide, { color: champion ? '#183D31' : palette.ink }]}>{player.rank}</Text>
        </View>
      </View>
    </View>
  );
}

export default function LeaderboardPodium({ players, currentUserId, isDark, wide = false }) {
  if (!players.length) return null;
  const palette = isDark ? DARK : LIGHT;
  // Keep the leader in the center even when only one or two players are ranked.
  // Display the service's actual ranks so tied ratings remain tied on the podium.
  const ordered = [players[1], players[0], players[2]];
  const tied = new Set(players.slice(0, 3).map((player) => player.rank)).size < Math.min(players.length, 3);

  return (
    <View testID="leaderboard-podium" style={styles.container}>
      <View style={[styles.stage, wide && styles.stageWide, { borderBottomColor: palette.line }]}>
        {ordered.map((player, index) => player ? (
          <PodiumPlayer key={player.id} player={player} currentUserId={currentUserId} palette={palette} wide={wide} />
        ) : <View key={`empty-${index}`} style={styles.player} />)}
      </View>
      {tied ? <Text style={[styles.tieNote, { color: palette.muted }]}>Equal ratings share a rank.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  stage: { width: '100%', maxWidth: 440, alignSelf: 'center', paddingTop: 28, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1 },
  stageWide: { maxWidth: 520, paddingTop: 36, paddingHorizontal: 14 },
  player: { flex: 1, minWidth: 0, alignItems: 'center' },
  identity: { width: '100%', paddingHorizontal: 4, paddingBottom: 12, alignItems: 'center' },
  identityWide: { paddingHorizontal: 8, paddingBottom: 16 },
  crown: { position: 'absolute', top: -25, alignSelf: 'center' },
  avatarRing: { padding: 3, borderWidth: 1, borderRadius: 50 },
  name: { width: '100%', marginTop: 9, minHeight: 32, textAlign: 'center', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  nameWide: { fontSize: 14, lineHeight: 19, minHeight: 38 },
  rating: { marginTop: 5, fontSize: 19, lineHeight: 24, fontWeight: '600', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  ratingWide: { marginTop: 6, fontSize: 22, lineHeight: 28 },
  step: { width: '100%' },
  face: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  edge: { position: 'absolute', top: 0, right: 0, bottom: 0, width: 3 },
  rank: { fontSize: 42, lineHeight: 50, fontWeight: '600', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  rankWide: { fontSize: 60, lineHeight: 66, letterSpacing: -3 },
  tieNote: { marginTop: 12, textAlign: 'center', fontSize: 11, lineHeight: 16 },
});
