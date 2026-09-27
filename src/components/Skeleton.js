import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

// Placeholder shapes shown while chats and teams load, pulsing together so
// the screen reads as one loading state rather than many spinners.

export function useSkeletonPulse() {
  const pulse = useRef(new Animated.Value(0.42)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.9, duration: 720, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.42, duration: 720, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  return pulse;
}

export function SkeletonBlock({ pulse, color, style }) {
  return <Animated.View style={[styles.block, { backgroundColor: color, opacity: pulse }, style]} />;
}

function useSkeletonColors() {
  const { isDark } = useTheme();
  return isDark ? DARK_CONTENT_COLORS : LIGHT_CONTENT_COLORS;
}

// Chat bubbles: someone else's, yours, then someone else's again.
export function ChatMessagesSkeleton() {
  const pulse = useSkeletonPulse();
  const colors = useSkeletonColors();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.messages}>
      <View style={styles.messageRow}>
        <SkeletonBlock pulse={pulse} color={colors.line} style={styles.messageAvatar} />
        <SkeletonBlock pulse={pulse} color={colors.line} style={styles.bubbleWide} />
      </View>
      <View style={[styles.messageRow, styles.messageMine]}>
        <SkeletonBlock pulse={pulse} color={colors.line} style={styles.bubbleMine} />
      </View>
      <View style={styles.messageRow}>
        <SkeletonBlock pulse={pulse} color={colors.line} style={styles.messageAvatar} />
        <SkeletonBlock pulse={pulse} color={colors.line} style={styles.bubbleShort} />
      </View>
      <View style={[styles.messageRow, styles.messageMine]}>
        <SkeletonBlock pulse={pulse} color={colors.line} style={styles.bubbleMineShort} />
      </View>
    </View>
  );
}

// The Teams tab before it knows your teams: the Joined / Discover switch, the
// section heading, and team cards shaped like the real ones.
export function TeamListSkeleton({ cards = 2 }) {
  const pulse = useSkeletonPulse();
  const colors = useSkeletonColors();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your teams" style={styles.teams}>
      <View style={[styles.tabs, { backgroundColor: colors.line }]}>
        <SkeletonBlock pulse={pulse} color={colors.surface} style={styles.tab} />
      </View>
      <SkeletonBlock pulse={pulse} color={colors.line} style={styles.eyebrow} />
      <SkeletonBlock pulse={pulse} color={colors.line} style={styles.heading} />
      {Array.from({ length: cards }, (_, index) => (
        <View key={index} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <SkeletonBlock pulse={pulse} color={colors.line} style={styles.cover} />
          <View style={styles.cardBody}>
            <View style={styles.stats}>
              <SkeletonBlock pulse={pulse} color={colors.line} style={styles.stat} />
              <SkeletonBlock pulse={pulse} color={colors.line} style={styles.stat} />
            </View>
            <SkeletonBlock pulse={pulse} color={colors.line} style={styles.cardAction} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderRadius: 999 },
  messages: { paddingTop: 8 },
  messageRow: { marginTop: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  messageMine: { justifyContent: 'flex-end' },
  messageAvatar: { width: 31, height: 31, borderRadius: 16 },
  bubbleWide: { width: '62%', height: 54, borderRadius: 15, borderBottomLeftRadius: 4 },
  bubbleMine: { width: '48%', height: 40, borderRadius: 15, borderBottomRightRadius: 4 },
  bubbleShort: { width: '40%', height: 36, borderRadius: 15, borderBottomLeftRadius: 4 },
  bubbleMineShort: { width: '30%', height: 36, borderRadius: 15, borderBottomRightRadius: 4 },
  teams: { paddingTop: 4 },
  tabs: { height: 48, padding: 5, borderRadius: 14, opacity: 0.6 },
  tab: { width: '50%', height: '100%', borderRadius: 11 },
  eyebrow: { width: 86, height: 9, marginTop: 22 },
  heading: { width: 140, height: 20, marginTop: 9, marginBottom: 14, borderRadius: 8 },
  card: { marginBottom: 14, overflow: 'hidden', borderRadius: 22, borderWidth: 1 },
  cover: { height: 150, borderRadius: 0 },
  cardBody: { padding: 14, gap: 14 },
  stats: { flexDirection: 'row', gap: 18 },
  stat: { width: 64, height: 26, borderRadius: 8 },
  cardAction: { height: 50, borderRadius: 14 },
});
