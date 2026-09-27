import { selectScoreVoice } from '../scoreVoice';

it('prefers Google English over basic voices, regardless of catalog order', () => {
  const basic = { identifier: 'basic', name: 'Basic', language: 'en-PH' };
  const google = { voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US' };
  expect(selectScoreVoice([basic, google])).toBe(google);
  expect(selectScoreVoice([google, basic])).toBe(google);
});

it('prefers an explicitly natural voice and uses accent to break quality ties', () => {
  const naturalUS = { identifier: 'natural-us', name: 'Jenny Natural', language: 'en-US' };
  const naturalPH = { identifier: 'natural-ph', name: 'Rosa Natural', language: 'en_PH' };
  const google = { identifier: 'google-us', name: 'Google US English', language: 'en-US' };
  expect(selectScoreVoice([google, naturalUS])).toBe(naturalUS);
  expect(selectScoreVoice([naturalUS, naturalPH])).toBe(naturalPH);
});

it('selects enhanced native voices without relying on provider names', () => {
  const enhanced = { identifier: 'en-us-x-tpf-local', language: 'en-US', quality: 'Enhanced' };
  expect(selectScoreVoice([{ identifier: 'en-us', language: 'en-US', quality: 'Default' }, enhanced])).toBe(enhanced);
});

it('ignores non-English and novelty voices and allows a system fallback', () => {
  const unusable = [
    { identifier: 'google-es', name: 'Google español', language: 'es-ES' },
    { identifier: 'zarvox', name: 'Zarvox', language: 'en-US' },
    { name: 'Missing voice identifier', language: 'en-US' },
  ];
  expect(selectScoreVoice(unusable)).toBeNull();
  expect(selectScoreVoice([])).toBeNull();
});
