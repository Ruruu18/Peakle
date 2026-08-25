import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { hasAnyVenueMembership } from '../services/database';

const OrganizerPassContext = createContext(null);

export function OrganizerPassProvider({ children }) {
  const { user } = useAuth();
  const [hasVenueAccess, setHasVenueAccess] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    setHydrated(false);
    if (!user?.id) {
      setHasVenueAccess(false);
      setHydrated(true);
      return () => { active = false; };
    }
    hasAnyVenueMembership(user.id)
      .then((value) => { if (active) setHasVenueAccess(value); })
      .catch(() => { if (active) setHasVenueAccess(false); })
      .finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, [user?.id]);

  const value = useMemo(() => ({
    hydrated,
    isAdminAccess: Boolean(user?.isAdmin),
    hasVenueAccess,
    hasOrganizerAccess: Boolean(user?.isAdmin) || hasVenueAccess,
  }), [hasVenueAccess, hydrated, user?.isAdmin]);

  return <OrganizerPassContext.Provider value={value}>{children}</OrganizerPassContext.Provider>;
}

export function useOrganizerPass() {
  const value = useContext(OrganizerPassContext);
  if (!value) throw new Error('useOrganizerPass must be used inside OrganizerPassProvider');
  return value;
}
