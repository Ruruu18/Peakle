import { requireSupabase } from '../../lib/supabase';
import {
  createScheduledActivity, createScheduledGame, getScheduledGameShareUrl, inviteToScheduledGame, isOnMyCalendar, isPlayerScheduledEntry,
  listScheduledGames, nextOnMyCalendar, openScheduledGameLink, playSetupFromGame, scheduledGameShareMessage, scheduleEntryFromActivity,
  setScheduledGameVisibility, shareCodeFromText,
} from '../schedule';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('../../config/demoMode', () => ({ DEMO_MODE: false }));
jest.mock('../playerActivities', () => ({ listDiscoverablePlayerActivities: jest.fn() }));
jest.mock('../../utils/geocode', () => ({ geocode: jest.fn().mockResolvedValue([]) }));

const details = {
  title: 'Community session', startsAt: '2026-10-01T09:00:00+08:00', durationMinutes: 90,
  court: { name: 'Community Courts', area: 'Pasig' }, notes: 'Bring balls',
  invitees: [{ id: 'friend' }], visibility: 'invite',
};
const rpc = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  rpc.mockResolvedValue({ data: { id: 'new-activity' }, error: null });
  requireSupabase.mockReturnValue({ rpc });
});

it.each(['game', 'open_play', 'competition', 'program'])('saves %s with its type and shared activity details', async (kind) => {
  await expect(createScheduledActivity({ ...details, kind, capacity: 8 })).resolves.toEqual({ id: 'new-activity' });
  expect(rpc).toHaveBeenCalledWith('create_scheduled_activity', expect.objectContaining({
    p_activity_kind: kind, p_title: details.title, p_starts_at: '2026-10-01T01:00:00.000Z',
    p_ends_at: '2026-10-01T02:30:00.000Z', p_capacity: kind === 'game' ? 4 : 8,
    p_court_label: 'Community Courts', p_court_area: 'Pasig', p_notes: 'Bring balls', p_invitee_ids: ['friend'],
  }));
});

it('retains singles capacity and ranked mode for game creation', async () => {
  await createScheduledGame({ ...details, matchType: 'singles', mode: 'ranked', capacity: 16 });
  expect(rpc).toHaveBeenCalledWith('create_scheduled_activity', expect.objectContaining({ p_activity_kind: 'game', p_capacity: 2, p_mode: 'ranked' }));
});

it('does not send a stale ranked selection when the type changes to a program', async () => {
  await createScheduledActivity({ ...details, kind: 'program', mode: 'ranked' });
  expect(rpc).toHaveBeenCalledWith('create_scheduled_activity', expect.objectContaining({ p_activity_kind: 'program', p_mode: 'casual' }));
});

it('rejects unsupported types and invalid limits before writing', async () => {
  await expect(createScheduledActivity({ ...details, kind: 'note' })).rejects.toThrow('activity type');
  await expect(createScheduledActivity({ ...details, kind: 'program', capacity: 17 })).rejects.toThrow('player limit');
  expect(rpc).not.toHaveBeenCalled();
});

it('propagates saving failures so the form can stay open for retry', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: new Error('Network unavailable') });
  await expect(createScheduledActivity({ ...details, kind: 'competition' })).rejects.toThrow('Network unavailable');
});

it('loads every player category into My schedule and preserves its origin', async () => {
  const rows = ['game', 'open_play', 'competition', 'program'].map((kind, index) => ({
    id: kind, activity_kind: kind, host_id: 'host', title: kind, status: 'scheduled', capacity: 8,
    starts_at: `2026-10-0${index + 1}T01:00:00.000Z`, ends_at: `2026-10-0${index + 1}T02:30:00.000Z`,
    scheduled_game_players: [{ user_id: 'host', status: 'going', profile: { display_name: 'Host' } }],
  }));
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lt: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: [], error: null }) };
  const personal = { select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), range: jest.fn().mockResolvedValue({ data: rows, error: null }) };
  requireSupabase.mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'host' } } } }) }, from: jest.fn(() => query), rpc: jest.fn(() => personal) });
  const entries = await listScheduledGames({ from: '2026-10-01', to: '2026-11-01' });
  expect(entries.map((entry) => entry.kind)).toEqual(['game', 'open_play', 'competition', 'program']);
  expect(entries.every(isPlayerScheduledEntry)).toBe(true);
  expect(entries.every(isOnMyCalendar)).toBe(true);
  expect(entries[2]).toMatchObject({ id: 'game:competition', typeLabel: 'Tournament', isHost: true });
  expect(nextOnMyCalendar(entries.slice(1), Date.parse('2026-10-01'))?.kind).toBe('open_play');
});

