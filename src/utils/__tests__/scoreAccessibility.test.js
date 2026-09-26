jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

import * as Speech from 'expo-speech';
import { estimateScoreAnnouncementMs, speakScoreAnnouncement } from '../scoreAccessibility';

const announcement = { player: 'Alex', team: 'Team Alex', action: 'SCORES!', score: '3 – 2', nextServe: 'Alex serving · Server 1' };

describe('speakScoreAnnouncement', () => {
  beforeEach(() => { jest.useFakeTimers(); Speech.speak.mockReset(); });
  afterEach(() => jest.useRealTimers());

  it('resolves only when the voice finishes', async () => {
    let finished = false;
    const done = speakScoreAnnouncement(announcement).then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    Speech.speak.mock.calls[0][1].onDone();
    await done;
    expect(finished).toBe(true);
  });

  it('never waits forever when speech callbacks do not fire', async () => {
    const done = speakScoreAnnouncement(announcement);
    jest.advanceTimersByTime(estimateScoreAnnouncementMs(announcement) + 2000);
    await expect(done).resolves.toBeUndefined();
  });

  it('holds longer than the 1.9s visual announcement for a full spoken score', () => {
    expect(estimateScoreAnnouncementMs(announcement)).toBeGreaterThan(1900);
    expect(estimateScoreAnnouncementMs(null)).toBe(0);
  });
});
