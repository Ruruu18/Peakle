import * as Location from 'expo-location';

export function hasValidVenueCoordinates(valueOrLatitude, possibleLongitude) {
  const latitude = typeof valueOrLatitude === 'object' ? Number(valueOrLatitude?.latitude) : Number(valueOrLatitude);
  const longitude = typeof valueOrLatitude === 'object' ? Number(valueOrLatitude?.longitude) : Number(possibleLongitude);
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

export function coordinatesFromMapsUrl(value) {
  if (!value) return null;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Keep the original URL. */ }
  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,|\/|$)/,
    /[?&](?:query|q|ll)=(-?\d{1,2}(?:\.\d+)?)(?:%2C|,)(-?\d{1,3}(?:\.\d+)?)(?:&|$)/i,
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (hasValidVenueCoordinates(latitude, longitude)) return { latitude, longitude, source: 'maps-link' };
  }
  return null;
}

async function expandedMapsCoordinates(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    return coordinatesFromMapsUrl(response.url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveVenueCoordinates({ googleMapsUrl, address, area }) {
  const direct = coordinatesFromMapsUrl(googleMapsUrl);
  if (direct) return direct;
  const expanded = await expandedMapsCoordinates(googleMapsUrl);
  if (expanded) return expanded;
  const query = [address, area, 'Philippines'].filter(Boolean).join(', ');
  try {
    const [result] = await Location.geocodeAsync(query);
    if (result && hasValidVenueCoordinates(result)) {
      return { latitude: Number(result.latitude), longitude: Number(result.longitude), source: 'address-geocode' };
    }
  } catch {
    // The form reports a precise, actionable error below.
  }
  throw new Error('We could not confirm precise coordinates. Check the address and Google Maps link, then try again.');
}
