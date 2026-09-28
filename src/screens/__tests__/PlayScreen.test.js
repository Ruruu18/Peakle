import React from 'react';
import { Alert, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import PlayScreen from '../PlayScreen';
import { useAuth } from '../../context/AuthContext';
import { useNearbyPlayersContext } from '../../context/NearbyPlayersContext';
import { saveCompletedMatch } from '../../services/database';

jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn(), useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../context/NearbyPlayersContext', () => ({ useNearbyPlayersContext: jest.fn() }));
jest.mock('../../context/LocationContext', () => ({ useUserLocation: () => ({ userLocation: {} }) }));
jest.mock('../../context/ThemeContext', () => ({
  ...jest.requireActual('../../context/ThemeContext'), useTheme: () => ({ isDark: false }),
}));
jest.mock('../../services/database', () => ({
  loadUnfinishedMatch: jest.fn(async () => null), saveCompletedMatch: jest.fn(async () => ({ id: 'saved' })),
}));
jest.mock('../../services/nearbyPlayers', () => ({ searchRegisteredPlayers: jest.fn() }));
jest.mock('../../services/directMessages', () => ({ listFollowingPlayers: jest.fn(async () => []) }));
jest.mock('../../services/playCourts', () => ({ loadRecentCourts: jest.fn(async () => []), areaFromLocationLabel: jest.fn() }));
jest.mock('../PlayerOpenPlayScreen', () => () => null);
jest.mock('../../components/AccountMenu', () => ({ HeaderAvatar: () => null }));
jest.mock('../../components/CourtPickerSheet', () => () => null);
jest.mock('../../components/CourtLineup', () => () => null);
jest.mock('../../components/RallyBall', () => () => null);
jest.mock('../../components/AppIcon', () => 'AppIcon');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons', { virtual: true });
jest.mock('../../components/ResponsiveModal', () => ({ visible, children }) => visible ? children : null);
jest.mock('../../hooks/useRallyBallAnimation', () => () => ({}));
jest.mock('../../hooks/useShoutScoring', () => () => ({}));
jest.mock('../../utils/scoreAccessibility', () => ({ stopScoreAnnouncement: jest.fn() }));
jest.mock('../../config/demoMode', () => ({ DEMO_MODE: false }));

const configuration = {
  players: [['Host'], ['Player']], bestOf: 1, target: 11, matchType: 'singles', mode: 'casual', access: 'public',
  firstServer: 0, firstServerPlayer: 'Host', scorer: 'Host', court: { name: 'Test court' }, scoringMethod: 'manual',
};
const live = { id: 'shared', host_id: 'host', scorer_id: 'host', revision: 1, status: 'live', configuration,
  state: { scores: [2, 1], games: [0, 0], gameScores: [] } };
const finalResult = { ...configuration, sharedLiveMatchId: live.id, reason: 'ended', scores: [2, 1], games: [0, 0], gameScores: [[2, 1]], winner: 0, elapsed: 30 };
const ended = { ...live, status: 'ended', revision: 2, state: { ...live.state, finalResult } };
const navigation = { navigate: jest.fn(), addListener: jest.fn(() => () => {}), isFocused: () => true };
let renderer, nearby;
const screen = () => <PlayScreen navigation={navigation} route={{}} />;
const hasText = (value) => renderer.root.findAllByType(Text).some((node) => node.props.children === value);
const press = async (label) => {
  let button = renderer.root.findAllByType(Text).find((node) => node.props.children === label);
  while (button && !button.props.onPress) button = button.parent;
  expect(button).toBeTruthy();
  expect(button.props.disabled).not.toBe(true);
  await act(async () => { await button.props.onPress(); });
};
const update = async (session) => {
  nearby.sharedLiveMatch = session;
  await act(async () => { renderer.update(screen()); });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useAuth.mockReturnValue({ user: { id: 'player', name: 'Player' } });
  nearby = { sharedLiveMatch: live, players: [], outgoingInvites: [], incomingInvites: [],
    syncSharedMatch: jest.fn(), refreshLiveMatch: jest.fn(), takeOverSharedScorer: jest.fn() };
  useNearbyPlayersContext.mockImplementation(() => nearby);
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  renderer = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('moves the other player from the live score to the final result when the host ends early', async () => {
  await act(async () => { renderer = TestRenderer.create(screen()); });
  expect(hasText('Watching live score')).toBe(true);
  await update(ended);
  expect(hasText('Watching live score')).toBe(false);
  expect(hasText('Shared match completed')).toBe(true);
  expect(saveCompletedMatch).not.toHaveBeenCalled();
});

it('also exits a rematch that reuses the same shared session ID', async () => {
  await act(async () => { renderer = TestRenderer.create(screen()); });
  await update(ended);
  await update({ ...live, revision: 3 });
  expect(hasText('Watching live score')).toBe(true);
  await update({ ...ended, revision: 4 });
  expect(hasText('Watching live score')).toBe(false);
  expect(hasText('Shared match completed')).toBe(true);
});

it('lets the scorer retry ending early after the shared close fails', async () => {
  nearby.sharedLiveMatch = { ...live, scorer_id: 'player' };
  nearby.refreshLiveMatch.mockResolvedValue(nearby.sharedLiveMatch);
  nearby.syncSharedMatch.mockRejectedValue(new Error('Connection lost'));
  await act(async () => { renderer = TestRenderer.create(screen()); });
  await press('End match early');
  await press('End as final');
  expect(Alert.alert).toHaveBeenCalledWith('Couldn’t close connected match', expect.any(String));
  expect(saveCompletedMatch).not.toHaveBeenCalled();
  nearby.syncSharedMatch.mockResolvedValue({ ...ended, scorer_id: 'player' });
  await press('End match early');
  await press('End as final');
  expect(saveCompletedMatch).toHaveBeenCalledTimes(1);
  expect(hasText('Match recorded')).toBe(true);
});
