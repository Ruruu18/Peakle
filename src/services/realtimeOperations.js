import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { requireSupabase } from '../lib/supabase';

const operationsKey = (userId) => `@peakle/open-play-operations/${userId}`;
const deviceKey = '@peakle/push-device-id';
let operationLock = Promise.resolve();

function withOperationLock(work) {
  const next = operationLock.then(work, work);
  operationLock = next.catch(() => {});
  return next;
}

async function readJson(key, fallback) {
  const value = await AsyncStorage.getItem(key).catch(() => null);
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function getPendingOpenPlayOperations(userId) {
  if (!userId) return [];
  return readJson(operationsKey(userId), []);
}

export async function queueOpenPlayOperation(userId, { sessionId, baseRevision = 0, operation }) {
  if (!userId || !sessionId) throw new Error('A signed-in session is required.');
  return withOperationLock(async () => {
    const pending = await getPendingOpenPlayOperations(userId);
    const entry = {
      id: Crypto.randomUUID(),
      sessionId,
      baseRevision,
      operation,
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(operationsKey(userId), JSON.stringify([...pending, entry]));
    return entry;
  });
}

async function flushOpenPlayOperationsUnlocked(userId, { onApplied, onConflict } = {}) {
  if (!userId) return { pending: 0, applied: 0 };
  const key = operationsKey(userId);
  const pending = await getPendingOpenPlayOperations(userId);
  const remaining = [...pending];
  let applied = 0;
  let revision = null;
  while (remaining.length) {
    const entry = remaining[0];
    const baseRevision = revision ?? entry.baseRevision;
    const { data, error } = await requireSupabase().rpc('apply_open_play_operation', {
      p_operation_id: entry.id,
      p_session_id: entry.sessionId,
      p_base_revision: baseRevision,
      p_operation: entry.operation,
    });
    if (error) break;
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.conflict) {
      // Rebase once on the authoritative revision. The RPC still validates
      // that the target player is in a compatible state before applying.
      const { data: retry, error: retryError } = await requireSupabase().rpc('apply_open_play_operation', {
        p_operation_id: entry.id,
        p_session_id: entry.sessionId,
        p_base_revision: result.revision,
        p_operation: entry.operation,
      });
      if (retryError || retry?.conflict) { onConflict?.(entry, retryError || retry); break; }
      revision = retry.revision;
    } else revision = result?.revision ?? revision;
    remaining.shift();
    applied += 1;
    onApplied?.(entry, revision);
    await AsyncStorage.setItem(key, JSON.stringify(remaining));
  }
  return { pending: remaining.length, applied, revision };
}

export function flushOpenPlayOperations(userId, callbacks = {}) {
  return withOperationLock(() => flushOpenPlayOperationsUnlocked(userId, callbacks));
}

export async function savePushToken({ token, userId }) {
  if (!token || !userId || !['ios', 'android'].includes(Platform.OS)) return;
  let deviceId = await AsyncStorage.getItem(deviceKey);
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await AsyncStorage.setItem(deviceKey, deviceId);
  }
  const { error } = await requireSupabase().rpc('register_device_push_token', {
    p_expo_push_token: token,
    p_platform: Platform.OS,
    p_device_id: deviceId,
  });
  if (error) throw error;
}

export async function disablePushToken(userId) {
  if (!userId) return;
  const deviceId = await AsyncStorage.getItem(deviceKey);
  if (!deviceId) return;
  const { error } = await requireSupabase().from('device_push_tokens')
    .update({ enabled: false, last_seen_at: new Date().toISOString() })
    .eq('user_id', userId).eq('device_id', deviceId);
  if (error) throw error;
}

export async function listNotifications() {
  const { data, error } = await requireSupabase().from('user_notifications')
    .select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id) {
  const { error } = await requireSupabase().rpc('mark_notification_read', { p_notification_id: id });
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { data, error } = await requireSupabase().rpc('mark_all_notifications_read');
  if (error) throw error;
  return data || 0;
}

export async function deleteNotification(id) {
  const { data, error } = await requireSupabase().rpc('delete_notification', { p_notification_id: id });
  if (error) throw error;
  return Boolean(data);
}

export async function clearReadNotifications() {
  const { data, error } = await requireSupabase().rpc('clear_read_notifications');
  if (error) throw error;
  return data || 0;
}

export async function publishOpenPlayAnnouncement(sessionId, body) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to publish an announcement.');
  const { data, error } = await client.from('open_play_announcements').insert({
    session_id: sessionId,
    body: body.trim(),
    created_by: auth.user.id,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function listVenueStaff(venueId) {
  const { data, error } = await requireSupabase().from('venue_members')
    .select('venue_id, user_id, role, created_at, profiles!venue_members_user_id_fkey(display_name, avatar_url)')
    .eq('venue_id', venueId).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function setVenueStaffRole(venueId, userId, role) {
  const { data, error } = await requireSupabase().rpc('set_venue_staff_role', {
    p_venue_id: venueId, p_user_id: userId, p_role: role,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function removeVenueStaff(venueId, userId) {
  const { error } = await requireSupabase().rpc('remove_venue_staff', { p_venue_id: venueId, p_user_id: userId });
  if (error) throw error;
}
