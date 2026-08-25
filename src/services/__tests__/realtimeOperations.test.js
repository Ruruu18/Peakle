import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { requireSupabase } from '../../lib/supabase';
import {
  getPendingOpenPlayOperations,
  queueOpenPlayOperation,
  flushOpenPlayOperations,
  savePushToken,
  disablePushToken,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearReadNotifications,
  publishOpenPlayAnnouncement,
  listVenueStaff,
  setVenueStaffRole,
  removeVenueStaff,
} from '../realtimeOperations';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'generated-uuid') }));

function mockClient(overrides = {}) {
  const client = {
    rpc: jest.fn(overrides.rpc || (async () => ({ data: null, error: null }))),
    from: overrides.from,
    auth: overrides.auth,
  };
  requireSupabase.mockReturnValue(client);
  return client;
}

const originalPlatformOS = Platform.OS;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  Platform.OS = originalPlatformOS;
});

afterAll(() => {
  Platform.OS = originalPlatformOS;
});

describe('getPendingOpenPlayOperations (AsyncStorage-backed read helper)', () => {
  it('returns an empty array without touching storage when there is no user', async () => {
    expect(await getPendingOpenPlayOperations(null)).toEqual([]);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('returns an empty array when nothing has been stored for this user', async () => {
    expect(await getPendingOpenPlayOperations('u1')).toEqual([]);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('@peakle/open-play-operations/u1');
  });

  it('falls back to an empty array instead of throwing when the stored value is corrupt JSON', async () => {
    await AsyncStorage.setItem('@peakle/open-play-operations/u1', '{not valid json');
    expect(await getPendingOpenPlayOperations('u1')).toEqual([]);
  });

  it('falls back to an empty array when AsyncStorage.getItem itself rejects', async () => {
    AsyncStorage.getItem.mockImplementationOnce(async () => {
      throw new Error('disk error');
    });
    expect(await getPendingOpenPlayOperations('u1')).toEqual([]);
  });

  it('returns the parsed, per-user list when present', async () => {
    const stored = [{ id: 'op1', sessionId: 's1' }];
    await AsyncStorage.setItem('@peakle/open-play-operations/u1', JSON.stringify(stored));
    expect(await getPendingOpenPlayOperations('u1')).toEqual(stored);
    // A different user's key must not be touched.
    expect(await getPendingOpenPlayOperations('u2')).toEqual([]);
  });
});

describe('queueOpenPlayOperation', () => {
  it('requires both a signed-in user and a sessionId', async () => {
    await expect(queueOpenPlayOperation(null, { sessionId: 's1', operation: {} })).rejects.toThrow(
      'A signed-in session is required.'
    );
    await expect(queueOpenPlayOperation('u1', { sessionId: null, operation: {} })).rejects.toThrow(
      'A signed-in session is required.'
    );
    expect(Crypto.randomUUID).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('appends a new entry (with a generated id and default baseRevision) to any existing pending queue', async () => {
    await AsyncStorage.setItem('@peakle/open-play-operations/u1', JSON.stringify([{ id: 'existing' }]));

    const entry = await queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'checkIn' } });

    expect(entry).toEqual(expect.objectContaining({
      id: 'generated-uuid',
      sessionId: 's1',
      baseRevision: 0,
      operation: { type: 'checkIn' },
    }));
    expect(typeof entry.createdAt).toBe('string');

    const pending = await getPendingOpenPlayOperations('u1');
    expect(pending).toEqual([{ id: 'existing' }, entry]);
  });

  it('honors an explicit baseRevision instead of defaulting to 0', async () => {
    const entry = await queueOpenPlayOperation('u1', { sessionId: 's1', baseRevision: 7, operation: {} });
    expect(entry.baseRevision).toBe(7);
  });
});

describe('withOperationLock serialization (exercised via queueOpenPlayOperation)', () => {
  it('runs overlapping calls in sequence so no queued entry is lost to a read-modify-write race', async () => {
    const p1 = queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'a' } });
    const p2 = queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'b' } });

    const [entry1, entry2] = await Promise.all([p1, p2]);

    const pending = await getPendingOpenPlayOperations('u1');
    expect(pending.map((e) => e.operation)).toEqual([{ type: 'a' }, { type: 'b' }]);
    expect(pending.map((e) => e.id)).toEqual([entry1.id, entry2.id]);
  });

  it('does not break the lock for later operations when an earlier one rejects', async () => {
    AsyncStorage.setItem.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });

    const p1 = queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'will-fail' } });
    const p2 = queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'will-succeed' } });

    await expect(p1).rejects.toThrow('disk full');
    const entry2 = await p2;
    expect(entry2.operation).toEqual({ type: 'will-succeed' });

    // Only the second (successful) write persisted.
    const pending = await getPendingOpenPlayOperations('u1');
    expect(pending.map((e) => e.operation)).toEqual([{ type: 'will-succeed' }]);

    // And the lock keeps working for further calls after the failure.
    const entry3 = await queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'c' } });
    expect(entry3.operation).toEqual({ type: 'c' });
  });
});

