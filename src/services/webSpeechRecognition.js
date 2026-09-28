// Web Speech API adapter with the same surface useShoutScoring uses from
// expo-speech-recognition. The library's web module always uses the browser's cloud
// recognizer, which fails with a `network` error in browsers that ship the API without
// Google's speech service (Brave, Arc, Opera, embedded webviews) or behind firewalls.
// This adapter can switch to Chrome's on-device recognizer (Chrome 139+) instead.

const LANG = 'en-US';

function recognitionClass() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
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
let processLocally = false;

function emit(eventName, payload) {
  listeners.get(eventName)?.forEach((listener) => listener(payload));
}

const webSpeechRecognition = {
  addListener(eventName, listener) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(listener);
    return { remove: () => listeners.get(eventName)?.delete(listener) };
  },

  isRecognitionAvailable() {
    return Boolean(recognitionClass());
  },

  // The browser asks for the microphone itself when recognition starts.
  requestPermissionsAsync() {
    return Promise.resolve({ granted: true, canAskAgain: true, expires: 'never', status: 'granted' });
  },

  isUsingOnDevice() {
    return processLocally;
  },

  // Switches future sessions to on-device recognition when the browser supports it,
  // downloading the English language pack if needed. Resolves false when unsupported.
  async enableOnDeviceRecognition() {
    if (processLocally) return true;
    const Recognition = recognitionClass();
    if (typeof Recognition?.available !== 'function') return false;
    const options = { langs: [LANG], processLocally: true };
    try {
      let status = await Recognition.available(options);
      if ((status === 'downloadable' || status === 'downloading') && typeof Recognition.install === 'function') {
        status = (await Recognition.install(options)) ? 'available' : status;
      }
      processLocally = status === 'available';
    } catch {
      processLocally = false;
    }
    return processLocally;
  },

  start(options = {}) {
    const Recognition = recognitionClass();
    if (!Recognition) throw new Error('Speech recognition is not supported in this browser.');
    recognition?.abort();

    const instance = new Recognition();
    instance.lang = options.lang || LANG;
    instance.interimResults = Boolean(options.interimResults);
    instance.maxAlternatives = options.maxAlternatives || 1;
    instance.continuous = Boolean(options.continuous);
    if (processLocally && 'processLocally' in instance) instance.processLocally = true;

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
    recognition?.stop();
  },

  abort() {
    recognition?.abort();
  },
};

export default webSpeechRecognition;
