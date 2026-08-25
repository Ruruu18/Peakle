import { requireSupabase } from '../lib/supabase';

export async function listMyPaymentHistory({ page = 0, pageSize = 20, signal } = {}) {
  let query = requireSupabase().rpc('list_my_payment_history', {
    p_limit: pageSize + 1,
    p_offset: page * pageSize,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  return { payments: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}
