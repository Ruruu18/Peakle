import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { locationErrorMessage, useUserLocation } from '../context/LocationContext';
import { supabase } from '../lib/supabase';
import {
  cancelMatchInvite,
  getNearbyLiveMatch,
  handoffNearbyLiveScorer,
  leaveMatchInvite,
  listMatchInvites,
  listNearbyOnlinePlayers,
  publishPresence,
  removeMatchInvitee,
  respondToMatchInvite,
  sendMatchInvite,
  startNearbyLiveMatch,
  stopPresence,
  updateNearbyLiveMatch,
} from '../services/nearbyPlayers';
import { DEMO_MODE } from '../config/demoMode';
import { DEMO_NEARBY_PLAYERS } from '../config/demoData';

const REFRESH_MS = 20_000;
const PRESENCE_AVAILABILITY = { free: 'available', away: 'offline', in_play: 'busy' };

function friendlyError(error) {
  if (['LOCATION_SERVICES_DISABLED', 'LOCATION_PERMISSION_DENIED'].includes(error?.code)) {
    return locationErrorMessage(error);
  }
  if (error?.code === '42P01' || error?.code === 'PGRST202' || error?.code === 'PGRST205' || error?.message?.includes('schema cache')) {
    return 'Nearby player setup has not been installed on Supabase yet.';
  }
  return error?.message || 'Nearby players are unavailable right now.';
}

