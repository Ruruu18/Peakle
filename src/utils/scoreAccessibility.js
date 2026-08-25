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

export function speakScoreAnnouncement(announcement) {
  const message = scoreAnnouncementMessage(announcement);
  if (!message) return;
  Speech.stop();
  Speech.speak(message, { language: 'en-PH', rate: 0.92, pitch: 1 });
}

export function stopScoreAnnouncement() {
  Speech.stop();
}
