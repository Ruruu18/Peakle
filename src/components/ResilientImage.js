import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

/**
 * Keeps useful UI in the image frame while a remote image is loading or fails.
 * The fallback is rendered underneath the image, so a slow connection never
 * creates an empty flash.
 */
export default function ResilientImage({
  uri,
  style,
  imageStyle,
  fallback,
  errorFallback,
  fallbackColor = '#E5F0ED',
  indicatorColor = '#1C6B66',
  showLoadingIndicator = true,
  contentFit = 'cover',
  transition = 0,
  cachePolicy = 'memory-disk',
  accessibilityLabel,
}) {
  const [loadedUri, setLoadedUri] = useState(null);
  const [failedUri, setFailedUri] = useState(null);
  const status = !uri ? 'empty' : failedUri === uri ? 'error' : loadedUri === uri ? 'loaded' : 'loading';
  const visibleFallback = status === 'error' && errorFallback !== undefined ? errorFallback : fallback;

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[styles.frame, { backgroundColor: fallbackColor }, style]}
    >
      {visibleFallback === undefined ? (
        showLoadingIndicator && status === 'loading'
          ? <ActivityIndicator size="small" color={indicatorColor} />
          : null
      ) : visibleFallback}
      {uri && status !== 'error' ? (
        <Image
          source={{ uri }}
          contentFit={contentFit}
          transition={transition}
          cachePolicy={cachePolicy}
          onLoad={() => setLoadedUri(uri)}
          onError={() => setFailedUri(uri)}
          style={[StyleSheet.absoluteFillObject, imageStyle]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
