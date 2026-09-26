import AsyncStorage from '@react-native-async-storage/async-storage';
import { FEEDBACK_RULES, isFeedbackDue, loadFeedbackState, recordFeedbackSession } from '../appFeedback';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 26, 12);
const always = () => 0;
const never = () => 0.99;
const settled = { firstSeenAt: NOW - 10 * DAY, activeDays: 5 };

describe('isFeedbackDue', () => {
  it('asks settled players on a lucky session', () => {
    expect(isFeedbackDue(settled, NOW, always)).toBe(true);
    expect(isFeedbackDue(settled, NOW, never)).toBe(false);
  });

  it('waits for new players to use the app for a few days', () => {
    expect(isFeedbackDue({ firstSeenAt: NOW - DAY, activeDays: 5 }, NOW, always)).toBe(false);
    expect(isFeedbackDue({ firstSeenAt: NOW - 10 * DAY, activeDays: 1 }, NOW, always)).toBe(false);
  });

  it('respects snooze, submit cooldown, prompt cap, and opt-out', () => {
    expect(isFeedbackDue({ ...settled, lastPromptAt: NOW - 5 * DAY }, NOW, always)).toBe(false);
    expect(isFeedbackDue({ ...settled, lastPromptAt: NOW - (FEEDBACK_RULES.snoozeDays + 1) * DAY }, NOW, always)).toBe(true);
    expect(isFeedbackDue({ ...settled, submittedAt: NOW - 30 * DAY }, NOW, always)).toBe(false);
    expect(isFeedbackDue({ ...settled, promptCount: FEEDBACK_RULES.maxPrompts }, NOW, always)).toBe(false);
    expect(isFeedbackDue({ ...settled, optedOut: true }, NOW, always)).toBe(false);
  });
});

describe('recordFeedbackSession', () => {
  beforeEach(() => AsyncStorage.clear());

  it('counts distinct active days once each', async () => {
    await recordFeedbackSession('u1', NOW);
    await recordFeedbackSession('u1', NOW + 1000);
    await recordFeedbackSession('u1', NOW + DAY);
    const state = await loadFeedbackState('u1');
    expect(state).toMatchObject({ firstSeenAt: NOW, activeDays: 2 });
  });
});
