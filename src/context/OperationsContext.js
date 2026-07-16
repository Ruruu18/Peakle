import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import {
  disablePushToken,
  flushOpenPlayOperations,
  getPendingOpenPlayOperations,
  listNotifications,
  markNotificationRead,
  queueOpenPlayOperation,
  savePushToken,
} from '../services/realtimeOperations';

const OperationsContext = createContext(null);

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export function OperationsProvider({ children }) {
  const { user } = useAuth();
  const [network, setNetwork] = useState({ isConnected: true, isInternetReachable: true });
  const [realtime, setRealtime] = useState('connected');
  const [pendingOperations, setPendingOperations] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const realtimeChannels = useRef(new Map());
  const flushing = useRef(false);

  const refreshNotifications = useCallback(async () => {
    if (!user?.id || !isSupabaseConfigured) { setNotifications([]); return []; }
    const rows = await listNotifications();
    setNotifications(rows);
    return rows;
  }, [user?.id]);

  const flush = useCallback(async () => {
    if (!user?.id || flushing.current || network.isConnected === false || network.isInternetReachable === false) return;
    flushing.current = true;
    try {
      const result = await flushOpenPlayOperations(user.id);
      setPendingOperations(result.pending);
    } finally { flushing.current = false; }
  }, [network.isConnected, network.isInternetReachable, user?.id]);

  useEffect(() => {
    Network.getNetworkStateAsync().then(setNetwork).catch(() => {});
    const subscription = Network.addNetworkStateListener(setNetwork);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!user?.id) { setPendingOperations(0); return; }
    getPendingOpenPlayOperations(user.id).then((items) => setPendingOperations(items.length));
  }, [user?.id]);

  useEffect(() => { flush().catch(() => {}); }, [flush]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') flush().catch(() => {}); });
    return () => subscription.remove();
  }, [flush]);

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return undefined;
    refreshNotifications().catch(() => {});
    const channel = requireSupabase().channel(`notifications-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, refreshNotifications)
      .subscribe();
    return () => { requireSupabase().removeChannel(channel); };
  }, [refreshNotifications, user?.id]);

  const reportRealtime = useCallback((key, status) => {
    if (status === 'REMOVE') {
      realtimeChannels.current.delete(key);
      if (!realtimeChannels.current.size) setRealtime('connected');
      return;
    }
    if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) realtimeChannels.current.set(key, status);
    const statuses = [...realtimeChannels.current.values()];
    if (statuses.some((value) => ['CHANNEL_ERROR', 'TIMED_OUT'].includes(value))) setRealtime('reconnecting');
    else if (statuses.length && statuses.every((value) => value === 'SUBSCRIBED')) setRealtime('connected');
    else setRealtime(status === 'SUBSCRIBED' ? 'connected' : 'connecting');
  }, []);

  const enqueueOperation = useCallback(async (sessionId, baseRevision, operation) => {
    const entry = await queueOpenPlayOperation(user?.id, { sessionId, baseRevision, operation });
    setPendingOperations((count) => count + 1);
    flush().catch(() => {});
    return entry;
  }, [flush, user?.id]);

  const enablePushNotifications = useCallback(async () => {
    if (Platform.OS === 'web' || !Device.isDevice) throw new Error('Push notifications require a physical iOS or Android device.');
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') throw new Error('Notification permission was not granted.');
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('open-play', {
      name: 'Open play operations', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250],
    });
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await savePushToken({ token, userId: user?.id });
    return token;
  }, [user?.id]);

  const disablePushNotifications = useCallback(() => disablePushToken(user?.id), [user?.id]);
  const readNotification = useCallback(async (id) => {
    await markNotificationRead(id);
    setNotifications((current) => current.map((notice) => notice.id === id ? { ...notice, read_at: new Date().toISOString() } : notice));
  }, []);
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const connectionState = !online ? 'offline' : realtime;
  const value = useMemo(() => ({
    connectionState, online, pendingOperations, reportRealtime, enqueueOperation, flush,
    notifications, unreadCount: notifications.filter((notice) => !notice.read_at).length,
    refreshNotifications, readNotification, enablePushNotifications, disablePushNotifications,
  }), [connectionState, disablePushNotifications, enablePushNotifications, enqueueOperation, flush, notifications, online, pendingOperations, readNotification, refreshNotifications, reportRealtime]);
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations() {
  const value = useContext(OperationsContext);
  if (!value) throw new Error('useOperations must be used inside OperationsProvider');
  return value;
}
