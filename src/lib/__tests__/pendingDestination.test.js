/**
 * @jest-environment jsdom
 */
import { cleanAuthUrl } from '../authLinks';
import {
  authReturnPath, clearPendingDestination, isShareablePath, readPendingDestination, rememberPendingDestination, restorePendingDestination,
} from '../pendingDestination';

beforeEach(() => {
  clearPendingDestination();
  window.history.replaceState(null, '', '/');
});

it('only keeps shareable record links', () => {
  expect(isShareablePath('/games/ab12cd34ef')).toBe(true);
  expect(isShareablePath('/open-play/COURT7')).toBe(true);
  expect(isShareablePath('/activities/competition/cup-123')).toBe(true);
  expect(isShareablePath('/games/short')).toBe(false);
  expect(isShareablePath('/profile')).toBe(false);
  expect(isShareablePath('https://evil.example/games/ab12cd34ef')).toBe(false);
  expect(rememberPendingDestination('/schedule')).toBe(false);
  expect(readPendingDestination()).toBeNull();
});

it('returns a Google or email callback to the shared game instead of home', () => {
  rememberPendingDestination('/games/ab12cd34ef');
  expect(cleanAuthUrl('https://beta.example/oauth/callback?code=secret', authReturnPath('/oauth/callback'))).toBe('/games/ab12cd34ef');
  expect(authReturnPath('/compete')).toBeNull();
});

it('restores the destination once before the signed-in navigator starts', () => {
  rememberPendingDestination('/games/ab12cd34ef');
  expect(restorePendingDestination()).toBe('/games/ab12cd34ef');
  expect(window.location.pathname).toBe('/games/ab12cd34ef');
  window.history.replaceState(null, '', '/');
  expect(restorePendingDestination()).toBeNull();
  expect(window.location.pathname).toBe('/');
});

it('does not override a page the player opened directly', () => {
  rememberPendingDestination('/games/ab12cd34ef');
  window.history.replaceState(null, '', '/profile');
  expect(restorePendingDestination()).toBeNull();
  expect(window.location.pathname).toBe('/profile');
  expect(readPendingDestination()).toBeNull();
});

it('expires after a day', () => {
  rememberPendingDestination('/games/ab12cd34ef', Date.now() - 25 * 60 * 60 * 1000);
  expect(readPendingDestination()).toBeNull();
});
