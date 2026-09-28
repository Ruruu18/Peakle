import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';

// First-game and repeat-play measurement. Only an event name and, where it
// helps, the activity id are sent: never message text, locations or profile
// details. Signed-out steps use a random id kept on this device.
const ANONYMOUS_ID_KEY = 'peakle.funnelAnonymousId';
let anonymousId = null;

function randomHex() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deviceAnonymousId() {
  if (anonymousId) return anonymousId;
  try {
    const stored = await AsyncStorage.getItem(ANONYMOUS_ID_KEY);
    if (/^[a-f0-9]{32}$/.test(stored || '')) return (anonymousId = stored);
    anonymousId = randomHex();
    await AsyncStorage.setItem(ANONYMOUS_ID_KEY, anonymousId);
  } catch (_) {
    anonymousId ||= randomHex();
  }
  return anonymousId;
}

// Fire and forget: measurement must never block or break a player action.
export function recordPlayerEvent(event, { gameId = null } = {}) {
  if (DEMO_MODE || !supabase) return;
  deviceAnonymousId()
    .then((id) => supabase.rpc('record_player_event', { p_event: event, p_anonymous_id: id, p_game_id: gameId }))
    .catch(() => {});
}
