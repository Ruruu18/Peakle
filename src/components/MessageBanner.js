import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import ProfilePhoto from './ProfilePhoto';
import { useOperations } from '../context/OperationsContext';
import { useNearbyPlayersContext } from '../context/NearbyPlayersContext';
import { dropShadow } from '../utils/shadow';

const VISIBLE_MS = 5000;
const HIDDEN_OFFSET = -160;

/**
 * Top-of-screen banner for a new private message, styled like the match
 * invitation card. Tap opens the chat, swipe up or wait to dismiss. It stays
 * quiet while that conversation is already open or a match invite is showing.
 */
export default function MessageBanner({ navigationRef }) {
  const insets = useSafeAreaInsets();
  const { messageBanner, dismissMessageBanner } = useOperations();
  const { incomingInvites } = useNearbyPlayersContext();
  const [openConversationId, setOpenConversationId] = useState(null);
  const offset = useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const hideTimer = useRef(null);

  useEffect(() => {
    if (!navigationRef) return undefined;
    const update = () => {
      const route = navigationRef.getCurrentRoute?.();
      setOpenConversationId(route?.name === 'DirectChat' ? route.params?.conversationId || null : null);
    };
    update();
    return navigationRef.addListener?.('state', update);
  }, [navigationRef]);

  const conversationId = messageBanner?.data?.conversationId || null;
  const suppressed = Boolean(conversationId && conversationId === openConversationId);
  const blockedByInvite = incomingInvites.length > 0;
  const notice = messageBanner && !suppressed ? messageBanner : null;

  const hide = useCallback(() => {
    clearTimeout(hideTimer.current);
    Animated.timing(offset, { toValue: HIDDEN_OFFSET, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start(() => dismissMessageBanner());
  }, [dismissMessageBanner, offset]);

  useEffect(() => {
    if (messageBanner && suppressed) dismissMessageBanner();
  }, [dismissMessageBanner, messageBanner, suppressed]);

  useEffect(() => {
    if (!notice || blockedByInvite) return undefined;
    offset.setValue(HIDDEN_OFFSET);
    Animated.spring(offset, { toValue: 0, damping: 18, stiffness: 220, mass: 0.8, useNativeDriver: Platform.OS !== 'web' }).start();
    hideTimer.current = setTimeout(hide, VISIBLE_MS);
    return () => clearTimeout(hideTimer.current);
  }, [blockedByInvite, hide, notice?.id, offset]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy < -6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => clearTimeout(hideTimer.current),
    onPanResponderMove: (_, gesture) => offset.setValue(Math.min(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy < -30 || gesture.vy < -0.5) hide();
      else {
        Animated.spring(offset, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start();
        hideTimer.current = setTimeout(hide, VISIBLE_MS);
      }
    },
  }), [hide, offset]);

  if (!notice || blockedByInvite) return null;

  const request = notice.kind === 'direct_message_request';
  const senderName = request ? 'New message request' : notice.title || 'New message';
  const open = () => {
    clearTimeout(hideTimer.current);
    dismissMessageBanner();
    if (!navigationRef?.isReady?.() || !conversationId) return;
    navigationRef.navigate('DirectChat', {
      conversationId,
      player: notice.data?.playerId ? { id: notice.data.playerId } : undefined,
      ownerTab: 'Team',
    });
  };

  return (
    <View style={[styles.layer, { pointerEvents: 'box-none' }]}>
      <Animated.View {...pan.panHandlers} style={[styles.card, { top: Math.max(insets.top, 12) + 8, transform: [{ translateY: offset }] }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${senderName}: ${notice.body}. Opens the chat`} onPress={open} style={({ pressed }) => [styles.content, pressed && styles.pressed]}>
          <ProfilePhoto name={request ? '?' : senderName} size={40} />
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>{request ? 'MESSAGE REQUEST' : 'NEW MESSAGE'}</Text>
            <Text numberOfLines={1} style={styles.title}>{senderName}</Text>
            <Text numberOfLines={2} style={styles.body}>{notice.body}</Text>
          </View>
          <Text style={styles.reply}>{request ? 'View' : 'Reply'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" hitSlop={8} onPress={hide} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <Ionicons name="close" size={16} color="#9FB3AC" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = createMobileStyleSheet({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 999, elevation: 999 },
  card: { position: 'absolute', left: 14, right: 14, maxWidth: 520, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 6, paddingVertical: 10, borderWidth: 1, borderColor: '#304743', borderRadius: 20, backgroundColor: '#0E2321', ...dropShadow({ color: '#07110F', opacity: .3, radius: 18, y: 9 }), elevation: 18 },
  content: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
  copy: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#D6E94A', fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  title: { marginTop: 2, color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  body: { marginTop: 2, color: '#C9D6D1', fontSize: 10, lineHeight: 14 },
  reply: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, overflow: 'hidden', backgroundColor: '#D6E94A', color: '#0E2321', fontSize: 10, fontWeight: '900' },
  close: { width: 30, height: 30, marginLeft: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  pressed: { opacity: .72 },
});
