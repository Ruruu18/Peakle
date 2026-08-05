import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import { completeOpenPlay, loadActiveOpenPlay, syncOpenPlay } from '../services/database';
import { listOrganizerOpenPlayRegistrations } from '../services/openPlayRegistration';
import { useOperations } from './OperationsContext';

const OpenPlaySessionContext = createContext(null);

export function OpenPlaySessionProvider({ children }) {
  const { user } = useAuth();
  const { pendingOperations, reportRealtime } = useOperations();
  const [screen, setScreen] = useState('setup');
  const [session, setSession] = useState(null);
  const [courtId, setCourtId] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const restoredFor = useRef(null);
  const endingSession = useRef(false);
  const syncInFlight = useRef(Promise.resolve());
  const [dataReady, setDataReady] = useState(false);
  const cacheKey = user?.id ? `@peakle/open-play-cache/${user.id}` : null;

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured || restoredFor.current === user.id) return;
    restoredFor.current = user.id;
    setDataReady(false);
    AsyncStorage.getItem(`@peakle/open-play-cache/${user.id}`).then((cached) => {
      if (!cached) return;
      try {
        const saved = JSON.parse(cached);
        if (saved?.id) { setScreen('dashboard'); setSession(saved); setCourtId(null); }
      } catch {}
    }).then(() => loadActiveOpenPlay()).then((saved) => {
      if (saved) {
        setScreen('dashboard'); setSession(saved); setCourtId(null);
        return;
      }
      setScreen('setup'); setSession(null); setCourtId(null);
      AsyncStorage.removeItem(`@peakle/open-play-cache/${user.id}`).catch(() => {});
    }).catch(() => {}).finally(() => setDataReady(true));
  }, [user?.id]);

  useEffect(() => {
    if (!cacheKey) return;
    if (session) AsyncStorage.setItem(cacheKey, JSON.stringify(session)).catch(() => {});
    else AsyncStorage.removeItem(cacheKey).catch(() => {});
  }, [cacheKey, session]);

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured || !dataReady || !session || screen === 'setup' || screen === 'summary' || pendingOperations > 0 || restoredFor.current !== user.id) return undefined;
    const timer = setTimeout(() => {
      syncInFlight.current = syncInFlight.current
        .then(() => endingSession.current ? undefined : syncOpenPlay(session))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [user?.id, screen, session, courtId, dataReady, pendingOperations]);

  const refreshRegistrations = useCallback(async () => {
    if (!session?.id) { setRegistrations([]); return []; }
    const rows = await listOrganizerOpenPlayRegistrations(session.id);
    setRegistrations(rows);
    const checkedIn = rows.filter((row) => row.status === 'approved' && row.checkedInAt && !row.departedAt);
    setSession((current) => {
      if (!current || current.id !== session.id) return current;
      const byId = new Map(checkedIn.map((row) => [row.id, row]));
      const existing = new Set(current.players.map((player) => player.id));
      const mapRow = (row, previous = {}) => ({ ...previous, id: row.id, userId: row.userId, name: row.name, avatar: row.avatar, skill: row.skill, registrationStatus: row.status, checkedInAt: row.checkedInAt, departedAt: row.departedAt, waitingSince: row.waitingSince, consecutiveGames: row.consecutiveGames, lastMatchEndedAt: row.lastMatchEndedAt, playPreference: row.playPreference, priorityBoost: row.priorityBoost, status: row.playStatus, gamesPlayed: row.gamesPlayed });
      const additions = checkedIn.filter((row) => !existing.has(row.id)).map((row) => mapRow(row));
      const nextPlayers = [...current.players.map((player) => byId.has(player.id) ? mapRow(byId.get(player.id), player) : player), ...additions];
      const databaseQueue = checkedIn.filter((row) => row.queuePosition != null && row.playStatus === 'waiting').sort((a, b) => a.queuePosition - b.queuePosition).map((row) => row.id);
      const activeMatchIds = current.courts.flatMap((court) => court.match?.playerIds || []);
      const preservedLocal = current.queue.filter((id) => !checkedIn.some((row) => row.id === id));
      const nextQueue = [...databaseQueue.filter((id) => !activeMatchIds.includes(id)), ...preservedLocal];
      const queueChanged = nextQueue.length !== current.queue.length || nextQueue.some((id, index) => id !== current.queue[index]);
      const playersChanged = JSON.stringify(nextPlayers) !== JSON.stringify(current.players);
      if (!playersChanged && !queueChanged) return current;
      return { ...current, players: nextPlayers, queue: nextQueue };
    });
    return rows;
  }, [session?.id]);

  const refreshRotationAudit = useCallback(async () => {
    if (!session?.id || !isSupabaseConfigured) return [];
    const { data, error } = await requireSupabase().from('open_play_rotation_decisions').select('*').eq('session_id', session.id).order('created_at', { ascending: false }).limit(25);
    if (error) throw error;
    const history = (data || []).map((row) => ({ matchId: row.match_id, playerIds: row.selected_player_ids, recommendedIds: row.recommended_player_ids, explanation: row.explanation?.reason || '', overridden: row.overridden, overrideReason: row.override_reason, createdAt: row.created_at }));
    setSession((current) => current?.id === session.id && JSON.stringify(current.assignmentHistory || []) !== JSON.stringify(history) ? { ...current, assignmentHistory: history } : current);
    return history;
  }, [session?.id]);

  const refreshLiveSession = useCallback(async () => {
    const fresh = await loadActiveOpenPlay();
    if (fresh?.id === session?.id) setSession(fresh);
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id || !dataReady) return;
    refreshRegistrations().catch(() => {});
    refreshRotationAudit().catch(() => {});
  }, [dataReady, refreshRegistrations, refreshRotationAudit, session?.id]);

  useEffect(() => {
    if (!session?.id || !isSupabaseConfigured) return undefined;
    const channel = requireSupabase()
      .channel(`organizer-open-play-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_players', filter: `session_id=eq.${session.id}` }, () => refreshRegistrations().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_sessions', filter: `id=eq.${session.id}` }, () => refreshLiveSession().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_courts', filter: `session_id=eq.${session.id}` }, () => refreshLiveSession().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_matches', filter: `session_id=eq.${session.id}` }, () => refreshLiveSession().catch(() => {}))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'open_play_rotation_decisions', filter: `session_id=eq.${session.id}` }, () => refreshRotationAudit().catch(() => {}))
      .subscribe((status) => reportRealtime(`organizer-${session.id}`, status));
    return () => { requireSupabase().removeChannel(channel); reportRealtime(`organizer-${session.id}`, 'REMOVE'); };
  }, [refreshLiveSession, refreshRegistrations, refreshRotationAudit, reportRealtime, session?.id]);

  const endSession = async () => {
    if (!session?.id) return;
    endingSession.current = true;
    try {
      await syncInFlight.current;
      await completeOpenPlay(session.id);
      setScreen('summary');
      setCourtId(null);
    } catch (error) {
      endingSession.current = false;
      throw error;
    }
  };

  const resetSession = () => {
    endingSession.current = false;
    setScreen('setup');
    setSession(null);
    setRegistrations([]);
    setCourtId(null);
  };

  return <OpenPlaySessionContext.Provider value={{ screen, setScreen, session, setSession, courtId, setCourtId, registrations, refreshRegistrations, endSession, resetSession }}>{children}</OpenPlaySessionContext.Provider>;
}

export function useOpenPlaySession() {
  const value = useContext(OpenPlaySessionContext);
  if (!value) throw new Error('useOpenPlaySession must be used inside OpenPlaySessionProvider');
  return value;
}
