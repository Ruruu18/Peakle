import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet } from 'react-native';
import PeakleLoadingScreen from './PeakleLoadingScreen';

export default function PeakleLoadingOverlay({ visible, status, minimumVisibleMs = 650 }) {
  const [mounted, setMounted] = useState(Boolean(visible));
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const shownAt = useRef(visible ? Date.now() : 0);
  const exitTimer = useRef(null);

  useEffect(() => {
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
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }, remaining);
    return () => clearTimeout(exitTimer.current);
  }, [minimumVisibleMs, mounted, opacity, visible]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);
  if (!mounted) return null;
  return (
    <Modal
      animationType="none"
      hardwareAccelerated
      navigationBarTranslucent
      onRequestClose={() => {}}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[styles.overlay, { opacity }]}>
        <PeakleLoadingScreen status={status} />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject },
});
