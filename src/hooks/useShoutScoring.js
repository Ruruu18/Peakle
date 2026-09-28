import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { buildContextualStrings, resolveShoutToTeam } from '../utils/shoutScoring';
import { mergeTranscriptFragments, moreCompleteTranscript } from '../utils/transcriptBuffer';

const COOLDOWN_MS = 1200;
// After a successful score, the mic is deliberately closed (not just cooling down) for this
// long before it starts listening again — covers the celebration/chatter right after a rally
// ("nice one team 1!") that would otherwise risk re-triggering the same call.
const POST_SCORE_PAUSE_MS = 1800;
// Per the library's docs, volume readings run -2..10 and "anything below 0" is inaudible —
// use that documented floor to reject phantom/glitch results with no real sound behind them.
const MIN_AUDIBLE_VOLUME = 0;
// Confidence is 0..1 (or -1 when the platform doesn't report one). Below this, a match is
// more likely a mis-hearing of background noise than an actual shouted word.
const MIN_CONFIDENCE = 0.35;
const MAX_ERROR_BACKOFF_MS = 4000;
// Browsers get Peakle's web adapter (the Web Speech API, falling back to free
// in-browser Whisper recognition); native builds load the optional native module so Expo Go still opens
// without it.
const speechRecognitionModule = Platform.OS === 'web'
  ? require('../services/webSpeechRecognition').default
  : requireOptionalNativeModule('ExpoSpeechRecognition');

const RECOVERABLE_ERRORS = new Set(['audio-capture', 'network', 'busy', 'client', 'unknown', 'bad-grammar', 'interrupted']);
const SILENCE_ERRORS = new Set(['no-speech', 'speech-timeout']);
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'model-unavailable']);
// Browser recognizer failures that the in-browser recognizer can take over from.
const WEB_LOCAL_FALLBACK_ERRORS = new Set(['network', 'service-not-allowed']);

function unavailableMessage(code, nativeMessage = '') {
  if (code === 'native-module-missing') {
    return 'Expo Go does not include Peakle\'s speech-recognition module. Open a Peakle development build made with npm run ios or npm run android, then connect it to the Expo server.';
  }
  if (Platform.OS === 'web' && code === 'not-allowed') {
    return 'Microphone access is blocked for this site. Allow the microphone in your browser’s address bar, then select Mic again.';
  }
  if (Platform.OS === 'web' && code === 'service-not-allowed') {
    return 'This browser cannot recognize speech. Use Chrome, Edge or Safari, or score with taps.';
  }
  if (code === 'model-unavailable') {
    return 'Speech recognition could not be downloaded. Check your connection, then select Listen again.';
  }
  if (Platform.OS === 'web' && code === 'network') {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'You are offline, and this browser needs an internet connection for speech recognition. Reconnect, then select Mic again.';
    }
    return 'This browser could not reach its speech recognition service. Brave, Arc, Opera and in-app browsers often do not include one. Open Peakle in Chrome, Edge or Safari, or score with taps.';
  }
  if (code === 'not-allowed') {
    return 'Microphone or speech recognition access is off. Enable both for Peakle in your device Settings, then select Shout again.';
  }
  if (code === 'service-not-allowed') {
    return Platform.OS === 'android'
      ? 'Speech recognition is not enabled on this device. Enable Speech Recognition & Synthesis on Android 13+, or the Google app on Android 12 and lower, then try again.'
      : 'Speech recognition is not available. Enable Siri & Dictation in Settings, then try again.';
  }
  if (code === 'language-not-supported') {
    return 'English (United States) speech recognition is not installed or supported on this device.';
  }
  const detail = nativeMessage ? ` (${nativeMessage})` : '';
  return `The microphone could not start${detail}. Close any other app using the microphone, check your connection, and try again.`;
}

function useSpeechRecognitionEvent(eventName, listener) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (!speechRecognitionModule) return undefined;

    const subscription = speechRecognitionModule.addListener(
      eventName,
      (event) => listenerRef.current(event),
    );

    return () => subscription.remove();
  }, [eventName]);
}

