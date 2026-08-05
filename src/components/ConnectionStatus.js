import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useOperations } from '../context/OperationsContext';

export default function ConnectionStatus({ compact = false }) {
  const { connectionState, pendingOperations } = useOperations();
  const stateToken = `${connectionState}:${pendingOperations > 0}`;
  const [revealedToken, setRevealedToken] = useState(null);

  useEffect(() => {
    setRevealedToken(null);
    if (connectionState === 'connected' && !pendingOperations) return undefined;
    // Channel setup and brief reconnects are normal. Keep them in the
    // background so route changes never flash a warning banner.
    const delay = pendingOperations ? 750 : connectionState === 'offline' ? 2500 : 8000;
    const timer = setTimeout(() => setRevealedToken(stateToken), delay);
    return () => clearTimeout(timer);
  }, [connectionState, pendingOperations, stateToken]);

  if (connectionState === 'connected' && !pendingOperations) return compact
    ? <View accessibilityLabel="Live connection healthy" style={styles.dot} /> : null;
  if (revealedToken !== stateToken) return null;
  const config = connectionState === 'offline'
    ? ['cloud-offline-outline', 'Offline', pendingOperations ? `${pendingOperations} saved change${pendingOperations === 1 ? '' : 's'}` : 'Changes stay on this device']
    : pendingOperations
      ? ['sync-outline', 'Syncing in background', `${pendingOperations} saved change${pendingOperations === 1 ? '' : 's'} waiting to sync`]
      : ['time-outline', 'Live updates delayed', 'Peakle is still restoring the live connection'];
  if (compact) return <View accessibilityLabel={`${config[1]}. ${config[2]}`} style={[styles.dot, styles.dotWarning]} />;
  return <View style={styles.banner}><Ionicons name={config[0]} size={17} color="#0E2321" /><View><Text style={styles.title}>{config[1]}</Text><Text style={styles.meta}>{config[2]}</Text></View></View>;
}

const styles = createMobileStyleSheet({
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D6E94A' },
  dotWarning: { backgroundColor: '#E39A45' },
  banner: { minHeight: 47, marginBottom: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: '#F3D8A9' },
  title: { color: '#0E2321', fontSize: 9, fontWeight: '900' },
  meta: { marginTop: 2, color: '#3C4A45', fontSize: 7.5 },
});
