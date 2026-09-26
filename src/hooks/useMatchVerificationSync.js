import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';

const DEBOUNCE_MS = 250;
let nextChannelId = 0;

/**
 * Calls `onChange` whenever a match result the player can see is saved,
 * confirmed, disputed or verified, or a visible rating moves - and again when
 * the app returns to the foreground, to catch anything missed while it slept.
 * Bursts (one verification updates the match, confirmations and every
 * participant's rating) collapse into a single refresh.
 */
export default function useMatchVerificationSync(userId, onChange) {
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    if (!userId || DEMO_MODE) return undefined;
    const client = requireSupabase();
    let timer = null;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callback.current?.(), DEBOUNCE_MS);
    };
    const channel = client.channel(`match-verification-${userId}-${nextChannelId += 1}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_result_confirmations' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_ratings' }, refresh)
      .subscribe();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      appState.remove();
      client.removeChannel(channel);
    };
  }, [userId]);
}