export default function useNearbyPlayers(radiusKm = 25) {
  const { user } = useAuth();
  const { userLocation, getCurrentCoordinates, useCurrentLocation } = useUserLocation();
  const [visible, setVisible] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [players, setPlayers] = useState([]);
  const [incomingInvites, setIncomingInvites] = useState([]);
  const [outgoingInvites, setOutgoingInvites] = useState([]);
  const [joinedInvite, setJoinedInvite] = useState(null);
  const [removedInvite, setRemovedInvite] = useState(null);
  const [sharedLiveMatch, setSharedLiveMatch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const visibleRef = useRef(false);
  const locationRef = useRef(userLocation);
  const appStateRef = useRef(AppState.currentState);
  const locationRequestRef = useRef(null);
  const locationPermissionCheckedRef = useRef(false);
  const storageKey = `@peakle/nearby-visible/${user?.id || 'guest'}`;

  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { locationRef.current = userLocation; }, [userLocation]);

  // Real "nearby" presence needs granted GPS permission, which a demo build
  // running in a simulator usually doesn't have. Show the canned roster
  // regardless, without touching the real visibility/location machinery.
  useEffect(() => {
    if (!DEMO_MODE) return undefined;
    visibleRef.current = true;
    setVisible(true);
    setPlayers(DEMO_NEARBY_PLAYERS);
    return undefined;
  }, []);

  const refreshInvites = useCallback(async () => {
    if (!user?.id) return;
    try {
      const result = await listMatchInvites();
      setIncomingInvites(result.incoming);
      setOutgoingInvites(result.outgoing);
      setJoinedInvite(result.joinedInvite);
      setRemovedInvite(result.removedInvite);
    } catch (nextError) {
      setError(friendlyError(nextError));
    }
  }, [user?.id]);

  const refreshPlayers = useCallback(async () => {
    const location = locationRef.current;
    if (!visibleRef.current || ![location?.latitude, location?.longitude].every(Number.isFinite)) {
      setPlayers([]);
      return;
    }
    try {
      setPlayers(await listNearbyOnlinePlayers(location, radiusKm));
      setError('');
    } catch (nextError) {
      setError(friendlyError(nextError));
    }
  }, [radiusKm]);

  const liveMatchId = joinedInvite?.live_match_id
    || outgoingInvites.find((invite) => invite.status === 'accepted' && invite.live_match_id)?.live_match_id
    || null;

  const refreshLiveMatch = useCallback(async (matchId = liveMatchId) => {
    if (!matchId) {
      setSharedLiveMatch(null);
      return null;
    }
    try {
      const session = await getNearbyLiveMatch(matchId);
      setSharedLiveMatch(session);
      return session;
    } catch (nextError) {
      setError(friendlyError(nextError));
      return null;
    }
  }, [liveMatchId]);

  const publish = useCallback(async (locationOverride) => {
    const location = locationOverride || locationRef.current;
    if (!visibleRef.current || ['inactive', 'background'].includes(appStateRef.current) || !user?.id) return false;
    if (![location?.latitude, location?.longitude].every(Number.isFinite)) return false;
    try {
      if (user.presenceStatus === 'away') {
        throw new Error('Your player status is Away. Change it to Active / free or In play before going visible.');
      }
      locationRef.current = location;
      await publishPresence(user.id, location, { visible: true, availability: PRESENCE_AVAILABILITY[user.presenceStatus] || 'available' });
      await refreshPlayers();
      return true;
    } catch (nextError) {
      setError(friendlyError(nextError));
      throw nextError;
    }
  }, [refreshPlayers, user?.id, user?.presenceStatus]);

  const publishFreshPresence = useCallback(async () => {
    if (locationRequestRef.current) return locationRequestRef.current;
    const request = (async () => {
      let location;
      let locationError;
      try {
        const requestPermission = !locationPermissionCheckedRef.current;
        locationPermissionCheckedRef.current = true;
        location = await getCurrentCoordinates({ requestPermission });
      } catch (nextError) {
        locationError = nextError;
        location = null;
      }
      if (!location) {
        if (['LOCATION_SERVICES_DISABLED', 'LOCATION_PERMISSION_DENIED'].includes(locationError?.code)) {
          setError(locationErrorMessage(locationError));
          return false;
        }
        const previous = locationRef.current;
        const isRecentGpsFix = previous?.source === 'gps'
          && Number.isFinite(previous.timestamp)
          && Date.now() - previous.timestamp < 2 * 60 * 1000;
        if (!isRecentGpsFix) {
          setError(locationErrorMessage(locationError));
          return false;
        }
        location = previous;
      }
      locationRef.current = location;
      return publish(location);
    })().finally(() => {
      locationRequestRef.current = null;
    });
    locationRequestRef.current = request;
    return request;
  }, [getCurrentCoordinates, publish]);

  useEffect(() => {
    let active = true;
    locationPermissionCheckedRef.current = false;
    setSettingsReady(false);
    AsyncStorage.getItem(storageKey).then((stored) => {
      if (!active) return;
      const nextVisible = stored === 'true';
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
    }).finally(() => { if (active) setSettingsReady(true); });
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!settingsReady) return;
    refreshInvites();
    if (visible) publishFreshPresence().catch(() => {});
    else setPlayers([]);
  }, [publishFreshPresence, refreshInvites, settingsReady, userLocation.latitude, userLocation.longitude, visible]);

  useEffect(() => {
    if (!settingsReady || !visible || user?.presenceStatus !== 'away') return;
    visibleRef.current = false;
    setVisible(false);
    setPlayers([]);
    AsyncStorage.setItem(storageKey, 'false').catch(() => {});
    stopPresence(user.id, { disable: true }).catch(() => {});
    setError('Your player status is Away. Change it to Active / free or In play before going visible.');
  }, [settingsReady, storageKey, user?.id, user?.presenceStatus, visible]);

  useEffect(() => {
    if (!settingsReady || !user?.id) return undefined;
    const timer = setInterval(() => {
      refreshInvites();
      if (liveMatchId) refreshLiveMatch(liveMatchId);
      if (visibleRef.current) publishFreshPresence().catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [liveMatchId, publishFreshPresence, refreshInvites, refreshLiveMatch, settingsReady, user?.id]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        refreshInvites();
        if (liveMatchId) refreshLiveMatch(liveMatchId);
        publishFreshPresence().catch(() => {});
      }
    });
    return () => listener.remove();
  }, [liveMatchId, publishFreshPresence, refreshInvites, refreshLiveMatch]);

  useEffect(() => {
    if (!supabase || !user?.id) return undefined;
    const channel = supabase.channel(`match-invites-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_invites' }, refreshInvites)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refreshInvites, user?.id]);

  useEffect(() => {
    refreshLiveMatch();
    if (!supabase || !liveMatchId) return undefined;
    const channel = supabase.channel(`nearby-live-match-${liveMatchId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'nearby_live_matches', filter: `id=eq.${liveMatchId}` }, () => refreshLiveMatch(liveMatchId))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [liveMatchId, refreshLiveMatch]);

  useEffect(() => () => {
    if (user?.id && visibleRef.current) stopPresence(user.id).catch(() => {});
  }, [user?.id]);

  const setDiscoveryVisible = useCallback(async (nextVisible) => {
    if (!user?.id) return false;
    setLoading(true);
    setError('');
    try {
      let location = locationRef.current;
      if (nextVisible) {
        location = await useCurrentLocation({ throwOnError: true });
        locationRef.current = location;
      }
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
      await AsyncStorage.setItem(storageKey, String(nextVisible));
      if (nextVisible) {
        const wasPublished = await publish(location);
        if (!wasPublished) throw new Error('Peakle could not start nearby-player visibility. Reopen the app and try again.');
      }
      else {
        setPlayers([]);
        await stopPresence(user.id, { disable: true });
      }
      return true;
    } catch (nextError) {
      visibleRef.current = false;
      setVisible(false);
      await AsyncStorage.setItem(storageKey, 'false').catch(() => {});
      setError(friendlyError(nextError));
      return false;
    } finally {
      setLoading(false);
    }
  }, [publish, storageKey, useCurrentLocation, user?.id]);

  const invite = useCallback(async (playerId, payload) => {
    setError('');
    try {
      const result = await sendMatchInvite(playerId, payload);
      await refreshInvites();
      return result;
    } catch (nextError) {
      setError(friendlyError(nextError));
      return null;
    }
  }, [refreshInvites]);

  const respond = useCallback(async (inviteId, accept) => {
    setError('');
    try {
      await respondToMatchInvite(inviteId, accept);
      await refreshInvites();
      return true;
    } catch (nextError) {
      setError(friendlyError(nextError));
      return false;
    }
  }, [refreshInvites]);

  const cancel = useCallback(async (inviteId) => {
    setError('');
    try {
      await cancelMatchInvite(inviteId);
      await refreshInvites();
    } catch (nextError) {
      setError(friendlyError(nextError));
    }
  }, [refreshInvites]);

  const leave = useCallback(async (inviteId) => {
    setError('');
    try {
      await leaveMatchInvite(inviteId);
      await refreshInvites();
      return true;
    } catch (nextError) {
      setError(friendlyError(nextError));
      return false;
    }
  }, [refreshInvites]);

  const remove = useCallback(async (inviteId) => {
    setError('');
    try {
      await removeMatchInvitee(inviteId);
      await refreshInvites();
      return true;
    } catch (nextError) {
      setError(friendlyError(nextError));
      return false;
    }
  }, [refreshInvites]);

  const startSharedMatch = useCallback(async ({ setupId, configuration, initialState, scorerId }) => {
    setError('');
    try {
      const created = await startNearbyLiveMatch({ setupId, configuration, initialState, scorerId });
      await refreshInvites();
      const session = await getNearbyLiveMatch(created.id);
      setSharedLiveMatch(session || created);
      return session || created;
    } catch (nextError) {
      setError(friendlyError(nextError));
      throw nextError;
    }
  }, [refreshInvites]);

  const syncSharedMatch = useCallback(async (matchId, expectedRevision, state, status = null) => {
    setError('');
    try {
      const changed = await updateNearbyLiveMatch(matchId, expectedRevision, state, status);
      setSharedLiveMatch((current) => ({ ...current, ...changed }));
      return changed;
    } catch (nextError) {
      setError(friendlyError(nextError));
      await refreshLiveMatch(matchId);
      throw nextError;
    }
  }, [refreshLiveMatch]);

  const handoffSharedScorer = useCallback(async (matchId, scorerId) => {
    setError('');
    try {
      const changed = await handoffNearbyLiveScorer(matchId, scorerId);
      await refreshLiveMatch(matchId);
      return changed;
    } catch (nextError) {
      setError(friendlyError(nextError));
      throw nextError;
    }
  }, [refreshLiveMatch]);

  return {
    visible,
    loading,
    error,
    players,
    incomingInvites,
    outgoingInvites,
    joinedInvite,
    removedInvite,
    sharedLiveMatch,
    setDiscoveryVisible,
    invite,
    respond,
    cancel,
    leave,
    remove,
    startSharedMatch,
    syncSharedMatch,
    handoffSharedScorer,
    refreshLiveMatch,
    refresh: () => Promise.all([refreshPlayers(), refreshInvites()]),
  };
}
