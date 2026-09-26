import { Platform } from 'react-native';
import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';

// Organizer waitlist: players who want organizer tools leave an email so the
// team can contact them once organizers open up after the beta.

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeOrganizerEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) throw new Error('Enter your email address.');
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error('That email address doesn’t look right.');
  return email;
}

async function currentUserId(client) {
  const { data } = await client.auth.getSession();
  return data?.session?.user?.id || null;
}

export async function getOrganizerInterest() {
  if (DEMO_MODE) return null;
  const client = requireSupabase();
  const userId = await currentUserId(client);
  if (!userId) return null;
  const { data, error } = await client.from('organizer_interest').select('email, created_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function submitOrganizerInterest(value) {
  const email = normalizeOrganizerEmail(value);
  if (DEMO_MODE) return { email };
  const client = requireSupabase();
  const userId = await currentUserId(client);
  if (!userId) throw new Error('Sign in to join the organizer list.');
  const { error } = await client.from('organizer_interest').upsert(
    { user_id: userId, email, platform: Platform.OS, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
  return { email };
}
