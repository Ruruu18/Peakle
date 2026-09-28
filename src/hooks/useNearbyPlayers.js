import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { locationErrorMessage, useUserLocation } from '../context/LocationContext';
import { supabase } from '../lib/supabase';
import {
  cancelMatchInvite,
  getActiveNearbyLiveMatchId,
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
  takeOverNearbyLiveScorer,
  touchNearbyLiveScorer,
  updateNearbyLiveMatch,
} from '../services/nearbyPlayers';
import { DEMO_MODE } from '../config/demoMode';
import { DEMO_NEARBY_PLAYERS } from '../config/demoData';

const REFRESH_MS = 20_000;
const LIVE_MATCH_REFRESH_MS = 3_000;
// Must stay well under the 45 second silence take_over_nearby_live_scorer requires.
const SCORER_CHECK_IN_MS = 20_000;
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
  const sharedLiveMatchRef = useRef(null);
  const liveMatchIdRef = useRef(null);
  const [trackedLiveMatchId, setTrackedLiveMatchId] = useState(null);
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

  const inviteLiveMatchId = joinedInvite?.live_match_id
    || outgoingInvites.find((invite) => invite.status === 'accepted' && invite.live_match_id)?.live_match_id
    || null;
  // Invites drop out of the history window long before a match ends. Keep
  // following a session once it is known so a player who backgrounded the
  // app still receives the other player's "match ended" update.
  const liveMatchId = inviteLiveMatchId || trackedLiveMatchId;
  liveMatchIdRef.current = liveMatchId;

  useEffect(() => {
    if (inviteLiveMatchId) setTrackedLiveMatchId(inviteLiveMatchId);
  }, [inviteLiveMatchId]);

  const recoverActiveLiveMatch = useCallback(async () => {
    if (!user?.id || DEMO_MODE) return;
    try {
      const activeId = await getActiveNearbyLiveMatchId();
      if (activeId) setTrackedLiveMatchId(activeId);
    } catch {
      // Recovery is best effort; invite-linked sessions still resolve normally.
    }
  }, [user?.id]);

  useEffect(() => { recoverActiveLiveMatch(); }, [recoverActiveLiveMatch]);

  // Realtime, polling and score writes can finish out of order. Never replace
  // an ended session with an older live score, or a new match with an old one.
  const applyLiveMatch = useCallback((session) => {
    if (!session || session.id !== liveMatchIdRef.current) return null;
    const current = sharedLiveMatchRef.current;
    if (current?.id === session.id && Number(session.revision) < Number(current.revision)) return current;
    const next = current?.id === session.id ? { ...current, ...session } : session;
    sharedLiveMatchRef.current = next;
    setSharedLiveMatch(next);
    return next;
  }, []);

  const refreshLiveMatch = useCallback(async (matchId = liveMatchIdRef.current) => {
    if (!matchId) {
      sharedLiveMatchRef.current = null;
      setSharedLiveMatch(null);
      return null;
    }
    try {
      const session = await getNearbyLiveMatch(matchId);
      return applyLiveMatch(session);
    } catch (nextError) {
      setError(friendlyError(nextError));
      return null;
    }
  }, [applyLiveMatch]);

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
      // A rematch can reuse this session ID. Keep a slower recovery check even
      // after the fast live polling stops at the final result.
      if (['completed', 'ended'].includes(sharedLiveMatchRef.current?.status)) refreshLiveMatch();
      if (visibleRef.current) publishFreshPresence().catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [publishFreshPresence, refreshInvites, refreshLiveMatch, settingsReady, user?.id]);

  // Keep active matches responsive even when the realtime socket misses an
  // update. Presence and player discovery can keep their slower refresh rate.
  const liveMatchFinished = ['completed', 'ended'].includes(sharedLiveMatch?.status);
  useEffect(() => {
    if (!liveMatchId || liveMatchFinished || !user?.id) return undefined;
    const timer = setInterval(() => {
      if (!['inactive', 'background'].includes(appStateRef.current)) refreshLiveMatch(liveMatchId);
    }, LIVE_MATCH_REFRESH_MS);
    return () => clearInterval(timer);
  }, [liveMatchId, liveMatchFinished, refreshLiveMatch, user?.id]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        refreshInvites();
        if (liveMatchId) refreshLiveMatch(liveMatchId);
        else recoverActiveLiveMatch();
        publishFreshPresence().catch(() => {});
      }
    });
    return () => listener.remove();
  }, [liveMatchId, publishFreshPresence, recoverActiveLiveMatch, refreshInvites, refreshLiveMatch]);

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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'nearby_live_matches', filter: `id=eq.${liveMatchId}` }, ({ new: session }) => {
        applyLiveMatch(session);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refreshLiveMatch(liveMatchId);
      });
    return () => { supabase.removeChannel(channel); };
  }, [applyLiveMatch, liveMatchId, refreshLiveMatch]);

  // While this device holds the scoring controls, check in so teammates only get
  // the take-over option when the scorer's phone has actually gone quiet.
  const scoringMatchId = sharedLiveMatch?.scorer_id === user?.id && ['live', 'paused'].includes(sharedLiveMatch?.status) ? sharedLiveMatch.id : null;
  useEffect(() => {
    if (!scoringMatchId || DEMO_MODE) return undefined;
    const checkIn = () => { touchNearbyLiveScorer(scoringMatchId).catch(() => {}); };
    checkIn();
    const timer = setInterval(checkIn, SCORER_CHECK_IN_MS);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') checkIn(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [scoringMatchId]);

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
      liveMatchIdRef.current = created.id;
      setTrackedLiveMatchId(created.id);
      applyLiveMatch(created);
      await refreshInvites();
      return await refreshLiveMatch(created.id) || created;
    } catch (nextError) {
      setError(friendlyError(nextError));
      throw nextError;
    }
  }, [applyLiveMatch, refreshInvites, refreshLiveMatch]);

  const syncSharedMatch = useCallback(async (matchId, expectedRevision, state, status = null) => {
    setError('');
    try {
      const changed = await updateNearbyLiveMatch(matchId, expectedRevision, state, status);
      return applyLiveMatch(changed) || changed;
    } catch (nextError) {
      setError(friendlyError(nextError));
      await refreshLiveMatch(matchId);
      throw nextError;
    }
  }, [applyLiveMatch, refreshLiveMatch]);

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

  const takeOverSharedScorer = useCallback(async (matchId) => {
    setError('');
    try {
      const changed = await takeOverNearbyLiveScorer(matchId);
      await refreshLiveMatch(matchId);
      return changed;
    } catch (nextError) {
      setError(friendlyError(nextError));
      await refreshLiveMatch(matchId);
      throw nextError;
    }
  }, [refreshLiveMatch]);

  // Release the joined-match UI as soon as this device sees the end, including
  // when an older invite refresh still says the invitation is accepted.
  const activeOutgoingInvites = useMemo(() => outgoingInvites.filter((invite) =>
    !liveMatchFinished || invite.live_match_id !== sharedLiveMatch.id), [outgoingInvites, liveMatchFinished, sharedLiveMatch?.id]);
  const activeJoinedInvite = liveMatchFinished && joinedInvite?.live_match_id === sharedLiveMatch.id ? null : joinedInvite;

  return {
    visible,
    loading,
    error,
    players,
    incomingInvites,
    outgoingInvites: activeOutgoingInvites,
    joinedInvite: activeJoinedInvite,
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
    takeOverSharedScorer,
    refreshLiveMatch,
    refresh: () => Promise.all([refreshPlayers(), refreshInvites()]),
  };
}
