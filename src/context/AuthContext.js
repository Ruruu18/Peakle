import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { isSupabaseConfigured, requireSupabase, supabase } from '../lib/supabase';

const AuthContext = createContext(null);
const PENDING_VERIFICATION_EMAIL_KEY = '@peakle/pending-verification-email';
const LAST_SIGN_IN_METHOD_KEY = '@peakle/last-sign-in-method';
const REMEMBERED_EMAIL_KEY = '@peakle/remembered-email';

function mapUser(authUser, profile, isAdmin = false) {
  if (!authUser) return null;
  const metadata = authUser.user_metadata || {};
  return {
    id: authUser.id,
    email: authUser.email,
    name: profile?.display_name || metadata.display_name || metadata.full_name || authUser.email?.split('@')[0] || 'Peakle Player',
    picture: profile?.avatar_url || metadata.avatar_url,
    location: profile?.home_area || 'Metro Manila',
    skill: profile?.skill_rating != null ? String(profile.skill_rating) : null,
    preference: profile?.play_preference || 'Doubles',
    presenceStatus: profile?.presence_status || 'free',
    mode: profile?.app_mode || 'player',
    preferences: profile?.notification_preferences,
    onboardingCompleted: profile?.onboarding_completed ?? false,
    lastLogin: profile?.last_login_at || null,
    lastSignInMethod: profile?.last_sign_in_method || null,
    isAdmin,
  };
}

async function recordLogin(authUserId, method) {
  // Best-effort: stamp the profile without letting a DB hiccup block login.
  try {
    const changes = { last_login_at: new Date().toISOString() };
    if (method === 'email' || method === 'google') changes.last_sign_in_method = method;
    await requireSupabase()
      .from('profiles')
      .update(changes)
      .eq('id', authUserId);
  } catch (_) {
    // silent
  }
}

async function readCurrentUser(authUser) {
  if (!authUser) return null;
  const client = requireSupabase();
  const [{ data: profile, error: profileError }, { data: adminAccess, error: adminError }] = await Promise.all([
    client.from('profiles').select('*').eq('id', authUser.id).maybeSingle(),
    client.from('platform_admins').select('user_id').eq('user_id', authUser.id).maybeSingle(),
  ]);
  if (profileError) throw profileError;
  // Keep sign-in compatible during a rolling deploy before the admin migration
  // reaches the database; only a confirmed row grants admin behavior.
  return mapUser(authUser, profile, !adminError && Boolean(adminAccess));
}

function readAuthParams(url) {
  if (!url) return new URLSearchParams();
  const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const fragment = url.includes('#') ? url.split('#')[1] : '';
  return new URLSearchParams([query, fragment].filter(Boolean).join('&'));
}

