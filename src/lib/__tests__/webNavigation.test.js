import { getPathFromState } from '@react-navigation/native';
import { webNavigationState } from '../webNavigation';

it('builds a player link from the record ID without putting profile data in the URL', () => {
  const original = { routes: [{ name: 'PublicProfile', params: { player: { id: 'player-123', name: 'A Player', avatar: 'https://example.invalid/photo' }, ownerTab: 'Home' } }] };
  const cleaned = webNavigationState(original);
  expect(getPathFromState(cleaned, { screens: { PublicProfile: 'players/:userId' } })).toBe('/players/player-123?ownerTab=Home');
  expect(original.routes[0].params.player.name).toBe('A Player');
});

it('builds refreshable event links with only the type and ID', () => {
  const cleaned = webNavigationState({ routes: [{ name: 'ActivityDetails', params: { activity: { sourceId: 'cup-123', type: 'competition', title: 'Community Cup' } } }] });
  expect(getPathFromState(cleaned, { screens: { ActivityDetails: 'activities/:activityType/:activityId' } })).toBe('/activities/competition/cup-123');
});

it('keeps primitives needed for booking returns and removes optional empty records', () => {
  expect(webNavigationState({ routes: [{ name: 'Book', params: { paymentBookingId: 'booking-123', status: 'success', court: null } }] }).routes[0].params).toEqual({ paymentBookingId: 'booking-123', status: 'success' });
});
