import React, { useId, useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { pickleballSvg } from '../../shared/pickleball';

// Ground travel and height are separate: the shadow stays on the playing surface.
export default function RallyBall({ travel, bounce, doubles, opacity }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const xml = useMemo(() => pickleballSvg(`rally-${id}`), [id]);
  const motion = useMemo(() => {
    const legs = doubles ? 4 : 2;
    const samples = Array.from({ length: legs * 8 + 1 }, (_, index) => index / (legs * 8));
    const heights = samples.map((value) => {
      const phase = (value * legs) % 1;
      return 4 * phase * (1 - phase);
    });
    const groundStops = doubles ? [0, .25, .5, .75, 1] : [0, .5, 1];
    const x = travel.interpolate({ inputRange: groundStops, outputRange: doubles ? [-62, 62, 62, -62, -62] : [0, 0, 0] });
    const y = travel.interpolate({ inputRange: groundStops, outputRange: doubles ? [-48, 64, -48, 64, -48] : [-48, 64, -48] });
    const height = Animated.add(travel.interpolate({ inputRange: samples, outputRange: heights.map((value) => value * -30) }), bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }));
    return {
      x, y, height,
      spin: travel.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
      scale: travel.interpolate({ inputRange: samples, outputRange: heights.map((value) => 1 + value * .1) }),
      squash: travel.interpolate({ inputRange: samples, outputRange: heights.map((value) => value === 0 ? .9 : 1) }),
      shadowScale: height.interpolate({ inputRange: [-42, 0], outputRange: [1.55, .75], extrapolate: 'clamp' }),
      shadowOpacity: Animated.multiply(opacity, height.interpolate({ inputRange: [-42, 0], outputRange: [.12, .34], extrapolate: 'clamp' })),
    };
  }, [bounce, doubles, opacity, travel]);

  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
    <Animated.View testID="rally-ball-shadow" style={[styles.shadow, { opacity: motion.shadowOpacity, transform: [{ translateX: motion.x }, { translateY: motion.y }, { scaleX: motion.shadowScale }] }]} />
    <Animated.View testID="rally-ball" style={[styles.ball, { opacity, transform: [{ translateX: motion.x }, { translateY: motion.y }] }]}>
      <Animated.View testID="rally-ball-lift" style={{ transform: [{ translateY: motion.height }, { scale: motion.scale }, { scaleY: motion.squash }] }}>
        <Animated.View style={{ transform: [{ rotate: motion.spin }] }}><SvgXml xml={xml} width={30} height={30} /></Animated.View>
      </Animated.View>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  ball: { position: 'absolute', zIndex: 6, top: 94, left: '50%', marginLeft: -15, width: 30, height: 30 },
  shadow: { position: 'absolute', zIndex: 5, top: 120, left: '50%', marginLeft: -13, width: 26, height: 7, borderRadius: 13, backgroundColor: '#041a13' },
});
