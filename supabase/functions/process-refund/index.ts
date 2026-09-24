import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS_HEADERS, handleCorsPreflight } from '../_shared/cors.ts';
import { checkAccountAccess } from '../_shared/account-access.ts';

const PAYMONGO_API = 'https://api.paymongo.com/v1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

Deno.serve(async (request) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const paymongoSecret = Deno.env.get('PAYMONGO_SECRET_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Missing server configuration' }, 500);
  if (!paymongoSecret) return json({ error: 'Payments are not configured yet' }, 503);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: request.headers.get('Authorization') || '' } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'Authentication required' }, 401);
  const accessError = await checkAccountAccess(userClient);
  if (accessError) return json({ error: accessError.error }, accessError.status);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const bookingId = String(payload.booking_id || '');
  if (!bookingId) return json({ error: 'booking_id is required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: booking, error: bookingError } = await admin
    .from('bookings')
    .select('id, user_id, paymongo_payment_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (bookingError) return json({ error: bookingError.message }, 500);
  if (!booking) return json({ error: 'Booking not found' }, 404);

  if (booking.user_id !== userData.user.id) {
    const { data: isAdmin } = await userClient.rpc('is_platform_admin');
    if (!isAdmin) return json({ error: 'Forbidden' }, 403);
  }

  // Never trust a client-supplied refund amount — re-derive everything from
  // the booking_refunds row cancel_booking already wrote server-side.
  const { data: refundRow, error: refundError } = await admin
    .from('booking_refunds')
    .select('id, refund_amount, total_collected, status')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (refundError) return json({ error: refundError.message }, 500);
  if (!refundRow) return json({ error: 'No refund is owed for this booking' }, 404);
  if (refundRow.status === 'refunded') return json({ refunded: true, already: true });
  if (Number(refundRow.refund_amount) > 0 && !booking.paymongo_payment_id) {
    return json({ error: 'Booking has no recorded payment to refund' }, 409);
  }

  // Atomically claim this refund before contacting PayMongo. Two workers may
  // read the same pending row, but only one can transition it to processing.
  const { data: claimedRefund, error: claimError } = await admin
    .from('booking_refunds')
    .update({ status: 'processing' })
    .eq('id', refundRow.id)
    .in('status', ['pending', 'failed'])
    .select('id, refund_amount, total_collected')
    .maybeSingle();
  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimedRefund) {
    const { data: current } = await admin
      .from('booking_refunds')
      .select('status')
      .eq('id', refundRow.id)
      .maybeSingle();
    if (current?.status === 'refunded') return json({ refunded: true, already: true });
    return json({ error: 'Refund is already being processed' }, 409);
  }

  const refundAmount = Number(claimedRefund.refund_amount);

  if (!(refundAmount > 0)) {
    // Nothing to actually send back (e.g. an owner cancellation still
    // routes here but the split left ₱0 for the player) — just settle it.
    const { error: completeError } = await admin.rpc('complete_booking_refund', {
      p_refund_id: refundRow.id,
      p_paymongo_refund_id: null,
    });
    if (completeError) return json({ error: completeError.message }, 500);
    return json({ refunded: true, amount: 0 });
  }

  const amountCentavos = Math.round(refundAmount * 100);
  const refundResponse = await fetch(`${PAYMONGO_API}/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${paymongoSecret}:`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: amountCentavos,
          payment_id: booking.paymongo_payment_id,
          reason: 'requested_by_customer',
          notes: `Peakle booking ${bookingId} cancellation`,
        },
      },
    }),
  });
  const refundJson = await refundResponse.json().catch(() => null);

  if (!refundResponse.ok || !refundJson?.data) {
    // Only a definitive client rejection is safe to retry. A provider 5xx (or
    // a malformed success response) may still have created the refund, so keep
    // the row in processing for reconciliation instead of risking a duplicate.
    if (refundResponse.status >= 400 && refundResponse.status < 500) {
      await admin
        .from('booking_refunds')
        .update({ status: 'failed' })
        .eq('id', refundRow.id)
        .eq('status', 'processing');
    }
    return json({ error: refundJson?.errors?.[0]?.detail || 'Refund could not be processed' }, 502);
  }

  const { error: completeError } = await admin.rpc('complete_booking_refund', {
    p_refund_id: refundRow.id,
    p_paymongo_refund_id: refundJson.data.id,
  });
  if (completeError) return json({ error: completeError.message }, 500);

  return json({ refunded: true, amount: refundAmount, paymongo_refund_id: refundJson.data.id });
});
