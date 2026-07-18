import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useUserLocation } from '../context/LocationContext';
import { supabase } from '../lib/supabase';
import {
  cancelMatchInvite,
  listMatchInvites,
  listNearbyOnlinePlayers,
  publishPresence,
  respondToMatchInvite,
  sendMatchInvite,
  stopPresence,
} from '../services/nearbyPlayers';

const REFRESH_MS = 20_000;
const PRESENCE_AVAILABILITY = { free: 'available', away: 'offline', in_play: 'busy' };

function friendlyError(error) {
  if (error?.code === '42P01' || error?.code === 'PGRST202' || error?.code === 'PGRST205' || error?.message?.includes('schema cache')) {
    return 'Nearby player setup has not been installed on Supabase yet.';
  }
  return error?.message || 'Nearby players are unavailable right now.';
}

export default function useNearbyPlayers(radiusKm = 25) {
  const { user } = useAuth();
  const { userLocation, useCurrentLocation } = useUserLocation();
  const [visible, setVisible] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [players, setPlayers] = useState([]);
  const [incomingInvites, setIncomingInvites] = useState([]);
  const [outgoingInvites, setOutgoingInvites] = useState([]);
  const [joinedInvite, setJoinedInvite] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const visibleRef = useRef(false);
  const locationRef = useRef(userLocation);
  const appStateRef = useRef(AppState.currentState);
  const storageKey = `@peakle/nearby-visible/${user?.id || 'guest'}`;

  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { locationRef.current = userLocation; }, [userLocation]);

  const refreshInvites = useCallback(async () => {
    if (!user?.id) return;
    try {
      const result = await listMatchInvites();
      setIncomingInvites(result.incoming);
      setOutgoingInvites(result.outgoing);
      setJoinedInvite(result.joinedInvite);
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

  const publish = useCallback(async (locationOverride) => {
    const location = locationOverride || locationRef.current;
    if (!visibleRef.current || ['inactive', 'background'].includes(appStateRef.current) || !user?.id) return false;
    if (![location?.latitude, location?.longitude].every(Number.isFinite)) return false;
    try {
      locationRef.current = location;
      await publishPresence(user.id, location, { visible: true, availability: PRESENCE_AVAILABILITY[user.presenceStatus] || 'available' });
      await refreshPlayers();
      return true;
    } catch (nextError) {
      setError(friendlyError(nextError));
      throw nextError;
    }
  }, [refreshPlayers, user?.id, user?.presenceStatus]);

  useEffect(() => {
    let active = true;
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
    if (visible) publish().catch(() => {});
    else setPlayers([]);
  }, [publish, refreshInvites, settingsReady, userLocation.latitude, userLocation.longitude, visible]);

  useEffect(() => {
    if (!settingsReady || !user?.id) return undefined;
    const timer = setInterval(() => {
      refreshInvites();
      if (visibleRef.current) publish().catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [publish, refreshInvites, settingsReady, user?.id]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (nextState) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;
      if (nextState === 'active') {
        refreshInvites();
        publish().catch(() => {});
      } else if (wasActive && user?.id && visibleRef.current) {
        stopPresence(user.id).catch(() => {});
      }
    });
    return () => listener.remove();
  }, [publish, refreshInvites, user?.id]);

  useEffect(() => {
    if (!supabase || !user?.id) return undefined;
    const channel = supabase.channel(`match-invites-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_invites' }, refreshInvites)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refreshInvites, user?.id]);

  useEffect(() => () => {
    if (user?.id && visibleRef.current) stopPresence(user.id).catch(() => {});
  }, [user?.id]);

  const setDiscoveryVisible = useCallback(async (nextVisible) => {
    if (!user?.id) return false;
    setLoading(true);
    setError('');
    try {
      let location = locationRef.current;
      if (nextVisible && ![location?.latitude, location?.longitude].every(Number.isFinite)) {
        location = await useCurrentLocation();
        if (!location) return false;
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
    } catch (nextError) {
      setError(friendlyError(nextError));
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

  return {
    visible,
    loading,
    error,
    players,
    incomingInvites,
    outgoingInvites,
    joinedInvite,
    setDiscoveryVisible,
    invite,
    respond,
    cancel,
    refresh: () => Promise.all([refreshPlayers(), refreshInvites()]),
  };
}
