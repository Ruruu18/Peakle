import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// A free, deterministic FAQ responder — no external API calls, so this never
// costs anything to run. It can only ever answer from the fixed knowledge
// below, which keeps it strictly scoped to Peakle app questions; anything
// it doesn't recognize gets a canned "here's what I can help with" reply
// instead of a guess. Escalating to a human is a separate, explicit action
// (the "Talk to a human" button -> request_human_support RPC), not something
// this function decides on its own.
//
// Keep the player-facing entries in sync with the FAQs in
// src/screens/HelpSupportScreen.js.
type FaqEntry = { id: string; keywords: string[]; answer: string };

const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'bookings',
    keywords: ['booking', 'book a court', 'reservation', 'payment status'],
    answer: 'Open Explore and switch to My Bookings to see your bookings and payment status. Payment history has your full receipt and refund record.',
  },
  {
    id: 'cancellations',
    keywords: ['cancel', 'refund', 'cancellation', 'money back'],
    answer: "Open the booking to see the venue's cancellation policy before cancelling. Eligible refunds are returned through the payment flow and appear in Payment history.",
  },
  {
    id: 'matches',
    keywords: ['box score', 'rally history', 'match result', 'game result', 'my matches'],
    answer: 'Go to Profile, then Matches, then tap a match to open its box score and rally history.',
  },
  {
    id: 'notifications',
    keywords: ['notification', 'push notification', 'not receiving', 'not getting alerts'],
    answer: "Check that Peakle notifications are allowed in your phone's settings, then use the notification test in Help & Support to verify this device.",
  },
  {
    id: 'privacy',
    keywords: ['privacy', 'visibility', 'who can see', 'player matching', 'hide my profile'],
    answer: 'Privacy & matching lets you control your competitive-profile visibility, availability, and whether player matching is enabled.',
  },
  {
    id: 'account',
    keywords: ['change my name', 'update photo', 'home area', 'account details', 'profile photo', 'edit profile'],
    answer: 'Go to Profile, then Settings, then Account details to update your name, photo, or home area.',
  },
  {
    id: 'safety',
    keywords: ['report', 'harass', 'unsafe', 'block a player', 'safety concern'],
    answer: 'Use the report option on the relevant message or conversation so the safety team gets the right context. If someone may be in immediate danger, contact local emergency services — Peakle support is not an emergency service.',
  },
  {
    id: 'organizer-venues',
    keywords: ['venue', 'court setup', 'add a court', 'venue hours'],
    answer: 'Manage your facility details, courts, and hours from Venue & Courts in the organizer portal.',
  },
  {
    id: 'organizer-staff',
    keywords: ['staff access', 'team access', 'invite staff', 'add teammate'],
    answer: 'Add or manage teammate access from Staff Access in the organizer portal — you control exactly what each role can do.',
  },
  {
    id: 'organizer-earnings',
    keywords: ['payout', 'earnings', 'withdrawal', 'my balance'],
    answer: 'Your balance, payout history, and withdrawal requests are under Earnings in the organizer portal.',
  },
  {
    id: 'organizer-open-play',
    keywords: ['open play', 'publish a session', 'session registration'],
    answer: 'Open Play lets you publish sessions, manage registration, and track live courts from the organizer portal.',
  },
];

const FALLBACK_MESSAGE = 'I don’t have a saved answer for that yet. I can help with bookings, cancellations & refunds, matches, notifications, privacy & matching, account details, safety, and organizer tools (venues, staff, payouts, Open Play). For anything else, tap "Talk to a human" and a Peakle teammate will follow up right here.';

function matchFaq(message: string): FaqEntry | null {
  const normalized = message.toLowerCase();
  let best: { entry: FaqEntry; score: number } | null = null;
  for (const entry of FAQ_ENTRIES) {
    const score = entry.keywords.filter((keyword) => normalized.includes(keyword)).length;
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  return best?.entry ?? null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Missing server configuration' }, 500);

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
  const conversationId = String(payload.conversation_id || '');
  if (!conversationId) return json({ error: 'conversation_id is required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: conversation, error: conversationError } = await admin
    .from('support_conversations')
    .select('id, requester_id, status')
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError) return json({ error: conversationError.message }, 500);
  if (!conversation || conversation.requester_id !== userData.user.id) {
    return json({ error: 'Conversation not found' }, 404);
  }
  // Once a human is assigned or the request is escalated/closed, stay out of the way.
  if (conversation.status !== 'bot') return json({ ok: true, skipped: true });

  const { data: lastMessage, error: lastMessageError } = await admin
    .from('support_messages')
    .select('body')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastMessageError) return json({ error: lastMessageError.message }, 500);
  if (!lastMessage) return json({ ok: true, skipped: true });

  const matched = matchFaq(lastMessage.body);
  const replyText = matched?.answer ?? FALLBACK_MESSAGE;

  const { error: insertError } = await admin
    .from('support_messages')
    .insert({ conversation_id: conversationId, sender_type: 'ai', body: replyText });
  if (insertError) return json({ error: insertError.message }, 500);

  await admin.from('support_conversations')
    .update({
      needs_human: !matched,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return json({ ok: true, matched: Boolean(matched) });
});
