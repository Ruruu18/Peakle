import { requireSupabase } from '../../lib/supabase';
import { listMyPaymentHistory } from '../payments';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

// Mimics the real supabase-js query builder: chain methods return the same
// thenable object, and awaiting it (at any point in the chain) resolves to
// the given { data, error } result.
function makeRpcBuilder(result) {
  const builder = {
    abortSignal: jest.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function mockClient(result) {
  const builder = makeRpcBuilder(result);
  const client = { rpc: jest.fn(() => builder) };
  requireSupabase.mockReturnValue(client);
  return { client, builder };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listMyPaymentHistory', () => {
  it('defaults to page 0 / pageSize 20, requesting one extra row at offset 0', async () => {
    const { client } = mockClient({ data: [], error: null });
    await listMyPaymentHistory();
    expect(client.rpc).toHaveBeenCalledWith('list_my_payment_history', { p_limit: 21, p_offset: 0 });
  });

  it('computes the RPC offset as page * pageSize and the limit as pageSize + 1', async () => {
    const { client } = mockClient({ data: [], error: null });
    await listMyPaymentHistory({ page: 2, pageSize: 10 });
    expect(client.rpc).toHaveBeenCalledWith('list_my_payment_history', { p_limit: 11, p_offset: 20 });
  });

  it('reports hasMore true and trims the lookahead row when more than pageSize rows come back', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}` }));
    mockClient({ data: rows, error: null });
    const result = await listMyPaymentHistory({ pageSize: 20 });
    expect(result.payments).toHaveLength(20);
    expect(result.payments).toEqual(rows.slice(0, 20));
    expect(result.hasMore).toBe(true);
  });

  it('reports hasMore false when exactly pageSize rows or fewer come back', async () => {
    const exact = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` }));
    mockClient({ data: exact, error: null });
    const exactResult = await listMyPaymentHistory({ pageSize: 20 });
    expect(exactResult.payments).toEqual(exact);
    expect(exactResult.hasMore).toBe(false);

    jest.clearAllMocks();
    const fewer = [{ id: 'p0' }, { id: 'p1' }];
    mockClient({ data: fewer, error: null });
    const fewerResult = await listMyPaymentHistory({ pageSize: 20 });
    expect(fewerResult.payments).toEqual(fewer);
    expect(fewerResult.hasMore).toBe(false);
  });

  it('treats a null data response as an empty, non-paginated page', async () => {
    mockClient({ data: null, error: null });
    const result = await listMyPaymentHistory();
    expect(result).toEqual({ payments: [], hasMore: false });
  });

  it('wires an abort signal onto the query when one is provided', async () => {
    const { builder } = mockClient({ data: [], error: null });
    const signal = { aborted: false };
    await listMyPaymentHistory({ signal });
    expect(builder.abortSignal).toHaveBeenCalledWith(signal);
  });

  it('does not touch abortSignal when no signal is provided', async () => {
    const { builder } = mockClient({ data: [], error: null });
    await listMyPaymentHistory();
    expect(builder.abortSignal).not.toHaveBeenCalled();
  });

  it('propagates an RPC error instead of returning a partial page', async () => {
    mockClient({ data: null, error: new Error('rpc failed') });
    await expect(listMyPaymentHistory()).rejects.toThrow('rpc failed');
  });
});
