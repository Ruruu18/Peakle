import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import {
  CHAT_MESSAGE_NOTIFICATION_KIND,
  clearReadNotifications,
  deleteNotification,
  disablePushToken,
  flushOpenPlayOperations,
  getPendingOpenPlayOperations,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  queueOpenPlayOperation,
  savePushToken,
} from '../services/realtimeOperations';
import { respondFollowRequest as respondToFollowRequest } from '../services/directMessages';
import { configureInteractiveNotifications } from '../services/notificationActions';
import { PRIVATE_MESSAGES_ENABLED } from '../config/features';
import { readCachedData, writeCachedData } from '../lib/asyncData';
import { notificationsCacheKey } from '../lib/cacheKeys';

const Notifications = Platform.OS === 'web' ? null : require('expo-notifications');
const OperationsContext = createContext(null);

// While the app is open, chat messages are announced by the in-app
// MessageBanner, so the OS banner would only duplicate it.
if (Platform.OS !== 'web') Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const inAppBanner = PRIVATE_MESSAGES_ENABLED && notification?.request?.content?.data?.notificationKind === CHAT_MESSAGE_NOTIFICATION_KIND;
    return { shouldShowBanner: !inAppBanner, shouldShowList: true, shouldPlaySound: !inAppBanner, shouldSetBadge: true };
  },
});

const visibleNotice = (notice) => notice.kind !== CHAT_MESSAGE_NOTIFICATION_KIND
  && (PRIVATE_MESSAGES_ENABLED || (!notice.data?.conversationId && !String(notice.kind || '').startsWith('direct_message')));
const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);

export function OperationsProvider({ children }) {
  const { user } = useAuth();
  const [network, setNetwork] = useState({ isConnected: true, isInternetReachable: true });
  const [realtime, setRealtime] = useState('connected');
  const [pendingOperations, setPendingOperations] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [messageBanner, setMessageBanner] = useState(null);
  const realtimeChannels = useRef(new Map());
  const flushing = useRef(false);
  const notificationsLoaded = useRef(false);

  const refreshNotifications = useCallback(async () => {
    if (!user?.id || !isSupabaseConfigured) { setNotifications([]); return []; }
    const rows = (await listNotifications()).filter(visibleNotice);
    notificationsLoaded.current = true;
    setNotifications(rows);
    writeCachedData(notificationsCacheKey(user.id), rows).catch(() => {});
    return rows;
  }, [user?.id]);
  // Apply a realtime change directly instead of refetching the whole inbox.
  const applyNotificationChange = useCallback((payload) => {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id;
      if (id) setNotifications((current) => current.filter((notice) => notice.id !== id));
      return;
    }
    const row = payload.new;
    if (!row?.id) return;
    const bannerKind = row.kind === CHAT_MESSAGE_NOTIFICATION_KIND || row.kind === 'direct_message_request';
    if (bannerKind && payload.eventType === 'INSERT' && !row.read_at && PRIVATE_MESSAGES_ENABLED) setMessageBanner(row);
    if (!visibleNotice(row)) return;
    setNotifications((current) => {
      const existing = current.findIndex((notice) => notice.id === row.id);
      if (existing < 0) return [row, ...current].sort(byNewest).slice(0, 50);
      const next = [...current];
      next[existing] = { ...next[existing], ...row };
      return next;
    });
  }, []);
  const dismissMessageBanner = useCallback(() => setMessageBanner(null), []);

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
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        flush().catch(() => {});
        refreshNotifications().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [flush, refreshNotifications]);

  useEffect(() => {
    setMessageBanner(null);
    notificationsLoaded.current = false;
    if (!user?.id || !isSupabaseConfigured) return undefined;
    let cancelled = false;
    // Show the last known inbox immediately; the fresh list replaces it.
    readCachedData(notificationsCacheKey(user.id)).then((cached) => {
      if (!cancelled && !notificationsLoaded.current && Array.isArray(cached)) setNotifications(cached);
    }).catch(() => {});
    refreshNotifications().catch(() => {});
    const channel = requireSupabase().channel(`notifications-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, applyNotificationChange)
      .subscribe();
    return () => { cancelled = true; requireSupabase().removeChannel(channel); };
  }, [applyNotificationChange, refreshNotifications, user?.id]);


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
    await configureInteractiveNotifications();
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
  useEffect(() => {
    if (!user?.id || !user.onboardingCompleted || Platform.OS === 'web' || !Device.isDevice) return;
    const preferences = user.preferences || {};
    const hasEnabledPreference = preferences.messages !== false
      || preferences.squad !== false
      || preferences.reminders !== false
      || preferences.organizerCourtAlerts === true
      || preferences.organizerCheckInAlerts === true;
    if (!hasEnabledPreference) return;
    Notifications.getPermissionsAsync()
      .then((permission) => {
        if (permission.status === 'granted') {
          return enablePushNotifications();
        }
        return null;
      })
      .catch(() => {});
  }, [
    enablePushNotifications,
    user?.id,
    user?.onboardingCompleted,
    user?.preferences?.organizerCheckInAlerts,
    user?.preferences?.organizerCourtAlerts,
    user?.preferences?.messages,
    user?.preferences?.reminders,
    user?.preferences?.squad,
  ]);

  const readNotification = useCallback(async (id) => {
    await markNotificationRead(id);
    setNotifications((current) => current.map((notice) => notice.id === id ? { ...notice, read_at: new Date().toISOString() } : notice));
  }, []);
  const readAllNotifications = useCallback(async () => {
    await markAllNotificationsRead();
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((notice) => notice.read_at ? notice : { ...notice, read_at: readAt }));
  }, []);
  const removeNotification = useCallback(async (id) => {
    await deleteNotification(id);
    setNotifications((current) => current.filter((notice) => notice.id !== id));
  }, []);
  const clearNotifications = useCallback(async () => {
    await clearReadNotifications();
    setNotifications((current) => current.filter((notice) => !notice.read_at || notice.kind === 'follow_request'));
  }, []);
  const respondFollowRequest = useCallback(async (requesterId, accept, notificationId) => {
    const accepted = await respondToFollowRequest(requesterId, accept);
    setNotifications((current) => current.filter((notice) => notice.id !== notificationId));
    return accepted;
  }, []);
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const connectionState = !online ? 'offline' : realtime;
  const value = useMemo(() => ({
    connectionState, online, pendingOperations, reportRealtime, enqueueOperation, flush,
    notifications, unreadCount: notifications.filter((notice) => !notice.read_at).length,
    messageBanner, dismissMessageBanner,
    refreshNotifications, readNotification, readAllNotifications, removeNotification, clearNotifications, respondFollowRequest, enablePushNotifications, disablePushNotifications,
  }), [clearNotifications, connectionState, dismissMessageBanner, messageBanner, disablePushNotifications, enablePushNotifications, enqueueOperation, flush, notifications, online, pendingOperations, readAllNotifications, readNotification, refreshNotifications, removeNotification, reportRealtime, respondFollowRequest]);
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations() {
  const value = useContext(OperationsContext);
  if (!value) throw new Error('useOperations must be used inside OperationsProvider');
  return value;
}
