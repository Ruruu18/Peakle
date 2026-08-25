import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { DEMO_MODE } from '../config/demoMode';

/**
 * Resets the scroll offset when its navigation screen becomes active again,
 * without unmounting the screen or discarding its local state. In demo-mode
 * builds it also drifts slowly up and down while focused, so a screen
 * recording shows motion without anyone touching the device.
 */
const FocusResetScrollView = forwardRef(function FocusResetScrollView(props, forwardedRef) {
  const scrollRef = useRef(null);

  useImperativeHandle(forwardedRef, () => scrollRef.current);

  useFocusEffect(useCallback(() => {
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
    });

    if (!DEMO_MODE) return () => cancelAnimationFrame(frame);

    const timers = [];
    const loop = () => {
      timers.push(setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
        timers.push(setTimeout(() => {
          timers.push(setTimeout(() => {
            scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
            timers.push(setTimeout(loop, 3500));
          }, 1500));
        }, 5000));
      }, 1200));
    };
    loop();

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  }, []));

  return <ScrollView ref={scrollRef} {...props} />;
});

export default FocusResetScrollView;
