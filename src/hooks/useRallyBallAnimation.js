import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

export default function useRallyBallAnimation({ doubles, paused }) {
  const rallyTravel = useRef(new Animated.Value(0)).current;
  const ballBounce = useRef(new Animated.Value(0)).current;
  const bounceLoop = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const focused = useIsFocused();
  const motionAllowed = !reducedMotion && foreground && focused;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReducedMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    const state = AppState.addEventListener('change', (value) => setForeground(value === 'active'));
    return () => { mounted = false; motion?.remove(); state.remove(); };
  }, []);

  const bounceBall = useCallback((iterations = 1) => {
    bounceLoop.current?.stop();
    ballBounce.setValue(0);
    if (!motionAllowed || paused) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(ballBounce, { toValue: 1, duration: 210, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
      Animated.timing(ballBounce, { toValue: 0, duration: 250, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
    ]), { iterations });
    bounceLoop.current = animation;
    animation.start();
  }, [ballBounce, motionAllowed, paused]);

  useEffect(() => {
    if (!motionAllowed || paused) {
      bounceLoop.current?.stop();
      ballBounce.setValue(0);
      if (reducedMotion) rallyTravel.setValue(0);
      return undefined;
    }
    rallyTravel.setValue(0);
    const stops = doubles ? [.25, .5, .75, 1] : [.5, 1];
    const animation = Animated.loop(Animated.sequence(stops.map((toValue) => Animated.timing(rallyTravel, {
      toValue, duration: 1400, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web', isInteraction: false,
    }))));
    animation.start();
    return () => animation.stop();
  }, [ballBounce, doubles, motionAllowed, paused, rallyTravel, reducedMotion]);

  useEffect(() => () => bounceLoop.current?.stop(), []);
  return { rallyTravel, ballBounce, bounceBall };
}
