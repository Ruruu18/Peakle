import {
  getFairPlayRules,
  playersPerMatch,
  rankFairPlayQueue,
  buildFairPlayAssignment,
  estimateWaitMinutes,
  rebalanceFairPlayQueue,
} from '../fairPlayEngine';

const player = (overrides) => ({
  id: 'p1',
  name: 'Player',
  status: 'waiting',
  gamesPlayed: 0,
  consecutiveGames: 0,
  ...overrides,
});

describe('getFairPlayRules / playersPerMatch', () => {
  it('falls back to doubles defaults when no rules are configured', () => {
    const rules = getFairPlayRules({});
    expect(rules.matchFormat).toBe('doubles');
    expect(rules.maxConsecutiveGames).toBe(2);
    expect(playersPerMatch({})).toBe(4);
  });

  it('respects singles format and custom rotation rules', () => {
    const session = { matchFormat: 'singles', rotationRules: { waitingWeight: 10 } };
    expect(playersPerMatch(session)).toBe(2);
    expect(getFairPlayRules(session).waitingWeight).toBe(10);
  });
});

describe('rankFairPlayQueue', () => {
  const now = Date.parse('2026-08-10T10:00:00Z');

  it('ranks a player with a bigger game deficit above one with more games played', () => {
    const session = {
      queue: ['a', 'b'],
      players: [
        player({ id: 'a', gamesPlayed: 0, waitingSince: now }),
        player({ id: 'b', gamesPlayed: 3, waitingSince: now }),
      ],
    };
    const ranked = rankFairPlayQueue(session, now);
    expect(ranked.map((item) => item.player.id)).toEqual(['a', 'b']);
    expect(ranked[0].gameDeficit).toBe(3);
  });

  it('excludes players who are not waiting, unavailable, or departed', () => {
    const session = {
      queue: ['a', 'b', 'c', 'd'],
      players: [
        player({ id: 'a', status: 'playing' }),
        player({ id: 'b', available: false }),
        player({ id: 'c', departedAt: now }),
        player({ id: 'd' }),
      ],
    };
    const ranked = rankFairPlayQueue(session, now);
    expect(ranked.map((item) => item.player.id)).toEqual(['d']);
  });

  it('marks a player ineligible while their rest period has not elapsed', () => {
    const session = {
      queue: ['a'],
      players: [player({ id: 'a', restUntil: now + 5 * 60000 })],
    };
    const [ranked] = rankFairPlayQueue(session, now);
    expect(ranked.eligible).toBe(false);
    expect(ranked.reasons.join(' ')).toMatch(/rest remaining/);
  });

  it('resets eligibility once every waiting player has hit the consecutive-game cap', () => {
    const session = {
      rotationRules: { maxConsecutiveGames: 2 },
      queue: ['a', 'b'],
      players: [
        player({ id: 'a', consecutiveGames: 2 }),
        player({ id: 'b', consecutiveGames: 2 }),
      ],
    };
    const ranked = rankFairPlayQueue(session, now);
    expect(ranked.every((item) => item.eligible)).toBe(true);
  });

  it('keeps a lone maxed-out player ineligible when others are under the cap', () => {
    const session = {
      rotationRules: { maxConsecutiveGames: 2 },
      queue: ['a', 'b'],
      players: [
        player({ id: 'a', consecutiveGames: 2 }),
        player({ id: 'b', consecutiveGames: 0 }),
      ],
    };
    const ranked = rankFairPlayQueue(session, now);
    const a = ranked.find((item) => item.player.id === 'a');
    expect(a.eligible).toBe(false);
  });
});

describe('buildFairPlayAssignment', () => {
  const now = Date.parse('2026-08-10T10:00:00Z');

  it('reports how many more eligible players are needed when the pool is short', () => {
    const session = {
      matchFormat: 'doubles',
      queue: ['a', 'b'],
      players: [player({ id: 'a' }), player({ id: 'b' })],
    };
    const assignment = buildFairPlayAssignment(session, now);
    expect(assignment.ready).toBe(false);
    expect(assignment.reason).toMatch(/Need 2 more eligible players/);
  });

  it('builds a ready doubles lineup once four eligible players are available', () => {
    const session = {
      matchFormat: 'doubles',
      queue: ['a', 'b', 'c', 'd'],
      players: ['a', 'b', 'c', 'd'].map((id) => player({ id })),
    };
    const assignment = buildFairPlayAssignment(session, now);
    expect(assignment.ready).toBe(true);
    expect(assignment.playerIds).toHaveLength(4);
    expect(assignment.teams).toHaveLength(2);
    expect(new Set(assignment.playerIds).size).toBe(4);
  });

  it('avoids repeat partners when an alternative lineup is available', () => {
    const session = {
      matchFormat: 'doubles',
      queue: ['a', 'b', 'c', 'd'],
      players: ['a', 'b', 'c', 'd'].map((id) => player({ id })),
      completedMatches: [{ teams: [['a', 'b'], ['c', 'd']] }],
    };
    const assignment = buildFairPlayAssignment(session, now);
    const partnerOf = (id) => assignment.teams.find((team) => team.includes(id)).find((other) => other !== id);
    expect(partnerOf('a')).not.toBe('b');
  });
});

describe('estimateWaitMinutes', () => {
  const now = Date.parse('2026-08-10T10:00:00Z');

  it('returns 0 minutes when an open court is immediately available', () => {
    const session = {
      matchFormat: 'singles',
      queue: ['a'],
      players: [player({ id: 'a' })],
      courts: [{ id: 'c1', match: null }],
    };
    expect(estimateWaitMinutes(session, 'a', now)).toBe(0);
  });

  it('returns null for a player who is not in the eligible queue', () => {
    const session = { queue: [], players: [], courts: [] };
    expect(estimateWaitMinutes(session, 'missing', now)).toBeNull();
  });

  it('estimates a positive wait when every court is occupied', () => {
    const session = {
      matchFormat: 'doubles',
      queue: ['a', 'b', 'c', 'd', 'e'],
      players: ['a', 'b', 'c', 'd', 'e'].map((id) => player({ id })),
      courts: [{ id: 'c1', match: { id: 'm1' } }],
    };
    expect(estimateWaitMinutes(session, 'e', now)).toBeGreaterThan(0);
  });
});

describe('rebalanceFairPlayQueue', () => {
  it('appends queued ids that fall outside the ranked (waiting) pool, in their original order', () => {
    const session = {
      queue: ['a', 'playing-player', 'b'],
      players: [
        player({ id: 'a' }),
        player({ id: 'playing-player', status: 'playing' }),
        player({ id: 'b' }),
      ],
    };
    expect(rebalanceFairPlayQueue(session)).toEqual(['a', 'b', 'playing-player']);
  });
});
