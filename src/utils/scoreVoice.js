// These are voices already exposed by the browser or the device's TTS engine.
// Selecting one needs no cloud API key or paid speech service.
const NOVELTY_VOICE = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|trinoids|whisper|wobble|zarvox)\b/i;

export function selectScoreVoice(voices = []) {
  let selected = null;
  let bestRank = -Infinity;
  for (const voice of voices) {
    const language = String(voice.language || voice.lang || '').replace(/_/g, '-').toLowerCase();
    const identifier = voice.identifier || voice.voiceURI;
    if (!identifier || !/^en(?:-|$)/.test(language) || NOVELTY_VOICE.test(voice.name || '')) continue;

    const description = `${voice.name || ''} ${identifier}`;
    // Quality comes before accent: a natural US voice is preferable to a
    // basic Philippine-English voice. Availability varies by device/browser.
    let rank = /natural|neural|premium/i.test(description) ? 500
      : /google/i.test(description) ? 400
        : voice.quality === 'Enhanced' || /enhanced/i.test(description) ? 300 : 0;
    rank += language === 'en-ph' ? 30 : language === 'en-us' ? 20 : language === 'en-gb' ? 10 : 0;
    if (voice.isDefault || voice.default) rank += 5;
    if (rank > bestRank) {
      bestRank = rank;
      selected = voice;
    }
  }
  return selected;
}