describe('flushOpenPlayOperations', () => {
  it('is a no-op when there is no user, without contacting supabase', async () => {
    const client = mockClient();
    const result = await flushOpenPlayOperations(null);
    expect(result).toEqual({ pending: 0, applied: 0 });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns zeroed counters when the queue is already empty', async () => {
    const client = mockClient();
    const result = await flushOpenPlayOperations('u1');
    expect(result).toEqual({ pending: 0, applied: 0, revision: null });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('applies a single pending operation, persists the shrunken queue, and reports it via onApplied', async () => {
    await queueOpenPlayOperation('u1', { sessionId: 's1', baseRevision: 3, operation: { type: 'checkIn' } });
    const client = mockClient({ rpc: async () => ({ data: [{ revision: 9 }], error: null }) });

    const onApplied = jest.fn();
    const result = await flushOpenPlayOperations('u1', { onApplied });

    expect(client.rpc).toHaveBeenCalledWith('apply_open_play_operation', {
      p_operation_id: 'generated-uuid',
      p_session_id: 's1',
      p_base_revision: 3,
      p_operation: { type: 'checkIn' },
    });
    expect(result).toEqual({ pending: 0, applied: 1, revision: 9 });
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }), 9);
    expect(await getPendingOpenPlayOperations('u1')).toEqual([]);
  });

  it('chains the returned revision into the next operation instead of that operation\'s own stale baseRevision', async () => {
    await queueOpenPlayOperation('u1', { sessionId: 's1', baseRevision: 1, operation: { type: 'a' } });
    await queueOpenPlayOperation('u1', { sessionId: 's1', baseRevision: 1, operation: { type: 'b' } });

    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: [{ revision: 5 }], error: null })
      .mockResolvedValueOnce({ data: [{ revision: 6 }], error: null });
    mockClient({ rpc });

    const result = await flushOpenPlayOperations('u1');

    expect(rpc.mock.calls[0][1].p_base_revision).toBe(1);
    expect(rpc.mock.calls[1][1].p_base_revision).toBe(5);
    expect(result).toEqual({ pending: 0, applied: 2, revision: 6 });
  });

  it('stops (without persisting) at the first server error, leaving the rest of the queue untouched', async () => {
    await queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'a' } });
    await queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'b' } });
    AsyncStorage.setItem.mockClear();

    mockClient({ rpc: async () => ({ data: null, error: new Error('conflict') }) });

    const result = await flushOpenPlayOperations('u1');
    expect(result).toEqual({ pending: 2, applied: 0, revision: null });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(await getPendingOpenPlayOperations('u1')).toHaveLength(2);
  });

  it('retries once on a conflict at the authoritative revision, and applies successfully if the retry clears', async () => {
    await queueOpenPlayOperation('u1', { sessionId: 's1', baseRevision: 1, operation: { type: 'a' } });
    // Note: unlike the initial attempt (which unwraps an array response via
    // `Array.isArray(data) ? data[0] : data`), the retry branch at
    // realtimeOperations.js:64-71 reads `retry.conflict`/`retry.revision`
    // directly off the RPC response with no such unwrap. It only behaves
    // correctly here because the retry mock returns a plain object; see the
    // dedicated bug-documentation test below for what happens with an
    // array-shaped response (the same shape the initial call assumes).
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: [{ conflict: true, revision: 10 }], error: null })
      .mockResolvedValueOnce({ data: { revision: 11 }, error: null });
    mockClient({ rpc });

    const result = await flushOpenPlayOperations('u1');

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1].p_base_revision).toBe(10);
    expect(result).toEqual({ pending: 0, applied: 1, revision: 11 });
  });

  it('reports an unresolved conflict via onConflict and stops without applying it', async () => {
    await queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'a' } });
    await queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'b' } });
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: [{ conflict: true, revision: 10 }], error: null })
      .mockResolvedValueOnce({ data: { conflict: true, revision: 10 }, error: null });
    mockClient({ rpc });

    const onConflict = jest.fn();
    const onApplied = jest.fn();
    const result = await flushOpenPlayOperations('u1', { onConflict, onApplied });

    expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ operation: { type: 'a' } }), expect.objectContaining({ conflict: true }));
    expect(onApplied).not.toHaveBeenCalled();
    expect(result).toEqual({ pending: 2, applied: 0, revision: null });
  });

  it('unwraps an array-shaped retry response the same way as the initial response, so a still-conflicting retry is correctly detected', async () => {
    // Both the initial call and the retry unwrap `Array.isArray(data) ? data[0] : data`
    // before reading `.conflict`/`.revision`, so an array-wrapped retry response
    // is handled identically to a plain-object one.
    await queueOpenPlayOperation('u1', { sessionId: 's1', baseRevision: 1, operation: { type: 'a' } });
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: [{ conflict: true, revision: 10 }], error: null })
      .mockResolvedValueOnce({ data: [{ conflict: true, revision: 10 }], error: null });
    mockClient({ rpc });

    const onConflict = jest.fn();
    const result = await flushOpenPlayOperations('u1', { onConflict });

    expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ operation: { type: 'a' } }), expect.objectContaining({ conflict: true }));
    expect(result).toEqual({ pending: 1, applied: 0, revision: null });
  });

  it('reports a retry-call error via onConflict too', async () => {
    await queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'a' } });
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: [{ conflict: true, revision: 10 }], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('retry failed') });
    mockClient({ rpc });

    const onConflict = jest.fn();
    await flushOpenPlayOperations('u1', { onConflict });
    expect(onConflict).toHaveBeenCalledWith(expect.anything(), expect.any(Error));
  });

  it('works without callbacks being supplied at all', async () => {
    await queueOpenPlayOperation('u1', { sessionId: 's1', operation: { type: 'a' } });
    mockClient({ rpc: async () => ({ data: [{ revision: 1 }], error: null }) });
    await expect(flushOpenPlayOperations('u1')).resolves.toEqual({ pending: 0, applied: 1, revision: 1 });
  });
});

