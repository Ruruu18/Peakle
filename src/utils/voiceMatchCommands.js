import { normalizeShout } from './shoutScoring';

const NUMBER_WORDS = {
  zero: 0,
  oh: 0,
  one: 1,
  won: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
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
  if (/\bteam\s*(?:1|one|won)\b/.test(normalized)) return 0;
  if (/\bteam\s*(?:2|two|to|too)\b/.test(normalized)) return 1;
  return null;
}

function namedPlayer(normalized, players) {
  const matches = [];
  (players || []).forEach((teamPlayers, team) => {
    (teamPlayers || []).forEach((name, playerIndex) => {
      const normalizedName = normalizeShout(name);
      const firstName = normalizedName.split(' ')[0];
      if (!firstName) return;
      const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`).test(normalized)) matches.push({ team, playerIndex, name });
    });
  });
  return matches.length === 1 ? matches[0] : null;
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
  // numbers from silently overwriting the match.
  if (tokens[0] !== 'score') return null;
  const numberTokens = tokens.slice(1).filter((token) => !['is', 'now'].includes(token));
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

function parseRallyCommand(normalized, players) {
  // A rally must include intent. Bare names/team numbers are deliberately rejected
  // because they occur constantly in normal doubles conversation.
  if (!/\b(?:point|rally|score|scores|scored|won|winner)\b/.test(normalized)) return null;

  const player = namedPlayer(normalized, players);
  if (player) return { type: 'rally', team: player.team, playerName: player.name };

  const team = explicitTeam(normalized);
  if (team === null) return null;
  return { type: 'rally', team, playerName: null };
}

export function parseVoiceMatchCommand(transcript, players, currentServer = 0) {
  const normalized = normalizeShout(transcript);
  if (!normalized) return null;
  return parseServeCommand(normalized, players)
    || parseScoreCall(normalized, currentServer)
    || parseRallyCommand(normalized, players);
}
