import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { useAuth } from './AuthContext';

const DEFAULT_LOCATION = {
  latitude: null,
  longitude: null,
  label: 'Your area',
  source: 'default',
};

const LocationContext = createContext(null);

function addressLabel(address) {
  const parts = [address?.district || address?.subregion, address?.city || address?.region, address?.country].filter(Boolean);
  return [...new Set(parts)].slice(0, 2).join(', ') || 'Current location';
}

export async function geocodeArea(query) {
  const clean = query?.trim();
  if (!clean) return null;
  const [coords] = await Location.geocodeAsync(clean);
  return coords ? { latitude: coords.latitude, longitude: coords.longitude } : null;
}

export function distanceInKm(from, to) {
  if (!from || !to || ![from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)) return null;
  const radius = 6371;
  const radians = (value) => value * Math.PI / 180;
  const lat = radians(to.latitude - from.latitude);
  const lng = radians(to.longitude - from.longitude);
  const value = Math.sin(lat / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function formatDistance(distance) {
  if (!Number.isFinite(distance)) return 'Distance unavailable';
  if (distance < 1) return `${Math.max(10, Math.round(distance * 1000 / 10) * 10)} m`;
  if (distance < 10) return `${distance.toFixed(1)} km`;
  return `${Math.round(distance)} km`;
}

export function LocationProvider({ children }) {
  const { user } = useAuth();
  const [userLocation, setUserLocation] = useState(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resolveAddress = useCallback(async (coords, fallback = 'Current location') => {
    try {
      const [address] = await Location.reverseGeocodeAsync(coords);
      return address ? addressLabel(address) : fallback;
    } catch {
      return fallback;
    }
  }, []);

  const useCurrentLocation = useCallback(async ({ quiet = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted' && !quiet) permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        if (!quiet) setError('Location permission is off. Search for a city or area instead.');
        return false;
      }
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: result.coords.latitude, longitude: result.coords.longitude };
      const label = await resolveAddress(coords);
      setUserLocation({ ...coords, label, source: 'gps' });
      return true;
    } catch {
      if (!quiet) setError('We could not get your position. Check location services and try again.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [resolveAddress]);

  const setManualLocation = useCallback(async (query) => {
    const clean = query.trim();
    if (!clean) return false;
    setLoading(true);
    setError('');
    try {
      const coords = await geocodeArea(clean);
      if (!coords) {
        setError('We could not find that place. Try a city and country.');
        return false;
      }
      const label = await resolveAddress(coords, clean);
      setUserLocation({ ...coords, label: label === 'Current location' ? clean : label, source: 'manual' });
      return true;
    } catch {
      setError('Place search is unavailable right now. Check your connection and try again.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [resolveAddress]);
  const clearError = useCallback(() => setError(''), []);

  useEffect(() => {
    const homeArea = user?.location?.trim();
    if (!homeArea) return undefined;
    let active = true;
    const applyProfileLocation = (coords) => {
      if (!active) return;
      setUserLocation((current) => {
        if (current.source === 'gps' || current.source === 'manual') return current;
        return { latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null, label: homeArea, source: 'profile' };
      });
    };
    geocodeArea(homeArea).then((coords) => {
      applyProfileLocation(coords);
    }).catch(() => applyProfileLocation(null));
    return () => { active = false; };
  }, [user?.location]);

  useEffect(() => {
    useCurrentLocation({ quiet: true });
  }, [useCurrentLocation]);

  const value = useMemo(() => ({ userLocation, loading, error, useCurrentLocation, setManualLocation, clearError }), [userLocation, loading, error, useCurrentLocation, setManualLocation, clearError]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useUserLocation() {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useUserLocation must be used inside LocationProvider');
  return value;
}
