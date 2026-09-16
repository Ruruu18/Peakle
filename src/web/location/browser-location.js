import { PH_LOCATIONS, formatLocation } from '../../data/phLocations';
import { containsPoint, resolveContainingArea } from './geometry';

export const PRECISE_ACCURACY_METERS = 100;
export const FIX_TIMEOUT_MS = 15000;
const MAX_FIX_AGE_MS = 30000;
let areasPromise;

export function locationErrorMessage(error) {
  if (error?.code === 'LOCATION_INSECURE') return 'Location requires HTTPS. Open the secure website, or use localhost for local testing.';
  if (error?.code === 'LOCATION_PERMISSION_DENIED' || error?.code === 1) return 'Location access is blocked for this website. Allow Location in your browser’s site settings, then try again. Also check your device’s location permission for this browser.';
  if (error?.code === 'LOCATION_SERVICES_DISABLED' || error?.code === 2) return 'Your browser could not determine your location. Enable location services on your device and try again.';
  if (error?.code === 'LOCATION_ACCURACY_LOW') return `Your browser reported only ${accuracyLabel(error.accuracy)} accuracy. Enable precise location for your browser or try again outdoors.`;
  if (error?.code === 3) return 'Finding your location timed out. Check your connection and try again.';
  if (error?.code === 'LOCATION_DATA_UNAVAILABLE') return 'City lookup could not load. Check your connection and try again; your coordinates have not been changed.';
  return error?.message || 'Your browser could not get your current location. Check your connection and location settings, then try again.';
}

function locationError(code, message, extra) {
  return Object.assign(new Error(message), { code, ...extra });
}

export function accuracyLabel(accuracy) {
  if (!Number.isFinite(accuracy)) return 'unknown';
  return accuracy >= 1000 ? `±${(accuracy / 1000).toFixed(1)} km` : `±${Math.max(1, Math.ceil(accuracy))} m`;
}

export function validFix(position, now = Date.now()) {
  const { latitude, longitude, accuracy } = position?.coords || {};
  return [latitude, longitude, accuracy, position?.timestamp].every(Number.isFinite)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && accuracy >= 0
    && now - position.timestamp <= MAX_FIX_AGE_MS && position.timestamp <= now + 5000;
}

export async function getBrowserCoordinates({ requestPermission = true, signal } = {}) {
  if (typeof window === 'undefined' || !window.isSecureContext) throw locationError('LOCATION_INSECURE');
  if (!navigator.geolocation) throw locationError('LOCATION_SERVICES_DISABLED');
  if (signal?.aborted) throw new DOMException('Location request cancelled.', 'AbortError');
  if (!requestPermission) {
    // Quiet background refreshes must never trigger a new permission prompt.
    const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
    if (permission?.state !== 'granted') throw locationError('LOCATION_PERMISSION_DENIED');
  }
  return new Promise((resolve, reject) => {
    let best = null;
    let watchId;
    let finished = false;
    let timer;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Location request cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(best ? null : locationError(3), best), FIX_TIMEOUT_MS);
    try {
      watchId = navigator.geolocation.watchPosition((position) => {
        if (!validFix(position)) return;
        const candidate = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp, source: 'gps' };
        // Reject a stale best fix if acquiring a better sample takes time.
        if (!best || candidate.accuracy <= best.accuracy || candidate.timestamp - best.timestamp > MAX_FIX_AGE_MS) best = candidate;
        if (candidate.accuracy <= PRECISE_ACCURACY_METERS) finish(null, candidate);
      }, (error) => {
        if (error.code === 1 || !best) finish(locationError(error.code));
        else finish(null, best);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: FIX_TIMEOUT_MS });
      if (finished) navigator.geolocation.clearWatch(watchId);
    } catch (error) { finish(error); }
  });
}

export async function loadAreas() {
  if (!areasPromise) {
    areasPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('/location/ph-areas-v1.json', { signal: controller.signal });
        if (!response.ok) throw new Error('Boundary data unavailable');
        const data = await response.json();
        if (data.version !== 1 || !Array.isArray(data.areas) || !data.areas.length) throw new Error('Invalid boundary data');
        return data;
      } catch {
        areasPromise = null;
        throw locationError('LOCATION_DATA_UNAVAILABLE');
      } finally { clearTimeout(timer); }
    })();
  }
  return areasPromise;
}

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^city of /, '').replace(/ city$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function areaLabel(area) {
  const region = area.province && normalize(area.province) !== normalize(area.city) ? `${area.province} (${area.region})` : area.region;
  return [area.city, region, 'Philippines'].filter(Boolean).join(' · ');
}

export async function searchAreas(query) {
  const { areas } = await loadAreas();
  const terms = normalize(query).split(' ').filter(Boolean);
  const matches = areas.filter((area) => terms.every((term) => normalize(`${area.city} ${area.province} ${area.region} Philippines`).includes(term)));
  return matches.sort((a, b) => Number(normalize(b.city) === normalize(query)) - Number(normalize(a.city) === normalize(query)) || a.city.localeCompare(b.city)).slice(0, 30);
}

export async function geocodeArea(query) {
  const city = String(query || '').split(/[·,]/)[0].trim();
  if (!city) return null;
  const { areas } = await loadAreas();
  const known = PH_LOCATIONS.find((area) => [area.city, ...(area.aliases || [])].some((name) => normalize(name) === normalize(city)));
  if (known && [known.latitude, known.longitude].every(Number.isFinite)) return { latitude: known.latitude, longitude: known.longitude, label: formatLocation(known), source: 'manual' };
  let matches = areas.filter((area) => normalize(area.city) === normalize(city));
  if (matches.length > 1) {
    const rest = normalize(String(query).slice(city.length));
    matches = matches.filter((area) => (area.province && rest.includes(normalize(area.province))) || rest.includes(normalize(area.region)));
  }
  if (matches.length !== 1) return null;
  const area = matches[0];
  return { latitude: area.center[1], longitude: area.center[0], label: areaLabel(area), source: 'manual' };
}

export async function describeCoordinates(coordinates) {
  const { areas, boundaryBufferMeters } = await loadAreas();
  const area = resolveContainingArea(areas, coordinates, boundaryBufferMeters);
  const boundaryUncertain = !area && areas.some((candidate) => containsPoint(candidate, coordinates));
  return { ...coordinates, label: area ? areaLabel(area) : 'Current location', area, boundaryUncertain };
}
