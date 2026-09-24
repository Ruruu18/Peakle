import { requireSupabase } from '../../lib/supabase';
import * as Crypto from 'expo-crypto';
import {
  quoteCourtBooking,
  createMultiCourtBooking,
  modifyBooking,
  cancelBooking,
  cancelUnpaidBooking,
  startBookingCheckout,
  triggerBookingRefund,
  joinCourtWaitlist,
  createBooking,
} from '../database';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'generated-uuid') }));

function mockClient({ rpc, invoke } = {}) {
  const client = {
    rpc: jest.fn(rpc || (async () => ({ data: null, error: null }))),
    functions: { invoke: jest.fn(invoke || (async () => ({ data: null, error: null }))) },
  };
  requireSupabase.mockReturnValue(client);
  return client;
}

const FUTURE_DATE = '2099-01-01';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('quoteCourtBooking', () => {
  it('rejects a booking time that has already started, without calling the server', async () => {
    const client = mockClient();
    await expect(quoteCourtBooking({ courtIds: ['c1'], dateIso: '2020-01-01', time: '2:00 PM', duration: 60 }))
      .rejects.toThrow('Choose a future booking time.');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('sends the exact court ids, ISO time range, and trimmed promo code to quote_booking', async () => {
    const client = mockClient({
      rpc: async () => ({ data: [{ subtotal: '500', discount_amount: '50', fee_amount: '10', total: '460' }], error: null }),
    });
    const quote = await quoteCourtBooking({ courtIds: ['c1', 'c2'], dateIso: FUTURE_DATE, time: '2:00 PM', duration: 60, promoCode: '  SAVE10  ' });
    expect(client.rpc).toHaveBeenCalledWith('quote_booking', {
      p_court_ids: ['c1', 'c2'],
      p_starts_at: '2099-01-01T06:00:00.000Z',
      p_ends_at: '2099-01-01T07:00:00.000Z',
      p_promo_code: 'SAVE10',
    });
    expect(quote).toEqual({ subtotal: 500, discount_amount: 50, fee_amount: 10, total: 460 });
  });

  it('sends null instead of an empty promo code', async () => {
    const client = mockClient({ rpc: async () => ({ data: [{}], error: null }) });
    await quoteCourtBooking({ courtIds: ['c1'], dateIso: FUTURE_DATE, time: '2:00 PM', duration: 60 });
    expect(client.rpc.mock.calls[0][1].p_promo_code).toBeNull();
  });

  it('throws the server error instead of returning a partial quote', async () => {
    mockClient({ rpc: async () => ({ data: null, error: new Error('court unavailable') }) });
    await expect(quoteCourtBooking({ courtIds: ['c1'], dateIso: FUTURE_DATE, time: '2:00 PM', duration: 60 }))
      .rejects.toThrow('court unavailable');
  });
});

describe('createMultiCourtBooking (idempotent booking creation)', () => {
  it('generates an idempotency key when the caller does not supply one', async () => {
    const client = mockClient({ rpc: async () => ({ data: [{ id: 'b1' }], error: null }) });
    const result = await createMultiCourtBooking({ quoteId: 'q1' });
    expect(Crypto.randomUUID).toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith('create_multi_court_booking', {
      p_quote_id: 'q1',
      p_idempotency_key: 'generated-uuid',
      p_invite_team: false,
      p_team_id: null,
    });
    expect(result.idempotencyKey).toBe('generated-uuid');
  });

  it('reuses a caller-supplied idempotency key instead of generating a new one, so a retry after a dropped response cannot double-book', async () => {
    const client = mockClient({ rpc: async () => ({ data: [{ id: 'b1' }], error: null }) });
    const result = await createMultiCourtBooking({ quoteId: 'q1', idempotencyKey: 'retry-key-123' });
    expect(Crypto.randomUUID).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls[0][1].p_idempotency_key).toBe('retry-key-123');
    expect(result.idempotencyKey).toBe('retry-key-123');
  });

  it('only sends a team id when inviting a team', async () => {
    const client = mockClient({ rpc: async () => ({ data: [], error: null }) });
    await createMultiCourtBooking({ quoteId: 'q1', inviteTeam: true, teamId: 't1', idempotencyKey: 'k1' });
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_invite_team: true, p_team_id: 't1' });

    await createMultiCourtBooking({ quoteId: 'q1', inviteTeam: false, teamId: 't1', idempotencyKey: 'k2' });
    expect(client.rpc.mock.calls[1][1]).toMatchObject({ p_invite_team: false, p_team_id: null });
  });

  it('throws on a server error and returns no bookings', async () => {
    mockClient({ rpc: async () => ({ data: null, error: new Error('capacity exceeded') }) });
    await expect(createMultiCourtBooking({ quoteId: 'q1', idempotencyKey: 'k1' })).rejects.toThrow('capacity exceeded');
  });
});