describe('savePushToken', () => {
  it('is a no-op when the token, userId, or platform is missing/unsupported', async () => {
    const client = mockClient();
    await savePushToken({ token: null, userId: 'u1' });
    await savePushToken({ token: 't', userId: null });
    Platform.OS = 'web';
    await savePushToken({ token: 't', userId: 'u1' });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('generates and persists a new device id on first registration', async () => {
    Platform.OS = 'ios';
    const client = mockClient({ rpc: async () => ({ data: null, error: null }) });

    await savePushToken({ token: 'expo-token', userId: 'u1' });

    expect(Crypto.randomUUID).toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@peakle/push-device-id', 'generated-uuid');
    expect(client.rpc).toHaveBeenCalledWith('register_device_push_token', {
      p_expo_push_token: 'expo-token',
      p_platform: 'ios',
      p_device_id: 'generated-uuid',
    });
  });

  it('reuses an already-stored device id instead of generating a new one', async () => {
    Platform.OS = 'android';
    await AsyncStorage.setItem('@peakle/push-device-id', 'existing-device-id');
    const client = mockClient({ rpc: async () => ({ data: null, error: null }) });

    await savePushToken({ token: 'expo-token', userId: 'u1' });

    expect(Crypto.randomUUID).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith('register_device_push_token', {
      p_expo_push_token: 'expo-token',
      p_platform: 'android',
      p_device_id: 'existing-device-id',
    });
  });

  it('throws on a server error', async () => {
    Platform.OS = 'ios';
    mockClient({ rpc: async () => ({ data: null, error: new Error('registration rejected') }) });
    await expect(savePushToken({ token: 't', userId: 'u1' })).rejects.toThrow('registration rejected');
  });
});

describe('disablePushToken', () => {
  it('is a no-op with no user', async () => {
    const client = mockClient();
    await disablePushToken(null);
    expect(client.from).toBeUndefined();
  });

  it('is a no-op when no device id has ever been stored on this device', async () => {
    const client = mockClient({ from: jest.fn() });
    await disablePushToken('u1');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('disables the stored device id for the given user', async () => {
    await AsyncStorage.setItem('@peakle/push-device-id', 'dev-1');
    const eq2 = jest.fn(async () => ({ error: null }));
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const update = jest.fn(() => ({ eq: eq1 }));
    const from = jest.fn(() => ({ update }));
    mockClient({ from });

    await disablePushToken('u1');

    expect(from).toHaveBeenCalledWith('device_push_tokens');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, last_seen_at: expect.any(String) }));
    expect(eq1).toHaveBeenCalledWith('user_id', 'u1');
    expect(eq2).toHaveBeenCalledWith('device_id', 'dev-1');
  });

  it('throws on a server error', async () => {
    await AsyncStorage.setItem('@peakle/push-device-id', 'dev-1');
    const from = jest.fn(() => ({
      update: () => ({ eq: () => ({ eq: async () => ({ error: new Error('rls denied') }) }) }),
    }));
    mockClient({ from });
    await expect(disablePushToken('u1')).rejects.toThrow('rls denied');
  });
});

describe('listNotifications', () => {
  it('requests the 50 most recent notifications and returns the data', async () => {
    const limit = jest.fn(async () => ({ data: [{ id: 'n1' }], error: null }));
    const order = jest.fn(() => ({ limit }));
    const select = jest.fn(() => ({ order }));
    const from = jest.fn(() => ({ select }));
    mockClient({ from });

    const result = await listNotifications();

    expect(from).toHaveBeenCalledWith('user_notifications');
    expect(select).toHaveBeenCalledWith('*');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
    expect(result).toEqual([{ id: 'n1' }]);
  });

  it('falls back to an empty array when data is null', async () => {
    const from = jest.fn(() => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error: null }) }) }) }));
    mockClient({ from });
    expect(await listNotifications()).toEqual([]);
  });

  it('throws on a server error', async () => {
    const from = jest.fn(() => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error: new Error('boom') }) }) }) }));
    mockClient({ from });
    await expect(listNotifications()).rejects.toThrow('boom');
  });
});

