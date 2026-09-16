import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet } from 'react-native';
import PeakleLoadingScreen from './PeakleLoadingScreen';

export default function PeakleLoadingOverlay({ visible, status, minimumVisibleMs = 650 }) {
  const [mounted, setMounted] = useState(Boolean(visible));
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const shownAt = useRef(visible ? Date.now() : 0);
  const exitTimer = useRef(null);
  const transitionId = useRef(0);

  useEffect(() => {
    const currentTransition = transitionId.current + 1;
    transitionId.current = currentTransition;
    clearTimeout(exitTimer.current);
    opacity.stopAnimation();
    if (visible) {
      shownAt.current = Date.now();
      setMounted(true);
      opacity.setValue(1);
      return undefined;
    }
    if (!mounted) return undefined;
    const remaining = Math.max(0, minimumVisibleMs - (Date.now() - shownAt.current));
    exitTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 240,
        useNativeDriver: Platform.OS !== 'web',
      }).start(() => {
        if (transitionId.current === currentTransition) setMounted(false);
      });
    }, remaining);
    return () => clearTimeout(exitTimer.current);
  }, [minimumVisibleMs, mounted, opacity, visible]);

  useEffect(() => () => {
    transitionId.current += 1;
    clearTimeout(exitTimer.current);
    opacity.stopAnimation();
  }, [opacity]);
  if (!mounted) return null;
  return (
    <Animated.View
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'yes' : 'no-hide-descendants'}
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.overlay, { opacity }]}
    >
      <PeakleLoadingScreen status={status} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10000, elevation: 10000 },
});