describe('modifyBooking / cancelUnpaidBooking (optimistic concurrency)', () => {
  it('forwards the expected revision so a stale client cannot silently overwrite a newer change', async () => {
    const client = mockClient({ rpc: async () => ({ data: [{ id: 'b1', revision: 3 }], error: null }) });
    await modifyBooking({ bookingId: 'b1', quoteId: 'q1', expectedRevision: 2 });
    expect(client.rpc).toHaveBeenCalledWith('modify_booking', { p_booking_id: 'b1', p_quote_id: 'q1', p_expected_revision: 2 });
  });

  it('rejects with the server conflict error when the revision is stale', async () => {
    mockClient({ rpc: async () => ({ data: null, error: new Error('revision mismatch') }) });
    await expect(modifyBooking({ bookingId: 'b1', quoteId: 'q1', expectedRevision: 1 })).rejects.toThrow('revision mismatch');
  });

  it('forwards the expected revision on unpaid cancellation too', async () => {
    const client = mockClient({ rpc: async () => ({ data: [{ id: 'b1' }], error: null }) });
    await cancelUnpaidBooking('b1', 4);
    expect(client.rpc).toHaveBeenCalledWith('cancel_unpaid_booking', { p_booking_id: 'b1', p_expected_revision: 4 });
  });
});

describe('cancelBooking', () => {
  it('cancels and triggers a refund in one call', async () => {
    const client = mockClient({
      rpc: async () => ({ data: [{ id: 'b1', status: 'cancelled' }], error: null }),
      invoke: async () => ({ data: { refunded: true }, error: null }),
    });
    const result = await cancelBooking('b1', 2, ' court closed ');
    expect(client.rpc).toHaveBeenCalledWith('cancel_booking', { p_booking_id: 'b1', p_expected_revision: 2, p_reason: 'court closed' });
    expect(client.functions.invoke).toHaveBeenCalledWith('process-refund', { body: { booking_id: 'b1' } });
    expect(result).toEqual({ id: 'b1', status: 'cancelled' });
  });

  it('still reports the cancellation as successful even when the refund trigger fails, so a payment-provider hiccup never masks a real cancellation', async () => {
    const client = mockClient({
      rpc: async () => ({ data: [{ id: 'b1', status: 'cancelled' }], error: null }),
      invoke: async () => ({ data: null, error: new Error('refund provider timeout') }),
    });
    const result = await cancelBooking('b1', 2);
    expect(result).toEqual({ id: 'b1', status: 'cancelled' });
    expect(client.functions.invoke).toHaveBeenCalled();
  });

  it('does not attempt a refund when the cancellation itself is rejected by the server', async () => {
    const client = mockClient({ rpc: async () => ({ data: null, error: new Error('booking already started') }) });
    await expect(cancelBooking('b1', 2)).rejects.toThrow('booking already started');
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });
});