it('pages the personal calendar independently of a full discovery feed and merges shared entries once', async () => {
  const row = (id, hostId = 'other') => ({ id, host_id: hostId, activity_kind: 'game', status: 'scheduled', capacity: 4, starts_at: '2026-10-01T01:00:00Z', ends_at: '2026-10-01T03:00:00Z' });
  const publicRows = Array.from({ length: 200 }, (_, i) => row(`public-${i}`));
  const firstPage = Array.from({ length: 100 }, (_, i) => row(`mine-${i}`, 'host'));
  const lastPage = [row('last-personal-game', 'host'), publicRows[0]];
  const personal = { select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), range: jest.fn()
    .mockResolvedValueOnce({ data: firstPage, error: null }).mockResolvedValueOnce({ data: lastPage, error: null }) };
  const discovery = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lt: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: publicRows, error: null }) };
  const myRpc = jest.fn(() => personal);
  requireSupabase.mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'host' } } } }) }, rpc: myRpc, from: jest.fn(() => discovery) });
  const entries = await listScheduledGames({ from: '2026-10-01', to: '2026-11-01' });
  expect(entries).toHaveLength(301);
  expect(entries.some((entry) => entry.sourceId === 'last-personal-game')).toBe(true);
  expect(personal.range.mock.calls).toEqual([[0, 99], [100, 199]]);
  expect(myRpc).toHaveBeenCalledWith('list_my_scheduled_games', { p_from: '2026-10-01', p_to: '2026-11-01' });
  expect(discovery.eq.mock.calls).toEqual([['visibility', 'open'], ['status', 'scheduled']]);
});

it('rejects invalid dates and durations without sending a request', async () => {
  await expect(createScheduledActivity({ ...details, startsAt: 'invalid' })).rejects.toThrow('valid start time');
  await expect(createScheduledActivity({ ...details, durationMinutes: 0 })).rejects.toThrow('duration');
  await expect(createScheduledActivity({ ...details, durationMinutes: 721 })).rejects.toThrow('12 hours');
  expect(rpc).not.toHaveBeenCalled();
});

it('keeps personal activities visible during a database rollout using filtered table queries', async () => {
  const row = (id, hostId) => ({ id, host_id: hostId, status: 'scheduled', capacity: 4, starts_at: '2026-10-01T01:00:00Z', ends_at: '2026-10-01T03:00:00Z' });
  const queries = [];
  const from = jest.fn((table) => {
    const filters = {};
    const query = {
      select: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lt: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
      eq: jest.fn((key, value) => { filters[key] = value; return query; }), neq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      range: jest.fn(() => Promise.resolve({ data: [filters.host_id ? row('hosted', 'host') : row('invited', 'friend')], error: null })),
    };
    if (table === 'scheduled_games') queries.push(query);
    return query;
  });
  const unavailable = { select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), range: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } }) };
  requireSupabase.mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'host' } } } }) }, rpc: jest.fn(() => unavailable), from });
  const entries = await listScheduledGames({ from: '2026-10-01', to: '2026-11-01' });
  expect(entries.map((entry) => entry.sourceId).sort()).toEqual(['hosted', 'invited']);
  expect(queries[1].eq).toHaveBeenCalledWith('host_id', 'host');
  expect(queries[2].eq).toHaveBeenCalledWith('my_registration.user_id', 'host');
  expect(queries[2].select).toHaveBeenCalledWith(expect.stringContaining('my_registration:scheduled_game_players!inner(user_id)'));
});

