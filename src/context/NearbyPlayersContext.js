import React, { createContext, useContext } from 'react';
import useNearbyPlayers from '../hooks/useNearbyPlayers';

const NearbyPlayersContext = createContext(null);

export function NearbyPlayersProvider({ children }) {
  const value = useNearbyPlayers(25);
  return <NearbyPlayersContext.Provider value={value}>{children}</NearbyPlayersContext.Provider>;
}

export function useNearbyPlayersContext() {
  const value = useContext(NearbyPlayersContext);
  if (!value) throw new Error('useNearbyPlayersContext must be used inside NearbyPlayersProvider');
  return value;
}
