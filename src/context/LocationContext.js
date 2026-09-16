import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { useAuth } from './AuthContext';
import { knownLocationCoordinates } from '../data/phLocations';
import { geocode, reverseGeocode } from '../utils/geocode';

const DEFAULT_LOCATION = {
  latitude: null,
  longitude: null,
  label: 'Your area',
  source: 'default',
};

const LocationContext = createContext(null);

function locationAccessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function locationErrorMessage(error) {
  if (Platform.OS === 'web') {
    if (error?.code === 'LOCATION_PERMISSION_DENIED' || error?.code === 1) {
      return 'Location access is blocked for this website. Allow Location in your browser’s site settings, then try again.';
    }
    if (error?.code === 'LOCATION_SERVICES_DISABLED' || error?.code === 2) {
      return 'Your browser could not determine your location. Check that location services are enabled on your device, then try again.';
    }
    if (error?.code === 3) {
      return 'Finding your location timed out. Check your connection and try again.';
    }
    return 'Your browser could not get your current location. Check your connection and location settings, then try again.';
  }
  if (error?.code === 'LOCATION_SERVICES_DISABLED') {
    return 'Your phone location service is off. Turn it on, then try again.';
  }
  if (error?.code === 'LOCATION_PERMISSION_DENIED') {
    return 'Peakle does not have location permission. Allow location for Peakle in your phone settings, then try again.';
  }
  return 'Peakle could not get a GPS fix. Move to an open area and try again.';
}

function addressLabel(address) {
  const parts = [address?.city || address?.district || address?.subregion, address?.region, address?.country]
    .filter(Boolean)
    .filter((part, index, values) => values.findIndex((value) => value.toLocaleLowerCase() === part.toLocaleLowerCase()) === index);
  return parts.join(' · ') || 'Current location';
}

export async function geocodeArea(query) {
  const clean = typeof query === 'string' ? query.trim() : '';
  if (!clean) return null;
  const knownCoordinates = knownLocationCoordinates(clean);
  if (knownCoordinates) return knownCoordinates;
  const structuredParts = clean.split(/\s*·\s*/).map((part) => part.trim()).filter(Boolean);
  const queries = structuredParts.length >= 2
    ? [
      structuredParts.join(', '),
      [structuredParts[0], structuredParts[structuredParts.length - 1]].filter(Boolean).join(', '),
    ]
    : [clean];
  let geocoderResponded = false;
  let lastError = null;

  for (const placeQuery of [...new Set(queries)]) {
    try {
      const results = await geocode(placeQuery);
      geocoderResponded = true;
      const coords = results.find((result) => (
        [result?.latitude, result?.longitude].every(Number.isFinite)
        && result.latitude >= -90
        && result.latitude <= 90
        && result.longitude >= -180
        && result.longitude <= 180
      ));
      if (coords) return { latitude: coords.latitude, longitude: coords.longitude };
    } catch (error) {
      lastError = error;
      // A region label may not be understood by every platform geocoder.
      // Continue with the city + country fallback instead.
    }
  }
  if (!geocoderResponded && lastError) throw lastError;
  return null;
}

export function distanceInKm(from, to) {
  if (!from || !to || ![from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)) return null;
  if (Math.abs(from.latitude) > 90 || Math.abs(to.latitude) > 90 || Math.abs(from.longitude) > 180 || Math.abs(to.longitude) > 180) return null;
  const radius = 6371.0088;
  const radians = (value) => value * Math.PI / 180;
  const lat = radians(to.latitude - from.latitude);
  const lng = radians(to.longitude - from.longitude);
  const haversine = Math.sin(lat / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lng / 2) ** 2;
  const value = Math.min(1, Math.max(0, haversine));
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function formatDistance(distance) {
  if (!Number.isFinite(distance) || distance < 0) return 'Distance unavailable';
  if (distance < 1) return `${Math.max(10, Math.round(distance * 1000 / 10) * 10).toLocaleString('en-US')} m`;
  if (distance < 100) return `${distance.toFixed(1)} km`;
  return `${Math.round(distance).toLocaleString('en-US')} km`;
}

export function LocationProvider({ children }) {
  const { user } = useAuth();
  const [userLocation, setUserLocation] = useState(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resolveAddress = useCallback(async (coords, fallback = 'Current location') => {
    try {
      const address = await reverseGeocode(coords);
      return address ? addressLabel(address) : fallback;
    } catch {
      return fallback;
    }
  }, []);

  const getCurrentCoordinates = useCallback(async ({ requestPermission = false } = {}) => {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      throw locationAccessError('LOCATION_SERVICES_DISABLED', 'Device location services are disabled.');
    }

    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted' && requestPermission) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (permission.status !== 'granted') {
      throw locationAccessError('LOCATION_PERMISSION_DENIED', 'Foreground location permission was not granted.');
    }

    const result = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
      mayShowUserSettingsDialog: true,
    });
    return {
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
      accuracy: Number.isFinite(result.coords.accuracy) ? Math.max(0, result.coords.accuracy) : null,
      timestamp: Number.isFinite(result.timestamp) ? result.timestamp : Date.now(),
      source: 'gps',
    };
  }, []);

  const useCurrentLocation = useCallback(async ({ quiet = false, throwOnError = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      const coords = await getCurrentCoordinates({ requestPermission: !quiet });
      const label = await resolveAddress(coords);
      const located = { ...coords, label, source: 'gps' };
      setUserLocation(located);
      return located;
    } catch (nextError) {
      if (!quiet) setError(locationErrorMessage(nextError));
      if (throwOnError) throw nextError;
      return false;
    } finally {
      setLoading(false);
    }
  }, [getCurrentCoordinates, resolveAddress]);

  const setManualLocation = useCallback(async (query, displayLabel = '') => {
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
      setUserLocation({ ...coords, label: displayLabel.trim() || (label === 'Current location' ? clean : label), source: 'manual' });
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
    if (!homeArea) {
      setUserLocation((current) => ['gps', 'manual'].includes(current.source) ? current : DEFAULT_LOCATION);
      return undefined;
    }
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

  const value = useMemo(() => ({ userLocation, loading, error, getCurrentCoordinates, useCurrentLocation, setManualLocation, clearError }), [userLocation, loading, error, getCurrentCoordinates, useCurrentLocation, setManualLocation, clearError]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useUserLocation() {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useUserLocation must be used inside LocationProvider');
  return value;
}