it('keeps organizer registrations separate and honors declined player invitations', () => {
  const organizer = scheduleEntryFromActivity({ id: 'organizer:1', type: 'competition', registration: { status: 'registered' } });
  expect(isPlayerScheduledEntry(organizer)).toBe(false);
  expect(isOnMyCalendar(organizer)).toBe(true);
  expect(isOnMyCalendar({ kind: 'program', isPlayerScheduled: true, myStatus: 'invited' })).toBe(true);
  expect(isOnMyCalendar({ kind: 'program', isPlayerScheduled: true, myStatus: 'declined' })).toBe(false);
  expect(isOnMyCalendar({ kind: 'game', myStatus: 'going' })).toBe(true);
  expect(() => playSetupFromGame({ kind: 'competition', isPlayerScheduled: true })).toThrow('Only games');
});

describe('sharing scheduled activities', () => {
  it('builds a share link from the host-issued code', async () => {
    rpc.mockResolvedValueOnce({ data: 'abc123def4', error: null });
    await expect(getScheduledGameShareUrl('game-1')).resolves.toBe('peakle://games/abc123def4');
    expect(rpc).toHaveBeenCalledWith('get_scheduled_game_share_code', { p_game_id: 'game-1' });
  });

  it('reads a share code back out of a chat message', () => {
    const message = scheduledGameShareMessage({ title: 'Open play', startsAt: '2026-10-01T09:00:00+08:00', place: 'Community Courts', area: 'Pasig' }, 'https://play.example.com/games/abc123def4');
    expect(message).toContain('Join me for Open play on Peakle');
    expect(message).toContain('Community Courts, Pasig');
    expect(shareCodeFromText(message)).toBe('abc123def4');
    expect(shareCodeFromText('peakle://games/ABC123DEF4')).toBe('abc123def4');
    expect(shareCodeFromText('see /games/short')).toBeNull();
  });

  it('opens a link, invites players and changes visibility through RPCs', async () => {
    rpc.mockResolvedValueOnce({ data: { gameId: 'game-1', startsAt: '2026-10-01T01:00:00Z' }, error: null });
    await expect(openScheduledGameLink('abc123def4')).resolves.toEqual({ gameId: 'game-1', startsAt: '2026-10-01T01:00:00Z' });
    expect(rpc).toHaveBeenLastCalledWith('open_scheduled_game_link', { p_code: 'abc123def4' });

    rpc.mockResolvedValueOnce({ data: 2, error: null });
    await expect(inviteToScheduledGame('game-1', [{ id: 'a' }, { id: 'b' }, {}])).resolves.toBe(2);
    expect(rpc).toHaveBeenLastCalledWith('invite_scheduled_game_players', { p_game_id: 'game-1', p_player_ids: ['a', 'b'] });

    rpc.mockResolvedValueOnce({ data: null, error: null });
    await setScheduledGameVisibility('game-1', 'open');
    expect(rpc).toHaveBeenLastCalledWith('set_scheduled_game_visibility', { p_game_id: 'game-1', p_visibility: 'open' });
  });

  it('explains when the sharing migration is not deployed yet', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } });
    await expect(getScheduledGameShareUrl('game-1')).rejects.toThrow('not available yet');
  });
});

