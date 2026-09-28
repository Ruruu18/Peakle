import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { supabase } from '../../lib/supabase';
import { getActiveNearbyLiveMatchId, getNearbyLiveMatch, listMatchInvites, updateNearbyLiveMatch } from '../../services/nearbyPlayers';
import useNearbyPlayers from '../useNearbyPlayers';

jest.mock('../../lib/supabase', () => ({ supabase: { channel: jest.fn(), removeChannel: jest.fn() } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'player', presenceStatus: 'free' } }) }));
jest.mock('../../context/LocationContext', () => {
  const location = { userLocation: {}, getCurrentCoordinates: jest.fn(), useCurrentLocation: jest.fn() };
  return { useUserLocation: () => location, locationErrorMessage: jest.fn() };
});
jest.mock('../../config/demoMode', () => ({ DEMO_MODE: false }));
jest.mock('../../services/nearbyPlayers', () => ({
  getActiveNearbyLiveMatchId: jest.fn(), getNearbyLiveMatch: jest.fn(),
  listMatchInvites: jest.fn(), updateNearbyLiveMatch: jest.fn(),
  touchNearbyLiveScorer: jest.fn(async () => {}),
}));

const live = { id: 'match', host_id: 'host', scorer_id: 'host', status: 'live', revision: 3, state: { scores: [2, 1] }, nearby_live_match_members: [{ user_id: 'player' }] };
const ended = { ...live, status: 'ended', revision: 4, state: { finalResult: { reason: 'ended', scores: [2, 1] } } };
const invite = { id: 'invite', status: 'accepted', live_match_id: 'match' };
let current, renderer, channels, listeners;

function Probe() { current = useNearbyPlayers(); return null; }
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const mount = async () => { await act(async () => { renderer = TestRenderer.create(<Probe />); }); };
const matchChannel = () => channels.find((channel) => channel.table === 'nearby_live_matches');

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  channels = [];
  listeners = [];
  getActiveNearbyLiveMatchId.mockResolvedValue(null);
  getNearbyLiveMatch.mockResolvedValue(live);
  listMatchInvites.mockResolvedValue({ incoming: [], outgoing: [], joinedInvite: invite, removedInvite: null });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    listeners.push(handler);
    return { remove: jest.fn() };
  });
  supabase.channel.mockImplementation(() => {
    const channel = {
      on: jest.fn((type, { table }, handler) => { channel.table = table; channel.change = handler; return channel; }),
      subscribe: jest.fn((handler) => { channel.status = handler; return channel; }),
    };
    channels.push(channel);
    return channel;
  });
});

afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  renderer = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('applies the other player ending early immediately, even when the follow-up fetch stalls', async () => {
  await mount();
  getNearbyLiveMatch.mockImplementation(() => new Promise(() => {}));
  await act(async () => { matchChannel().change({ new: ended }); });
  expect(current.sharedLiveMatch.status).toBe('ended');
  expect(current.sharedLiveMatch.state.finalResult.reason).toBe('ended');
  expect(current.sharedLiveMatch.nearby_live_match_members).toEqual(live.nearby_live_match_members);
  expect(current.joinedInvite).toBeNull();
});

it('does not reopen a finished match when an older fetch arrives afterward', async () => {
  await mount();
  const stale = deferred();
  getNearbyLiveMatch.mockReturnValueOnce(stale.promise);
  let refresh;
  act(() => { refresh = current.refreshLiveMatch(); });
  getNearbyLiveMatch.mockResolvedValue(ended);
  await act(async () => { await current.refreshLiveMatch(); });
  await act(async () => { stale.resolve(live); await refresh; });
  expect(current.sharedLiveMatch.status).toBe('ended');
  expect(current.sharedLiveMatch.revision).toBe(4);
});

it('does not reopen a finished match when an earlier score write arrives afterward', async () => {
  await mount();
  const stale = deferred();
  updateNearbyLiveMatch.mockReturnValueOnce(stale.promise);
  let update;
  act(() => { update = current.syncSharedMatch('match', 2, live.state); });
  getNearbyLiveMatch.mockResolvedValue(ended);
  await act(async () => { await current.refreshLiveMatch(); });
  await act(async () => { stale.resolve(live); await update; });
  expect(current.sharedLiveMatch.status).toBe('ended');
});

it('recovers a missed ending within three seconds when realtime is unavailable', async () => {
  await mount();
  getNearbyLiveMatch.mockResolvedValue(ended);
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(current.sharedLiveMatch.status).toBe('ended');
  expect(current.joinedInvite).toBeNull();
});

it('refreshes immediately when the realtime channel reconnects', async () => {
  await mount();
  getNearbyLiveMatch.mockResolvedValue(ended);
  await act(async () => { matchChannel().status?.('SUBSCRIBED'); });
  expect(current.sharedLiveMatch.status).toBe('ended');
});

it('keeps following the match after its invite expires and catches the end on foreground', async () => {
  await mount();
  listMatchInvites.mockResolvedValue({ incoming: [], outgoing: [], joinedInvite: null, removedInvite: null });
  await act(async () => { await current.refresh(); });
  getNearbyLiveMatch.mockResolvedValue(ended);
  await act(async () => { listeners.forEach((handler) => handler('active')); });
  expect(current.sharedLiveMatch.status).toBe('ended');
});

it('picks up the host starting the match within three seconds when realtime misses it', async () => {
  listMatchInvites.mockResolvedValue({ incoming: [], outgoing: [], joinedInvite: { ...invite, live_match_id: null }, removedInvite: null });
  await mount();
  expect(current.sharedLiveMatch).toBeNull();
  listMatchInvites.mockResolvedValue({ incoming: [], outgoing: [], joinedInvite: invite, removedInvite: null });
  await act(async () => { jest.advanceTimersByTime(3000); });
  await act(async () => {});
  expect(current.sharedLiveMatch.status).toBe('live');
});
