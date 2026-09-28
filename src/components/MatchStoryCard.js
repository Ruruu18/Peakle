import React, { forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

const BALL_IMAGE = require('../../public/images/ball.png');

// Logical size of the export card. captureRef scales it to 1080x1920 (9:16),
// the native size for Stories and My Day.
export const STORY_CARD_WIDTH = 360;
export const STORY_CARD_HEIGHT = 640;

const INK = '#0E2321';
const OPTIC = '#D6E94A';
const TEAL = '#1C6B66';
const BRICK = '#B6472E';
const MUTED = '#8EA19B';

function formatDuration(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Portrait match card that is only rendered off-screen for photo export, so it
 * uses its own fixed typography instead of the scaled phone styles.
 */
const MatchStoryCard = forwardRef(function MatchStoryCard({ result }, ref) {
  const games = result.gameScores?.length ? result.gameScores : [result.scores];
  const multiGame = games.length > 1;
  const headline = multiGame ? result.games : games[0];
  const totalPoints = games.reduce((total, game) => total + game[0] + game[1], 0);
  const winnerName = result.winner == null ? null : result.players[result.winner].join(' & ');
  const playedAt = new Date(result.endedAtTimestamp || Date.now());
  const dateLabel = playedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeLabel = playedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const formatLabel = `${result.matchType === 'singles' ? 'SINGLES' : 'DOUBLES'} · ${result.mode === 'ranked' ? 'RANKED' : 'CASUAL'}`;

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <View style={styles.brandRow}>
        <View style={styles.brand}>
          <Image source={BALL_IMAGE} style={styles.ball} tintColor={OPTIC} resizeMode="contain" />
          <Text style={styles.brandText}>PEAKLE</Text>
        </View>
        <View style={styles.finalPill}><View style={styles.finalDot} /><Text style={styles.finalText}>FINAL</Text></View>
      </View>

      <View style={styles.hero}>
        <Text style={styles.meta}>{formatLabel}</Text>
        <Text style={styles.heroLead}>{winnerName ? 'Victory for' : 'Match ends'}</Text>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.heroName}>{winnerName || 'Level'}</Text>
      </View>

      <View style={styles.bigScore}>
        <Text style={[styles.bigScoreValue, result.winner === 0 && styles.bigScoreWon]}>{headline[0]}</Text>
        <View style={styles.bigScoreDivider}><Text style={styles.bigScoreLabel}>{multiGame ? 'GAMES' : 'POINTS'}</Text></View>
        <Text style={[styles.bigScoreValue, result.winner === 1 && styles.bigScoreWon]}>{headline[1]}</Text>
      </View>

      <View style={styles.board}>
        <View style={styles.boardHead}>
          <Text style={[styles.boardLabel, styles.boardTeamLabel]}>TEAM</Text>
          {games.map((_, index) => <Text key={`head-${index}`} style={styles.boardLabel}>G{index + 1}</Text>)}
        </View>
        {[0, 1].map((team) => (
          <View key={`team-${team}`} style={[styles.teamRow, team === 1 && styles.teamRowBorder]}>
            <View style={[styles.teamMark, team === 1 && styles.teamMarkAway]}><Text style={styles.teamMarkText}>T{team + 1}</Text></View>
            <View style={styles.teamNameWrap}>
              {result.players[team].filter(Boolean).map((name, index) => (
                <Text key={`${team}-${index}`} numberOfLines={1} style={[styles.teamName, result.winner === team && styles.teamNameWon]}>{name}</Text>
              ))}
            </View>
            {result.winner === team ? <View style={styles.winTag}><Text style={styles.winTagText}>WIN</Text></View> : null}
            {games.map((game, index) => (
              <Text key={`score-${team}-${index}`} style={[styles.gameScore, game[team] > game[1 - team] && styles.gameScoreWon]}>{game[team]}</Text>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.statValue}>{formatDuration(result.elapsed)}</Text><Text style={styles.statLabel}>DURATION</Text></View>
        <View style={[styles.stat, styles.statMiddle]}><Text style={styles.statValue}>{totalPoints}</Text><Text style={styles.statLabel}>POINTS</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{games.length}</Text><Text style={styles.statLabel}>{games.length === 1 ? 'GAME' : 'GAMES'}</Text></View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <Ionicons name="location" size={12} color={OPTIC} />
          <Text numberOfLines={1} style={styles.footerVenue}>{result.court?.name || 'Community match'}</Text>
        </View>
        <Text style={styles.footerDate}>{dateLabel} · {timeLabel}</Text>
      </View>
    </View>
  );
});

export default MatchStoryCard;

const styles = StyleSheet.create({
  card: { width: STORY_CARD_WIDTH, height: STORY_CARD_HEIGHT, paddingHorizontal: 26, paddingTop: 34, paddingBottom: 30, overflow: 'hidden', backgroundColor: INK },
  glowTop: { position: 'absolute', top: -120, right: -110, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(214,233,74,.06)' },
  glowBottom: { position: 'absolute', bottom: -140, left: -120, width: 340, height: 340, borderRadius: 170, backgroundColor: 'rgba(28,107,102,.22)' },

  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center' },
  ball: { width: 22, height: 22, marginRight: 8 },
  brandText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  finalPill: { height: 26, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,.18)', backgroundColor: 'rgba(255,255,255,.06)' },
  finalDot: { width: 6, height: 6, marginRight: 6, borderRadius: 3, backgroundColor: OPTIC },
  finalText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },

  hero: { marginTop: 28 },
  meta: { color: OPTIC, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  heroLead: { marginTop: 14, color: '#ABC0B9', fontSize: 18, fontWeight: '600' },
  heroName: { marginTop: 2, color: '#FFFFFF', fontSize: 30, lineHeight: 36, fontWeight: '900', letterSpacing: -0.6 },

  bigScore: { marginTop: 12, flexDirection: 'row', alignItems: 'center' },
  bigScoreValue: { minWidth: 58, color: MUTED, fontSize: 60, lineHeight: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  bigScoreWon: { color: OPTIC },
  bigScoreDivider: { marginHorizontal: 14, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.08)' },
  bigScoreLabel: { color: '#ABC0B9', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },

  board: { marginTop: 'auto', overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,.13)', backgroundColor: 'rgba(255,255,255,.05)' },
  boardHead: { height: 32, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: 'rgba(255,255,255,.1)' },
  boardLabel: { width: 34, color: '#82968F', textAlign: 'center', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  boardTeamLabel: { flex: 1, textAlign: 'left' },
  teamRow: { minHeight: 62, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  teamRowBorder: { borderTopWidth: 1, borderColor: 'rgba(255,255,255,.1)' },
  teamMark: { width: 32, height: 32, marginRight: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: TEAL },
  teamMarkAway: { backgroundColor: BRICK },
  teamMarkText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  teamNameWrap: { flex: 1, minWidth: 0 },
  teamName: { color: '#C9D6D1', fontSize: 14, lineHeight: 19, fontWeight: '800' },
  teamNameWon: { color: '#FFFFFF' },
  winTag: { marginLeft: 6, marginRight: 4, paddingHorizontal: 6, height: 16, justifyContent: 'center', borderRadius: 4, backgroundColor: OPTIC },
  winTagText: { color: INK, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  gameScore: { width: 34, color: MUTED, textAlign: 'center', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  gameScoreWon: { color: '#FFFFFF', fontWeight: '900' },

  stats: { marginTop: 14, flexDirection: 'row', borderRadius: 16, backgroundColor: 'rgba(255,255,255,.05)' },
  stat: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  statMiddle: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,.1)' },
  statValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabel: { marginTop: 4, color: '#82968F', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },

  footer: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: 'rgba(255,255,255,.12)' },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerVenue: { flex: 1, marginLeft: 6, color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  footerDate: { marginTop: 5, color: '#ABC0B9', fontSize: 11, fontWeight: '700' },
});