describe('player beta growth', () => {
  const schedule = require('../schedule');
  const game = {
    sourceId: 'g1', kind: 'game', title: 'Sunday doubles', startsAt: '2026-10-04T10:00:00.000Z', endsAt: '2026-10-04T11:30:00.000Z',
    matchType: 'doubles', mode: 'casual', visibility: 'invite', capacity: 4, court: { name: 'Community Courts', area: 'Pasig' },
    notes: 'Bring balls', skillLevel: 'beginner', courtCost: '₱150', hostId: 'host',
    going: [{ id: 'host', name: 'Host' }, { id: 'p1', name: 'Pat', avatar: null }],
  };

  it('drafts the same activity a week later with the players who went', () => {
    expect(schedule.nextWeekDraft(game)).toMatchObject({
      day: '2026-10-11', startMinutes: 18 * 60, durationMinutes: 90, court: game.court, skillLevel: 'beginner', courtCost: '₱150',
      invitees: [{ id: 'p1', name: 'Pat', avatar: null }],
    });
  });

  it('saves skill level and court cost after creating the activity', async () => {
    await createScheduledActivity({ ...details, kind: 'game', skillLevel: 'beginner', courtCost: ' Free ' });
    expect(rpc).toHaveBeenLastCalledWith('update_scheduled_game', { p_game_id: 'new-activity', p_skill_level: 'beginner', p_court_cost: 'Free' });
  });

  it('keeps a created activity when the database has no detail columns yet', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'new-activity' }, error: null }).mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
    await expect(createScheduledActivity({ ...details, kind: 'game', skillLevel: 'advanced' })).resolves.toEqual({ id: 'new-activity' });
  });

  it('only sends the fields a host changed', async () => {
    await schedule.updateScheduledGame('g1', { skillLevel: 'any', courtCost: '' });
    expect(rpc).toHaveBeenLastCalledWith('update_scheduled_game', { p_game_id: 'g1', p_skill_level: 'any', p_court_cost: '' });
    await schedule.updateScheduledGame('g1', { startsAt: '2026-10-11T10:00:00.000Z', durationMinutes: 60, court: { name: 'Listed', venueId: 'v1', courtId: 'c1' } });
    expect(rpc).toHaveBeenLastCalledWith('update_scheduled_game', expect.objectContaining({
      p_starts_at: '2026-10-11T10:00:00.000Z', p_ends_at: '2026-10-11T11:00:00.000Z', p_venue_id: 'v1', p_court_id: 'c1', p_latitude: null,
    }));
    await expect(schedule.updateScheduledGame('g1', { startsAt: '2026-10-11T10:00:00.000Z', durationMinutes: 0 })).rejects.toThrow('valid start time');
  });

  it('filters Discover by area either way round, and by skill', () => {
    const entry = { isPlayerScheduled: true, area: 'Kapitolyo, Pasig', place: 'Community Courts', skillLevel: 'beginner' };
    expect(schedule.matchesArea(entry, 'pasig')).toBe(true);
    expect(schedule.matchesArea({ ...entry, area: 'Pasig' }, 'Pasig City')).toBe(true);
    expect(schedule.matchesArea(entry, 'Makati')).toBe(false);
    expect(schedule.matchesArea(entry, '')).toBe(true);
    expect(schedule.matchesSkill(entry, 'beginner')).toBe(true);
    expect(schedule.matchesSkill(entry, 'advanced')).toBe(false);
    expect(schedule.matchesSkill({ ...entry, skillLevel: 'any' }, 'advanced')).toBe(true);
  });

  it('shows a player their waitlist place and a host the waitlist size', async () => {
    const row = { id: 'full', host_id: 'other', activity_kind: 'game', status: 'scheduled', visibility: 'open', capacity: 2, starts_at: '2026-10-01T01:00:00Z', ends_at: '2026-10-01T03:00:00Z',
      scheduled_game_players: [{ user_id: 'other', status: 'going' }, { user_id: 'p2', status: 'going' }] };
    const table = () => {
      const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lt: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis() };
      query.limit = jest.fn().mockResolvedValue({ data: [row], error: null });
      return query;
    };
    const personal = { select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), range: jest.fn().mockResolvedValue({ data: [], error: null }) };
    const places = Promise.resolve({ data: [{ game_id: 'full', place: 2, waiting: 2 }], error: null });
    requireSupabase.mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'me' } } } }) }, rpc: jest.fn((name) => (name === 'list_scheduled_game_waitlists' ? places : personal)), from: jest.fn(table) });
    const [entry] = await listScheduledGames({ from: '2026-10-01', to: '2026-11-01' });
    expect(entry).toMatchObject({ spotsLeft: 0, waitlistPlace: 2, waitlistCount: 2 });
  });
});
