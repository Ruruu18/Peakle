import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const DeviceOnboardingContext = createContext(null);

// Keep this key stable across app updates. Change the value only if every existing
// installation must intentionally see a future onboarding experience again.
export const DEVICE_ONBOARDING_STORAGE_KEY = '@peakle/device-onboarding';
const COMPLETED_VALUE = 'completed-v1';

export function DeviceOnboardingProvider({ children }) {
  const [hydrated, setHydrated] = useState(false);
  const [hasCompletedDeviceOnboarding, setHasCompletedDeviceOnboarding] = useState(false);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(DEVICE_ONBOARDING_STORAGE_KEY)
      .then((value) => {
        if (active) setHasCompletedDeviceOnboarding(value === COMPLETED_VALUE);
      })
      .catch(() => {
        // A storage failure must never trap the user on a startup screen.
        if (active) setHasCompletedDeviceOnboarding(true);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });

    return () => { active = false; };
  }, []);

  const completeDeviceOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(DEVICE_ONBOARDING_STORAGE_KEY, COMPLETED_VALUE);
    setHasCompletedDeviceOnboarding(true);
  }, []);

  const value = useMemo(() => ({
    hydrated,
    hasCompletedDeviceOnboarding,
    completeDeviceOnboarding,
  }), [hydrated, hasCompletedDeviceOnboarding, completeDeviceOnboarding]);

  return <DeviceOnboardingContext.Provider value={value}>{children}</DeviceOnboardingContext.Provider>;
}

export function useDeviceOnboarding() {
  const value = useContext(DeviceOnboardingContext);
  if (!value) throw new Error('useDeviceOnboarding must be used inside DeviceOnboardingProvider');
  return value;
}
