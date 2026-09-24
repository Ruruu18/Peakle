import { isAccountAccessError } from '../accountAccess';

test('recognizes revoked sessions and the backend suspension response', () => {
  for (const code of ['user_banned', 'session_not_found', 'refresh_token_not_found']) {
    expect(isAccountAccessError({ code })).toBe(true);
  }
  expect(isAccountAccessError({ code: 'PT403', message: 'Account access is suspended or this session has been revoked.' })).toBe(true);
});

test('keeps ordinary permission and transient network failures distinct from a ban', () => {
  for (const error of [null, new Error('Network error'), { code: '42501' }, { code: 'PT403', message: 'Venue access required' }, { code: 'invalid_credentials' }]) {
    expect(isAccountAccessError(error)).toBe(false);
  }
});
