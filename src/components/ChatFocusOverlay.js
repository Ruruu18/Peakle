import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet } from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Messenger-style focus layer for a chat: frosts every message behind the one
 * whose controls are open. Render it as a sibling of the message rows and give
 * the active row a higher zIndex so it stays sharp above the layer. Web gets a
 * real backdrop blur; native uses a strong frosted tint.
 */
export default function ChatFocusOverlay({ visible, dark, onPress }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      fade.setValue(0);
      return;
    }
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [fade, visible]);
  if (!visible) return null;
  return (
    <AnimatedPressable
      accessibilityLabel="Close message controls"
      onPress={onPress}
      style={[styles.overlay, { opacity: fade, backgroundColor: dark ? 'rgba(6,14,13,.72)' : 'rgba(243,245,239,.78)' }]}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    ...Platform.select({ web: { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', cursor: 'default' } }),
  },
});
