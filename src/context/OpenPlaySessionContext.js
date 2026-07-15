import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { completeOpenPlay, loadActiveOpenPlay, syncOpenPlay } from '../services/database';

const OpenPlaySessionContext = createContext(null);

export function OpenPlaySessionProvider({ children }) {
  const { user } = useAuth();
  const [screen, setScreen] = useState('setup');
  const [session, setSession] = useState(null);
  const [courtId, setCourtId] = useState(null);
  const restoredFor = useRef(null);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured || restoredFor.current === user.id) return;
    restoredFor.current = user.id;
    setDataReady(false);
    loadActiveOpenPlay().then((saved) => {
      if (!saved) return;
      setScreen('dashboard');
      setSession(saved);
      setCourtId(null);
    }).catch(() => {}).finally(() => setDataReady(true));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured || !dataReady || restoredFor.current !== user.id) return undefined;
    const timer = setTimeout(() => syncOpenPlay(session).catch(() => {}), 400);
    return () => clearTimeout(timer);
  }, [user?.id, screen, session, courtId, dataReady]);

  const resetSession = () => {
    if (session?.id) completeOpenPlay(session.id).catch(() => {});
    setScreen('setup');
    setSession(null);
    setCourtId(null);
  };

  return <OpenPlaySessionContext.Provider value={{ screen, setScreen, session, setSession, courtId, setCourtId, resetSession }}>{children}</OpenPlaySessionContext.Provider>;
}

export function useOpenPlaySession() {
  const value = useContext(OpenPlaySessionContext);
  if (!value) throw new Error('useOpenPlaySession must be used inside OpenPlaySessionProvider');
  return value;
}
