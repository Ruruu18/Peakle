import React, { useRef } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AppIcon from './AppIcon';

// Swipe to reply, shared by team and private chats: drag a message right and
// let go past the reply icon to quote it in the composer. The quote shows
// above the reply, and tapping it jumps to the original.

const REPLY_DISTANCE = 56;
const MAX_DRAG = 76;

// In browsers the bubble's long press and tap run outside the gesture system,
// so a swipe held past the long-press delay would also open the message menu.
// Chats skip opening the menu while a swipe is in progress or just ended.
let swipeActiveUntil = 0;
export const isSwipeActive = () => Date.now() < swipeActiveUntil;

// Short text for a quoted message: its words, or what kind of attachment it was.
export function replySnippet(message) {
  if (!message) return '';
  if (message.deleted || message.deletedAt) return 'Message unavailable';
  if (message.text) return message.text;
  const type = message.mediaType || (message.image ? 'image' : message.video ? 'video' : message.audio ? 'audio' : null);
  return { image: 'Photo', gif: 'GIF', video: 'Video', audio: 'Voice message' }[type] || 'Attachment';
}

export function SwipeToReply({ enabled = true, onReply, color, children }) {
  const drag = useRef(new Animated.Value(0)).current;
  const latest = useRef({ onReply, enabled });
  latest.current = { onReply, enabled };
  const armed = useRef(false);
  const settle = () => Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 6, speed: 18 }).start();
  const responder = useRef(PanResponder.create({
    // Only a clearly horizontal drag to the right, so scrolling and long
    // presses keep working.
    onMoveShouldSetPanResponder: (_, gesture) => latest.current.enabled
      && gesture.dx > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.8,
    onPanResponderGrant: () => { armed.current = false; swipeActiveUntil = Infinity; },
    onPanResponderMove: (_, gesture) => {
      const distance = Math.max(0, Math.min(MAX_DRAG, gesture.dx * 0.85));
      drag.setValue(distance);
      armed.current = distance >= REPLY_DISTANCE;
    },
    onPanResponderRelease: () => {
      swipeActiveUntil = Date.now() + 350;
      if (armed.current) latest.current.onReply?.();
      armed.current = false;
      settle();
    },
    onPanResponderTerminate: () => { swipeActiveUntil = Date.now() + 350; armed.current = false; settle(); },
    onPanResponderTerminationRequest: () => false,
  })).current;
  const iconOpacity = drag.interpolate({ inputRange: [8, REPLY_DISTANCE], outputRange: [0, 1], extrapolate: 'clamp' });
  const iconScale = drag.interpolate({ inputRange: [8, REPLY_DISTANCE, MAX_DRAG], outputRange: [0.6, 1, 1.12], extrapolate: 'clamp' });
  return (
    <View {...responder.panHandlers}>
      <Animated.View style={[styles.replyIcon, { opacity: iconOpacity, transform: [{ scale: iconScale }], pointerEvents: 'none' }]}>
        <AppIcon name="arrow-undo" size={17} color={color} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: drag }] }}>{children}</Animated.View>
    </View>
  );
}

// Shown above a reply's bubble. Tapping it scrolls to the original message.
export function ReplyQuote({ reply, mine, colors, onPress }) {
  if (!reply) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Reply to ${reply.sender}: ${replySnippet(reply)}. Go to the original message`}
      disabled={!onPress || reply.deleted}
      onPress={() => onPress?.(reply.id)}
      style={({ pressed }) => [styles.quote, mine && styles.quoteMine, { borderLeftColor: colors.teal, backgroundColor: colors.tealWash || colors.paper }, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={[styles.quoteSender, { color: colors.teal }]}>{reply.sender}</Text>
      <Text numberOfLines={2} style={[styles.quoteText, { color: colors.ink70 || colors.ink }, reply.deleted && styles.quoteDeleted]}>{replySnippet(reply)}</Text>
    </Pressable>
  );
}

// Above the composer while a reply is being written.
export function ReplyComposerBar({ target, colors, onCancel }) {
  if (!target) return null;
  return (
    <View style={[styles.bar, { borderColor: colors.line, backgroundColor: colors.tealWash || colors.paper }]}>
      <AppIcon name="arrow-undo" size={16} color={colors.teal} />
      <View style={styles.barCopy}>
        <Text numberOfLines={1} style={[styles.barTitle, { color: colors.teal }]}>Replying to {target.mine ? 'yourself' : target.sender}</Text>
        <Text numberOfLines={1} style={[styles.barText, { color: colors.ink70 || colors.ink }]}>{replySnippet(target)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={onCancel} hitSlop={10} style={styles.barClose}>
        <AppIcon name="close" size={18} color={colors.ink40 || colors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  replyIcon: { position: 'absolute', left: 4, top: 0, bottom: 0, width: 32, alignItems: 'center', justifyContent: 'center' },
  quote: { maxWidth: 260, marginBottom: 3, paddingHorizontal: 10, paddingVertical: 6, borderLeftWidth: 3, borderRadius: 10, opacity: 0.92 },
  quoteMine: { alignSelf: 'flex-end' },
  quoteSender: { fontSize: 10, fontWeight: '800' },
  quoteText: { marginTop: 1, fontSize: 11, lineHeight: 15 },
  quoteDeleted: { fontStyle: 'italic' },
  pressed: { opacity: 0.6 },
  bar: { paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1 },
  barCopy: { flex: 1, minWidth: 0 },
  barTitle: { fontSize: 11, fontWeight: '800' },
  barText: { marginTop: 2, fontSize: 11 },
  barClose: { padding: 2 },
});
