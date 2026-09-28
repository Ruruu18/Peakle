// Free, private speech-to-text for browsers whose Web Speech API has no working
// recognizer behind it (Brave, Firefox, Safari with Dictation off, Chrome behind a
// firewall). Runs OpenAI's Whisper in the page with transformers.js: audio never leaves
// the device and there is no API key or per-minute cost. The library is imported from a
// CDN at runtime so Metro never tries to bundle it; the model (~40 MB) downloads once
// from the Hugging Face Hub and the browser caches it.
//
// Each start() is one utterance session, matching how the browser recognizer behaves:
// `start` → `speechstart` → `result` (final) → `end`. Voice activity detection decides
// when a command begins and ends.

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const MODEL_ID = 'onnx-community/whisper-tiny.en';
const SAMPLE_RATE = 16000;
const FRAME_SIZE = 2048;
// Speech is anything this many times louder than the running noise floor.
const SPEECH_FACTOR = 2.5;
const MIN_SPEECH_RMS = 0.01;
// Long enough that the natural pause in "score two… one… two" does not end the command.
const END_SILENCE_MS = 900;
const MIN_UTTERANCE_MS = 250;
// Sound must stay above the speech level this long to count as a voice. Paddle pops,
// claps and ball bounces are shorter, so they never open an utterance.
const ONSET_MS = 120;
// An utterance needs this much voiced sound in total, or it was noise.
const MIN_VOICED_MS = 200;
// Voice band: cuts wind, traffic rumble and hum below, and hiss above (which also keeps
// the downsample to 16 kHz clean).
const HIGH_PASS_HZ = 120;
const LOW_PASS_HZ = 7000;
const MAX_UTTERANCE_MS = 6000;
const PRE_ROLL_MS = 300;
// Keep the microphone open briefly between sessions so rapid restarts don't re-open it.
const RELEASE_AFTER_IDLE_MS = 5000;
// What Whisper tends to "hear" in room noise.
const HALLUCINATIONS = /^(you|thank you|thank you so much|thanks for watching|please subscribe|bye|okay|so|oh|uh|um|hmm|music|applause|silence)$/i;

// A dynamic import the bundler cannot see, so the CDN module is loaded by the browser.
const importFromUrl = new Function('url', 'return import(url)');

let modelPromise = null;
let capture = null;
let session = null;
let releaseTimer = null;

async function loadModel() {
  const { pipeline } = await importFromUrl(TRANSFORMERS_URL);
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        return await pipeline('automatic-speech-recognition', MODEL_ID, {
          device: 'webgpu',
          dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        });
      }
    } catch {
      // Fall through to the CPU build, which works in every browser.
    }
  }
  return pipeline('automatic-speech-recognition', MODEL_ID, { dtype: 'q8' });
}

