import { requireSupabase } from '../lib/supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const routeCache = new Map();
let lastFailure = null;

function pruneRouteCache(now) {
  for (const [key, entry] of routeCache) {
    if (now - entry.cachedAt >= CACHE_TTL_MS) routeCache.delete(key);
  }
  while (routeCache.size > CACHE_MAX_ENTRIES) {
    routeCache.delete(routeCache.keys().next().value);
  }
}

function validCoordinates(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function coordinateKey(value) {
  return `${value.latitude.toFixed(5)},${value.longitude.toFixed(5)}`;
}

function cacheKey(origin, destination) {
  return `${coordinateKey(origin)}>${coordinateKey(destination)}`;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function requestRouteChunk(origin, destinations) {
  const { data, error } = await requireSupabase().functions.invoke('route-distances', {
    body: {
      origin,
      destinations: destinations.map(({ id, coordinates }) => ({ id, ...coordinates })),
    },
  });
  if (error) throw new Error(error.message || 'Driving routes are unavailable.');
  if (!Array.isArray(data?.routes)) throw new Error(data?.error || 'Driving routes returned an invalid response.');
  return data.routes;
}

export async function listDrivingRouteDistances(originValue, destinationValues = []) {
  const origin = validCoordinates(originValue);
  if (!origin) return {};
  if (lastFailure && Date.now() - lastFailure.at < FAILURE_BACKOFF_MS) throw lastFailure.error;

  const destinations = destinationValues.map((destination) => {
    const coordinates = validCoordinates(destination);
    return coordinates && destination?.id != null ? { id: String(destination.id), coordinates } : null;
  }).filter(Boolean);
  const result = {};
  const missing = [];
  const now = Date.now();

  destinations.forEach((destination) => {
    const stored = routeCache.get(cacheKey(origin, destination.coordinates));
    if (stored && now - stored.cachedAt < CACHE_TTL_MS) {
      result[destination.id] = stored.route;
    } else {
      missing.push(destination);
    }
  });

  try {
    const responses = await Promise.all(chunks(missing, 25).map((group) => requestRouteChunk(origin, group)));
    responses.flat().forEach((route) => {
      if (!route?.id || !Number.isFinite(route.distanceMeters)) return;
      const normalized = {
        distanceMeters: route.distanceMeters,
        distanceKm: route.distanceMeters / 1000,
        durationMinutes: Number.isFinite(route.durationSeconds) ? Math.max(1, Math.round(route.durationSeconds / 60)) : null,
        provider: route.provider || 'openrouteservice',
      };
      result[route.id] = normalized;
      const destination = destinations.find((item) => item.id === route.id);
      if (destination) routeCache.set(cacheKey(origin, destination.coordinates), { route: normalized, cachedAt: now });
    });
    pruneRouteCache(now);
    lastFailure = null;
    return result;
  } catch (error) {
    lastFailure = { error, at: Date.now() };
    throw error;
  }
}
