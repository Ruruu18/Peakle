import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking, Platform } from 'react-native';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { isSupabaseConfigured, requireSupabase, supabase } from '../lib/supabase';
import { readCachedData, withTimeout, writeCachedData } from '../lib/asyncData';
import { DEMO_MODE } from '../config/demoMode';
import { cleanAuthUrl, readAuthParams } from '../lib/authLinks';
import { isAccountAccessError } from '../lib/accountAccess';
import { DEMO_USER } from '../config/demoData';
import { disablePushToken } from '../services/realtimeOperations';
import { deleteManagedProfilePhoto, isLocalPhotoUri, normalizeProfilePhoto, uploadProfilePhoto } from '../services/profilePhotos';
import {
  BOOKING_VENUES_CACHE_KEY,
  HOME_VENUES_CACHE_KEY,
  bookingsCacheKey,
  homeDashboardCacheKey,
  openPlaySessionsCacheKey,
  profileScreenCacheKey,
  teamScreenCacheKey,
} from '../lib/cacheKeys';

const AuthContext = createContext(null);
const PENDING_VERIFICATION_EMAIL_KEY = '@peakle/pending-verification-email';
const LAST_SIGN_IN_METHOD_KEY = '@peakle/last-sign-in-method';
const REMEMBERED_EMAIL_KEY = '@peakle/remembered-email';
const ONBOARDING_SAVE_TIMEOUT_MS = 15000;
const AUTH_STARTUP_TIMEOUT_MS = 8000;
const userCacheKey = (userId) => `@peakle/cache/auth-user/${userId}`;

export function mapUser(authUser, profile, isAdmin = false) {
  if (!authUser) return null;
  const metadata = authUser.user_metadata || {};
  return {
    id: authUser.id,
    email: authUser.email,
    name: profile?.display_name || metadata.display_name || metadata.full_name || authUser.email?.split('@')[0] || 'Peakle Player',
    picture: normalizeProfilePhoto(profile?.avatar_url || metadata.avatar_url || metadata.picture),
    location: profile?.home_area || '',
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
    await withTimeout(
      requireSupabase().from('profiles').update(changes).eq('id', authUserId),
      5000,
      'Login activity update timed out.',
    );
  } catch (_) {
    // silent
  }
}

export async function readCurrentUser(authUser) {
  if (!authUser) return null;
  const client = requireSupabase();
  const [{ data: profile, error: profileError }, { data: adminAccess, error: adminError }] = await Promise.all([
    client.rpc('get_my_profile').maybeSingle(),
    client.from('platform_admins').select('user_id').eq('user_id', authUser.id).maybeSingle(),
  ]);
  if (profileError) throw profileError;
  // Keep sign-in compatible during a rolling deploy before the admin migration
  // reaches the database; only a confirmed row grants admin behavior.
  return mapUser(authUser, profile, !adminError && Boolean(adminAccess));
}

