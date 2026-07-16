import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useOperations } from '../context/OperationsContext';

export default function ConnectionStatus({ compact = false }) {
  const { connectionState, pendingOperations } = useOperations();
  if (connectionState === 'connected' && !pendingOperations) return compact
    ? <View accessibilityLabel="Live connection healthy" style={styles.dot} /> : null;
  const config = connectionState === 'offline'
    ? ['cloud-offline-outline', 'Offline', pendingOperations ? `${pendingOperations} saved change${pendingOperations === 1 ? '' : 's'}` : 'Changes stay on this device']
    : ['sync-outline', 'Reconnecting', pendingOperations ? `${pendingOperations} change${pendingOperations === 1 ? '' : 's'} waiting` : 'Live updates will resume automatically'];
  if (compact) return <View accessibilityLabel={`${config[1]}. ${config[2]}`} style={[styles.dot, styles.dotWarning]} />;
  return <View style={styles.banner}><Ionicons name={config[0]} size={17} color="#0E2321" /><View><Text style={styles.title}>{config[1]}</Text><Text style={styles.meta}>{config[2]}</Text></View></View>;
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D6E94A' },
  dotWarning: { backgroundColor: '#E39A45' },
  banner: { minHeight: 47, marginBottom: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: '#F3D8A9' },
  title: { color: '#0E2321', fontSize: 9, fontWeight: '900' },
  meta: { marginTop: 2, color: '#3C4A45', fontSize: 7.5 },
});

