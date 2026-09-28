import { normalizeShout } from './shoutScoring';

const NUMBER_WORDS = {
  zero: 0,
  oh: 0,
  one: 1,
  won: 1,
  wan: 1,
  juan: 1,
  two: 2,
  to: 2,
  too: 2,
  tu: 2,
  three: 3,
  tree: 3,
  free: 3,
  four: 4,
  for: 4,
  fore: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

// Words speech recognizers commonly return in place of the command words, especially
// when the command is shouted across a court. Each is only read as the command word.
const WORD_ALIASES = {
  points: 'point',
  pointe: 'point',
  appoint: 'point',
  paint: 'point',
  pint: 'point',
  poynt: 'point',
  teams: 'team',
  teen: 'team',
  teem: 'team',
  tim: 'team',
  tea: 'team',
  tee: 'team',
  sore: 'score',
  store: 'score',
  scor: 'score',
  skor: 'score',
  scorer: 'score',
  surve: 'serve',
  serv: 'serve',
  serf: 'serve',
  surfing: 'serving',
  surving: 'serving',
  serbing: 'serving',
  servin: 'serving',
  sideout: 'side out',
  sighed: 'side',
  undue: 'undo',
  wins: 'win',
  winning: 'win',
  receivers: 'receiver',
  receiving: 'receiver',
  receive: 'receiver',
};

// Any of these words means the speaker is probably talking about the score. Speech
// with none of them is court chatter or noise and is ignored without feedback.
const SCORING_WORDS = /\b(?:point|rally|score|scores|scored|won|win|winner|takes|serve|serves|server|serving|service|sideout|fault|receiver|undo|team)\b/;
const RALLY_INTENT = /\b(?:point|rally|score|scores|scored|won|win|winner|takes)\b/;

const FILLER_WORDS = new Set(['the', 'ok', 'okay', 'so', 'uh', 'um', 'and', 'now', 'hey', 'alright']);
// Words that must never be mistaken for a player's name by fuzzy matching.
const COMMAND_WORDS = new Set([
  'point', 'team', 'score', 'scores', 'scored', 'serve', 'serves', 'server', 'serving', 'service',
  'rally', 'won', 'win', 'winner', 'takes', 'sideout', 'side', 'fault', 'receiver', 'undo', 'back', 'first', 'second', 'number', ...Object.keys(NUMBER_WORDS),
  ...FILLER_WORDS, 'you', 'but', 'its', 'was', 'his', 'her', 'him', 'she', 'not', 'yes', 'get',
  'got', 'nice', 'good', 'ball', 'out', 'that', 'this', 'what', 'here', 'there', 'man', 'all',
  'let', 'lets', 'net', 'shot', 'side', 'fault', 'is', 'at', 'dash',
]);

function canonicalize(normalized) {
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => WORD_ALIASES[token] || token)
    .join(' ')
    .replace(/\bside out\b/g, 'sideout');
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// Rough sound-alike key, so "Jon"/"John" or "Katie"/"Kaity" count as the same name.
function soundKey(word) {
  return word
    .replace(/ph/g, 'f')
    .replace(/ck|q/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/(?!^)[aeiouyhw]/g, '')
    .replace(/(.)\1+/g, '$1');
}

// 0 for an exact word, 1 for a close mishearing, null when the name was not said.
function nameMatchStrength(tokens, firstName) {
  if (tokens.includes(firstName)) return 0;
  if (firstName.length < 3) return null;
  const allowed = firstName.length >= 6 ? 2 : 1;
  const close = tokens.some((token) => token.length >= 3
    && !COMMAND_WORDS.has(token)
    && (editDistance(token, firstName) <= allowed
      || soundKey(token) === soundKey(firstName)));
  return close ? 1 : null;
}

function tokenNumber(token) {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token];
}

function serviceNumberFromPhrase(normalized) {
  if (/\b(?:server|service)\s*(?:number\s*)?(?:2|two|second)\b/.test(normalized) || /\bsecond\s+server\b/.test(normalized)) return 2;
  if (/\b(?:server|service)\s*(?:number\s*)?(?:1|one|first)\b/.test(normalized) || /\bfirst\s+server\b/.test(normalized)) return 1;
  return 1;
}

function explicitTeam(normalized) {
  const teams = new Set();
  const pattern = /\bteam\s*([a-z0-9]+)/g;
  let found = pattern.exec(normalized);
  while (found) {
    const number = tokenNumber(found[1]);
    if (number === 1 || number === 2) teams.add(number - 1);
    found = pattern.exec(normalized);
  }
  return teams.size === 1 ? [...teams][0] : null;
}

function namedPlayer(normalized, players) {
  const tokens = normalized.split(' ');
  const matches = [];
  (players || []).forEach((teamPlayers, team) => {
    (teamPlayers || []).forEach((name, playerIndex) => {
      const firstName = normalizeShout(name).split(' ')[0];
      if (!firstName) return;
      const strength = nameMatchStrength(tokens, firstName);
      if (strength !== null) matches.push({ team, playerIndex, name, strength });
    });
  });
  // An exactly heard name wins over sound-alikes of the other players.
  const exact = matches.filter((match) => match.strength === 0);
  const candidates = exact.length ? exact : matches;
  if (candidates.length !== 1) return null;
  const { strength, ...player } = candidates[0];
  return player;
}