describe('markNotificationRead / markAllNotificationsRead / deleteNotification / clearReadNotifications', () => {
  it('markNotificationRead calls the RPC with the notification id and throws on error', async () => {
    const client = mockClient({ rpc: async () => ({ data: null, error: null }) });
    await markNotificationRead('n1');
    expect(client.rpc).toHaveBeenCalledWith('mark_notification_read', { p_notification_id: 'n1' });

    mockClient({ rpc: async () => ({ data: null, error: new Error('nope') }) });
    await expect(markNotificationRead('n1')).rejects.toThrow('nope');
  });

  it('markAllNotificationsRead returns the affected count, defaulting to 0', async () => {
    mockClient({ rpc: async () => ({ data: 4, error: null }) });
    expect(await markAllNotificationsRead()).toBe(4);

    mockClient({ rpc: async () => ({ data: null, error: null }) });
    expect(await markAllNotificationsRead()).toBe(0);

    mockClient({ rpc: async () => ({ data: null, error: new Error('nope') }) });
    await expect(markAllNotificationsRead()).rejects.toThrow('nope');
  });

  it('deleteNotification coerces the result to a boolean', async () => {
    mockClient({ rpc: async () => ({ data: true, error: null }) });
    expect(await deleteNotification('n1')).toBe(true);

    mockClient({ rpc: async () => ({ data: null, error: null }) });
    expect(await deleteNotification('n1')).toBe(false);

    mockClient({ rpc: async () => ({ data: null, error: new Error('nope') }) });
    await expect(deleteNotification('n1')).rejects.toThrow('nope');
  });

  it('clearReadNotifications returns the cleared count, defaulting to 0, and throws on error', async () => {
    mockClient({ rpc: async () => ({ data: 3, error: null }) });
    expect(await clearReadNotifications()).toBe(3);

    mockClient({ rpc: async () => ({ data: null, error: new Error('nope') }) });
    await expect(clearReadNotifications()).rejects.toThrow('nope');
  });
});

