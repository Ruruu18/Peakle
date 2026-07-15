import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';

const STORAGE_KEY = '@peakle/app-mode';
const AppModeContext = createContext(null);

export function AppModeProvider({ children }) {
  const { user, updateProfile } = useAuth();
  const [mode, setModeState] = useState(user?.mode || 'player');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((savedMode) => {
        if (savedMode === 'player' || savedMode === 'organizer') setModeState(savedMode);
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (user?.mode === 'player' || user?.mode === 'organizer') setModeState(user.mode);
  }, [user?.mode]);

  const setMode = (nextMode) => {
    if (nextMode !== 'player' && nextMode !== 'organizer') return;
    setModeState(nextMode);
    AsyncStorage.setItem(STORAGE_KEY, nextMode).catch(() => {});
    if (user?.id) updateProfile({ mode: nextMode }).catch(() => {});
  };

  return <AppModeContext.Provider value={{ mode, setMode, hydrated }}>{children}</AppModeContext.Provider>;
}

export function useAppMode() {
  const value = useContext(AppModeContext);
  if (!value) throw new Error('useAppMode must be used inside AppModeProvider');
  return value;
}
