import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Resets the scroll offset when its navigation screen becomes active again,
 * without unmounting the screen or discarding its local state.
 */
const FocusResetScrollView = forwardRef(function FocusResetScrollView(props, forwardedRef) {
  const scrollRef = useRef(null);

  useImperativeHandle(forwardedRef, () => scrollRef.current);

  useFocusEffect(useCallback(() => {
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
    });

    return () => cancelAnimationFrame(frame);
  }, []));

  return <ScrollView ref={scrollRef} {...props} />;
});

export default FocusResetScrollView;