export async function restoreSessionFromUrl(url) {
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

export async function getExpoGoOAuthRedirectUrl() {
  const generatedUrl = makeRedirectUri({ path: 'oauth/callback' });
  const launchUrl = await Linking.getInitialURL().catch(() => null);
  if (!launchUrl?.startsWith('exp://')) return generatedUrl;

  // Build the callback from the URL that actually opened Expo Go. This avoids
  // returning a physical phone to Metro's unusable exp://localhost address.
  const launchBase = launchUrl
    .split('/--/')[0]
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
  return `${launchBase}/--/oauth/callback`;
}

export function AuthProvider({ children }) {
  const authGeneration = useRef(0);
  const [user, setUser] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('');
  const [lastSignInMethod, setLastSignInMethod] = useState(null);
  const [rememberedEmail, setRememberedEmail] = useState('');
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authLinkError, setAuthLinkError] = useState('');

  const handleAccessRevocation = (error) => {
    if (!isAccountAccessError(error)) return;
    ++authGeneration.current;
    setUser(null);
    setPasswordRecovery(false);
    setHydrated(true);
    setAuthLinkError('Your account access has been suspended or this session was revoked. Sign in again or contact support@peakle.app.');
    // Clear this browser/device only. A revoked session must not remain visible
    // as a cached authenticated profile while requests are denied by the server.
    void supabase?.auth.signOut({ scope: 'local' }).catch(() => {});
  };

  useEffect(() => {
    if (!supabase) { setHydrated(true); return undefined; }
    let active = true;
    const startupGeneration = authGeneration.current;
    Promise.all([
      withTimeout(supabase.auth.getSession(), 6000, 'Session restore timed out.'),
      AsyncStorage.getItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => ''),
      AsyncStorage.getItem(LAST_SIGN_IN_METHOD_KEY).catch(() => null),
      AsyncStorage.getItem(REMEMBERED_EMAIL_KEY).catch(() => ''),
    ]).then(async ([{ data }, pendingEmail, storedSignInMethod, storedEmail]) => {
      if (!active || authGeneration.current !== startupGeneration) return;
      const authUser = data.session?.user;
      const localSignInMethod = storedSignInMethod === 'google' || storedSignInMethod === 'email' ? storedSignInMethod : null;
      if (authUser) {
        setPendingVerificationEmail('');
        AsyncStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => {});
      } else {
        setPendingVerificationEmail(pendingEmail || '');
      }
      setRememberedEmail(storedEmail || '');
      const [cachedUser] = authUser ? await Promise.all([
        readCachedData(userCacheKey(authUser.id)),
        readCachedData(teamScreenCacheKey(authUser.id)),
        readCachedData(profileScreenCacheKey(authUser.id)),
        readCachedData(homeDashboardCacheKey(authUser.id)),
        readCachedData(HOME_VENUES_CACHE_KEY),
        readCachedData(BOOKING_VENUES_CACHE_KEY),
        readCachedData(bookingsCacheKey(authUser.id)),
        readCachedData(openPlaySessionsCacheKey(authUser.id)),
      ]) : [null];
      const hasCachedUser = cachedUser?.id === authUser?.id;
      const provisionalUser = authUser
        ? { ...mapUser(authUser), ...(hasCachedUser ? cachedUser : {}), id: authUser.id, email: authUser.email }
        : null;
      if (!active || authGeneration.current !== startupGeneration) return;
      // An uncached provisional user has no onboarding state yet; keep the launch
      // screen up until the real profile loads so onboarding never flashes.
      if (!authUser || hasCachedUser) {
        setUser(provisionalUser);
        setHydrated(true);
      }
      const syncedSignInMethod = provisionalUser?.lastSignInMethod === 'google' || provisionalUser?.lastSignInMethod === 'email'
        ? provisionalUser.lastSignInMethod
        : localSignInMethod;
      setLastSignInMethod(syncedSignInMethod);
      if (provisionalUser?.lastSignInMethod) {
        AsyncStorage.setItem(LAST_SIGN_IN_METHOD_KEY, provisionalUser.lastSignInMethod).catch(() => {});
      }
      if (authUser) {
        try {
          const currentUser = await withTimeout(
            readCurrentUser(authUser),
            AUTH_STARTUP_TIMEOUT_MS,
            'Profile refresh timed out.',
          );
          if (!active || authGeneration.current !== startupGeneration) return;
          setUser(currentUser);
          writeCachedData(userCacheKey(authUser.id), currentUser);
          if (currentUser?.lastSignInMethod) {
            setLastSignInMethod(currentUser.lastSignInMethod);
            AsyncStorage.setItem(LAST_SIGN_IN_METHOD_KEY, currentUser.lastSignInMethod).catch(() => {});
          }
        } catch (error) {
          if (active && authGeneration.current === startupGeneration) {
            handleAccessRevocation(error);
            // Keep the authenticated cached profile visible while the database reconnects.
            if (!isAccountAccessError(error)) setUser((current) => current || provisionalUser);
          }
        } finally {
          if (active && authGeneration.current === startupGeneration) setHydrated(true);
        }
      }
    }).catch(() => { if (active) setHydrated(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const eventGeneration = ++authGeneration.current;
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
      if (!session?.user) {
        setUser(null);
        setHydrated(true);
        return;
      }
      setTimeout(async () => {
        const authUser = session.user;
        const cachedUser = await readCachedData(userCacheKey(authUser.id));
        if (!active || authGeneration.current !== eventGeneration) return;
        const hasCachedUser = cachedUser?.id === authUser.id;
        const provisionalUser = { ...mapUser(authUser), ...(hasCachedUser ? cachedUser : {}), id: authUser.id, email: authUser.email };
        // Without a cached profile the provisional user has no onboarding state yet
        // (mapUser defaults it to false). Showing it would flash the onboarding
        // screen for existing accounts, so wait for the real profile instead.
        if (hasCachedUser) {
          setUser((current) => (current?.id === authUser.id ? current : provisionalUser));
          setHydrated(true);
        }
        try {
          const value = await withTimeout(readCurrentUser(authUser), AUTH_STARTUP_TIMEOUT_MS, 'Profile refresh timed out.');
          if (!active || authGeneration.current !== eventGeneration) return;
          setUser(value);
          writeCachedData(userCacheKey(authUser.id), value);
        } catch (error) {
          if (active && authGeneration.current === eventGeneration) {
            handleAccessRevocation(error);
            // A temporary fetch failure must not turn an authenticated user into a guest.
            if (!isAccountAccessError(error)) setUser((current) => (current?.id === authUser.id ? current : provisionalUser));
          }
        } finally {
          if (active && authGeneration.current === eventGeneration) setHydrated(true);
        }
      }, 0);
    });
    const openUrl = ({ url }) => {
      if (url.includes('reset-password')) setPasswordRecovery(true);
      setAuthLinkError('');
      restoreSessionFromUrl(url)
        .then((isRecovery) => { if (active && isRecovery) setPasswordRecovery(true); })
        .catch((error) => { if (active) setAuthLinkError(error.message || 'This sign-in link is invalid or expired.'); })
        .finally(() => {
          if (Platform.OS === 'web' && active) window.history.replaceState(window.history.state, '', cleanAuthUrl(url));
        });
    };
    const linkListener = Linking.addEventListener('url', openUrl);
    Linking.getInitialURL().then((url) => { if (url) openUrl({ url }); });
    return () => { active = false; listener.subscription.unsubscribe(); linkListener.remove(); };
  }, []);

  useEffect(() => {
    const userId = user?.id;
    if (!supabase || !userId) return undefined;
    let active = true;
    let syncing = false;
    const syncProfile = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          if (active) handleAccessRevocation(error);
          return;
        }
        if (!data.user || data.user.id !== userId) return;
        const nextUser = await readCurrentUser(data.user);
        if (!active || !nextUser) return;
        setUser(nextUser);
        writeCachedData(userCacheKey(userId), nextUser);
      } catch (error) {
        if (active) handleAccessRevocation(error);
        // Keep the last usable profile while another device or the network reconnects.
      } finally {
        syncing = false;
      }
    };
    const channel = supabase.channel(`profile-sync-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, syncProfile)
      .subscribe();
    const appState = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') syncProfile();
    });
    syncProfile();
    return () => {
      active = false;
      appState.remove();
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

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
    const emailRedirectTo = makeRedirectUri({ scheme: 'peakle', path: 'verify-email' });
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
      options: { emailRedirectTo: makeRedirectUri({ scheme: 'peakle', path: 'verify-email' }) },
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

  // Expo Go cannot present itself as Peakle's registered native Google client.
  // Route that environment through Supabase's approved HTTPS OAuth callback,
  // then restore the returned Supabase session from the Expo deep link.
  const signInWithGoogleOAuth = async () => {
    const client = requireSupabase();
    if (Platform.OS === 'web') {
      // Redirect in this tab so Safari does not depend on a popup or a second
      // browser's PKCE verifier. The normal startup handler restores the session.
      await rememberSignInMethod('google');
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/oauth/callback`, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Google sign-in could not be started.');
      window.location.assign(data.url);
      return { cancelled: false };
    }
    const redirectTo = await getExpoGoOAuthRedirectUrl();
    if (__DEV__) console.info(`[Peakle Google OAuth] Add this Supabase redirect URL: ${redirectTo}`);
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error('Google sign-in could not be started.');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) return { cancelled: true };

    await restoreSessionFromUrl(result.url);
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const authUser = sessionData.session?.user;
    if (!authUser) throw new Error('Google sign-in completed without an account session.');

    setPendingVerificationEmail('');
    await AsyncStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY).catch(() => {});
    await recordLogin(authUser.id, 'google');
    await rememberSignInMethod('google');
    setUser(await readCurrentUser(authUser));
    return { cancelled: false };
  };

  const requestPasswordReset = async (email) => {
    const redirectTo = makeRedirectUri({ scheme: 'peakle', path: 'reset-password' });
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
    const authResult = await withTimeout(
      client.auth.getUser(),
      ONBOARDING_SAVE_TIMEOUT_MS,
      'Peakle could not verify your session. Check your connection and try again.',
    );
    if (authResult.error) throw authResult.error;
    let authUser = authResult.data.user;
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
    const selectedAvatar = normalizeProfilePhoto(profile.avatar !== undefined ? profile.avatar : profile.picture);
    const savedAvatar = isLocalPhotoUri(selectedAvatar)
      ? await uploadProfilePhoto(authUser.id, selectedAvatar)
      : selectedAvatar || null;
    const profilePayload = {
      id: authUser.id,
      display_name: profile.name,
      avatar_url: savedAvatar,
      home_area: profile.location,
      skill_rating: null,
      play_preference: profile.preference,
      onboarding_completed: true,
    };
    const { error } = await withTimeout(
      client.from('profiles').upsert(profilePayload, { onConflict: 'id' }),
      ONBOARDING_SAVE_TIMEOUT_MS,
      'Profile setup timed out. Check your connection and try again.',
    );
    if (error) throw error;
    const { data: savedProfile, error: savedProfileError } = await withTimeout(
      client.rpc('get_my_profile').maybeSingle(),
      ONBOARDING_SAVE_TIMEOUT_MS,
      'Profile setup timed out. Check your connection and try again.',
    );
    if (savedProfileError) throw savedProfileError;
    if (!savedProfile?.onboarding_completed) {
      throw new Error('Your profile was not saved. Please try again.');
    }
    const currentUser = await withTimeout(
      readCurrentUser(authUser),
      ONBOARDING_SAVE_TIMEOUT_MS,
      'Your profile was saved, but Peakle could not finish loading. Reopen the app and log in again.',
    );
    if (!currentUser?.onboardingCompleted) {
      throw new Error('Your profile setup could not be verified. Please try again.');
    }
    setUser(currentUser);
    writeCachedData(userCacheKey(authUser.id), currentUser);
  };

  const updateProfile = async (changes) => {
    const previousAvatar = user?.picture || null;
    const nextChanges = { ...changes };
    let uploadedAvatar = null;
    if (isLocalPhotoUri(changes.avatar)) {
      uploadedAvatar = await uploadProfilePhoto(user.id, changes.avatar);
      nextChanges.avatar = uploadedAvatar;
    }
    const payload = {};
    if (nextChanges.name !== undefined) payload.display_name = nextChanges.name;
    if (nextChanges.location !== undefined) payload.home_area = nextChanges.location;
    if (nextChanges.avatar !== undefined) payload.avatar_url = nextChanges.avatar || null;
    if (nextChanges.preference !== undefined) payload.play_preference = nextChanges.preference;
    if (nextChanges.presenceStatus !== undefined) payload.presence_status = nextChanges.presenceStatus;
    if (nextChanges.mode !== undefined) payload.app_mode = nextChanges.mode;
    if (nextChanges.preferences !== undefined) payload.notification_preferences = nextChanges.preferences;
    const { error } = await requireSupabase().from('profiles').update(payload).eq('id', user.id);
    if (error) {
      if (uploadedAvatar) deleteManagedProfilePhoto(uploadedAvatar).catch(() => {});
      throw error;
    }
    if (nextChanges.avatar !== undefined) nextChanges.avatar = normalizeProfilePhoto(payload.avatar_url);
    setUser((current) => {
      const nextUser = { ...current, ...nextChanges, ...(nextChanges.avatar !== undefined ? { picture: nextChanges.avatar || null } : {}) };
      writeCachedData(userCacheKey(user.id), nextUser);
      return nextUser;
    });
    if (nextChanges.avatar !== undefined && previousAvatar && previousAvatar !== nextChanges.avatar) {
      deleteManagedProfilePhoto(previousAvatar).catch(() => {});
    }
    return nextChanges;
  };

  const signOut = async () => {
    const client = requireSupabase();
    if (user?.id) {
      await Promise.all([
        client.from('player_presence').update({ availability: 'offline', updated_at: new Date().toISOString() }).eq('user_id', user.id).then(() => {}, () => {}),
        disablePushToken(user.id).catch(() => {}),
      ]);
    }
    const { error } = await client.auth.signOut();
    if (error) throw error;
    setUser(null);
  };

  const deleteAccount = async () => {
    const client = requireSupabase();
    if (!user?.id) throw new Error('Sign in before deleting your account.');

    await Promise.all([
      client.from('player_presence').update({ availability: 'offline', updated_at: new Date().toISOString() }).eq('user_id', user.id).then(() => {}, () => {}),
      disablePushToken(user.id).catch(() => {}),
    ]);

    const { data, error } = await client.functions.invoke('delete-account');
    if (error) throw new Error(error.message || 'Peakle could not delete your account. Please try again.');
    if (!data?.deleted) throw new Error(data?.error || 'Peakle could not confirm account deletion.');

    authGeneration.current += 1;
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    await AsyncStorage.clear().catch(() => {});
    setPendingVerificationEmail('');
    setRememberedEmail('');
    setLastSignInMethod(null);
    setUser(null);
  };

  const value = useMemo(() => (DEMO_MODE ? {
    user: DEMO_USER,
    hydrated: true,
    configured: true,
    pendingVerificationEmail: '',
    passwordRecovery: false,
    authLinkError: '',
    lastSignInMethod: 'email',
    rememberedEmail: '',
    signIn: async () => {},
    signUp: async () => ({ user: DEMO_USER, needsEmailConfirmation: false }),
    rememberPendingVerification: async () => {},
    resendSignupConfirmation: async () => {},
    clearPendingVerification: async () => {},
    signInWithGoogle: async () => {},
    signInWithGoogleOAuth: async () => ({ cancelled: true }),
    requestPasswordReset: async () => {},
    updatePassword: async () => {},
    completeOnboarding: async () => {},
    updateProfile: async () => ({}),
    signOut: async () => {},
    deleteAccount: async () => { throw new Error('Account deletion is unavailable in demo mode.'); },
  } : {
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
    signInWithGoogleOAuth,
    requestPasswordReset,
    updatePassword,
    completeOnboarding,
    updateProfile,
    signOut,
    deleteAccount,
  }), [user, hydrated, pendingVerificationEmail, passwordRecovery, authLinkError, lastSignInMethod, rememberedEmail]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