export default function useShoutScoring({
  active,
  players,
  onScore,
  onTranscript,
  strictConfidence = false,
  minimumAudibleVolume = MIN_AUDIBLE_VOLUME,
  fragmentBufferMs = 0,
}) {
  const [listening, setListening] = useState(false);
  const [lastHeard, setLastHeard] = useState('');
  const [volume, setVolume] = useState(-2);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [failure, setFailure] = useState(null);
  const [preparingOnDevice, setPreparingOnDevice] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);

  const activeRef = useRef(active);
  const playersRef = useRef(players);
  const onScoreRef = useRef(onScore);
  const onTranscriptRef = useRef(onTranscript);
  const contextualStringsRef = useRef(buildContextualStrings(players));
  const lastScoredAtRef = useRef(0);

  const mountedRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const permissionGrantedRef = useRef(false);
  const restartTimerRef = useRef(null);
  const errorStreakRef = useRef(0);
  const peakVolumeRef = useRef(-Infinity);
  const justScoredRef = useRef(false);
  const blockedRef = useRef(false);
  const bestSessionTranscriptRef = useRef('');
  const finalHandledInSessionRef = useRef(false);
  const pendingFragmentRef = useRef('');
  const pendingFragmentTimerRef = useRef(null);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    playersRef.current = players;
    contextualStringsRef.current = buildContextualStrings(players);
  }, [players]);
  useEffect(() => { onScoreRef.current = onScore; }, [onScore]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearPendingFragmentTimer = useCallback(() => {
    if (pendingFragmentTimerRef.current) {
      clearTimeout(pendingFragmentTimerRef.current);
      pendingFragmentTimerRef.current = null;
    }
  }, []);

  const clearPendingFragment = useCallback(() => {
    clearPendingFragmentTimer();
    pendingFragmentRef.current = '';
  }, [clearPendingFragmentTimer]);

  const schedulePendingFragmentRejection = useCallback(() => {
    clearPendingFragmentTimer();
    if (!fragmentBufferMs || !pendingFragmentRef.current) return;
    pendingFragmentTimerRef.current = setTimeout(() => {
      pendingFragmentTimerRef.current = null;
      const transcript = pendingFragmentRef.current;
      pendingFragmentRef.current = '';
      if (transcript && mountedRef.current && activeRef.current) {
        onTranscriptRef.current?.([], transcript, { reason: 'unrecognized', pending: false });
      }
    }, fragmentBufferMs);
  }, [clearPendingFragmentTimer, fragmentBufferMs]);

  const blockRecognition = useCallback((code, nativeMessage = '') => {
    blockedRef.current = true;
    sessionActiveRef.current = false;
    clearRestartTimer();
    setListening(false);
    setVolume(-2);
    setPreparingOnDevice(false);
    setNeedsTap(false);
    setPermissionDenied(code === 'not-allowed');
    setFailure({ code, message: unavailableMessage(code, nativeMessage) });
  }, [clearRestartTimer]);

  const startListening = useCallback(async () => {
    if (blockedRef.current || sessionActiveRef.current) return;
    if (!speechRecognitionModule) {
      blockRecognition('native-module-missing');
      return;
    }
    // Guards against overlapping sessions: a restart scheduled from `end`/`error` can race
    // with the effect-driven start when `active` flips quickly (e.g. pausing then resuming).
    sessionActiveRef.current = true;

    try {
      if (!permissionGrantedRef.current) {
        const permission = await speechRecognitionModule.requestPermissionsAsync();
        if (!mountedRef.current) {
          sessionActiveRef.current = false;
          return;
        }
        if (!permission.granted) {
          blockRecognition('not-allowed');
          return;
        }
        permissionGrantedRef.current = true;
      }
      setPermissionDenied(false);
      setFailure(null);

      if (!activeRef.current) {
        sessionActiveRef.current = false;
        return;
      }

      if (!speechRecognitionModule.isRecognitionAvailable()) {
        blockRecognition('service-not-allowed');
        return;
      }

      peakVolumeRef.current = -Infinity;
      bestSessionTranscriptRef.current = '';
      finalHandledInSessionRef.current = false;
      setVolume(-2);
      const androidApiLevel = Platform.OS === 'android' ? Number(Platform.Version) : 0;
      speechRecognitionModule.start({
        lang: 'en-US',
        // iOS emits its final result when a non-continuous task ends. The old combination
        // of continuous=true + ignoring interim results could listen forever without ever
        // delivering a score. Android only supports continuous recognition from API 33.
        continuous: Platform.OS === 'android' && androidApiLevel >= 33,
        interimResults: true,
        maxAlternatives: 3,
        addsPunctuation: false,
        // Bias the recognizer toward the exact words that matter (team calls, player names)
        // so it's far less likely to mistake crowd/background chatter for a scoring word.
        contextualStrings: contextualStringsRef.current,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 150 },
        ...(Platform.OS === 'ios' ? {
          // Apple's confirmation hint is intended for short words and phrases.
          // These are short multi-word commands, not yes/no or single-word answers.
          iosTaskHint: 'search',
          // Apple's voice processing suppresses background noise and removes the app's
          // own spoken score announcements, so they are not heard as commands.
          iosVoiceProcessingEnabled: true,
        } : {}),
        ...(Platform.OS === 'android' ? {
          // Short-phrase model instead of free-form dictation — better suited to a single
          // shouted word/name than to long-form speech.
          androidIntentOptions: {
            EXTRA_LANGUAGE_MODEL: 'web_search',
            // Give a player enough time to say "score two one two" without the
            // recognizer treating a natural pause between numbers as the end.
            EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 1200,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 900,
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1600,
          },
        } : {}),
      });
    } catch (error) {
      if (mountedRef.current) blockRecognition('audio-capture', error?.message);
    }
  }, [blockRecognition]);

  const scheduleRestart = useCallback((delayMs) => {
    clearRestartTimer();
    if (!activeRef.current || !mountedRef.current) return;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      startListening();
    }, delayMs);
  }, [clearRestartTimer, startListening]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (active) {
      blockedRef.current = false;
      clearPendingFragment();
      setFailure(null);
      setLastHeard('');
      setVolume(-2);
      startListening();
    } else {
      blockedRef.current = true;
      clearPendingFragment();
      clearRestartTimer();
      if (sessionActiveRef.current) speechRecognitionModule?.stop();
      sessionActiveRef.current = false;
      setListening(false);
      setVolume(-2);
    }
    return () => {
      blockedRef.current = true;
      clearRestartTimer();
      clearPendingFragment();
      if (sessionActiveRef.current) speechRecognitionModule?.stop();
    };
  }, [active, startListening, clearRestartTimer, clearPendingFragment]);

  // The in-browser recognizer is downloading its model before the first session.
  useSpeechRecognitionEvent('preparing', () => {
    setPreparingOnDevice(true);
  });

  // The browser is holding audio until the page gets a tap or key press.
  useSpeechRecognitionEvent('needsgesture', () => {
    setPreparingOnDevice(false);
    setNeedsTap(true);
  });

  useSpeechRecognitionEvent('start', () => {
    setPreparingOnDevice(false);
    setNeedsTap(false);
    bestSessionTranscriptRef.current = '';
    finalHandledInSessionRef.current = false;
    setListening(true);
  });

  useSpeechRecognitionEvent('speechstart', () => {
    // Real audio is flowing again — the session has recovered, so drop any error backoff.
    errorStreakRef.current = 0;
    peakVolumeRef.current = -Infinity;
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (event.value > peakVolumeRef.current) peakVolumeRef.current = event.value;
    setVolume(event.value);
  });

  useSpeechRecognitionEvent('end', () => {
    sessionActiveRef.current = false;
    setListening(false);
    // A fatal/permission error already decided not to keep listening. A ref is required
    // here because the native `end` event can arrive before React commits failure state.
    if (blockedRef.current) return;

    // Some engines end after providing only interim text. Preserve it as a fragment
    // so the next rapidly restarted session can finish the command.
    if (fragmentBufferMs && !finalHandledInSessionRef.current && bestSessionTranscriptRef.current) {
      const fragment = mergeTranscriptFragments(
        pendingFragmentRef.current,
        bestSessionTranscriptRef.current,
      );
      pendingFragmentRef.current = fragment;
      setLastHeard(fragment);
      schedulePendingFragmentRejection();
    }
    if (justScoredRef.current) {
      justScoredRef.current = false;
      scheduleRestart(POST_SCORE_PAUSE_MS);
      return;
    }
    const backoff = errorStreakRef.current > 0
      ? Math.min(300 * 2 ** (errorStreakRef.current - 1), MAX_ERROR_BACKOFF_MS)
      : 50;
    scheduleRestart(backoff);
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (Platform.OS === 'web'
      && WEB_LOCAL_FALLBACK_ERRORS.has(event.error)
      && !speechRecognitionModule.isUsingLocalRecognition()
      && speechRecognitionModule.useLocalRecognition()) {
      // The browser's own recognizer is missing or unreachable. The `end` that follows
      // restarts listening on the in-browser recognizer.
      errorStreakRef.current = 0;
      return;
    }
    if (FATAL_ERRORS.has(event.error)) {
      blockRecognition(event.error, event.message);
      return;
    }
    if (SILENCE_ERRORS.has(event.error) || event.error === 'aborted') return;
    if (RECOVERABLE_ERRORS.has(event.error)) {
      errorStreakRef.current = Math.min(errorStreakRef.current + 1, 5);
      if (errorStreakRef.current >= 3) blockRecognition(event.error, event.message);
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    const alternatives = (event.results || []).filter((result) => result?.transcript);
    if (!alternatives.length) return;

    bestSessionTranscriptRef.current = moreCompleteTranscript(
      bestSessionTranscriptRef.current,
      alternatives[0].transcript,
    );
    const liveTranscript = fragmentBufferMs
      ? mergeTranscriptFragments(pendingFragmentRef.current, bestSessionTranscriptRef.current)
      : alternatives[0].transcript;
    setLastHeard(liveTranscript);
    if (fragmentBufferMs && pendingFragmentRef.current) {
      // Keep the join window open while the recognizer is actively producing the
      // continuation of a cut command.
      schedulePendingFragmentRejection();
    }
    if (!event.isFinal) return;
    finalHandledInSessionRef.current = true;

    // Only gate on volume once we've actually observed a real reading — `volumechange`
    // support isn't guaranteed on every platform/OS version, and a hard block here would
    // silently discard every valid shout if the event never fires.
    if (Number.isFinite(minimumAudibleVolume)
      && peakVolumeRef.current > -Infinity
      && peakVolumeRef.current < minimumAudibleVolume) {
      onTranscriptRef.current?.([], alternatives[0].transcript, { reason: 'too-quiet' });
      justScoredRef.current = true;
      speechRecognitionModule.abort();
      return;
    }

    const now = Date.now();
    if (now - lastScoredAtRef.current < COOLDOWN_MS) return;

    const confident = alternatives.filter((result) => result.confidence === -1 || result.confidence >= MIN_CONFIDENCE);
    if (strictConfidence && !confident.length) {
      onTranscriptRef.current?.([], alternatives[0].transcript, { reason: 'low-confidence' });
      justScoredRef.current = true;
      speechRecognitionModule.abort();
      return;
    }
    const transcripts = (confident.length ? confident : alternatives).map((result) => result.transcript);
    const completeSessionTranscript = moreCompleteTranscript(
      alternatives[0].transcript,
      bestSessionTranscriptRef.current,
    );
    if (completeSessionTranscript && !transcripts.includes(completeSessionTranscript)) {
      transcripts.push(completeSessionTranscript);
    }
    const bufferedTranscripts = fragmentBufferMs
      ? transcripts.map((transcript) => mergeTranscriptFragments(pendingFragmentRef.current, transcript))
      : transcripts;
    const primaryTranscript = fragmentBufferMs
      ? mergeTranscriptFragments(pendingFragmentRef.current, completeSessionTranscript)
      : alternatives[0].transcript;

    // Screens may consume explicit voice commands (for example, “Alex serving”) before
    // the same player name is interpreted as the winner of a rally.
    if (onTranscriptRef.current?.(bufferedTranscripts, primaryTranscript, {
      reason: null,
      pending: Boolean(fragmentBufferMs),
    }) === true) {
      clearPendingFragment();
      setLastHeard(primaryTranscript);
      lastScoredAtRef.current = now;
      justScoredRef.current = true;
      speechRecognitionModule.abort();
      return;
    }

    if (fragmentBufferMs) {
      pendingFragmentRef.current = primaryTranscript;
      setLastHeard(primaryTranscript);
      schedulePendingFragmentRejection();
      return;
    }

    const team = resolveShoutToTeam(bufferedTranscripts, playersRef.current);
    if (team === null) return;

    lastScoredAtRef.current = now;
    justScoredRef.current = true;
    onScoreRef.current?.(team, primaryTranscript);
    // Close the mic right away instead of leaving it hot until the recognizer times out on
    // its own — the `end` handler above sees `justScoredRef` and holds off restarting for
    // POST_SCORE_PAUSE_MS.
    speechRecognitionModule.abort();
  });

  return {
    listening,
    lastHeard,
    volume,
    permissionDenied,
    preparingOnDevice,
    needsTap,
    unavailable: Boolean(failure),
    errorCode: failure?.code || null,
    errorMessage: failure?.message || '',
  };
}
