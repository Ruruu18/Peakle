import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (request) => {
  const suppliedSecret = request.headers.get('x-push-dispatch-secret');
  if (!suppliedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return new Response('Missing server configuration', { status: 500 });
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // The dispatcher secret is generated inside Postgres and kept in Supabase
  // Vault. The Edge Function can only ask a service-role RPC to verify a
  // candidate; it never reads or logs the stored value. Any missing verifier,
  // Vault problem, or database error fails closed.
  const { data: secretIsValid, error: secretError } = await supabase.rpc(
    'verify_push_dispatch_secret',
    { p_candidate: suppliedSecret },
  );
  if (secretError) {
    console.error('send-push-notifications: secret verification failed', secretError.message);
    return new Response('Dispatcher is not configured', { status: 503 });
  }
  if (secretIsValid !== true) return new Response('Unauthorized', { status: 401 });

  const { data: notices, error } = await supabase.rpc('claim_push_notifications', { p_limit: 100 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!notices?.length) return Response.json({ processed: 0 });

  const now = Date.now();
  const expiredNotices = notices.filter((notice) => {
    const expiresAt = Date.parse(notice.data?.expiresAt || '');
    return Number.isFinite(expiresAt) && expiresAt <= now;
  });
  if (expiredNotices.length) {
    await supabase.from('user_notifications')
      .update({ push_status: 'skipped', push_error: 'Notification expired before dispatch' })
      .in('id', expiredNotices.map((notice) => notice.id));
  }
  const activeNotices = notices.filter((notice) => !expiredNotices.some((expired) => expired.id === notice.id));
  if (!activeNotices.length) return Response.json({ processed: notices.length, sent: 0 });
  const recipientIds = [...new Set(activeNotices.map((notice) => notice.user_id))];
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, notification_preferences')
    .in('id', recipientIds);
  if (profileError) return Response.json({ error: profileError.message }, { status: 500 });

  const preferencesByUser = new Map(
    (profiles || []).map((profile) => [profile.id, profile.notification_preferences || {}]),
  );
  const messageKinds = new Set(['direct_message', 'direct_message_request', 'direct_message_accepted', 'team_mention']);
  const mutedNotices = activeNotices.filter((notice) =>
    messageKinds.has(notice.kind)
      && preferencesByUser.get(notice.user_id)?.messages === false
  );
  if (mutedNotices.length) {
    await supabase.from('user_notifications')
      .update({ push_status: 'skipped', push_error: 'Message notifications disabled by user' })
      .in('id', mutedNotices.map((notice) => notice.id));
  }
  const deliverableNotices = activeNotices.filter(
    (notice) => !mutedNotices.some((muted) => muted.id === notice.id),
  );
  if (!deliverableNotices.length) return Response.json({ processed: notices.length, sent: 0 });

  const { data: tokens, error: tokenError } = await supabase
    .from('device_push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', [...new Set(deliverableNotices.map((notice) => notice.user_id))])
    .eq('enabled', true);
  if (tokenError) return Response.json({ error: tokenError.message }, { status: 500 });

  const messages = deliverableNotices.flatMap((notice) => (tokens || [])
    .filter((token) => token.user_id === notice.user_id)
    .map((token) => {
      const expiresAt = Date.parse(notice.data?.expiresAt || '');
      const isDirectMessage = notice.kind === 'direct_message';
      const isFollowNotification = notice.kind === 'follow_request' || notice.kind === 'follow_accepted';
      return {
        to: token.expo_push_token,
        sound: 'default',
        title: notice.title,
        body: notice.body,
        data: { ...notice.data, notificationId: notice.id, notificationKind: notice.kind },
        channelId: isDirectMessage ? 'messages' : isFollowNotification ? 'social' : 'open-play',
        ...(isDirectMessage ? {
          categoryId: 'peakle_direct_message',
          collapseId: `conversation:${notice.data?.conversationId || notice.id}`,
        } : {}),
        ...(isFollowNotification ? {
          collapseId: `${notice.kind}:${notice.data?.requestId || notice.id}`,
        } : {}),
        priority: 'high',
        ...(Number.isFinite(expiresAt) ? { expiration: Math.floor(expiresAt / 1000) } : {}),
        _notificationId: notice.id,
      };
    }));

  const noticesWithoutTokens = deliverableNotices.filter((notice) => !messages.some((message) => message._notificationId === notice.id));
  if (noticesWithoutTokens.length) {
    await supabase.from('user_notifications').update({ push_status: 'skipped', push_error: 'No enabled device token' })
      .in('id', noticesWithoutTokens.map((notice) => notice.id));
  }
  if (!messages.length) return Response.json({ processed: notices.length, sent: 0 });

  const payload = messages.map(({ _notificationId: _ignored, ...message }) => message);
  let expoResponse: Response;
  try {
    expoResponse = await fetch(EXPO_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify(payload),
    });
  } catch (sendError) {
    await supabase.from('user_notifications').update({ push_status: 'failed', push_error: String(sendError) })
      .in('id', [...new Set(messages.map((message) => message._notificationId))]);
    return Response.json({ error: String(sendError) }, { status: 502 });
  }
  const expoBody = await expoResponse.json().catch(() => ({ data: [] }));
  const tickets = Array.isArray(expoBody.data) ? expoBody.data : [];
  const outcomes = new Map<string, { sent: boolean; error?: string }>();
  messages.forEach((message, index) => {
    const ticket = tickets[index];
    const previous = outcomes.get(message._notificationId);
    const sent = ticket?.status === 'ok';
    outcomes.set(message._notificationId, {
      sent: Boolean(previous?.sent || sent),
      error: sent ? previous?.error : ticket?.message || ticket?.details?.error || `Expo HTTP ${expoResponse.status}`,
    });
  });

  await Promise.all([...outcomes.entries()].map(([id, outcome]) => supabase
    .from('user_notifications')
    .update(outcome.sent
      ? { push_status: 'sent', sent_at: new Date().toISOString(), push_error: null }
      : { push_status: 'failed', push_error: outcome.error })
    .eq('id', id)));

  return Response.json({ processed: notices.length, sent: [...outcomes.values()].filter((outcome) => outcome.sent).length });
});
