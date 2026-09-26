import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Icon from './AppIcon';
import { isTouchHeld } from '../utils/webLongPress';

const REACTION_SIZE = 48;

// Copy is offered where the browser clipboard exists; native has no clipboard module installed.
export const canCopyText = Platform.OS === 'web' && typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
export const copyText = (text) => navigator.clipboard.writeText(text).catch(() => {});
// Long-pressing a bubble opens the focus view; on web it must not start a text selection or the iOS callout.
export const unselectable = Platform.select({ web: { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }, default: null });
const PILL_PADDING = 8;

/**
 * Messenger-style message focus: the whole screen blurs, the chosen message
 * stays sharp, a reaction pill sits above it and a menu of actions below.
 * Slide a finger across the pill to pick a reaction without lifting.
 * Web gets a real backdrop blur; native uses a strong frosted tint.
 *
 * actions: [{ key, label, icon, onPress, destructive, separated }]
 */
export default function MessageFocusModal({ visible, mine, dark, reactions, selectedReactions = [], onReact, actions, onClose, children }) {
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= 1024;
  const appear = useRef(new Animated.Value(0)).current;
  const [hovered, setHovered] = useState(-1);
  const hoveredRef = useRef(-1);
  const pillRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      appear.setValue(0);
      hoveredRef.current = -1;
      setHovered(-1);
      return;
    }
    Animated.timing(appear, { toValue: 1, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [appear, visible]);

  const chooseAt = useCallback((locationX) => {
    const index = Math.floor((locationX - PILL_PADDING) / REACTION_SIZE);
    const next = index >= 0 && index < reactions.length ? index : -1;
    hoveredRef.current = next;
    setHovered(next);
  }, [reactions.length]);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4,
    onPanResponderGrant: (event) => chooseAt(event.nativeEvent.locationX),
    onPanResponderMove: (event) => chooseAt(event.nativeEvent.locationX),
    onPanResponderRelease: () => {
      if (hoveredRef.current >= 0) onReact(reactions[hoveredRef.current]);
      hoveredRef.current = -1;
      setHovered(-1);
      onClose();
    },
    onPanResponderTerminate: () => {
      hoveredRef.current = -1;
      setHovered(-1);
    },
  }), [chooseAt, onClose, onReact, reactions]);

  // Web: the finger that long-pressed is still down when the menu opens, but the
  // pill's PanResponder only sees new touches. Follow that finger on the window
  // (blocking the page scroll) so sliding across the pill still picks a reaction.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || !isTouchHeld()) return undefined;
    const hoverAt = (touch) => {
      const rect = pillRef.current?.getBoundingClientRect?.();
      let next = -1;
      if (rect && touch && touch.clientY >= rect.top - 24 && touch.clientY <= rect.bottom + 24) {
        const index = Math.floor((touch.clientX - rect.left - PILL_PADDING) / ((rect.width - PILL_PADDING * 2) / reactions.length));
        if (index >= 0 && index < reactions.length) next = index;
      }
      hoveredRef.current = next;
      setHovered(next);
    };
    const move = (event) => {
      event.preventDefault();
      hoverAt(event.touches[0]);
    };
    const end = (event) => {
      if (event.touches.length) return;
      const picked = event.type === 'touchend' ? hoveredRef.current : -1;
      hoveredRef.current = -1;
      setHovered(-1);
      detach();
      // Swallow the lift's synthetic click so it can't land on the backdrop and
      // close the menu; releasing off the pill leaves the menu open for taps.
      if (event.type === 'touchend') event.preventDefault();
      if (picked >= 0) {
        onReact(reactions[picked]);
        onClose();
      }
    };
    const detach = () => {
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end, { passive: false });
    window.addEventListener('touchcancel', end);
    return detach;
  }, [visible, onClose, onReact, reactions]);

  if (!visible) return null;
  const palette = dark ? DARK : LIGHT;
  const rise = (from) => ({ opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] });
  const side = mine ? styles.alignEnd : styles.alignStart;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: appear, backgroundColor: palette.tint }]}>
        <Pressable accessibilityLabel="Close message actions" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <ScrollView pointerEvents="box-none" style={styles.stage} contentContainerStyle={[styles.stageContent, desktop && styles.stageDesktop]} showsVerticalScrollIndicator={false}>
          <Pressable accessible={false} focusable={false} onPress={onClose} style={StyleSheet.absoluteFillObject} />
          <Animated.View ref={pillRef} {...pan.panHandlers} style={[styles.pill, side, { backgroundColor: palette.pill }, rise(10)]}>
            {reactions.map((emoji, index) => {
              const chosen = selectedReactions.includes(emoji);
              return (
                <Pressable key={emoji} accessibilityLabel={`React ${emoji}`} onPress={() => { onReact(emoji); onClose(); }} style={({ pressed }) => [styles.reaction, (chosen || pressed) && { backgroundColor: palette.chosen }, hovered === index && styles.reactionHovered]}>
                  <Text style={styles.reactionText}>{emoji}</Text>
                </Pressable>
              );
            })}
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.preview, side, { opacity: appear }]}>{children}</Animated.View>
          <Animated.View style={[styles.menu, side, { backgroundColor: palette.menu }, rise(14)]}>
            {actions.map((action, index) => (
              <View key={action.key}>
                {index > 0 ? <View style={action.separated ? [styles.groupGap, { backgroundColor: palette.gap }] : [styles.divider, { backgroundColor: palette.line }]} /> : null}
                <Pressable accessibilityRole="button" onPress={() => { onClose(); action.onPress(); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.pressed }, Platform.OS === 'web' && styles.webPointer]}>
                  <Text style={[styles.rowLabel, { color: action.destructive ? palette.danger : palette.ink }]}>{action.label}</Text>
                  <Icon name={action.icon} size={21} color={action.destructive ? palette.danger : palette.ink} />
                </Pressable>
              </View>
            ))}
          </Animated.View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const DARK = { tint: 'rgba(8,12,14,.55)', pill: 'rgba(38,42,46,.94)', menu: 'rgba(38,42,46,.96)', chosen: 'rgba(255,255,255,.16)', line: 'rgba(255,255,255,.1)', gap: 'rgba(0,0,0,.35)', pressed: 'rgba(255,255,255,.08)', ink: '#F3F5EF', danger: '#FF6B5B' };
