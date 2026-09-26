import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';
import { APP_VERSION } from '../config/appInfo';

// Occasional "How's Peakle so far?" prompt. It only appears for players who
// have been around for a while, never twice close together, and stops for good
// once they opt out or have been asked enough times.

const DAY = 24 * 60 * 60 * 1000;
export const FEEDBACK_RULES = Object.freeze({
  minDaysSinceFirstSeen: 3,
  minActiveDays: 3,
  snoozeDays: 21, // after "Not now" / closing it
  cooldownDaysAfterSubmit: 120,
  maxPrompts: 4,
  chance: 0.4, // per eligible session, so it feels occasional rather than scheduled
});

const storageKey = (userId) => `@peakle/app-feedback/${userId}`;
const dayStamp = (now) => new Date(now).toISOString().slice(0, 10);

export async function loadFeedbackState(userId) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveFeedbackState(userId, state) {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(state)).catch(() => {});
}

// Called once per app session; counts distinct days the player opened Peakle.
export async function recordFeedbackSession(userId, now = Date.now()) {
  const state = await loadFeedbackState(userId);
  const today = dayStamp(now);
  const next = {
    ...state,
    firstSeenAt: state.firstSeenAt || now,
    activeDays: state.lastActiveDay === today ? state.activeDays || 1 : (state.activeDays || 0) + 1,
    lastActiveDay: today,
  };
  await saveFeedbackState(userId, next);
  return next;
}

export function isFeedbackDue(state, now = Date.now(), random = Math.random) {
  const rules = FEEDBACK_RULES;
  if (!state || state.optedOut) return false;
  if ((state.promptCount || 0) >= rules.maxPrompts) return false;
  if (!state.firstSeenAt || now - state.firstSeenAt < rules.minDaysSinceFirstSeen * DAY) return false;
  if ((state.activeDays || 0) < rules.minActiveDays) return false;
  if (state.submittedAt && now - state.submittedAt < rules.cooldownDaysAfterSubmit * DAY) return false;
  if (state.lastPromptAt && now - state.lastPromptAt < rules.snoozeDays * DAY) return false;
  return random() < rules.chance;
}

export async function markFeedbackPrompted(userId, now = Date.now()) {
  const state = await loadFeedbackState(userId);
  await saveFeedbackState(userId, { ...state, lastPromptAt: now, promptCount: (state.promptCount || 0) + 1 });
}

export async function optOutOfFeedback(userId) {
  const state = await loadFeedbackState(userId);
  await saveFeedbackState(userId, { ...state, optedOut: true });
}

// Another device may already have collected feedback recently.
export async function hasRecentFeedback(userId, now = Date.now()) {
  if (DEMO_MODE) return false;
  const since = new Date(now - FEEDBACK_RULES.cooldownDaysAfterSubmit * DAY).toISOString();
  const { data, error } = await requireSupabase()
    .from('app_feedback').select('id').eq('user_id', userId).gte('created_at', since).limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

export async function submitAppFeedback(userId, { rating, comment }, now = Date.now()) {
  const value = Math.round(Number(rating));
  if (!(value >= 1 && value <= 5)) throw new Error('Pick a star rating first.');
  const text = String(comment || '').trim().slice(0, 1000);
  if (!DEMO_MODE) {
    const { error } = await requireSupabase().from('app_feedback').insert({
      user_id: userId,
      rating: value,
      comment: text || null,
      app_version: APP_VERSION,
      platform: Platform.OS,
    });
    if (error) throw error;
  }
  const state = await loadFeedbackState(userId);
  await saveFeedbackState(userId, { ...state, submittedAt: now });
}
