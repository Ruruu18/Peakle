import * as Location from 'expo-location';
import { findKnownLocation, formatLocation } from '../data/phLocations';
import { reverseGeocode } from './geocode';

const FIX_TIMEOUT_MS = 12000;
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

function positionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(positionError('LOCATION_TIMEOUT', 'Location fix timed out.')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Android fixes at Highest accuracy can take 10–30s indoors (or never resolve),
// which made "Use my location" feel stuck. Balanced accuracy is plenty for a
// city/nearby search, and a recent cached fix is used when a fresh one stalls.
export async function getDevicePosition({ requestPermission = true } = {}) {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) throw positionError('LOCATION_SERVICES_DISABLED', 'Device location services are disabled.');

  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== 'granted' && requestPermission) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (permission.status !== 'granted') throw positionError('LOCATION_PERMISSION_DENIED', 'Foreground location permission was not granted.');

  try {
    return await withTimeout(Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: true,
    }), FIX_TIMEOUT_MS);
  } catch (error) {
    const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).catch(() => null);
    if (lastKnown) return lastKnown;
    throw error;
  }
}

/** Detect the device's home area as a "City · Region · Country" label. */
export async function detectHomeAreaLabel() {
  const position = await getDevicePosition();
  const geo = await reverseGeocode({ latitude: position.coords.latitude, longitude: position.coords.longitude });
  const city = geo?.city || geo?.district || geo?.subregion || '';
  const known = findKnownLocation(city);
  if (known) return formatLocation(known);
  if (!city) throw positionError('LOCATION_UNRESOLVED', 'Could not resolve a city for this position.');
  return [city, geo?.region || '', geo?.country || 'Philippines'].join(' · ');
}
