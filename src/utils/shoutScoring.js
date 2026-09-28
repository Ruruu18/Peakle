const TEAM_ONE_PHRASES = ['team one', 'team 1', 'teamone'];
const TEAM_TWO_PHRASES = ['team two', 'team 2', 'teamtwo'];
// Command words the recognizer should favor over similar-sounding chatter.
const SCORING_PHRASES = [
  'point', 'point team one', 'point team two', 'side out', 'fault', 'score', 'serving',
  'server one', 'server two', 'serving team', 'receiving team', 'undo',
];

export function normalizeShout(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesWholeWord(haystack, needle) {
  if (!needle) return false;
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);
}

function teamMatchesPhrase(normalized, phrases) {
  return phrases.some((phrase) => normalized === phrase || includesWholeWord(normalized, phrase));
}

function playerNamesMatch(normalized, teamPlayers) {
  return (teamPlayers || []).some((name) => {
    const firstName = normalizeShout(String(name || '').trim().split(/\s+/)[0] || '');
    return firstName.length > 1 && includesWholeWord(normalized, firstName);
  });
}

function resolveSingleShout(transcript, players) {
  const normalized = normalizeShout(transcript);
  if (!normalized) return null;

  const explicitOne = teamMatchesPhrase(normalized, TEAM_ONE_PHRASES);
  const explicitTwo = teamMatchesPhrase(normalized, TEAM_TWO_PHRASES);
  if (explicitOne && !explicitTwo) return 0;
  if (explicitTwo && !explicitOne) return 1;
  if (explicitOne && explicitTwo) return null;

  const fullNameOne = normalizeShout(players[0].join(' and '));
  const fullNameTwo = normalizeShout(players[1].join(' and '));
  const nameMatchOne = fullNameOne.length > 1 && includesWholeWord(normalized, fullNameOne);
  const nameMatchTwo = fullNameTwo.length > 1 && includesWholeWord(normalized, fullNameTwo);
  if (nameMatchOne && !nameMatchTwo) return 0;
  if (nameMatchTwo && !nameMatchOne) return 1;
  if (nameMatchOne && nameMatchTwo) return null;

  const playerMatchOne = playerNamesMatch(normalized, players[0]);
  const playerMatchTwo = playerNamesMatch(normalized, players[1]);
  if (playerMatchOne && !playerMatchTwo) return 0;
  if (playerMatchTwo && !playerMatchOne) return 1;

  return null;
}

/**
 * Resolves one or more transcript candidates (the recognizer's ranked alternatives)
 * to a team. Alternatives are tried in order so a noisy top guess doesn't block a
 * clean lower-ranked match from the same utterance.
 */
export function resolveShoutToTeam(transcriptOrList, players) {
  if (!Array.isArray(players) || players.length < 2) return null;

  const transcripts = Array.isArray(transcriptOrList) ? transcriptOrList : [transcriptOrList];
  for (const transcript of transcripts) {
    const team = resolveSingleShout(transcript, players);
    if (team !== null) return team;
  }
  return null;
}

/**
 * Builds the vocabulary the recognizer should be biased toward (team phrases,
 * full player names, and first names). Passed as `contextualStrings` so the
 * recognizer favors these exact words over unrelated crowd/background noise.
 */
export function buildContextualStrings(players) {
  const strings = new Set([...TEAM_ONE_PHRASES, ...TEAM_TWO_PHRASES, ...SCORING_PHRASES]);
  (players || []).forEach((team) => {
    (team || []).forEach((name) => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return;
      strings.add(trimmed);
      const firstName = trimmed.split(/\s+/)[0];
      if (firstName) strings.add(firstName);
    });
  });
  return Array.from(strings);
}
