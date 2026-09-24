import React from 'react';
import { Modal } from 'react-native';
import useDesktopLayout from '../hooks/useDesktopLayout';

// Preserve RN's focus trap, Escape handling, and native presentation semantics.
export default function ResponsiveModal({ animationType, ...props }) {
  const desktop = useDesktopLayout();
  return <Modal {...props} animationType={desktop && animationType === 'slide' ? 'fade' : animationType} />;
}
