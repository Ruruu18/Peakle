import { Platform } from 'react-native';
import * as Location from 'expo-location';

// expo-location's geocodeAsync/reverseGeocodeAsync are unimplemented on web
// (they always throw), so "use current location" silently fell back to a
// generic label there. Nominatim (OpenStreetMap) fills the gap for web only;
// native platforms keep using the device geocoder.
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

function addressFromNominatim(result) {
  const address = result?.address;
  if (!address) return null;
  return {
    city: address.city || address.town || address.municipality || address.village || address.county || null,
    subregion: address.county || address.state_district || null,
    district: address.suburb || address.city_district || address.neighbourhood || null,
    region: address.state || address.region || null,
    country: address.country || null,
  };
}

export async function reverseGeocode({ latitude, longitude }) {
  if (Platform.OS !== 'web') {
    const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
    return address || null;
  }
  const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=14&addressdetails=1`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Reverse geocoding is unavailable right now.');
  const data = await response.json();
  return addressFromNominatim(data);
}

export async function geocode(query) {
  if (Platform.OS !== 'web') return Location.geocodeAsync(query);
  const url = `${NOMINATIM_BASE}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Geocoding is unavailable right now.');
  const results = await response.json();
  return results
    .map((item) => ({ latitude: Number(item.lat), longitude: Number(item.lon) }))
    .filter(({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude));
}