function parseServeCommand(normalized, players) {
  if (!/\b(?:serve|serves|server|serving|service)\b/.test(normalized)) return null;

  const player = namedPlayer(normalized, players);
  if (player) {
    return {
      type: 'serve',
      server: player.team,
      servingPlayerIndex: player.playerIndex,
      serviceNumber: serviceNumberFromPhrase(normalized),
      playerName: player.name,
      playerExplicit: true,
    };
  }

  const team = explicitTeam(normalized);
  if (team === null) return null;
  return {
    type: 'serve',
    server: team,
    servingPlayerIndex: 0,
    serviceNumber: serviceNumberFromPhrase(normalized),
    playerName: players?.[team]?.[0] || `Team ${team + 1}`,
    playerExplicit: false,
  };
}

function parseScoreCall(normalized, currentServer) {
  const tokens = normalized.split(' ').filter(Boolean);
  // Requiring the word "score" prevents ordinary court chatter containing three
  // numbers from silently overwriting the match. Leading filler ("okay, score…") is allowed.
  const scoreIndex = tokens.findIndex((token) => !FILLER_WORDS.has(token));
  if (tokens[scoreIndex] !== 'score') return null;
  let numberTokens = tokens.slice(scoreIndex + 1)
    .filter((token) => !['is', 'now', 'its', 'at', 'dash'].includes(token));
  // Recognizers often write "two one two" as "212".
  if (numberTokens.length === 1 && /^\d{3}$/.test(numberTokens[0])) numberTokens = numberTokens[0].split('');
  if (numberTokens.length !== 3) return null;

  const numbers = numberTokens.map(tokenNumber);
  if (numbers.some((value) => !Number.isInteger(value))) return null;
  const [servingScore, receivingScore, serviceNumber] = numbers;
  if (![1, 2].includes(serviceNumber) || servingScore > 99 || receivingScore > 99) return null;

  const scores = currentServer === 0
    ? [servingScore, receivingScore]
    : [receivingScore, servingScore];
  return { type: 'score', scores, serviceNumber };
}

// "Side out", "fault team one" and "point serving team" name the rally winner by role
// rather than by team number.
function parseRoleCommand(normalized, players, currentServer) {
  const receiver = 1 - currentServer;
  // "That's not a fault" / "no side out" is a disagreement, not a call.
  if (/\b(?:not|no|never)\b/.test(normalized)) return null;
  if (/\bsideout\b/.test(normalized)) return { type: 'rally', team: receiver, playerName: null };
  if (/\bfault\b/.test(normalized)) {
    const player = namedPlayer(normalized, players);
    const faulted = player ? player.team : explicitTeam(normalized);
    // A short call with no side named ("fault", "foot fault") is the server's.
    if (faulted === null && normalized.split(' ').length > 3) return null;
    return { type: 'rally', team: faulted === null ? receiver : 1 - faulted, playerName: null };
  }
  if (!RALLY_INTENT.test(normalized)) return null;
  if (/\breceiver\b/.test(normalized)) return { type: 'rally', team: receiver, playerName: null };
  if (/\b(?:server|serving)\s+(?:team|side)\b|\b(?:point|win)\s+(?:server|serving)$/.test(normalized)) {
    return { type: 'rally', team: currentServer, playerName: null };
  }
  return null;
}

function parseUndoCommand(normalized) {
  if (/\bundo\b|\btake\s+(?:it|that)\s+back\b|\bscratch\s+that\b|\bcancel\s+(?:that|last)\b/.test(normalized)) {
    return { type: 'undo' };
  }
  return null;
}

function parseRallyCommand(normalized, players) {
  // A rally must include intent. Bare names/team numbers are deliberately rejected
  // because they occur constantly in normal doubles conversation.
  if (!RALLY_INTENT.test(normalized)) return null;

  const player = namedPlayer(normalized, players);
  if (player) return { type: 'rally', team: player.team, playerName: player.name };

  const team = explicitTeam(normalized);
  if (team === null) return null;
  return { type: 'rally', team, playerName: null };
}

export function parseVoiceMatchCommand(transcript, players, currentServer = 0) {
  const normalized = canonicalize(normalizeShout(transcript));
  if (!normalized) return null;
  return parseUndoCommand(normalized)
    || parseScoreCall(normalized, currentServer)
    || parseRoleCommand(normalized, players, currentServer)
    || parseServeCommand(normalized, players)
    || parseRallyCommand(normalized, players);
}

// True when the speech contains any scoring word, even if it was not a full command.
export function mentionsScoring(transcript) {
  return SCORING_WORDS.test(canonicalize(normalizeShout(transcript)));
}
