import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

function initials(name = '') {
  return name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'P';
}

export default function CartoonAvatar({ avatar, name, size = 64, style }) {
  if (avatar?.startsWith('http')) {
    return <Image source={{ uri: avatar }} contentFit="cover" transition={200} cachePolicy="memory-disk" style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }, style]} />;
  }
  return <View style={[styles.frame, styles.fallback, { width: size, height: size, borderRadius: size / 2 }, style]}><Text style={[styles.initials, { fontSize: size * .25 }]}>{initials(name)}</Text></View>;
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: '#FFFFFF' },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C6B66' },
  initials: { color: '#FFFFFF', fontWeight: '900' },
});
