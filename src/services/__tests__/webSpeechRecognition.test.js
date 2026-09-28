jest.mock('../webWhisperRecognition', () => ({
  ...jest.requireActual('../webWhisperRecognition'),
  isWhisperSupported: jest.fn(() => true),
  startWhisperSession: jest.fn(),
  stopWhisperSession: jest.fn(),
  abortWhisperSession: jest.fn(),
}));

function loadAdapter({ recognizer = true, brave = false, stored = null } = {}) {
  jest.resetModules();
  const store = new Map(stored ? [['peakle.speech.useLocalRecognizer', stored]] : []);
  global.window = {
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
  };
  if (recognizer) {
    global.window.webkitSpeechRecognition = jest.fn(function Recognition() {
      this.addEventListener = jest.fn();
      this.start = jest.fn();
      this.stop = jest.fn();
      this.abort = jest.fn();
    });
  }
  global.navigator = brave ? { brave: {} } : {};
  const whisper = require('../webWhisperRecognition');
  const adapter = require('../webSpeechRecognition').default;
  return { adapter, whisper, store };
}

afterEach(() => {
  delete global.window;
  delete global.navigator;
});

describe('webSpeechRecognition', () => {
  it('uses the browser recognizer when one exists', () => {
    const { adapter, whisper } = loadAdapter();
    adapter.start({ lang: 'en-US' });
    expect(window.webkitSpeechRecognition).toHaveBeenCalled();
    expect(whisper.startWhisperSession).not.toHaveBeenCalled();
  });

  it('goes straight to local recognition in Brave and browsers without the API', () => {
    let { adapter, whisper } = loadAdapter({ brave: true });
    adapter.start();
    expect(whisper.startWhisperSession).toHaveBeenCalled();

    ({ adapter, whisper } = loadAdapter({ recognizer: false }));
    expect(adapter.isRecognitionAvailable()).toBe(true);
    adapter.start();
    expect(whisper.startWhisperSession).toHaveBeenCalled();
  });

  it('remembers the switch to local recognition', () => {
    const { adapter, whisper, store } = loadAdapter();
    expect(adapter.isUsingLocalRecognition()).toBe(false);
    expect(adapter.useLocalRecognition()).toBe(true);
    expect(store.get('peakle.speech.useLocalRecognizer')).toBe('1');
    adapter.start();
    expect(whisper.startWhisperSession).toHaveBeenCalled();

    const reloaded = loadAdapter({ stored: '1' });
    expect(reloaded.adapter.isUsingLocalRecognition()).toBe(true);
  });

  it('routes stop and abort to the local session', () => {
    const { adapter, whisper } = loadAdapter({ recognizer: false });
    adapter.start();
    adapter.stop();
    adapter.abort();
    expect(whisper.stopWhisperSession).toHaveBeenCalled();
    expect(whisper.abortWhisperSession).toHaveBeenCalled();
  });
});

describe('cleanTranscript', () => {
  const { cleanTranscript } = jest.requireActual('../webWhisperRecognition');

  it('keeps real commands', () => {
    expect(cleanTranscript(' Point Team 1')).toBe('Point Team 1');
    expect(cleanTranscript(' Alex serving.')).toBe('Alex serving.');
  });

  it('drops noise markers and common hallucinations', () => {
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('');
    expect(cleanTranscript(' (wind blowing)')).toBe('');
    expect(cleanTranscript(' Thank you.')).toBe('');
    expect(cleanTranscript(' [Music] Point team two')).toBe('Point team two');
  });
});
