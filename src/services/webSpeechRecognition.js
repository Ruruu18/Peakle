// Web speech adapter with the same surface useShoutScoring uses from
// expo-speech-recognition. It prefers the browser's Web Speech API, whose recognizer
// is a cloud service in Chrome/Edge and Dictation in Safari. Many browsers ship the API
// with nothing behind it (Brave, Arc, Opera, embedded webviews), Safari needs Dictation
// switched on, and firewalls block Chrome's service. In those cases, and in browsers
// without the API at all, it switches to free in-browser Whisper recognition.

import {
  abortWhisperSession,
  isWhisperSupported,
  startWhisperSession,
  stopWhisperSession,
} from './webWhisperRecognition';

const LANG = 'en-US';
// Remembers that this browser's own recognizer failed, so later matches start on the
// local recognizer straight away instead of failing once first.
const LOCAL_PREFERENCE_KEY = 'peakle.speech.useLocalRecognizer';

function recognitionClass() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function readLocalPreference() {
  try {
    return window.localStorage.getItem(LOCAL_PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLocalPreference() {
  try {
    window.localStorage.setItem(LOCAL_PREFERENCE_KEY, '1');
  } catch {
    // Private windows can refuse storage; the fallback still applies for this visit.
  }
}

function initialUseLocal() {
  if (typeof window === 'undefined') return false;
  // Brave exposes the API but never ships a recognizer for it.
  if (!recognitionClass() || navigator.brave) return true;
  return readLocalPreference();
}

function mapResultEvent(ev) {
  const current = ev.results[ev.resultIndex];
  if (current?.isFinal) {
    const results = [];
    for (let i = 0; i < current.length; i += 1) {
      results.push({ transcript: current[i].transcript, confidence: current[i].confidence, segments: [] });
    }
    return { isFinal: true, results };
  }
  let transcript = '';
  let confidenceTotal = 0;
  let count = 0;
  for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
    const best = ev.results[i]?.[0];
    if (!best) continue;
    transcript += best.transcript;
    confidenceTotal += best.confidence;
    count += 1;
  }
  return {
    isFinal: false,
    results: [{ transcript, confidence: count ? confidenceTotal / count : -1, segments: [] }],
  };
}

const EVENT_MAPPERS = {
  start: () => null,
  end: () => null,
  speechstart: () => null,
  error: (ev) => ({ error: ev.error, message: ev.message }),
  result: mapResultEvent,
};

const listeners = new Map();
let recognition = null;
let useLocal = null;

function emit(eventName, payload) {
  listeners.get(eventName)?.forEach((listener) => listener(payload));
}

function usingLocal() {
  if (useLocal === null) useLocal = initialUseLocal();
  return useLocal;
}

const webSpeechRecognition = {
  addListener(eventName, listener) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(listener);
    return { remove: () => listeners.get(eventName)?.delete(listener) };
  },

  isRecognitionAvailable() {
    return Boolean(recognitionClass()) || isWhisperSupported();
  },

  // The browser asks for the microphone itself when recognition starts.
  requestPermissionsAsync() {
    return Promise.resolve({ granted: true, canAskAgain: true, expires: 'never', status: 'granted' });
  },

  isUsingLocalRecognition() {
    return usingLocal();
  },

  // Switches future sessions to the in-browser recognizer. Returns false when this
  // browser cannot run it either.
  useLocalRecognition() {
    if (!isWhisperSupported()) return false;
    useLocal = true;
    writeLocalPreference();
    return true;
  },

  start(options = {}) {
    recognition?.abort();
    recognition = null;
    if (usingLocal()) {
      startWhisperSession(emit);
      return;
    }

    const Recognition = recognitionClass();
    if (!Recognition) throw new Error('Speech recognition is not supported in this browser.');
    const instance = new Recognition();
    instance.lang = options.lang || LANG;
    instance.interimResults = Boolean(options.interimResults);
    instance.maxAlternatives = options.maxAlternatives || 1;
    instance.continuous = Boolean(options.continuous);

    Object.entries(EVENT_MAPPERS).forEach(([eventName, mapEvent]) => {
      instance.addEventListener(eventName, (ev) => {
        // Ignore late events from a session that has already been replaced.
        if (recognition !== instance) return;
        emit(eventName, mapEvent(ev));
      });
    });

    recognition = instance;
    instance.start();
  },

  stop() {
    if (recognition) recognition.stop();
    else stopWhisperSession();
  },

  abort() {
    if (recognition) recognition.abort();
    else abortWhisperSession();
  },
};

export default webSpeechRecognition;
