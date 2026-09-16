import { Linking } from 'react-native';
import { makeRedirectUri } from 'expo-auth-session';
import { requireSupabase } from '../../lib/supabase';
import { getExpoGoOAuthRedirectUrl, mapUser, readCurrentUser, restoreSessionFromUrl } from '../AuthContext';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: jest.fn(() => 'https://generated.example/oauth/callback') }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('mapUser', () => {
  it('returns null for a missing auth user', () => {
    expect(mapUser(null, null)).toBeNull();
  });

  it('prefers the profile display name, falling back through metadata and email', () => {
    const authUser = { id: 'u1', email: 'jamie@example.com', user_metadata: { display_name: 'Meta Name', full_name: 'Meta Full' } };
    expect(mapUser(authUser, { display_name: 'Profile Name' }).name).toBe('Profile Name');
    expect(mapUser(authUser, null).name).toBe('Meta Name');
    expect(mapUser({ ...authUser, user_metadata: { full_name: 'Meta Full' } }, null).name).toBe('Meta Full');
    expect(mapUser({ ...authUser, user_metadata: {} }, null).name).toBe('jamie');
    expect(mapUser({ ...authUser, email: undefined, user_metadata: {} }, null).name).toBe('Peakle Player');
  });

  it('defaults presence, mode, and preference when the profile has none', () => {
    const authUser = { id: 'u1', email: 'jamie@example.com', user_metadata: {} };
    const user = mapUser(authUser, null);
    expect(user.presenceStatus).toBe('free');
    expect(user.mode).toBe('player');
    expect(user.preference).toBe('Doubles');
    expect(user.onboardingCompleted).toBe(false);
    expect(user.isAdmin).toBe(false);
  });

  it('carries the isAdmin flag through unchanged', () => {
    const authUser = { id: 'u1', email: 'jamie@example.com', user_metadata: {} };
    expect(mapUser(authUser, null, true).isAdmin).toBe(true);
  });
});

describe('readCurrentUser', () => {
  it('returns null without querying when there is no auth user', async () => {
    const client = { rpc: jest.fn(), from: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await readCurrentUser(null)).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('grants admin only when the platform_admins lookup confirms a row and reports no error', async () => {
    const client = {
      rpc: jest.fn(() => ({ maybeSingle: () => Promise.resolve({ data: { display_name: 'Jamie' }, error: null }) })),
      from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { user_id: 'u1' }, error: null }) }) }) })),
    };
    requireSupabase.mockReturnValue(client);
    const user = await readCurrentUser({ id: 'u1', email: 'jamie@example.com', user_metadata: {} });
    expect(user.isAdmin).toBe(true);
  });

  it('treats an admin-lookup error as non-admin instead of throwing, keeping sign-in working during a rolling deploy', async () => {
    const client = {
      rpc: jest.fn(() => ({ maybeSingle: () => Promise.resolve({ data: { display_name: 'Jamie' }, error: null }) })),
      from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: new Error('missing table') }) }) }) })),
    };
    requireSupabase.mockReturnValue(client);
    const user = await readCurrentUser({ id: 'u1', email: 'jamie@example.com', user_metadata: {} });
    expect(user.isAdmin).toBe(false);
  });

  it('throws when the profile RPC itself errors', async () => {
    const client = {
      rpc: jest.fn(() => ({ maybeSingle: () => Promise.resolve({ data: null, error: new Error('profile fetch failed') }) })),
      from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) })),
    };
    requireSupabase.mockReturnValue(client);
    await expect(readCurrentUser({ id: 'u1', email: 'jamie@example.com', user_metadata: {} })).rejects.toThrow('profile fetch failed');
  });
});

describe('restoreSessionFromUrl', () => {
  function mockClient() {
    const client = { auth: { exchangeCodeForSession: jest.fn(() => Promise.resolve({ error: null })), setSession: jest.fn(() => Promise.resolve({ error: null })) } };
    requireSupabase.mockReturnValue(client);
    return client;
  }

  it('throws a readable error when the link carries an error_description', async () => {
    mockClient();
    await expect(restoreSessionFromUrl('peakle://reset-password#error=access_denied&error_description=Link+expired'))
      .rejects.toThrow('Link expired');
  });

  it('exchanges a PKCE code for a session and reports non-recovery links as such', async () => {
    const client = mockClient();
    const isRecovery = await restoreSessionFromUrl('https://beta.example/oauth/callback?code=one-use-code');
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('one-use-code');
    expect(isRecovery).toBe(false);
  });

  it('sets the session from native access/refresh token fragments', async () => {
    const client = mockClient();
    await restoreSessionFromUrl('peakle://auth#access_token=at&refresh_token=rt&type=recovery');
    expect(client.auth.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it('reports a link as a recovery link from the type param or a reset-password path', async () => {
    mockClient();
    expect(await restoreSessionFromUrl('peakle://reset-password#access_token=at&refresh_token=rt&type=recovery')).toBe(true);
    expect(await restoreSessionFromUrl('https://beta.example/reset-password?code=one-use-code')).toBe(true);
  });

  it('propagates an error from exchangeCodeForSession', async () => {
    const client = mockClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: new Error('exchange failed') });
    await expect(restoreSessionFromUrl('https://beta.example/oauth/callback?code=bad-code')).rejects.toThrow('exchange failed');
  });
});

describe('getExpoGoOAuthRedirectUrl', () => {
  it('falls back to the generated redirect URI when there is no exp:// launch URL', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('https://beta.example/');
    expect(await getExpoGoOAuthRedirectUrl()).toBe('https://generated.example/oauth/callback');
  });

  it('falls back to the generated redirect URI when getInitialURL rejects', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockRejectedValue(new Error('no url'));
    expect(await getExpoGoOAuthRedirectUrl()).toBe('https://generated.example/oauth/callback');
  });

  it('builds the callback from the exp:// launch URL instead of the generated one, so a physical device is not sent to localhost', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('exp://192.168.1.5:8081/--/some/path?foo=bar#frag');
    expect(await getExpoGoOAuthRedirectUrl()).toBe('exp://192.168.1.5:8081/--/oauth/callback');
  });

  it('strips a trailing slash from the launch base before appending the callback path', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('exp://192.168.1.5:8081/');
    expect(await getExpoGoOAuthRedirectUrl()).toBe('exp://192.168.1.5:8081/--/oauth/callback');
  });
});
