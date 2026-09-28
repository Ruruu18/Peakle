import React, { createContext, useCallback, useContext, useMemo } from 'react';
import useNearbyPlayers from '../hooks/useNearbyPlayers';
import { useOperations } from './OperationsContext';

const NearbyPlayersContext = createContext(null);

export function NearbyPlayersProvider({ children }) {
  const nearby = useNearbyPlayers(25);
  const { dismissMatchInviteNotice } = useOperations();
  const { respond: respondToInvite } = nearby;
  // An answered invitation has nothing left to act on in the notifications list.
  const respond = useCallback(async (inviteId, accept) => {
    const responded = await respondToInvite(inviteId, accept);
    if (responded) dismissMatchInviteNotice(inviteId);
    return responded;
  }, [dismissMatchInviteNotice, respondToInvite]);
  const value = useMemo(() => ({ ...nearby, respond }), [nearby, respond]);
  return <NearbyPlayersContext.Provider value={value}>{children}</NearbyPlayersContext.Provider>;
}

export function useNearbyPlayersContext() {
  const value = useContext(NearbyPlayersContext);
  if (!value) throw new Error('useNearbyPlayersContext must be used inside NearbyPlayersProvider');
  return value;
}
