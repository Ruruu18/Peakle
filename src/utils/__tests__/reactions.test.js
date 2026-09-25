import { createReactionTracker, toggleOwnReaction } from '../reactions';

describe('toggleOwnReaction', () => {
  const others = [{ user_id: 'u2', emoji: '👍' }];

  it('replaces the user reaction when one reaction per user is allowed', () => {
    const start = [...others, { user_id: 'u1', emoji: '❤️' }];
    expect(toggleOwnReaction(start, 'u1', '🔥', { singlePerUser: true })).toEqual([...others, { user_id: 'u1', emoji: '🔥' }]);
    expect(toggleOwnReaction(start, 'u1', '❤️', { singlePerUser: true })).toEqual(others);
  });

  it('toggles each emoji independently otherwise', () => {
    const start = [...others, { user_id: 'u1', emoji: '❤️' }];
    expect(toggleOwnReaction(start, 'u1', '🔥')).toEqual([...start, { user_id: 'u1', emoji: '🔥' }]);
    expect(toggleOwnReaction(start, 'u1', '❤️')).toEqual(others);
  });
});

describe('createReactionTracker', () => {
  it('settles only after the last pending toggle finishes', () => {
    const tracker = createReactionTracker();
    tracker.start('m1');
    tracker.start('m1');
    expect(tracker.isPending('m1')).toBe(true);
    expect(tracker.finish('m1')).toBe(false);
    expect(tracker.finish('m1')).toBe(true);
    expect(tracker.isPending('m1')).toBe(false);
  });
});
