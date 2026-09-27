import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import AppIcon from './AppIcon';

const ATTACH_BUTTON_WIDTH = 38;
const ATTACH_TRAY_WIDTH = ATTACH_BUTTON_WIDTH * 3;

// The chat composer's attachment buttons, shared by private and team chats.
// "+" (or ">" once minimized) slides away as camera, gallery, and mic slide
// in, and the reverse when minimizing.
// mode — closed: "+" · open: camera, gallery, mic · minimized: ">" after the
// player opened the buttons and then went back to typing.
export default function ComposerAttachments({ mode, colors, onOpen, onCamera, onLibrary, onVoice }) {
  const open = mode === 'open';
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: open ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [open, progress]);
  const toggleStyle = {
    width: progress.interpolate({ inputRange: [0, 1], outputRange: [ATTACH_BUTTON_WIDTH, 0] }),
    opacity: progress.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }),
  };
  const trayStyle = {
    width: progress.interpolate({ inputRange: [0, 1], outputRange: [0, ATTACH_TRAY_WIDTH] }),
    opacity: progress.interpolate({ inputRange: [0.3, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
  };
  const minimized = mode === 'minimized';
  return (
    <View style={styles.attachTray}>
      <Animated.View accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'} style={[styles.attachClip, toggleStyle, { pointerEvents: open ? 'none' : 'auto' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Show attachments" accessibilityHint="Photo, video, or voice message" onPress={onOpen} hitSlop={4} style={styles.attachButton}><AppIcon name={minimized ? 'chevron-forward' : 'add-circle'} size={minimized ? 24 : 27} color={colors.teal} /></Pressable>
      </Animated.View>
      <Animated.View accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} style={[styles.attachClip, trayStyle, { pointerEvents: open ? 'auto' : 'none' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Take a photo or video" onPress={onCamera} hitSlop={4} style={styles.attachButton}><AppIcon name="camera" size={23} color={colors.teal} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Send a photo or video" onPress={onLibrary} hitSlop={4} style={styles.attachButton}><AppIcon name="image" size={22} color={colors.teal} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Record a voice message" onPress={onVoice} hitSlop={4} style={styles.attachButton}><AppIcon name="mic" size={23} color={colors.teal} /></Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  attachTray: { flexDirection: 'row', alignItems: 'center' },
  attachButton: { width: ATTACH_BUTTON_WIDTH, height: 43, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  attachClip: { flexDirection: 'row', overflow: 'hidden' },
});