const LIGHT = { tint: 'rgba(236,240,234,.5)', pill: 'rgba(255,255,255,.96)', menu: 'rgba(255,255,255,.97)', chosen: 'rgba(14,35,33,.1)', line: 'rgba(14,35,33,.1)', gap: 'rgba(14,35,33,.07)', pressed: 'rgba(14,35,33,.06)', ink: '#0E2321', danger: '#A53F29' };

const shadow = Platform.select({
  ios: { shadowColor: '#000000', shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
  android: { elevation: 12 },
  web: { boxShadow: '0 14px 44px rgba(0,0,0,.28)' },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    ...Platform.select({ web: { backdropFilter: 'blur(26px) saturate(140%)', WebkitBackdropFilter: 'blur(26px) saturate(140%)' } }),
  },
  stage: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  stageContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 34, justifyContent: 'flex-end' },
  stageDesktop: { justifyContent: 'center', paddingBottom: 0 },
  alignStart: { alignSelf: 'flex-start' },
  alignEnd: { alignSelf: 'flex-end' },
  pill: { maxWidth: '100%', padding: PILL_PADDING, flexDirection: 'row', alignItems: 'center', borderRadius: 36, ...shadow },
  reaction: { width: REACTION_SIZE, height: REACTION_SIZE, flexShrink: 1, alignItems: 'center', justifyContent: 'center', borderRadius: REACTION_SIZE / 2 },
  reactionHovered: { transform: [{ scale: 1.25 }, { translateY: -6 }] },
  reactionText: { fontSize: 30 },
  preview: { maxWidth: '86%', marginTop: 14, marginBottom: 12 },
  menu: { width: '64%', minWidth: 240, maxWidth: 320, overflow: 'hidden', borderRadius: 16, ...shadow },
  row: { minHeight: 52, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth },
  groupGap: { height: 7 },
  webPointer: { cursor: 'pointer' },
});
