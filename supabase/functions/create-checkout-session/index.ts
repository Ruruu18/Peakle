import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS_HEADERS, handleCorsPreflight } from '../_shared/cors.ts';

const PAYMONGO_API = 'https://api.paymongo.com/v1';
const APP_SCHEME = 'peakle://';
const ALLOWED_PAYMENT_METHODS = ['gcash', 'paymaya', 'card', 'dob'];

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

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const bookingId = String(payload.booking_id || '');
  const membershipId = String(payload.membership_id || '');
  if (Boolean(bookingId) === Boolean(membershipId)) {
    return json({ error: 'Provide exactly one of booking_id or membership_id' }, 400);
  }
  const requestedMethod = String(payload.payment_method_type || '');
  const paymentMethodTypes = ALLOWED_PAYMENT_METHODS.includes(requestedMethod)
    ? [requestedMethod]
    : ALLOWED_PAYMENT_METHODS;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let resourceId: string;
  let amount: number;
  let referenceNumber: string;
  let description: string;
  let successUrl: string;
  let cancelUrl: string;
  let metadata: Record<string, string>;

  if (bookingId) {
    const { data: booking, error: bookingError } = await admin
      .from('bookings')
      .select('id, user_id, amount, reference, payment_status, venues(name), courts(name)')
      .eq('id', bookingId)
      .maybeSingle();
    if (bookingError) return json({ error: bookingError.message }, 500);
    if (!booking) return json({ error: 'Booking not found' }, 404);
    if (booking.user_id !== userData.user.id) return json({ error: 'Forbidden' }, 403);
    if (booking.payment_status !== 'awaiting_payment') {
      return json({ error: `Booking is not awaiting payment (status: ${booking.payment_status})` }, 409);
    }

    const venueName = (booking as Record<string, any>).venues?.name || 'Peakle booking';
    const courtName = (booking as Record<string, any>).courts?.name || 'Court';
    resourceId = booking.id;
    amount = Number(booking.amount);
    referenceNumber = booking.reference || booking.id;
    description = `${venueName} — ${courtName}`.slice(0, 255);
    successUrl = `${APP_SCHEME}booking/${booking.id}/payment-result?status=success`;
    cancelUrl = `${APP_SCHEME}booking/${booking.id}/payment-result?status=cancelled`;
    metadata = { resource_type: 'booking', booking_id: booking.id };
  } else {
    const { data: membership, error: membershipError } = await admin
      .from('player_memberships')
      .select('id,user_id,amount_due,currency,payment_status,status,membership_products(name,venue_id,active,venues(name,active,verification_status))')
      .eq('id', membershipId)
      .maybeSingle();
    if (membershipError) return json({ error: membershipError.message }, 500);
    if (!membership) return json({ error: 'Membership order not found' }, 404);
    if (membership.user_id !== userData.user.id) return json({ error: 'Forbidden' }, 403);
    if (membership.payment_status !== 'awaiting_payment' || membership.status !== 'pending') {
      return json({ error: `Membership is not awaiting payment (status: ${membership.payment_status})` }, 409);
    }

    const product = (membership as Record<string, any>).membership_products;
    if (!product?.active || !product?.venues?.active || product?.venues?.verification_status !== 'verified') {
      return json({ error: 'This membership product is no longer available' }, 409);
    }
    if (membership.currency !== 'PHP') return json({ error: 'Unsupported membership currency' }, 409);
    const venueName = product?.venues?.name || 'Peakle venue';
    const productName = product?.name || 'Membership';
    resourceId = membership.id;
    amount = Number(membership.amount_due);
    referenceNumber = `MEM-${membership.id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    description = `${venueName} — ${productName}`.slice(0, 255);
    successUrl = `${APP_SCHEME}membership/${membership.id}/payment-result?status=success`;
    cancelUrl = `${APP_SCHEME}membership/${membership.id}/payment-result?status=cancelled`;
    metadata = { resource_type: 'membership', membership_id: membership.id };
  }

  const amountCentavos = Math.round(amount * 100);
  if (!Number.isFinite(amountCentavos) || amountCentavos <= 0) return json({ error: 'Invalid payment amount' }, 500);

  const resourceType = bookingId ? 'booking' : 'membership';
  const { data: checkoutClaim, error: claimError } = await admin.rpc('claim_paymongo_checkout', {
    p_resource_type: resourceType,
    p_resource_id: resourceId,
  });
  if (claimError) {
    const conflict = /already in progress|reconciliation|not awaiting payment/i.test(claimError.message);
    return json({ error: claimError.message }, conflict ? 409 : 500);
  }
  if (checkoutClaim?.state === 'existing') {
    return json({
      checkout_url: checkoutClaim.checkout_url,
      session_id: checkoutClaim.session_id,
      resource_type: resourceType,
      resource_id: resourceId,
      reused: true,
    });
  }
  const claimToken: string | undefined = checkoutClaim?.claim_token;
  if (!claimToken) return json({ error: 'Could not reserve checkout creation' }, 500);

  let checkoutResponse: Response;
  try {
    checkoutResponse = await fetch(`${PAYMONGO_API}/checkout_sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${paymongoSecret}:`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            description,
            line_items: [{ currency: 'PHP', amount: amountCentavos, description, name: description, quantity: 1 }],
            payment_method_types: paymentMethodTypes,
            success_url: successUrl,
            cancel_url: cancelUrl,
            reference_number: referenceNumber,
            metadata,
          },
        },
      }),
    });
  } catch {
    // The provider may have received the request. Keep the durable claim so a
    // retry cannot create a second chargeable session.
    return json({ error: 'Checkout creation has an uncertain provider status; contact support before retrying' }, 502);
  }
  const checkoutJson = await checkoutResponse.json().catch(() => null);
  if (!checkoutResponse.ok || !checkoutJson?.data) {
    // A 4xx is a definitive rejection and safe to retry after correcting the
    // request. Server/network failures remain claimed for reconciliation.
    if (checkoutResponse.status >= 400 && checkoutResponse.status < 500) {
      await admin.rpc('release_paymongo_checkout_claim', {
        p_resource_type: resourceType,
        p_resource_id: resourceId,
        p_claim_token: claimToken,
      });
    }
    return json({ error: checkoutJson?.errors?.[0]?.detail || 'Could not start checkout' }, 502);
  }

  const sessionId: string | undefined = checkoutJson.data.id;
  const checkoutUrl: string | undefined = checkoutJson.data.attributes?.checkout_url;
  if (!sessionId || !checkoutUrl) return json({ error: 'Unexpected response from PayMongo' }, 502);

  const { error: finalizeError } = await admin.rpc('finalize_paymongo_checkout', {
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_claim_token: claimToken,
    p_session_id: sessionId,
    p_checkout_url: checkoutUrl,
  });
  if (finalizeError) return json({ error: finalizeError.message }, 500);

  return json({ checkout_url: checkoutUrl, session_id: sessionId, resource_type: resourceType, resource_id: resourceId });
});
