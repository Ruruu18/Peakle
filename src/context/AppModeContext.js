import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { useOrganizerPass } from './OrganizerPassContext';

const STORAGE_KEY = '@peakle/app-mode';
const AppModeContext = createContext(null);

export function AppModeProvider({ children }) {
  const { user, updateProfile } = useAuth();
  const { hasOrganizerAccess, hydrated: passHydrated } = useOrganizerPass();
  const [mode, setModeState] = useState(user?.mode || 'player');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((savedMode) => {
        if (savedMode === 'player') setModeState('player');
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (user?.mode === 'player') setModeState('player');
    if (user?.mode === 'organizer' && passHydrated) setModeState(hasOrganizerAccess ? 'organizer' : 'player');
  }, [hasOrganizerAccess, passHydrated, user?.mode]);

  useEffect(() => {
    if (!passHydrated || hasOrganizerAccess || mode !== 'organizer') return;
    setModeState('player');
    AsyncStorage.setItem(STORAGE_KEY, 'player').catch(() => {});
    if (user?.id) updateProfile({ mode: 'player' }).catch(() => {});
  }, [hasOrganizerAccess, mode, passHydrated, updateProfile, user?.id]);

  const setMode = (nextMode) => {
    if (nextMode !== 'player' && nextMode !== 'organizer') return;
    if (nextMode === 'organizer' && !hasOrganizerAccess) return false;
    setModeState(nextMode);
    AsyncStorage.setItem(STORAGE_KEY, nextMode).catch(() => {});
    if (user?.id) updateProfile({ mode: nextMode }).catch(() => {});
    return true;
  };

  return <AppModeContext.Provider value={{ mode, setMode, hydrated, canUseOrganizerMode: hasOrganizerAccess, passHydrated }}>{children}</AppModeContext.Provider>;
}

export function useAppMode() {
  const value = useContext(AppModeContext);
  if (!value) throw new Error('useAppMode must be used inside AppModeProvider');
  return value;
}
