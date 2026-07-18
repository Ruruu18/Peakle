import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { SectionList } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

const FocusResetSectionList = forwardRef(function FocusResetSectionList(props, forwardedRef) {
  const listRef = useRef(null);

  useImperativeHandle(forwardedRef, () => listRef.current);

  useFocusEffect(useCallback(() => {
    const frame = requestAnimationFrame(() => {
      listRef.current?.getScrollResponder()?.scrollTo({ x: 0, y: 0, animated: false });
    });

    return () => cancelAnimationFrame(frame);
  }, []));

  return <SectionList ref={listRef} {...props} />;
});

export default FocusResetSectionList;
