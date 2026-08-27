import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { requireSupabase } from '../lib/supabase';

export const CHAT_NOTIFICATION_CATEGORY = 'peakle_direct_message';
export const CHAT_NOTIFICATION_CHANNEL = 'messages';
export const SOCIAL_NOTIFICATION_CHANNEL = 'social';
export const REPLY_NOTIFICATION_ACTION = 'peakle_reply';
export const READ_NOTIFICATION_ACTION = 'peakle_mark_read';
export const NOTIFICATION_ACTION_TASK = 'peakle-notification-actions';
export const LAST_NOTIFICATION_TEST_KEY = '@peakle/last-notification-test';

let configuredPromise;
const handledTestResponses = new Set();
const HANDLED_TEST_RESPONSES_MAX = 20;
const hasNativeTaskManager = Platform.OS === 'android'
  && Boolean(requireOptionalNativeModule('ExpoTaskManager'));
const TaskManager = hasNativeTaskManager
  ? require('expo-task-manager')
  : null;

async function configureNotificationChannels() {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationChannelAsync(CHAT_NOTIFICATION_CHANNEL, {
      name: 'Messages',
      description: 'Private messages and message requests',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: '#D6E94A',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: true,
    }),
    Notifications.setNotificationChannelAsync(SOCIAL_NOTIFICATION_CHANNEL, {
      name: 'Follow requests',
      description: 'New follow requests and accepted requests',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: '#D6E94A',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: true,
    }),
  ]);
}

export function configureInteractiveNotifications() {
  if (Platform.OS === 'web') return Promise.resolve();
  if (!configuredPromise) {
    configuredPromise = Promise.all([
      configureNotificationChannels(),
      Notifications.setNotificationCategoryAsync(CHAT_NOTIFICATION_CATEGORY, [
        {
          identifier: REPLY_NOTIFICATION_ACTION,
          buttonTitle: 'Reply',
          textInput: { submitButtonTitle: 'Send', placeholder: 'Message…' },
          options: { opensAppToForeground: false },
        },
        {
          identifier: READ_NOTIFICATION_ACTION,
          buttonTitle: 'Mark as read',
          options: { opensAppToForeground: false },
        },
      ], {
        previewPlaceholder: 'New Peakle message',
        showTitle: true,
        showSubtitle: true,
      }),
    ]).catch((error) => {
      configuredPromise = undefined;
      throw error;
    });
  }
  return configuredPromise;
}

async function markNotificationRead(notificationId) {
  if (!notificationId) return;
  const { error } = await requireSupabase().rpc('mark_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
}

async function replyToMessageNotification(notificationId, body) {
  const clean = body?.trim();
  if (!notificationId || !clean) return;
  const { error } = await requireSupabase().rpc('reply_to_direct_message_notification', {
    p_notification_id: notificationId,
    p_body: clean,
  });
  if (error) throw error;
}

async function recordTestReply(response) {
  const responseKey = response.notification?.request?.identifier;
  if (responseKey && handledTestResponses.has(responseKey)) return;
  if (responseKey) {
    handledTestResponses.add(responseKey);
    while (handledTestResponses.size > HANDLED_TEST_RESPONSES_MAX) {
      handledTestResponses.delete(handledTestResponses.values().next().value);
    }
  }
  const clean = response.userText?.trim();
  const result = {
    completedAt: new Date().toISOString(),
    reply: clean || null,
    action: response.actionIdentifier,
  };
  await AsyncStorage.setItem(LAST_NOTIFICATION_TEST_KEY, JSON.stringify(result));
  if (clean) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Notification test passed',
        body: `Peakle received your reply: “${clean.slice(0, 80)}”`,
        sound: 'default',
        data: { notificationTestAcknowledgement: true },
      },
      trigger: null,
    });
  }
}

export async function handleInteractiveNotificationResponse(response) {
  const action = response?.actionIdentifier;
  if (!action || action === Notifications.DEFAULT_ACTION_IDENTIFIER) return false;
  const request = response.notification?.request;
  const data = request?.content?.data || {};

  if (data.notificationTest) {
    await recordTestReply(response);
    await Notifications.dismissNotificationAsync(request.identifier).catch(() => {});
    return true;
  }

  if (!data.notificationId) return false;
  if (action === REPLY_NOTIFICATION_ACTION) {
    await replyToMessageNotification(data.notificationId, response.userText);
  } else if (action === READ_NOTIFICATION_ACTION) {
    await markNotificationRead(data.notificationId);
  } else {
    return false;
  }
  await Notifications.dismissNotificationAsync(request.identifier).catch(() => {});
  return true;
}

export async function scheduleClosedAppNotificationTest(seconds = 10) {
  await configureInteractiveNotifications();
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Allow notifications before running the test.');
  // Some Android notification schedulers try to persist the resolved default
  // sound Uri and fail because android.net.Uri is not Serializable. The
  // messages channel already supplies the device's default sound on Android,
  // so only send the content-level sound override to iOS.
  const sound = Platform.OS === 'android' ? {} : { sound: 'default' };
  const trigger = Platform.OS === 'android'
    ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: CHAT_NOTIFICATION_CHANNEL }
    : { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds };
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Alex from Peakle',
      subtitle: 'Notification test',
      body: 'Are we still on for pickleball tonight?',
      ...sound,
      categoryIdentifier: CHAT_NOTIFICATION_CATEGORY,
      data: { notificationTest: true, senderName: 'Alex from Peakle' },
    },
    trigger,
  });
}

export async function getLastNotificationTest() {
  const stored = await AsyncStorage.getItem(LAST_NOTIFICATION_TEST_KEY);
  if (!stored) return null;
  try { return JSON.parse(stored); } catch { return null; }
}

if (TaskManager && !TaskManager.isTaskDefined(NOTIFICATION_ACTION_TASK)) {
  TaskManager.defineTask(NOTIFICATION_ACTION_TASK, async ({ data, error }) => {
    if (error || !data || !('actionIdentifier' in data)) return;
    await handleInteractiveNotificationResponse(data);
  });
}

if (TaskManager) {
  Notifications.registerTaskAsync(NOTIFICATION_ACTION_TASK).catch(() => {});
}

if (Platform.OS !== 'web') {
  configureInteractiveNotifications().catch(() => {});
  Notifications.addNotificationResponseReceivedListener((response) => {
    handleInteractiveNotificationResponse(response).catch(() => {});
  });
}
