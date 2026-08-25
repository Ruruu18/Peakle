import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// PayMongo signs webhooks as `t=<timestamp>,te=<test hmac>,li=<live hmac>` —
// see https://developers.paymongo.com/docs/webhooks#verifying-webhook-signature.
// The exact event payload shape here (checkout_session_id location, event
// type name) should be double-checked against a real test-mode delivery
// once live keys/webhook are registered — PayMongo's Checkout event schema
// has shifted before and this hasn't been exercised against the live API.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const webhookSecret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!webhookSecret || !supabaseUrl || !serviceKey) return json({ error: 'Missing server configuration' }, 500);

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('Paymongo-Signature') || '';
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((pair) => pair.split('=').map((part) => part.trim())),
  );
  const timestamp = parts.t;
  const providedSignatures = [parts.te, parts.li].filter(Boolean);
  if (!timestamp || !providedSignatures.length) return json({ error: 'Missing signature' }, 401);
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    return json({ error: 'Stale signature' }, 401);
  }

  const expectedSignature = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
  if (!providedSignatures.some((signature) => timingSafeEqual(expectedSignature, signature))) {
    return json({ error: 'Invalid signature' }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const eventType = event?.data?.attributes?.type;
  if (eventType !== 'checkout_session.payment.paid' && eventType !== 'payment.paid') {
    return json({ received: true, ignored: eventType });
  }

  const resource = event?.data?.attributes?.data;
  const paymentAttributes = resource?.attributes || {};
  const paymentId: string | undefined = resource?.id;
  // create-checkout-session sets a resource id on the checkout session,
  // and PayMongo carries that metadata through to the resulting
  // Payment resource — confirmed against a real test-mode payment. The
  // Payment resource's own checkout_session_id field is null and
  // attributes.source.id is the e-wallet source (e.g. src_... for GCash),
  // not the checkout session, so neither is usable for the lookup.
  const bookingId: string | undefined = paymentAttributes?.metadata?.booking_id;
  const membershipId: string | undefined = paymentAttributes?.metadata?.membership_id;
  const amountPaid = Number(paymentAttributes.amount) / 100;
  const paymentMethod: string | undefined = paymentAttributes?.source?.type;

  if (Boolean(bookingId) === Boolean(membershipId) || !Number.isFinite(amountPaid) || amountPaid <= 0) {
    console.error('paymongo-webhook: could not resolve a unique resource id or amount', rawBody);
    return json({ received: true, unresolved: true });
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let recordError: { message: string } | null = null;
  if (bookingId) {
    const result = await admin.rpc('record_booking_payment', {
      p_booking_id: bookingId,
      p_paymongo_payment_id: paymentId || null,
      p_amount_paid: amountPaid,
      p_payment_method: paymentMethod || null,
    });
    recordError = result.error;
  } else {
    const result = await admin.rpc('record_membership_payment', {
      p_membership_id: membershipId,
      p_paymongo_payment_id: paymentId || null,
      p_amount_paid: amountPaid,
      p_payment_method: paymentMethod || null,
    });
    recordError = result.error;
  }
  if (recordError) return json({ error: recordError.message }, 500);

  return json({ received: true });
});
