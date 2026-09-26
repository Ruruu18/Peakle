import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

const BALL_IMAGE = require('../../public/images/ball_green.png');
const colors = { ink: '#0E2321', optic: '#D6E94A' };

export default function PeakleLoadingScreen({ status = 'GETTING THE COURT READY' }) {
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bounceAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(bounce, { toValue: 0, duration: 310, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(bounce, { toValue: 0.32, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(bounce, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.delay(100),
      ]),
    );
    bounceAnimation.start();
    return () => bounceAnimation.stop();
  }, [bounce]);

  const ballStyle = {
    transform: [{ translateY: bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -44] }) }],
  };
  const shadowStyle = {
    opacity: bounce.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0.1] }),
    transform: [{ scaleX: bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) }],
  };
  const trailStyle = {
    opacity: bounce.interpolate({ inputRange: [0, 0.08, 0.75, 1], outputRange: [0, 0.8, 0.55, 0.15] }),
  };

  return (
    <View accessibilityLabel="Loading content" accessibilityViewIsModal style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.ballStage}>
          <Animated.View style={[styles.ballShadow, shadowStyle]} />
          <Animated.View style={[styles.motionTrails, trailStyle, { pointerEvents: 'none' }]}>
            <View style={styles.motionLineShort} />
            <View style={styles.motionLineTall} />
          </Animated.View>
          <Animated.Image
            accessibilityIgnoresInvertColors
            accessible={false}
            defaultSource={BALL_IMAGE}
            fadeDuration={0}
            resizeMode="contain"
            source={BALL_IMAGE}
            style={[styles.ball, ballStyle]}
          />
        </View>
        <Text style={styles.status}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  card: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 28, borderRadius: 24, backgroundColor: colors.ink },
  ballStage: { width: 88, height: 88, alignItems: 'center', justifyContent: 'flex-end', overflow: 'visible' },
  ball: { position: 'absolute', bottom: 10, width: 52, height: 52, zIndex: 1 },
  ballShadow: { width: 36, height: 7, marginBottom: 5, borderRadius: 18, backgroundColor: '#000000' },
  motionTrails: { position: 'absolute', bottom: 24, flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  motionLineShort: { width: 3, height: 9, borderRadius: 2, backgroundColor: colors.optic },
  motionLineTall: { width: 3, height: 15, borderRadius: 2, backgroundColor: colors.optic },
  status: { marginTop: 14, color: colors.optic, fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
});
