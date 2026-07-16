import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  activateDemoOrganizerPass,
  cancelDemoOrganizerPass,
  createPreviewEntitlement,
  expireDemoOrganizerPass,
  getOrganizerPassTier,
  hasCurrentOrganizerAccess,
  hasOrganizerPassCapability,
  loadOrganizerPass,
  refreshOrganizerPass,
  restoreDemoOrganizerPass,
} from '../services/organizerPass';

const OrganizerPassContext = createContext(null);

export function OrganizerPassProvider({ children }) {
  const { user } = useAuth();
  const [entitlement, setEntitlement] = useState(createPreviewEntitlement());
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setHydrated(false);
    loadOrganizerPass(user?.id)
      .then((value) => { if (active) setEntitlement(value); })
      .catch(() => { if (active) setEntitlement(createPreviewEntitlement()); })
      .finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !hasCurrentOrganizerAccess(entitlement) || !entitlement.currentPeriodEnd) return undefined;
    const remaining = new Date(entitlement.currentPeriodEnd).getTime() - Date.now();
    const timeout = setTimeout(() => {
      loadOrganizerPass(user.id)
        .then(setEntitlement)
        .catch(() => setEntitlement(createPreviewEntitlement()));
    }, Math.max(0, Math.min(remaining + 250, 2_147_000_000)));
    return () => clearTimeout(timeout);
  }, [entitlement, user?.id]);

  const run = useCallback(async (operation) => {
    setBusy(true);
    try {
      const value = await operation();
      setEntitlement(value);
      return value;
    } finally {
      setBusy(false);
    }
  }, []);

  const passTier = user?.isAdmin ? 'admin' : hasCurrentOrganizerAccess(entitlement) ? getOrganizerPassTier(entitlement) : null;
  const value = useMemo(() => ({
    entitlement,
    hydrated,
    busy,
    isAdminAccess: Boolean(user?.isAdmin),
    hasOrganizerAccess: Boolean(user?.isAdmin) || hasCurrentOrganizerAccess(entitlement),
    passTier,
    hasPassCapability: (capability) => hasOrganizerPassCapability(passTier, capability),
    isDemo: true,
    activate: (planId) => run(() => activateDemoOrganizerPass(user?.id, planId)),
    cancel: () => run(() => cancelDemoOrganizerPass(user?.id)),
    restore: () => run(() => restoreDemoOrganizerPass(user?.id)),
    simulateExpiration: () => run(() => expireDemoOrganizerPass(user?.id)),
    simulateReinstall: () => run(() => refreshOrganizerPass(user?.id)),
  }), [busy, entitlement, hydrated, passTier, run, user?.id, user?.isAdmin]);

  return <OrganizerPassContext.Provider value={value}>{children}</OrganizerPassContext.Provider>;
}

export function useOrganizerPass() {
  const value = useContext(OrganizerPassContext);
  if (!value) throw new Error('useOrganizerPass must be used inside OrganizerPassProvider');
  return value;
}
