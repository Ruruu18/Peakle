import React from 'react';
import { Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

const BALL_IMAGE = require('../../public/images/ball.png');

// Ionicons wrapper that swaps the generic tennis ball for the Peakle ball logo.
export default function AppIcon({ name, size = 20, color, style }) {
  if (typeof name === 'string' && name.startsWith('tennisball')) {
    return <Image source={BALL_IMAGE} accessibilityIgnoresInvertColors style={[{ width: size, height: size }, style]} tintColor={color} resizeMode="contain" />;
  }
  return <Ionicons name={name} size={size} color={color} style={style} />;
}
