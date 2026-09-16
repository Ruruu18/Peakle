import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireSupabase } from '../../lib/supabase';
import { loadUnfinishedMatch, saveCompletedMatch, saveUnfinishedMatch } from '../database';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));
const key = '@peakle/unfinished-match/player-a';
const draft = { clientMatchId: 'match-a', players: [['A'], ['B']], scores: [6, 3], matchType: 'singles', mode: 'casual', target: 11, bestOf: 1, matchStartedAt: 1700000000000, draftSavedAt: 200 };

function clientWith(...results) {
  const builders = [];
  const client = {
    auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: 'player-a' } } } })) },
    from: jest.fn(() => {
      const result = results.shift();
      const query = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
      for (const method of ['select', 'insert', 'update', 'upsert', 'eq', 'not', 'order', 'limit', 'single', 'maybeSingle']) query[method] = jest.fn(() => query);
      builders.push(query);
      return query;
    }),
  };
  requireSupabase.mockReturnValue(client);
  return { client, builders };
}

beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });

it('keeps the latest score locally when the server is unreachable', async () => {
  clientWith({ data: null, error: { message: 'Offline' } });
  await expect(saveUnfinishedMatch('player-a', draft)).rejects.toMatchObject({ message: 'Offline' });
  expect(JSON.parse(await AsyncStorage.getItem(key))).toMatchObject({ scores: [6, 3], clientMatchId: 'match-a' });
});

it('recovers an offline draft using the stored authenticated session', async () => {
  await AsyncStorage.setItem(key, JSON.stringify(draft));
  clientWith({ data: null, error: { message: 'Offline' } });
  expect(await loadUnfinishedMatch()).toEqual(draft);
});

it('retries a lost insert response using the same ID without reopening completed matches', async () => {
  const { builders } = clientWith({ data: null, error: { code: '23505' } }, { data: { id: 'match-a' }, error: null });
  expect(await saveUnfinishedMatch('player-a', draft)).toMatchObject({ savedMatchId: 'match-a' });
  expect(builders[0].insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'match-a', started_at: new Date(draft.matchStartedAt).toISOString() }));
  expect(builders[1].eq).toHaveBeenCalledWith('status', 'live');
  expect(builders[1].eq).toHaveBeenCalledWith('created_by', 'player-a');
});

it('does not replace a newer browser score with a late server response', async () => {
  await AsyncStorage.setItem(key, JSON.stringify({ ...draft, scores: [7, 3], draftSavedAt: 300 }));
  clientWith({ data: { id: 'match-a' }, error: null });
  await saveUnfinishedMatch('player-a', draft);
  expect(JSON.parse(await AsyncStorage.getItem(key)).scores).toEqual([7, 3]);
});

it('prefers a newer server score recorded on another device', async () => {
  await AsyncStorage.setItem(key, JSON.stringify(draft));
  clientWith({ data: { id: 'match-a', resume_state: { ...draft, scores: [8, 3], draftSavedAt: 400 } }, error: null });
  expect(await loadUnfinishedMatch()).toMatchObject({ savedMatchId: 'match-a', scores: [8, 3] });
});

it('discards stale local recovery after the match was completed on another device', async () => {
  await AsyncStorage.setItem(key, JSON.stringify(draft));
  clientWith({ data: null, error: null }, { data: { status: 'completed' }, error: null });
  expect(await loadUnfinishedMatch()).toBeNull();
  expect(await AsyncStorage.getItem(key)).toBeNull();
});

it('does not expose another account’s saved match', async () => {
  await AsyncStorage.setItem('@peakle/unfinished-match/player-b', JSON.stringify(draft));
  clientWith({ data: null, error: null });
  expect(await loadUnfinishedMatch()).toBeNull();
});

it('retains a finished result for retry after a failed upload and page reload', async () => {
  const result = { ...draft, scores: [11, 3], games: [1, 0], gameScores: [[11, 3]], reason: 'completed' };
  clientWith({ data: null, error: { message: 'Offline' } });
  await expect(saveCompletedMatch('player-a', result, 'A')).rejects.toMatchObject({ message: 'Offline' });
  clientWith({ data: null, error: null });
  expect(await loadUnfinishedMatch()).toMatchObject({ scores: [11, 3], reason: 'completed', resultPendingSave: true });
});
