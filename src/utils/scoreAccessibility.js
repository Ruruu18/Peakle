import { AccessibilityInfo, Platform } from 'react-native';
import * as Speech from 'expo-speech';

function spokenScore(score) {
  return String(score || '').replace(/\s*[\u2013\u2014-]\s*/g, ' to ').trim();
}

export function scoreAnnouncementMessage(announcement) {
  if (!announcement) return '';

  const action = String(announcement.action || '').replace(/!+/g, '').toLowerCase();
  return [
    [announcement.player, announcement.team, action].filter(Boolean).join(', '),
    announcement.score ? `Score ${spokenScore(announcement.score)}` : null,
    announcement.nextServe || announcement.note || null,
  ].filter(Boolean).join('. ');
}

export function announceScoreForVoiceOver(announcement) {
  if (Platform.OS !== 'ios' || !announcement) return;
  const message = scoreAnnouncementMessage(announcement);

  if (message) AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: false });
}

// Roughly how long the spoken announcement lasts at rate 0.92. Devices that
// only watch the score use it to stay in step with the scorer's voice.
export function estimateScoreAnnouncementMs(announcement) {
  const words = scoreAnnouncementMessage(announcement).split(/\s+/).filter(Boolean).length;
  return words ? Math.min(8000, 600 + words * 420) : 0;
}

// Resolves when the voice finishes, is stopped, or fails. The cap keeps a
// missing speech callback from freezing the court.
export function speakScoreAnnouncement(announcement) {
  const message = scoreAnnouncementMessage(announcement);
  if (!message) return Promise.resolve();
  Speech.stop();
  return new Promise((resolve) => {
    const cap = setTimeout(resolve, estimateScoreAnnouncementMs(announcement) + 2000);
    const done = () => { clearTimeout(cap); resolve(); };
    Speech.speak(message, { language: 'en-PH', rate: 0.92, pitch: 1, onDone: done, onStopped: done, onError: done });
  });
}

export function stopScoreAnnouncement() {
  Speech.stop();
}