function getModel() {
  if (!modelPromise) {
    modelPromise = loadModel().catch((error) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

function resampleTo16k(input, inputRate) {
  if (inputRate === SAMPLE_RATE) return new Float32Array(input);
  const ratio = inputRate / SAMPLE_RATE;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    output[i] = input[index] + (input[next] - input[index]) * (position - index);
  }
  return output;
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function concat(chunks) {
  const total = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { out.set(chunk, offset); offset += chunk.length; });
  return out;
}

export function cleanTranscript(text) {
  const cleaned = String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bare = cleaned.replace(/[.,!?]/g, '').trim();
  if (!bare || HALLUCINATIONS.test(bare)) return '';
  return cleaned;
}

// Batches the 128-sample render quanta into FRAME_SIZE frames before posting them to the
// main thread. Served from a Blob URL so there is no separate worklet file to host.
const CAPTURE_WORKLET = `
class PeakleCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(${FRAME_SIZE}); this.length = 0; }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let offset = 0;
    while (offset < input.length) {
      const count = Math.min(input.length - offset, this.buffer.length - this.length);
      this.buffer.set(input.subarray(offset, offset + count), this.length);
      this.length += count;
      offset += count;
      if (this.length === this.buffer.length) {
        this.port.postMessage(this.buffer);
        this.buffer = new Float32Array(this.buffer.length);
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor('peakle-capture', PeakleCapture);
`;

async function createCaptureNode(context, onFrame) {
  if (context.audioWorklet && typeof AudioWorkletNode === 'function') {
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(context, 'peakle-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = (event) => onFrame(event.data);
    return { node, detach: () => { node.port.onmessage = null; } };
  }
  // Older browsers without AudioWorklet.
  const node = context.createScriptProcessor(FRAME_SIZE, 1, 1);
  node.onaudioprocess = (event) => onFrame(event.inputBuffer.getChannelData(0));
  return { node, detach: () => { node.onaudioprocess = null; } };
}

let capturePromise = null;

async function openCapture() {
  if (capture) return capture;
  if (capturePromise) return capturePromise;
  capturePromise = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    let opened = null;
    try {
      const source = context.createMediaStreamSource(stream);
      const highPass = context.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = HIGH_PASS_HZ;
      const lowPass = context.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = LOW_PASS_HZ;
      const { node: processor, detach } = await createCaptureNode(context, (frame) => {
        opened?.onFrame?.(frame, context.sampleRate);
      });
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(highPass);
      highPass.connect(lowPass);
      lowPass.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      opened = { stream, context, nodes: [source, highPass, lowPass, processor, mute], detach, onFrame: null };
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      context.close().catch(() => {});
      throw error;
    }
    capture = opened;
    return opened;
  })();
  try {
    return await capturePromise;
  } finally {
    capturePromise = null;
  }
}

function releaseCapture() {
  if (!capture) return;
  const { stream, context, nodes, detach } = capture;
  capture = null;
  detach();
  try { nodes.forEach((node) => node.disconnect()); } catch { /* already gone */ }
  stream.getTracks().forEach((track) => track.stop());
  context.close().catch(() => {});
}

function scheduleRelease() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (!session) releaseCapture();
  }, RELEASE_AFTER_IDLE_MS);
}

// Browsers keep audio suspended until the page has had a tap or key press. Resolves once
// audio is running, resuming on the next gesture anywhere on the page if needed.
async function ensureAudioRunning(context, onNeedsGesture) {
  if (context.state === 'running') return;
  const resumed = await Promise.race([
    context.resume().then(() => context.state === 'running', () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 300)),
  ]);
  if (resumed) return;
  onNeedsGesture();
  await new Promise((resolve) => {
    const events = ['pointerdown', 'keydown', 'touchend'];
    const onGesture = () => { context.resume().catch(() => {}); };
    const onStateChange = () => {
      if (context.state !== 'running') return;
      events.forEach((name) => window.removeEventListener(name, onGesture, true));
      context.removeEventListener('statechange', onStateChange);
      resolve();
    };
    events.forEach((name) => window.addEventListener(name, onGesture, true));
    context.addEventListener('statechange', onStateChange);
  });
}

function micErrorCode(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'not-allowed';
  return 'audio-capture';
}

export function isWhisperSupported() {
  return typeof window !== 'undefined'
    && typeof WebAssembly === 'object'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && Boolean(window.AudioContext || window.webkitAudioContext);
}