describe('startBookingCheckout / triggerBookingRefund', () => {
  it('starts checkout with the booking id and payment method', async () => {
    const client = mockClient({ invoke: async () => ({ data: { checkout_url: 'https://pay/x' }, error: null }) });
    const result = await startBookingCheckout('b1', 'gcash');
    expect(client.functions.invoke).toHaveBeenCalledWith('create-checkout-session', { body: { booking_id: 'b1', payment_method_type: 'gcash', platform: 'ios' } });
    expect(result.checkout_url).toBe('https://pay/x');
  });

  it('throws when checkout succeeds at the transport level but returns no checkout url', async () => {
    mockClient({ invoke: async () => ({ data: { error: 'provider declined' }, error: null }) });
    await expect(startBookingCheckout('b1', 'card')).rejects.toThrow('provider declined');
  });

  it('throws a fallback message when the checkout function errors without one', async () => {
    mockClient({ invoke: async () => ({ data: null, error: {} }) });
    await expect(startBookingCheckout('b1', 'card')).rejects.toThrow('Could not start checkout.');
  });

  it('throws a fallback message when the refund function errors without one', async () => {
    mockClient({ invoke: async () => ({ data: null, error: {} }) });
    await expect(triggerBookingRefund('b1')).rejects.toThrow('Could not process the refund.');
  });
});

describe('joinCourtWaitlist', () => {
  it('sends the correct court and time range', async () => {
    const client = mockClient({ rpc: async () => ({ data: [{ id: 'w1' }], error: null }) });
    await joinCourtWaitlist({ courtId: 'c1', dateIso: FUTURE_DATE, time: '6:00 PM', duration: 30 });
    expect(client.rpc).toHaveBeenCalledWith('join_court_waitlist', {
      p_court_id: 'c1',
      p_starts_at: '2099-01-01T10:00:00.000Z',
      p_ends_at: '2099-01-01T10:30:00.000Z',
    });
  });
});

describe('createBooking', () => {
  const baseArgs = { userId: 'u1', venue: { id: 'v1' }, court: { id: 'c1' }, booking: { dateIso: FUTURE_DATE, time: '2:00 PM', duration: 60, inviteTeam: false, teamId: null } };

  it('rejects a past booking time without contacting the server', async () => {
    const client = mockClient();
    await expect(createBooking({ ...baseArgs, booking: { ...baseArgs.booking, dateIso: '2020-01-01' } }))
      .rejects.toThrow('Choose a future booking time.');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('creates a booking with the team invite fields on the first attempt', async () => {
    const client = mockClient({ rpc: async () => ({ data: [{ id: 'b1' }], error: null }) });
    const result = await createBooking(baseArgs);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('create_booking', {
      p_court_id: 'c1',
      p_starts_at: '2099-01-01T06:00:00.000Z',
      p_ends_at: '2099-01-01T07:00:00.000Z',
      p_invite_team: false,
      p_team_id: null,
    });
    expect(result).toEqual({ id: 'b1' });
  });

  it('retries without the team_id argument during a rolling deploy (PGRST202), and returns the retry result', async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: [{ id: 'b1-legacy' }], error: null });
    const client = mockClient({ rpc });
    const result = await createBooking({ ...baseArgs, booking: { ...baseArgs.booking, inviteTeam: true, teamId: 't1' } });
    expect(rpc).toHaveBeenCalledTimes(2);
    const secondCallArgs = rpc.mock.calls[1][1];
    expect(secondCallArgs).not.toHaveProperty('p_team_id');
    expect(secondCallArgs).toEqual({
      p_court_id: 'c1',
      p_starts_at: '2099-01-01T06:00:00.000Z',
      p_ends_at: '2099-01-01T07:00:00.000Z',
      p_invite_team: true,
    });
    expect(result).toEqual({ id: 'b1-legacy' });
  });

  it('throws when the retry also fails', async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: null, error: new Error('court double-booked') });
    mockClient({ rpc });
    await expect(createBooking(baseArgs)).rejects.toThrow('court double-booked');
  });

  it('throws immediately on a non-PGRST202 error without retrying', async () => {
    const rpc = jest.fn().mockResolvedValueOnce({ data: null, error: new Error('court double-booked') });
    mockClient({ rpc });
    await expect(createBooking(baseArgs)).rejects.toThrow('court double-booked');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
