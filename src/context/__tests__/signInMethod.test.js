import React from 'react';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { supabase } from '../../lib/supabase';
import { AuthProvider, useAuth } from '../AuthContext';

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() } },
  requireSupabase: jest.fn(),
}));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: jest.fn() }));

const methodKey = '@peakle/last-selected-sign-in-method';
let auth;
let tree;
function Consumer() { auth = useAuth(); return null; }

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  AsyncStorage.getItem.mockResolvedValue(null);
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  supabase.auth.onAuthStateChange.mockImplementation((listener) => {
    // Supabase may emit this before the startup storage/profile reads finish.
    listener('INITIAL_SESSION', null);
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  jest.restoreAllMocks();
});

async function mount() {
  await act(async () => { tree = create(<AuthProvider><Consumer /></AuthProvider>); });
}

it.each(['email', 'google'])('restores %s history even when a session event supersedes startup', async (method) => {
  AsyncStorage.getItem.mockImplementation(async (key) => key === methodKey ? method : null);
  await mount();
  expect(auth.hydrated).toBe(true);
  expect(auth.lastSignInMethod).toBe(method);
});

it('does not show a badge for unsupported stored methods', async () => {
  AsyncStorage.getItem.mockImplementation(async (key) => key === methodKey ? 'facebook' : null);
  await mount();
  expect(auth.lastSignInMethod).toBeNull();
});

it('keeps a new selection when an older storage read finishes later', async () => {
  let finishRead;
  AsyncStorage.getItem.mockImplementation((key) => key === methodKey
    ? new Promise(resolve => { finishRead = resolve; })
    : Promise.resolve(null));
  await mount();
  await act(async () => { await auth.rememberSignInMethod('email'); });
  await act(async () => { finishRead('google'); });
  expect(auth.lastSignInMethod).toBe('email');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(methodKey, 'email');
});