// `emit(eventName, payload)` delivers events in the expo-speech-recognition shape.
export function startWhisperSession(emit) {
  abortWhisperSession({ silent: true });
  clearTimeout(releaseTimer);
  const current = {
    stopped: false,
    aborted: false,
    speaking: false,
    chunks: [],
    preRoll: [],
    preRollSamples: 0,
    noiseFloor: MIN_SPEECH_RMS / SPEECH_FACTOR,
    loudMs: 0,
    speechMs: 0,
    voicedMs: 0,
    silenceMs: 0,
    finish: null,
    emit,
  };
  session = current;
  const isCurrent = () => session === current && !current.aborted;

  const end = () => {
    if (session === current) session = null;
    if (capture) capture.onFrame = null;
    scheduleRelease();
    if (!current.aborted) emit('end', null);
  };

  const transcribe = async (audio) => {
    try {
      const model = await getModel();
      const output = await model(audio);
      const transcript = cleanTranscript(output?.text);
      if (transcript && isCurrent()) {
        emit('result', { isFinal: true, results: [{ transcript, confidence: -1, segments: [] }] });
      }
    } catch (error) {
      if (isCurrent()) emit('error', { error: 'client', message: error?.message || 'Transcription failed' });
    }
    end();
  };

  current.finish = () => {
    if (current.stopped) return;
    current.stopped = true;
    if (capture) capture.onFrame = null;
    const audio = concat(current.chunks);
    if (current.speaking
      && current.voicedMs >= MIN_VOICED_MS
      && audio.length >= (MIN_UTTERANCE_MS / 1000) * SAMPLE_RATE) {
      transcribe(audio);
    } else {
      end();
    }
  };

  (async () => {
    let model = null;
    const modelLoad = getModel().then((loaded) => { model = loaded; });
    // Only show "downloading" when the model is not already in memory.
    const settled = await Promise.race([modelLoad.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 150))]);
    if (!settled && isCurrent()) emit('preparing', null);
    try {
      await modelLoad;
    } catch (error) {
      if (isCurrent()) {
        emit('error', { error: 'model-unavailable', message: error?.message || '' });
        end();
      }
      return;
    }
    if (!isCurrent() || !model) return;
    try {
      const { context } = await openCapture();
      await ensureAudioRunning(context, () => { if (isCurrent()) emit('needsgesture', null); });
    } catch (error) {
      if (isCurrent()) {
        emit('error', { error: micErrorCode(error), message: error?.message || '' });
        end();
      }
      return;
    }
    if (!isCurrent() || current.stopped || !capture) return;

    capture.onFrame = (frame, inputRate) => {
      if (!isCurrent() || current.stopped) return;
      const samples = resampleTo16k(frame, inputRate);
      const frameMs = (samples.length / SAMPLE_RATE) * 1000;
      const level = rms(samples);
      const threshold = Math.max(MIN_SPEECH_RMS, current.noiseFloor * SPEECH_FACTOR);

      if (!current.speaking) {
        // Track the room's noise floor slowly, and keep a short pre-roll so the first
        // syllable ("point…") is not clipped when speech is detected.
        current.noiseFloor = current.noiseFloor * 0.95 + level * 0.05;
        current.preRoll.push(samples);
        current.preRollSamples += samples.length;
        while (current.preRollSamples > (PRE_ROLL_MS / 1000) * SAMPLE_RATE && current.preRoll.length > 1) {
          current.preRollSamples -= current.preRoll.shift().length;
        }
        current.loudMs = level > threshold ? current.loudMs + frameMs : 0;
        if (current.loudMs >= ONSET_MS) {
          current.speaking = true;
          current.voicedMs = current.loudMs;
          current.chunks = [...current.preRoll];
          current.preRoll = [];
          emit('speechstart', null);
        }
        return;
      }

      current.chunks.push(samples);
      current.speechMs += frameMs;
      if (level > threshold) current.voicedMs += frameMs;
      current.silenceMs = level > threshold ? 0 : current.silenceMs + frameMs;
      if (current.silenceMs >= END_SILENCE_MS || current.speechMs >= MAX_UTTERANCE_MS) current.finish();
    };
    emit('start', null);
  })();
}

// Ends the session, transcribing any command already in progress.
export function stopWhisperSession() {
  session?.finish?.();
}

// Ends the session and discards anything heard. Like the browser recognizer, an abort
// still reports `end`, unless a new session is replacing this one.
export function abortWhisperSession({ silent = false } = {}) {
  const current = session;
  if (!current) return;
  current.aborted = true;
  session = null;
  if (capture) capture.onFrame = null;
  scheduleRelease();
  if (!silent) current.emit('end', null);
}
