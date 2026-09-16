const DEFAULT_ACTION_IDENTIFIER = '__default_action__';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * notificationActions.js has module-load-time side effects (it configures
 * notification categories/channels and registers a response listener as soon
 * as it is imported) and a module-private `configuredPromise` cache. To keep
 * each test's view of that cache and of the mocked native calls independent,
 * every test loads a fresh copy of the module (and its dependencies) via
 * jest.resetModules()/require() instead of a single top-level import.
 */
function setupNotificationActions({
  platformOS = 'ios',
  categoryImpl,
  requireOptionalNativeModuleImpl,
  withTaskManager = false,
} = {}) {
  jest.resetModules();

  const loadNotifications = jest.fn(() => ({
    setNotificationChannelAsync: jest.fn(async () => {}),
    setNotificationCategoryAsync: jest.fn(categoryImpl || (async () => {})),
    getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    scheduleNotificationAsync: jest.fn(async () => 'scheduled-id'),
    dismissNotificationAsync: jest.fn(async () => {}),
    addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
    registerTaskAsync: jest.fn(async () => {}),
    AndroidImportance: { HIGH: 4 },
    AndroidNotificationVisibility: { PRIVATE: 0 },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
    DEFAULT_ACTION_IDENTIFIER,
  }));
  jest.doMock('expo-notifications', loadNotifications);

  jest.doMock('expo-modules-core', () => ({
    ...jest.requireActual('expo-modules-core'),
    requireOptionalNativeModule: jest.fn(
      requireOptionalNativeModuleImpl || (() => (withTaskManager ? {} : null))
    ),
  }));

  if (withTaskManager) {
    jest.doMock('expo-task-manager', () => ({
      isTaskDefined: jest.fn(() => false),
      defineTask: jest.fn(),
    }));
  }

  jest.doMock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

  const RN = require('react-native');
  RN.Platform.OS = platformOS;

  const notificationActions = require('../notificationActions');
  const notificationImportsOnLoad = loadNotifications.mock.calls.length;
  const Notifications = require('expo-notifications');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const { requireSupabase } = require('../../lib/supabase');
  const TaskManager = withTaskManager ? require('expo-task-manager') : null;

  return { notificationActions, Notifications, AsyncStorage, requireSupabase, Platform: RN.Platform, TaskManager, notificationImportsOnLoad };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('configureInteractiveNotifications', () => {
  it('is a no-op on web: resolves immediately without touching Notifications', async () => {
    const { notificationActions, Notifications, notificationImportsOnLoad } = setupNotificationActions({ platformOS: 'web' });
    await notificationActions.configureInteractiveNotifications();
    expect(notificationImportsOnLoad).toBe(0);
    expect(Notifications.setNotificationCategoryAsync).not.toHaveBeenCalled();
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('rejects native notification tests and ignores native responses on web', async () => {
    const { notificationActions, Notifications } = setupNotificationActions({ platformOS: 'web' });
    await expect(notificationActions.scheduleClosedAppNotificationTest()).rejects.toThrow('only available in the iOS and Android app');
    await expect(notificationActions.handleInteractiveNotificationResponse({
      actionIdentifier: notificationActions.READ_NOTIFICATION_ACTION,
      notification: { request: { identifier: 'web-notice', content: { data: { notificationId: 'notice-1' } } } },
    })).resolves.toBe(false);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it('registers the chat category with reply and mark-as-read actions on iOS, without touching Android channels', async () => {
    const { notificationActions, Notifications } = setupNotificationActions({ platformOS: 'ios' });
    await notificationActions.configureInteractiveNotifications();

    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      notificationActions.CHAT_NOTIFICATION_CATEGORY,
      [
        expect.objectContaining({ identifier: notificationActions.REPLY_NOTIFICATION_ACTION, buttonTitle: 'Reply' }),
        expect.objectContaining({ identifier: notificationActions.READ_NOTIFICATION_ACTION, buttonTitle: 'Mark as read' }),
      ],
      expect.objectContaining({ previewPlaceholder: 'New Peakle message' })
    );
  });

  it('creates both Android notification channels in addition to the category', async () => {
    const { notificationActions, Notifications } = setupNotificationActions({ platformOS: 'android' });
    await notificationActions.configureInteractiveNotifications();

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      notificationActions.CHAT_NOTIFICATION_CHANNEL,
      expect.objectContaining({ name: 'Messages', importance: 4 })
    );
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      notificationActions.SOCIAL_NOTIFICATION_CHANNEL,
      expect.objectContaining({ name: 'Follow requests', importance: 4 })
    );
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
  });

  it('caches the configuration promise: a second call does not re-register the category', async () => {
    const { notificationActions, Notifications } = setupNotificationActions({ platformOS: 'ios' });
    await flush(); // let the module's own load-time call settle first
    const callsAfterLoad = Notifications.setNotificationCategoryAsync.mock.calls.length;
    expect(callsAfterLoad).toBe(1);

    await notificationActions.configureInteractiveNotifications();
    await notificationActions.configureInteractiveNotifications();
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
  });

  it('clears the cached promise on failure so a later call retries', async () => {
    let call = 0;
    const { notificationActions, Notifications } = setupNotificationActions({
      platformOS: 'ios',
      categoryImpl: async () => {
        call += 1;
        if (call === 1) throw new Error('category registration failed');
      },
    });
    // The module's own load-time call is the failing first attempt; let it settle.
    await flush();

    await notificationActions.configureInteractiveNotifications();
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(2);
  });
});

describe('handleInteractiveNotificationResponse', () => {
  it('returns false and does nothing for a response with no action identifier', async () => {
    const { notificationActions, Notifications } = setupNotificationActions();
    const result = await notificationActions.handleInteractiveNotificationResponse({});
    expect(result).toBe(false);
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it('returns false for the platform default action (tapping the notification body)', async () => {
    const { notificationActions } = setupNotificationActions();
    const result = await notificationActions.handleInteractiveNotificationResponse({
      actionIdentifier: DEFAULT_ACTION_IDENTIFIER,
    });
    expect(result).toBe(false);
  });

  it('returns false and does not dismiss when there is no notificationId and it is not a test notification', async () => {
    const { notificationActions, Notifications } = setupNotificationActions();
    const result = await notificationActions.handleInteractiveNotificationResponse({
      actionIdentifier: 'some-action',
      notification: { request: { identifier: 'n1', content: { data: {} } } },
    });
    expect(result).toBe(false);
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it('returns false for an unrecognized action even when a notificationId is present, and does not dismiss', async () => {
    const { notificationActions, Notifications, requireSupabase } = setupNotificationActions();
    const result = await notificationActions.handleInteractiveNotificationResponse({
      actionIdentifier: 'some-unknown-action',
      notification: { request: { identifier: 'n1', content: { data: { notificationId: 'note-1' } } } },
    });
    expect(result).toBe(false);
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
    expect(requireSupabase).not.toHaveBeenCalled();
  });

  describe('reply action', () => {
    it('sends the trimmed reply text via RPC, then dismisses the notification', async () => {
      const { notificationActions, Notifications, requireSupabase } = setupNotificationActions();
      const rpc = jest.fn(async () => ({ data: null, error: null }));
      requireSupabase.mockReturnValue({ rpc });

      const result = await notificationActions.handleInteractiveNotificationResponse({
        actionIdentifier: notificationActions.REPLY_NOTIFICATION_ACTION,
        userText: '  On my way!  ',
        notification: { request: { identifier: 'n1', content: { data: { notificationId: 'note-1' } } } },
      });

      expect(rpc).toHaveBeenCalledWith('reply_to_direct_message_notification', {
        p_notification_id: 'note-1',
        p_body: 'On my way!',
      });
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('n1');
      expect(result).toBe(true);
    });

    it('skips the RPC call (but still dismisses) when the reply text is empty or whitespace-only', async () => {
      const { notificationActions, Notifications, requireSupabase } = setupNotificationActions();
      const rpc = jest.fn(async () => ({ data: null, error: null }));
      requireSupabase.mockReturnValue({ rpc });

      const result = await notificationActions.handleInteractiveNotificationResponse({
        actionIdentifier: notificationActions.REPLY_NOTIFICATION_ACTION,
        userText: '   ',
        notification: { request: { identifier: 'n1', content: { data: { notificationId: 'note-1' } } } },
      });

      expect(rpc).not.toHaveBeenCalled();
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('n1');
      expect(result).toBe(true);
    });

    it('propagates a server error instead of dismissing the notification', async () => {
      const { notificationActions, Notifications, requireSupabase } = setupNotificationActions();
      requireSupabase.mockReturnValue({ rpc: async () => ({ data: null, error: new Error('rls denied') }) });

      await expect(notificationActions.handleInteractiveNotificationResponse({
        actionIdentifier: notificationActions.REPLY_NOTIFICATION_ACTION,
        userText: 'hello',
        notification: { request: { identifier: 'n1', content: { data: { notificationId: 'note-1' } } } },
      })).rejects.toThrow('rls denied');
      expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
    });
  });

  describe('mark-as-read action', () => {
    it('marks the notification read via RPC, then dismisses it', async () => {
      const { notificationActions, Notifications, requireSupabase } = setupNotificationActions();
      const rpc = jest.fn(async () => ({ data: null, error: null }));
      requireSupabase.mockReturnValue({ rpc });

      const result = await notificationActions.handleInteractiveNotificationResponse({
        actionIdentifier: notificationActions.READ_NOTIFICATION_ACTION,
        notification: { request: { identifier: 'n1', content: { data: { notificationId: 'note-1' } } } },
      });

      expect(rpc).toHaveBeenCalledWith('mark_notification_read', { p_notification_id: 'note-1' });
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('n1');
      expect(result).toBe(true);
    });

    it('propagates a server error', async () => {
      const { notificationActions, requireSupabase } = setupNotificationActions();
      requireSupabase.mockReturnValue({ rpc: async () => ({ data: null, error: new Error('not found') }) });

      await expect(notificationActions.handleInteractiveNotificationResponse({
        actionIdentifier: notificationActions.READ_NOTIFICATION_ACTION,
        notification: { request: { identifier: 'n1', content: { data: { notificationId: 'note-1' } } } },
      })).rejects.toThrow('not found');
    });
  });

  describe('notification-test action (background delivery smoke test)', () => {
    function testResponse(id, { userText, actionIdentifier = 'reply-action' } = {}) {
      return {
        actionIdentifier,
        userText,
        notification: { request: { identifier: id, content: { data: { notificationTest: true } } } },
      };
    }

    it('records the result to AsyncStorage and dismisses the notification, without calling supabase', async () => {
      const { notificationActions, Notifications, AsyncStorage, requireSupabase } = setupNotificationActions();

      const result = await notificationActions.handleInteractiveNotificationResponse(
        testResponse('t1', { userText: 'It worked' })
      );

      expect(result).toBe(true);
      expect(requireSupabase).not.toHaveBeenCalled();
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        notificationActions.LAST_NOTIFICATION_TEST_KEY,
        expect.stringContaining('"reply":"It worked"')
      );
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('t1');
    });

    it('schedules a confirmation notification only when a reply was actually typed', async () => {
      const { notificationActions, Notifications } = setupNotificationActions();

      await notificationActions.handleInteractiveNotificationResponse(testResponse('t1', { userText: 'yes!' }));
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].content.body).toContain('yes!');

      Notifications.scheduleNotificationAsync.mockClear();
      await notificationActions.handleInteractiveNotificationResponse(testResponse('t2', { userText: '   ' }));
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('does not fail the response handling if dismissing the notification errors out', async () => {
      const { notificationActions, Notifications } = setupNotificationActions();
      Notifications.dismissNotificationAsync.mockImplementationOnce(async () => {
        throw new Error('already dismissed');
      });
      await expect(notificationActions.handleInteractiveNotificationResponse(testResponse('t1'))).resolves.toBe(true);
    });

    it('de-dupes by notification identifier: replaying the same response id is a no-op the second time', async () => {
      const { notificationActions, AsyncStorage } = setupNotificationActions();
      await notificationActions.handleInteractiveNotificationResponse(testResponse('dup-1', { userText: 'first' }));
      AsyncStorage.setItem.mockClear();

      await notificationActions.handleInteractiveNotificationResponse(testResponse('dup-1', { userText: 'second' }));
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('caps the de-dupe set size, evicting the oldest entries so they can be handled again', async () => {
      const { notificationActions, AsyncStorage } = setupNotificationActions();

      for (let i = 0; i < 25; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await notificationActions.handleInteractiveNotificationResponse(testResponse(`id-${i}`));
      }

      // id-0 was inserted first; with a cap of 20 and 25 insertions it must
      // have been evicted, so replaying it is processed again.
      AsyncStorage.setItem.mockClear();
      await notificationActions.handleInteractiveNotificationResponse(testResponse('id-0'));
      expect(AsyncStorage.setItem).toHaveBeenCalled();

      // id-24 was inserted last and is still within the cap, so it is still deduped.
      AsyncStorage.setItem.mockClear();
      await notificationActions.handleInteractiveNotificationResponse(testResponse('id-24'));
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });
  });
});

describe('scheduleClosedAppNotificationTest', () => {
  it('throws and never schedules when notification permission is not granted', async () => {
    const { notificationActions, Notifications } = setupNotificationActions();
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(notificationActions.scheduleClosedAppNotificationTest()).rejects.toThrow(
      'Allow notifications before running the test.'
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules with a plain time-interval trigger (no channel) on iOS, defaulting to 10 seconds', async () => {
    const { notificationActions, Notifications } = setupNotificationActions({ platformOS: 'ios' });

    const id = await notificationActions.scheduleClosedAppNotificationTest();

    expect(id).toBe('scheduled-id');
    const [args] = Notifications.scheduleNotificationAsync.mock.calls.slice(-1);
    expect(args[0].trigger).toEqual({ type: 'timeInterval', seconds: 10 });
    expect(args[0].content.sound).toBe('default');
    expect(args[0].content.categoryIdentifier).toBe(notificationActions.CHAT_NOTIFICATION_CATEGORY);
    expect(args[0].content.data).toEqual({ notificationTest: true, senderName: 'Alex from Peakle' });
  });

  it('uses the messages channel on Android without serializing a content sound Uri', async () => {
    const { notificationActions, Notifications } = setupNotificationActions({ platformOS: 'android' });

    await notificationActions.scheduleClosedAppNotificationTest(30);

    const [args] = Notifications.scheduleNotificationAsync.mock.calls.slice(-1);
    expect(args[0].trigger).toEqual({
      type: 'timeInterval',
      seconds: 30,
      channelId: notificationActions.CHAT_NOTIFICATION_CHANNEL,
    });
    expect(args[0].content).not.toHaveProperty('sound');
  });
});

describe('getLastNotificationTest', () => {
  it('returns null when nothing has been stored', async () => {
    const { notificationActions, AsyncStorage } = setupNotificationActions();
    AsyncStorage.getItem.mockResolvedValue(null);
    expect(await notificationActions.getLastNotificationTest()).toBeNull();
  });

  it('returns the parsed record when present', async () => {
    const { notificationActions, AsyncStorage } = setupNotificationActions();
    const record = { completedAt: '2026-08-10T00:00:00.000Z', reply: 'hi', action: 'peakle_reply' };
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(record));
    expect(await notificationActions.getLastNotificationTest()).toEqual(record);
  });

  it('returns null instead of throwing when the stored value is corrupt JSON', async () => {
    const { notificationActions, AsyncStorage } = setupNotificationActions();
    AsyncStorage.getItem.mockResolvedValue('{not json');
    expect(await notificationActions.getLastNotificationTest()).toBeNull();
  });
});

describe('module load-time wiring', () => {
  it('registers a notification-response listener on load (non-web) that forwards to the response handler', async () => {
    const { notificationActions, Notifications, AsyncStorage } = setupNotificationActions({ platformOS: 'ios' });
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);

    const listener = Notifications.addNotificationResponseReceivedListener.mock.calls[0][0];
    await listener({
      actionIdentifier: 'reply-action',
      userText: 'via listener',
      notification: { request: { identifier: 'listener-1', content: { data: { notificationTest: true } } } },
    });
    await flush();

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      notificationActions.LAST_NOTIFICATION_TEST_KEY,
      expect.stringContaining('via listener')
    );
  });

  it('does not register a background task on Android when the native TaskManager module is unavailable', () => {
    const { Notifications } = setupNotificationActions({ platformOS: 'android' });
    expect(Notifications.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('defines and registers the background notification-action task on Android when TaskManager is present', () => {
    const { Notifications, TaskManager } = setupNotificationActions({ platformOS: 'android', withTaskManager: true });
    expect(TaskManager.defineTask).toHaveBeenCalledWith('peakle-notification-actions', expect.any(Function));
    expect(Notifications.registerTaskAsync).toHaveBeenCalledWith('peakle-notification-actions');
  });
});