async function restoreSessionFromUrl(url) {
  const client = requireSupabase();
  const params = readAuthParams(url);
  const errorDescription = params.get('error_description');
  if (errorDescription) throw new Error(errorDescription.replace(/\+/g, ' '));

  const code = params.get('code');
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
  } else {
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) throw error;
    }
  }
  return params.get('type') === 'recovery' || url.includes('reset-password');
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('');
  const [lastSignInMethod, setLastSignInMethod] = useState(null);
  const [rememberedEmail, setRememberedEmail] = useState('');
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authLinkError, setAuthLinkError] = useState('');

  useEffect(() => {
    if (!supabase) { setHydrated(true); return undefined; }
    let active = true;
    Promise.all([
      supabase.auth.getSession(),
      AsyncStorage.getItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => ''),
      AsyncStorage.getItem(LAST_SIGN_IN_METHOD_KEY).catch(() => null),
      AsyncStorage.getItem(REMEMBERED_EMAIL_KEY).catch(() => ''),
    ]).then(async ([{ data }, pendingEmail, storedSignInMethod, storedEmail]) => {
      if (!active) return;
      const localSignInMethod = storedSignInMethod === 'google' || storedSignInMethod === 'email' ? storedSignInMethod : null;
      if (data.session?.user) {
        setPendingVerificationEmail('');
        AsyncStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => {});
      } else {
        setPendingVerificationEmail(pendingEmail || '');
      }
      setRememberedEmail(storedEmail || '');
      const currentUser = await readCurrentUser(data.session?.user);
      setUser(currentUser);
      const syncedSignInMethod = currentUser?.lastSignInMethod === 'google' || currentUser?.lastSignInMethod === 'email'
        ? currentUser.lastSignInMethod
        : localSignInMethod;
      setLastSignInMethod(syncedSignInMethod);
      if (currentUser?.lastSignInMethod) {
        AsyncStorage.setItem(LAST_SIGN_IN_METHOD_KEY, currentUser.lastSignInMethod).catch(() => {});
      }
    }).catch(() => { if (active) setUser(null); }).finally(() => { if (active) setHydrated(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (session?.user) {
        setPendingVerificationEmail('');
        AsyncStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => {});
        // Record last login whenever a new session starts (covers token refresh
        // initiated sign-ins too, e.g. Google OAuth redirect).
        if (event === 'SIGNED_IN') {
          recordLogin(session.user.id);
        }
      }
      setTimeout(() => readCurrentUser(session?.user).then((value) => { if (active) setUser(value); }).catch(() => { if (active) setUser(null); }), 0);
    });
    const openUrl = ({ url }) => {
      if (url.includes('reset-password')) setPasswordRecovery(true);
      setAuthLinkError('');
      restoreSessionFromUrl(url)
        .then((isRecovery) => { if (active && isRecovery) setPasswordRecovery(true); })
        .catch((error) => { if (active) setAuthLinkError(error.message || 'This sign-in link is invalid or expired.'); });
    };
    const linkListener = Linking.addEventListener('url', openUrl);
    Linking.getInitialURL().then((url) => { if (url) openUrl({ url }); });
    return () => { active = false; listener.subscription.unsubscribe(); linkListener.remove(); };
  }, []);

  const rememberPendingVerification = async (email) => {
    setPendingVerificationEmail(email);
    await AsyncStorage.setItem(PENDING_VERIFICATION_EMAIL_KEY, email).catch(() => {});
  };

  const rememberSignInMethod = async (method) => {
    setLastSignInMethod(method);
    await AsyncStorage.setItem(LAST_SIGN_IN_METHOD_KEY, method).catch(() => {});
  };

  const updateRememberedEmail = async (email) => {
    const normalizedEmail = email.trim().toLowerCase();
    setRememberedEmail(normalizedEmail);
    if (normalizedEmail) await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, normalizedEmail).catch(() => {});
    else await AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY).catch(() => {});
  };

  const signIn = async ({ email, password, rememberMe = false }) => {
    const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
    await recordLogin(data.user.id, 'email');
    await rememberSignInMethod('email');
    await updateRememberedEmail(rememberMe ? email : '');
    setUser(await readCurrentUser(data.user));
  };

  const signUp = async ({ name, email, password }) => {
    const emailRedirectTo = Linking.createURL('verify-email');
    const { data, error } = await requireSupabase().auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name },
        emailRedirectTo,
      },
    });
    if (error) throw error;
    const needsEmailConfirmation = !data.session;
    if (needsEmailConfirmation) {
      await rememberPendingVerification(email);
    } else {
      setPendingVerificationEmail('');
      await AsyncStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => {});
      setUser(await readCurrentUser(data.user));
    }
    return { user: data.user, needsEmailConfirmation };
  };

  const resendSignupConfirmation = async (email) => {
    const { error } = await requireSupabase().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: Linking.createURL('verify-email') },
    });
    if (error) throw error;
  };

  const clearPendingVerification = async () => {
    setPendingVerificationEmail('');
    await AsyncStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => {});
  };

  const signInWithGoogle = async ({ idToken, accessToken }) => {
    if (!idToken) throw new Error('Google did not return an ID token. Check the OAuth client configuration.');
    const { data, error } = await requireSupabase().auth.signInWithIdToken({ provider: 'google', token: idToken, access_token: accessToken });
    if (error) throw error;
    // A verified Google session supersedes any unfinished password signup on
    // this device. Clear it explicitly instead of relying only on the async
    // auth-state listener, so the verification screen cannot linger or return.
    setPendingVerificationEmail('');
    await AsyncStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => {});
    await recordLogin(data.user.id, 'google');
    await rememberSignInMethod('google');
    setUser(await readCurrentUser(data.user));
  };

  const requestPasswordReset = async (email) => {
    const redirectTo = Linking.createURL('reset-password');
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  };

  const updatePassword = async (password) => {
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) throw error;
    setPasswordRecovery(false);
    setAuthLinkError('');
  };

  const completeOnboarding = async (profile) => {
    const client = requireSupabase();
    let authUser = (await client.auth.getUser()).data.user;
    if (!authUser && profile.idToken) {
      const { data, error } = await client.auth.signInWithIdToken({ provider: 'google', token: profile.idToken, access_token: profile.accessToken });
      if (error) throw error;
      authUser = data.user;
    }
    if (!authUser && profile.password) {
      const result = await signUp(profile);
      if (result.needsEmailConfirmation) throw new Error('Check your email to confirm your Peakle account, then log in.');
      authUser = result.user;
    }
    if (!authUser) throw new Error('Your account session is missing. Please log in again.');
    const { error } = await client.from('profiles').update({
      display_name: profile.name,
      avatar_url: profile.avatar || profile.picture || null,
      home_area: profile.location,
      skill_rating: null,
      play_preference: profile.preference,
      onboarding_completed: true,
    }).eq('id', authUser.id);
    if (error) throw error;
    setUser(await readCurrentUser(authUser));
  };

  const updateProfile = async (changes) => {
    const payload = {};
    if (changes.name !== undefined) payload.display_name = changes.name;
    if (changes.location !== undefined) payload.home_area = changes.location;
    if (changes.avatar !== undefined) payload.avatar_url = changes.avatar;
    if (changes.preference !== undefined) payload.play_preference = changes.preference;
    if (changes.presenceStatus !== undefined) payload.presence_status = changes.presenceStatus;
    if (changes.mode !== undefined) payload.app_mode = changes.mode;
    if (changes.preferences !== undefined) payload.notification_preferences = changes.preferences;
    const { error } = await requireSupabase().from('profiles').update(payload).eq('id', user.id);
    if (error) throw error;
    setUser((current) => ({ ...current, ...changes, ...(changes.avatar !== undefined ? { picture: changes.avatar } : {}) }));
  };

  const signOut = async () => {
    const client = requireSupabase();
    if (user?.id) {
      await client.from('player_presence').update({ availability: 'offline', updated_at: new Date().toISOString() }).eq('user_id', user.id).catch(() => {});
    }
    const { error } = await client.auth.signOut();
    if (error) throw error;
    setUser(null);
  };

  const value = useMemo(() => ({
    user,
    hydrated,
    configured: isSupabaseConfigured,
    pendingVerificationEmail,
    passwordRecovery,
    authLinkError,
    lastSignInMethod,
    rememberedEmail,
    signIn,
    signUp,
    rememberPendingVerification,
    resendSignupConfirmation,
    clearPendingVerification,
    signInWithGoogle,
    requestPasswordReset,
    updatePassword,
    completeOnboarding,
    updateProfile,
    signOut,
  }), [user, hydrated, pendingVerificationEmail, passwordRecovery, authLinkError, lastSignInMethod, rememberedEmail]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
