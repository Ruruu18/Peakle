jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(), getAvailableVoicesAsync: jest.fn() }));

import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { estimateScoreAnnouncementMs, scoreAnnouncementMessage, speakScoreAnnouncement, stopScoreAnnouncement } from '../scoreAccessibility';

const announcement = { player: 'Alex', team: 'Team Alex', action: 'SCORES!', score: '3 – 2', nextServe: 'Alex serving · Server 1' };

describe('speakScoreAnnouncement', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Speech.speak.mockReset();
    Speech.getAvailableVoicesAsync.mockReset().mockResolvedValue([]);
  });
  afterEach(() => { stopScoreAnnouncement(); jest.useRealTimers(); });

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

  it('uses an enhanced English voice with its matching language at normal speed', async () => {
    Speech.getAvailableVoicesAsync.mockResolvedValue([
      { identifier: 'basic-ph', name: 'Basic', language: 'en-PH', quality: 'Default' },
      { identifier: 'enhanced-us', name: 'Ava', language: 'en-US', quality: 'Enhanced' },
    ]);
    const done = speakScoreAnnouncement(announcement);
    await Promise.resolve();
    expect(Speech.speak.mock.calls[0][1]).toMatchObject({ voice: 'enhanced-us', language: 'en-US', rate: 1, pitch: 1 });
    Speech.speak.mock.calls[0][1].onDone();
    await done;
  });

  it('falls back when voice discovery fails', async () => {
    Speech.getAvailableVoicesAsync.mockRejectedValue(new Error('No voice catalog'));
    const done = speakScoreAnnouncement(announcement);
    await Promise.resolve();
    expect(Speech.speak.mock.calls[0][1]).toMatchObject({ language: 'en-US' });
    expect(Speech.speak.mock.calls[0][1].voice).toBeUndefined();
    Speech.speak.mock.calls[0][1].onDone();
    await done;
  });

  it('does not wait indefinitely for the voice catalog or speak twice if it arrives late', async () => {
    let release;
    Speech.getAvailableVoicesAsync.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const done = speakScoreAnnouncement(announcement);
    jest.advanceTimersByTime(500);
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    release([{ identifier: 'late-voice', language: 'en-US' }]);
    await Promise.resolve();
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    Speech.speak.mock.calls[0][1].onDone();
    await done;
  });

  it('retries an unavailable selected voice once using the system fallback', async () => {
    Speech.getAvailableVoicesAsync.mockResolvedValue([{ identifier: 'enhanced-us', language: 'en-US', quality: 'Enhanced' }]);
    const done = speakScoreAnnouncement(announcement);
    await Promise.resolve();
    Speech.speak.mock.calls[0][1].onError(new Error('Voice unavailable'));
    expect(Speech.speak.mock.calls[1][1].voice).toBeUndefined();
    Speech.speak.mock.calls[1][1].onError(new Error('Engine unavailable'));
    await done;
    expect(Speech.speak).toHaveBeenCalledTimes(2);
  });

  it('cancels pending voice discovery when muted', async () => {
    const done = speakScoreAnnouncement(announcement);
    stopScoreAnnouncement();
    await done;
    jest.runAllTimers();
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it('only speaks the latest score when announcements overlap', async () => {
    const first = speakScoreAnnouncement(announcement);
    const second = speakScoreAnnouncement({ ...announcement, score: '4 – 2' });
    await first;
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    expect(Speech.speak.mock.calls[0][0]).toContain('4 to 2');
    Speech.speak.mock.calls[0][1].onDone();
    await second;
  });

  it('uses spoken pauses instead of a visual separator in the serve call', () => {
    expect(scoreAnnouncementMessage(announcement)).toContain('Alex serving, Server 1');
  });
});

describe('browser score announcements', () => {
  const originalPlatform = Platform.OS;
  const originalWindow = global.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  const google = { voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US', localService: false };
  const local = { voiceURI: 'Samantha', name: 'Samantha', lang: 'en-US', localService: true, default: true };
  let synth;

  beforeEach(() => {
    jest.useFakeTimers();
    Platform.OS = 'web';
    synth = { getVoices: jest.fn(() => [local, google]), speak: jest.fn(), cancel: jest.fn() };
    global.window = { speechSynthesis: synth, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } };
    Object.defineProperty(global, 'navigator', { configurable: true, value: { onLine: true } });
  });
  afterEach(() => {
    stopScoreAnnouncement();
    Platform.OS = originalPlatform;
    global.window = originalWindow;
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator);
    else delete global.navigator;
    jest.useRealTimers();
  });

  it('selects Google English synchronously so the first tap can speak', async () => {
    const done = speakScoreAnnouncement(announcement);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = synth.speak.mock.calls[0][0];
    expect(utterance.voice).toBe(google);
    expect(utterance.lang).toBe('en-US');
    utterance.onend();
    await done;
  });

  it('uses a local voice offline and retries locally if an online voice fails', async () => {
    navigator.onLine = false;
    const offline = speakScoreAnnouncement(announcement);
    expect(synth.speak.mock.calls[0][0].voice).toBe(local);
    synth.speak.mock.calls[0][0].onend();
    await offline;
    navigator.onLine = true;
    const online = speakScoreAnnouncement(announcement);
    synth.speak.mock.calls[1][0].onerror({ error: 'network' });
    expect(synth.speak.mock.calls[2][0].voice).toBe(local);
    synth.speak.mock.calls[2][0].onend();
    await online;
  });

  it('picks up late-loaded voices on the next announcement without delaying the first', async () => {
    synth.getVoices.mockReturnValueOnce([]);
    const first = speakScoreAnnouncement(announcement);
    expect(synth.speak.mock.calls[0][0].voice).toBeUndefined();
    synth.speak.mock.calls[0][0].onend();
    await first;
    const second = speakScoreAnnouncement(announcement);
    expect(synth.speak.mock.calls[1][0].voice).toBe(google);
    synth.speak.mock.calls[1][0].onend();
    await second;
  });

  it('does not restart an old announcement after mute or a newer score', async () => {
    const first = speakScoreAnnouncement(announcement);
    const oldUtterance = synth.speak.mock.calls[0][0];
    const second = speakScoreAnnouncement({ ...announcement, score: '4 – 2' });
    await first;
    oldUtterance.onerror({ error: 'network' });
    stopScoreAnnouncement();
    synth.speak.mock.calls[1][0].onerror({ error: 'network' });
    await second;
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

  it('stops speech when the completion callback never arrives', async () => {
    const done = speakScoreAnnouncement(announcement);
    const cancellations = synth.cancel.mock.calls.length;
    jest.advanceTimersByTime(estimateScoreAnnouncementMs(announcement) + 2000);
    await done;
    expect(synth.cancel).toHaveBeenCalledTimes(cancellations + 1);
  });

  it('allows scoring to continue when speech is unsupported', async () => {
    delete window.speechSynthesis;
    await expect(speakScoreAnnouncement(announcement)).resolves.toBeUndefined();
  });
});
