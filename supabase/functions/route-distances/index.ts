const OPENROUTESERVICE_MATRIX_URL = 'https://api.heigit.org/openrouteservice/v2/matrix/driving-car';
const MAX_DESTINATIONS = 25;
const responseHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' };

type Coordinates = { latitude: number; longitude: number };
type Destination = Coordinates & { id: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function coordinates(value: unknown): Coordinates | null {
  const item = value as Record<string, unknown> | null;
  const latitude = Number(item?.latitude);
  const longitude = Number(item?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function location(value: Coordinates) {
  // openrouteservice uses GeoJSON coordinate order: [longitude, latitude].
  return [value.longitude, value.latitude];
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const apiKey = Deno.env.get('OPENROUTESERVICE_API_KEY');
  if (!apiKey) return json({ error: 'Driving routes are not configured.' }, 503);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const origin = coordinates(payload.origin);
  const inputDestinations = Array.isArray(payload.destinations) ? payload.destinations : [];
  const destinations = inputDestinations.slice(0, MAX_DESTINATIONS).map((value) => {
    const coords = coordinates(value);
    const id = String((value as Record<string, unknown>)?.id || '').slice(0, 120);
    return coords && id ? { id, ...coords } : null;
  }).filter((value): value is Destination => Boolean(value));
  if (!origin || !destinations.length || destinations.length !== inputDestinations.length) {
    return json({ error: `Provide one valid origin and 1-${MAX_DESTINATIONS} valid destinations.` }, 400);
  }

  const destinationIndexes = destinations.map((_, index) => String(index + 1));
  const routeResponse = await fetch(OPENROUTESERVICE_MATRIX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({
      locations: [location(origin), ...destinations.map(location)],
      sources: ['0'],
      destinations: destinationIndexes,
      metrics: ['distance', 'duration'],
      units: 'm',
    }),
  });

  if (!routeResponse.ok) {
    const routeError = await routeResponse.text();
    console.error(`openrouteservice ${routeResponse.status}: ${routeError.slice(0, 500)}`);
    const status = routeResponse.status === 429 ? 429 : 502;
    return json({ error: status === 429 ? 'The free routing limit is temporarily busy.' : 'Driving routes could not be calculated.' }, status);
  }

  const matrix = await routeResponse.json();
  const distances = Array.isArray(matrix?.distances?.[0]) ? matrix.distances[0] : [];
  const durations = Array.isArray(matrix?.durations?.[0]) ? matrix.durations[0] : [];
  if (distances.length !== destinations.length) {
    return json({ error: 'The routing service returned an invalid distance matrix.' }, 502);
  }
  const routes = destinations.map((destination, index) => {
    const distanceMeters = Number(distances[index]);
    if (!Number.isFinite(distanceMeters)) return null;
    const routeDurationSeconds = Number(durations[index]);
    return {
      id: destination.id,
      distanceMeters,
      durationSeconds: Number.isFinite(routeDurationSeconds) ? routeDurationSeconds : null,
      provider: 'openrouteservice',
    };
  }).filter(Boolean);
  return json({ routes, provider: 'openrouteservice' });
});