describe('publishOpenPlayAnnouncement', () => {
  it('requires a signed-in user and never inserts otherwise', async () => {
    const insert = jest.fn();
    const client = mockClient({
      from: jest.fn(() => ({ insert })),
      auth: { getUser: jest.fn(async () => ({ data: { user: null } })) },
    });

    await expect(publishOpenPlayAnnouncement('s1', 'hi')).rejects.toThrow('Sign in to publish an announcement.');
    expect(insert).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('inserts a trimmed announcement authored by the current user', async () => {
    const single = jest.fn(async () => ({ data: { id: 'a1', body: 'Court closed' }, error: null }));
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    const from = jest.fn(() => ({ insert }));
    mockClient({
      from,
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
    });

    const result = await publishOpenPlayAnnouncement('s1', '  Court closed  ');

    expect(from).toHaveBeenCalledWith('open_play_announcements');
    expect(insert).toHaveBeenCalledWith({ session_id: 's1', body: 'Court closed', created_by: 'u1' });
    expect(result).toEqual({ id: 'a1', body: 'Court closed' });
  });

  it('throws on a server error', async () => {
    const from = jest.fn(() => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: new Error('rls') }) }) }) }));
    mockClient({ from, auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) } });
    await expect(publishOpenPlayAnnouncement('s1', 'x')).rejects.toThrow('rls');
  });
});

describe('listVenueStaff', () => {
  it('queries members for the venue, ordered by join date, and returns the data', async () => {
    const order = jest.fn(async () => ({ data: [{ user_id: 'u1' }], error: null }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));
    mockClient({ from });

    const result = await listVenueStaff('v1');

    expect(from).toHaveBeenCalledWith('venue_members');
    expect(eq).toHaveBeenCalledWith('venue_id', 'v1');
    expect(order).toHaveBeenCalledWith('created_at');
    expect(result).toEqual([{ user_id: 'u1' }]);
  });

  it('falls back to an empty array and throws on error', async () => {
    const from = jest.fn(() => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: null }) }) }) }));
    mockClient({ from });
    expect(await listVenueStaff('v1')).toEqual([]);

    mockClient({ from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: new Error('nope') }) }) }) }) });
    await expect(listVenueStaff('v1')).rejects.toThrow('nope');
  });
});

describe('setVenueStaffRole', () => {
  it('sends the venue, user, and role, and unwraps an array response to its first row', async () => {
    const client = mockClient({ rpc: async () => ({ data: [{ user_id: 'u1', role: 'staff' }], error: null }) });
    const result = await setVenueStaffRole('v1', 'u1', 'staff');
    expect(client.rpc).toHaveBeenCalledWith('set_venue_staff_role', { p_venue_id: 'v1', p_user_id: 'u1', p_role: 'staff' });
    expect(result).toEqual({ user_id: 'u1', role: 'staff' });
  });

  it('returns a non-array response as-is', async () => {
    mockClient({ rpc: async () => ({ data: { user_id: 'u1' }, error: null }) });
    expect(await setVenueStaffRole('v1', 'u1', 'staff')).toEqual({ user_id: 'u1' });
  });

  it('throws on a server error', async () => {
    mockClient({ rpc: async () => ({ data: null, error: new Error('forbidden') }) });
    await expect(setVenueStaffRole('v1', 'u1', 'staff')).rejects.toThrow('forbidden');
  });
});

describe('removeVenueStaff', () => {
  it('calls the RPC with venue and user ids and resolves on success', async () => {
    const client = mockClient({ rpc: async () => ({ data: null, error: null }) });
    await expect(removeVenueStaff('v1', 'u1')).resolves.toBeUndefined();
    expect(client.rpc).toHaveBeenCalledWith('remove_venue_staff', { p_venue_id: 'v1', p_user_id: 'u1' });
  });

  it('throws on a server error', async () => {
    mockClient({ rpc: async () => ({ data: null, error: new Error('forbidden') }) });
    await expect(removeVenueStaff('v1', 'u1')).rejects.toThrow('forbidden');
  });
});
