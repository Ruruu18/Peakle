import { requireSupabase } from '../../lib/supabase';
import {
  createScheduledActivity, createScheduledGame, isOnMyCalendar, isPlayerScheduledEntry,
  listScheduledGames, nextOnMyCalendar, playSetupFromGame, scheduleEntryFromActivity,
} from '../schedule';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('../../config/demoMode', () => ({ DEMO_MODE: false }));
jest.mock('../playerActivities', () => ({ listDiscoverablePlayerActivities: jest.fn() }));

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
  const query = { select: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lt: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: rows, error: null }) };
  requireSupabase.mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'host' } } } }) }, from: jest.fn(() => query) });
  const entries = await listScheduledGames({ from: '2026-10-01', to: '2026-11-01' });
  expect(entries.map((entry) => entry.kind)).toEqual(['game', 'open_play', 'competition', 'program']);
  expect(entries.every(isPlayerScheduledEntry)).toBe(true);
  expect(entries.every(isOnMyCalendar)).toBe(true);
  expect(entries[2]).toMatchObject({ id: 'game:competition', typeLabel: 'Tournament', isHost: true });
  expect(nextOnMyCalendar(entries.slice(1), Date.parse('2026-10-01'))?.kind).toBe('open_play');
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
