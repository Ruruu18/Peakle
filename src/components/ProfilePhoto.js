import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ResilientImage from './ResilientImage';
import { normalizeProfilePhoto } from '../services/profilePhotos';

function initials(name = '') {
  return name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'P';
}

export default function ProfilePhoto({ photo, name, size = 64, style }) {
  const visiblePhoto = normalizeProfilePhoto(photo);
  const radius = size / 2;
  const fallback = <View style={[styles.fallback, { borderRadius: radius }]}><Text style={[styles.initials, { fontSize: size * .25 }]}>{initials(name)}</Text></View>;
  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: radius }, style]}>
      <ResilientImage
        uri={visiblePhoto}
        accessibilityLabel={`${name || 'Player'} profile photo`}
        fallback={fallback}
        fallbackColor="#1C6B66"
        contentFit="cover"
        style={styles.image}
        imageStyle={{ borderRadius: radius }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C6B66' },
  initials: { color: '#FFFFFF', fontWeight: '900' },
});
