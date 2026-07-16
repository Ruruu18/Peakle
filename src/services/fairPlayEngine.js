const DEFAULT_RULES = {
  averageMatchMinutes: 15,
  maxConsecutiveGames: 2,
  restMinutes: 0,
  matchFormat: 'doubles',
  waitingWeight: 4,
  gameDeficitWeight: 120,
  consecutivePenalty: 45,
  priorityWeight: 30,
  preferencePenalty: 60,
  skillBalanceWeight: 24,
  repeatPartnerPenalty: 28,
  repeatOpponentPenalty: 10,
};

const asTime = (value, fallback = 0) => {
  if (typeof value === 'number') return value;
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pairKey = (a, b) => [a, b].sort().join('|');

export function getFairPlayRules(session = {}) {
  return {
    ...DEFAULT_RULES,
    ...(session.rotationRules || {}),
    averageMatchMinutes: Number(session.averageMatchMinutes || session.rotationRules?.averageMatchMinutes || DEFAULT_RULES.averageMatchMinutes),
    maxConsecutiveGames: Number(session.maxConsecutiveGames ?? session.rotationRules?.maxConsecutiveGames ?? DEFAULT_RULES.maxConsecutiveGames),
    restMinutes: Number(session.restMinutes ?? session.rotationRules?.restMinutes ?? DEFAULT_RULES.restMinutes),
    matchFormat: session.matchFormat || session.rotationRules?.matchFormat || DEFAULT_RULES.matchFormat,
  };
}

export function playersPerMatch(session = {}) {
  return getFairPlayRules(session).matchFormat === 'singles' ? 2 : 4;
}

function historyCounts(matches = []) {
  const partners = new Map();
  const opponents = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  matches.forEach((match) => {
    const teams = match.teams || [];
    teams.forEach((team) => {
      for (let left = 0; left < team.length; left += 1) {
        for (let right = left + 1; right < team.length; right += 1) bump(partners, pairKey(team[left], team[right]));
      }
    });
    if (teams.length === 2) teams[0].forEach((left) => teams[1].forEach((right) => bump(opponents, pairKey(left, right))));
  });
  return { partners, opponents };
}

function playerWaitStarted(player, now) {
  return asTime(player.waitingSince || player.checkedInAt || player.joinedAt, now);
}

function playerRestUntil(player, rules) {
  if (player.restUntil) return asTime(player.restUntil);
  const ended = asTime(player.lastMatchEndedAt);
  return ended ? ended + rules.restMinutes * 60000 : 0;
}

export function rankFairPlayQueue(session, now = Date.now()) {
  const rules = getFairPlayRules(session);
  const queued = new Set(session.queue || []);
  const candidates = (session.players || []).filter((player) => queued.has(player.id) && player.status === 'waiting' && player.available !== false && !player.departedAt);
  const mostGames = candidates.reduce((max, player) => Math.max(max, Number(player.gamesPlayed || 0)), 0);
  return candidates.map((player) => {
    const waitingMinutes = Math.max(0, (now - playerWaitStarted(player, now)) / 60000);
    const gamesPlayed = Number(player.gamesPlayed || 0);
    const gameDeficit = mostGames - gamesPlayed;
    const consecutiveGames = Number(player.consecutiveGames || 0);
    const priorityBoost = Number(player.priorityBoost || 0);
    const preferenceMatch = !player.playPreference || player.playPreference === 'either' || player.playPreference === rules.matchFormat;
    const restUntil = playerRestUntil(player, rules);
    const eligible = restUntil <= now && (rules.maxConsecutiveGames <= 0 || consecutiveGames < rules.maxConsecutiveGames || candidates.every((item) => Number(item.consecutiveGames || 0) >= rules.maxConsecutiveGames));
    const score = gameDeficit * rules.gameDeficitWeight
      + waitingMinutes * rules.waitingWeight
      - consecutiveGames * rules.consecutivePenalty
      - (preferenceMatch ? 0 : rules.preferencePenalty)
      + priorityBoost * rules.priorityWeight;
    const reasons = [];
    if (gameDeficit > 0) reasons.push(`${gameDeficit} fewer ${gameDeficit === 1 ? 'game' : 'games'} than the busiest player`);
    if (waitingMinutes >= 1) reasons.push(`waiting ${Math.floor(waitingMinutes)} min`);
    if (consecutiveGames > 0) reasons.push(`${consecutiveGames} consecutive ${consecutiveGames === 1 ? 'game' : 'games'}`);
    if (priorityBoost) reasons.push('organizer priority');
    if (!preferenceMatch) reasons.push(`prefers ${player.playPreference}`);
    if (!eligible && restUntil > now) reasons.push(`${Math.ceil((restUntil - now) / 60000)} min rest remaining`);
    else if (!eligible) reasons.push('consecutive-game limit reached');
    if (!reasons.length) reasons.push('available in the waiting pool');
    return { player, score, eligible, preferenceMatch, waitingMinutes, gamesPlayed, gameDeficit, consecutiveGames, restUntil, reasons };
  }).sort((left, right) => Number(right.eligible) - Number(left.eligible)
    || right.score - left.score
    || playerWaitStarted(left.player, now) - playerWaitStarted(right.player, now)
    || left.player.id.localeCompare(right.player.id));
}

function combinations(items, size, start = 0, chosen = [], output = []) {
  if (chosen.length === size) { output.push(chosen); return output; }
  for (let index = start; index <= items.length - (size - chosen.length); index += 1) combinations(items, size, index + 1, [...chosen, items[index]], output);
  return output;
}

function lineupOptions(ids) {
  if (ids.length === 2) return [[[ids[0]], [ids[1]]]];
  const [a, b, c, d] = ids;
  return [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ];
}

function lineupCost(teams, byId, history, rules) {
  const average = (team) => team.reduce((sum, id) => sum + Number(byId.get(id)?.skill || 0), 0) / team.length;
  const rated = teams.every((team) => team.every((id) => Number(byId.get(id)?.skill) > 0));
  const skillGap = rated ? Math.abs(average(teams[0]) - average(teams[1])) : 0;
  let repeatPartners = 0;
  let repeatOpponents = 0;
  teams.forEach((team) => {
    for (let left = 0; left < team.length; left += 1) for (let right = left + 1; right < team.length; right += 1) repeatPartners += history.partners.get(pairKey(team[left], team[right])) || 0;
  });
  teams[0].forEach((left) => teams[1].forEach((right) => { repeatOpponents += history.opponents.get(pairKey(left, right)) || 0; }));
  return {
    total: skillGap * rules.skillBalanceWeight + repeatPartners * rules.repeatPartnerPenalty + repeatOpponents * rules.repeatOpponentPenalty,
    skillGap,
    repeatPartners,
    repeatOpponents,
  };
}

export function buildFairPlayAssignment(session, now = Date.now()) {
  const rules = getFairPlayRules(session);
  const needed = playersPerMatch(session);
  const ranked = rankFairPlayQueue(session, now);
  const eligible = ranked.filter((item) => item.eligible);
  if (eligible.length < needed) {
    return { playerIds: [], teams: [], ranked, ready: false, reason: eligible.length ? `Need ${needed - eligible.length} more eligible ${needed - eligible.length === 1 ? 'player' : 'players'}.` : 'No eligible players are ready.' };
  }
  // Looking at the first twelve keeps the decision fast for large events while
  // still allowing fairness to beat strict FIFO.
  const pool = eligible.slice(0, Math.max(needed, 12));
  const groups = combinations(pool, needed);
  const history = historyCounts(session.completedMatches);
  const byId = new Map((session.players || []).map((player) => [player.id, player]));
  let best = null;
  groups.forEach((group) => {
    const groupScore = group.reduce((sum, item) => sum + item.score, 0);
    lineupOptions(group.map((item) => item.player.id)).forEach((teams) => {
      const cost = lineupCost(teams, byId, history, rules);
      const value = groupScore - cost.total;
      if (!best || value > best.value) best = { group, teams, cost, value };
    });
  });
  const playerIds = best.teams.flat();
  const selected = best.group.map((item) => item.player.name).join(', ');
  const factors = [];
  if (best.group.some((item) => item.gameDeficit > 0)) factors.push('balances game counts');
  if (best.group.some((item) => item.waitingMinutes >= 1)) factors.push('rewards waiting time');
  if (best.cost.skillGap > 0) factors.push(`keeps team-rating gap near ${best.cost.skillGap.toFixed(1)}`);
  if (best.cost.repeatPartners === 0) factors.push('avoids repeat partners');
  if (!factors.length) factors.push('uses the fairest eligible rotation');
  return {
    ready: true,
    playerIds,
    teams: best.teams,
    ranked,
    reason: `${selected} are next because this lineup ${factors.join(', ')}.`,
    factors,
    metrics: { skillGap: Number(best.cost.skillGap.toFixed(2)), repeatPartners: best.cost.repeatPartners, repeatOpponents: best.cost.repeatOpponents },
  };
}

export function estimateWaitMinutes(session, playerId, now = Date.now()) {
  const ranked = rankFairPlayQueue(session, now).filter((item) => item.eligible);
  const index = ranked.findIndex((item) => item.player.id === playerId);
  if (index < 0) return null;
  const rules = getFairPlayRules(session);
  const openCourts = Math.max(0, (session.courts || []).filter((court) => !court.match).length);
  const courtCount = Math.max(1, (session.courts || []).length);
  const group = Math.floor(index / playersPerMatch(session));
  if (group < openCourts) return 0;
  return Math.max(1, Math.ceil((group - openCourts + 1) / courtCount) * rules.averageMatchMinutes);
}

export function rebalanceFairPlayQueue(session, now = Date.now()) {
  const ranked = rankFairPlayQueue(session, now).map((item) => item.player.id);
  const rankedSet = new Set(ranked);
  return [...ranked, ...(session.queue || []).filter((id) => !rankedSet.has(id))];
}
