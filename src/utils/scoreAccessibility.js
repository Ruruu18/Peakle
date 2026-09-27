import { AccessibilityInfo, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { selectScoreVoice } from './scoreVoice';

let finishActiveAnnouncement = null;

function browserSpeech() {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.speechSynthesis : null;
}

// Start the browser's asynchronous voice discovery before the first match.
try { browserSpeech()?.getVoices(); } catch { /* Speech is optional. */ }

function stopSpeaking() {
  try {
    if (Platform.OS === 'web') browserSpeech()?.cancel();
    else Promise.resolve(Speech.stop()).catch(() => {});
  } catch { /* A missing speech engine must not interrupt scoring. */ }
}

function spokenScore(score) {
  return String(score || '').replace(/\s*[\u2013\u2014-]\s*/g, ' to ').trim();
}

export function scoreAnnouncementMessage(announcement) {
  if (!announcement) return '';

  const action = String(announcement.action || '').replace(/!+/g, '').toLowerCase();
  return [
    [announcement.player, announcement.team, action].filter(Boolean).join(', '),
    announcement.score ? `Score ${spokenScore(announcement.score)}` : null,
    (announcement.nextServe || announcement.note || '').replace(/\s*·\s*/g, ', '),
  ].filter(Boolean).join('. ');
}

export function announceScoreForVoiceOver(announcement) {
  if (Platform.OS !== 'ios' || !announcement) return;
  const message = scoreAnnouncementMessage(announcement);

  if (message) AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: false });
}

// A conservative estimate at normal speaking rate. Devices that
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
  stopScoreAnnouncement();
  return new Promise((resolve) => {
    let settled = false;
    let voiceTimer;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      clearTimeout(voiceTimer);
      if (finishActiveAnnouncement === done) finishActiveAnnouncement = null;
      resolve();
    };
    const cap = setTimeout(() => {
      done();
      stopSpeaking();
    }, estimateScoreAnnouncementMs(announcement) + 2000);
    finishActiveAnnouncement = done;

    if (Platform.OS === 'web') {
      const synth = browserSpeech();
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') { done(); return; }
      let voices = [];
      try { voices = synth.getVoices(); } catch { /* Use the browser default. */ }
      const localVoices = voices.filter((voice) => voice.localService !== false);
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      const preferred = selectScoreVoice(online ? voices : localVoices);
      const speak = (voice, canRetry) => {
        if (settled) return;
        const retry = () => {
          if (settled) return;
          if (canRetry && voice) speak(selectScoreVoice(localVoices.filter((item) => item !== voice)), false);
          else done();
        };
        try {
          const utterance = new window.SpeechSynthesisUtterance(message);
          utterance.lang = voice?.lang || 'en-US';
          if (voice) utterance.voice = voice;
          utterance.rate = 1;
          utterance.pitch = 1;
          utterance.onend = done;
          utterance.onerror = (event) => {
            if (event.error === 'canceled' || event.error === 'interrupted') done();
            else retry();
          };
          // Stay in the tap's call stack. Expo's web voice lookup awaits a
          // promise, which can delay speech until after mute/navigation.
          // Re-read voices on each announcement to pick up late-loaded voices.
          synth.speak(utterance);
        } catch { retry(); }
      };
      speak(preferred, true);
      return;
    }

    let started = false;
    const speakNative = (voice, canRetry = true) => {
      if (settled) return;
      const retry = () => {
        if (settled) return;
        if (canRetry && voice) speakNative(null, false);
        else done();
      };
      try {
        Speech.speak(message, {
          language: voice?.language || 'en-US',
          ...(voice ? { voice: voice.identifier } : {}),
          rate: 1, pitch: 1, onDone: done, onStopped: done, onError: retry,
        });
      } catch { retry(); }
    };
    const voicesReady = (voices) => {
      if (settled || started) return;
      started = true;
      clearTimeout(voiceTimer);
      speakNative(selectScoreVoice(voices));
    };
    // A slow or unavailable voice catalog must not hold up the first score.
    voiceTimer = setTimeout(() => voicesReady([]), 500);
    try {
      Promise.resolve(Speech.getAvailableVoicesAsync()).then(voicesReady, () => voicesReady([]));
    } catch { voicesReady([]); }
  });
}

export function stopScoreAnnouncement() {
  finishActiveAnnouncement?.();
  stopSpeaking();
}
