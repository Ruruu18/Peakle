import React from 'react';
import { Alert, Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import PlayScreen from '../PlayScreen';
import { useAuth } from '../../context/AuthContext';
import { useNearbyPlayersContext } from '../../context/NearbyPlayersContext';
import { saveCompletedMatch } from '../../services/database';
import CourtPickerSheet from '../../components/CourtPickerSheet';

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
  listTeams: jest.fn(async () => []),
}));
jest.mock('../../services/nearbyPlayers', () => ({ searchRegisteredPlayers: jest.fn() }));
jest.mock('../../services/directMessages', () => ({ listFollowingPlayers: jest.fn(async () => []), listPlayerActivity: async () => new Map() }));
jest.mock('../../services/playCourts', () => ({ loadRecentCourts: jest.fn(async () => []), rememberCourt: jest.fn(async () => []), areaFromLocationLabel: jest.fn() }));
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
const labeledButton = (label) => renderer.root.findAll((node) => node.props.accessibilityLabel === label && node.props.onPress)[0];
const pressLabel = async (label) => {
  const button = labeledButton(label);
  expect(button).toBeTruthy();
  expect(button.props.disabled).not.toBe(true);
  await act(async () => { await button.props.onPress(); });
};
const expectStep = (label) => {
  expect(labeledButton(`${label} step`).props.accessibilityState.selected).toBe(true);
  expect(renderer.root.findAllByType(Text).some((node) => React.Children.toArray(node.props.children).join('') === `${label} details`)).toBe(true);
};
const lineupInputs = () => renderer.root.findAllByType(TextInput).filter((node) => node.props.accessibilityLabel?.startsWith('Team '));
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

it('starts Build a Four on Game and keeps the selected step and form aligned when going back', async () => {
  nearby.sharedLiveMatch = null;
  await act(async () => {
    renderer = TestRenderer.create(<PlayScreen navigation={navigation} route={{ params: { nearbyPlayersToken: 1 } }} />);
  });
  expectStep('Game');
  expect(hasText('FORMAT')).toBe(true);
  expect(hasText('PLAY TYPE')).toBe(true);
  expect(hasText('COURT LINEUP')).toBe(false);
  expect(lineupInputs()).toHaveLength(0);
  expect(labeledButton('Court step').props.disabled).toBe(true);

  await press('Singles');
  await press('Ranked');
  await press('Continue to players');
  expectStep('Players');
  expect(hasText('FORMAT')).toBe(false);
  expect(hasText('PLAY TYPE')).toBe(false);
  expect(hasText('One player on each side')).toBe(true);
  expect(hasText('Add 1 more player.')).toBe(true);
  expect(lineupInputs()).toHaveLength(2);
  expect(lineupInputs()[0].props.value).toBe('Player');
  expect(hasText('Continue to court')).toBe(true);

  await pressLabel('Back to game');
  expectStep('Game');
  expect(hasText('HOW TO ADD PLAYERS')).toBe(false);
  expect(hasText('COURT LINEUP')).toBe(false);
  await press('Doubles');
  await press('Continue to players');
  expectStep('Players');
  expect(hasText('Two players on each side')).toBe(true);
  expect(lineupInputs()).toHaveLength(4);
  expect(lineupInputs()[0].props.value).toBe('Player');
  await press('Change game');
  expectStep('Game');
  await press('Continue to players');
  await press('Back');
  expectStep('Game');
  await pressLabel('Back to Play options');
  await pressLabel('Set up a match');
  expectStep('Game');
});

it('sends singles invitations after changing format from Build a Four', async () => {
  nearby.sharedLiveMatch = null;
  nearby.visible = true;
  nearby.players = [{ id: 'opponent', name: 'Alex', rating: 3 }];
  nearby.invite = jest.fn(async () => ({}));
  await act(async () => {
    renderer = TestRenderer.create(<PlayScreen navigation={navigation} route={{ params: { nearbyPlayersToken: 2 } }} />);
  });
  await press('Singles');
  await press('Continue to players');
  await press('Invite');
  expect(nearby.invite).toHaveBeenCalledWith('opponent', expect.objectContaining({ matchType: 'singles' }));
});

it('preserves the setup through Court, Review, first serve, and every previous step', async () => {
  nearby.sharedLiveMatch = null;
  await act(async () => {
    renderer = TestRenderer.create(<PlayScreen navigation={navigation} route={{ params: { startLiveToken: 3 } }} />);
  });
  await press('Singles');
  await press('Continue to players');
  await press('Guest names');
  await act(async () => { lineupInputs()[1].props.onChangeText('Alex'); });
  await press('Continue to court');
  expectStep('Court');
  expect(hasText('COURT LINEUP')).toBe(false);
  await pressLabel('Choose a court');
  await act(async () => { renderer.root.findByType(CourtPickerSheet).props.onSelect({ name: 'Test court', source: 'custom' }); });
  await press('Review match');
  expectStep('Review');
  await press('Continue to first serve');
  expect(hasText('Choose the opening server.')).toBe(true);
  await press('Back to match setup');
  expectStep('Review');
  expect(hasText('Continue to first serve')).toBe(true);
  await pressLabel('Back to court');
  expectStep('Court');
  expect(labeledButton('Change court. Selected: Test court')).toBeTruthy();
  await press('Back');
  expectStep('Players');
  expect(lineupInputs().map((node) => node.props.value)).toEqual(['Player', 'Alex']);
  await pressLabel('Game step');
  expectStep('Game');
  await press('Continue to players');
  expect(lineupInputs().map((node) => node.props.value)).toEqual(['Player', 'Alex']);
});

it('starts a fresh Game step when a new shortcut is opened with an old nearby token still in the route', async () => {
  nearby.sharedLiveMatch = null;
  await act(async () => {
    renderer = TestRenderer.create(<PlayScreen navigation={navigation} route={{ params: { nearbyPlayersToken: 4 } }} />);
  });
  await press('Continue to players');
  expectStep('Players');
  await act(async () => {
    renderer.update(<PlayScreen navigation={navigation} route={{ params: { nearbyPlayersToken: 4, startLiveToken: 5 } }} />);
  });
  expectStep('Game');
  expect(lineupInputs()).toHaveLength(0);
});
