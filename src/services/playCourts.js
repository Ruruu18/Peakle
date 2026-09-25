import AsyncStorage from '@react-native-async-storage/async-storage';

// Courts a player can score a match on while court booking is paused. Every
// option has the same shape so setup, live scoring, invites and saved results
// treat a listed Peakle court and a typed-in court identically:
//   { id, source, name, courtName, area, detail, color, venueId?, courtId? }

export const COURT_TEXT_LIMIT = 80;
const RECENT_LIMIT = 6;
const DEFAULT_COLOR = '#1C6B66';
const recentKey = (userId) => `peakle:recent-courts:${userId || 'guest'}`;

export function cleanCourtText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, COURT_TEXT_LIMIT);
}

// Location labels arrive as "Area · Region"; placeholders are not a real place.
export function areaFromLocationLabel(label) {
  const area = cleanCourtText(String(label || '').split(' · ')[0]);
  return ['Your area', 'Location', 'Current location'].includes(area) ? '' : area;
}

export function courtKey(court) {
  return [court?.name, court?.courtName, court?.area].map((part) => cleanCourtText(part).toLocaleLowerCase()).join('|');
}

function describe(court) {
  return {
    ...court,
    detail: [court.courtName, court.area].filter(Boolean).join(' · ') || (court.source === 'listed' ? 'Peakle court' : 'Your court'),
  };
}

export function customCourt({ name, courtName = '', area = '' }) {
  const cleanName = cleanCourtText(name);
  if (!cleanName) return null;
  const court = { source: 'custom', name: cleanName, courtName: cleanCourtText(courtName), area: cleanCourtText(area), color: DEFAULT_COLOR };
  return describe({ ...court, id: `custom:${courtKey(court)}` });
}

export function listedCourtOptions(venues) {
  return (venues || []).flatMap((venue) => (venue.courts || [])
    .filter((court) => court.active !== false)
    .map((court) => describe({
      id: court.id,
      source: 'listed',
      venueId: venue.id,
      courtId: court.id,
      name: cleanCourtText(venue.name),
      courtName: cleanCourtText(court.name),
      area: cleanCourtText(venue.area),
      color: venue.color || DEFAULT_COLOR,
    })));
}

// The label saved with a match: "Venue · Court 2" when both are known.
export function courtLabel(court) {
  return [court?.name, court?.courtName].map(cleanCourtText).filter(Boolean).join(' · ').slice(0, COURT_TEXT_LIMIT);
}

export function matchesCourtQuery(court, query) {
  const needle = cleanCourtText(query).toLocaleLowerCase();
  if (!needle) return true;
  return `${court.name} ${court.courtName} ${court.area}`.toLocaleLowerCase().includes(needle);
}

export async function loadRecentCourts(userId) {
  try {
    const stored = JSON.parse(await AsyncStorage.getItem(recentKey(userId)) || '[]');
    // Listed Peakle courts belong to booking, which is paused, so older saved ones stay hidden.
    return Array.isArray(stored) ? stored.filter((court) => court?.name && court.source !== 'listed').map((court) => describe({ ...court, source: court.source || 'custom' })) : [];
  } catch {
    return [];
  }
}

export async function rememberCourt(userId, court) {
  if (!court?.name) return loadRecentCourts(userId);
  const { id, source, name, courtName, area, color, venueId, courtId } = court;
  const entry = { id, source, name, courtName: courtName || '', area: area || '', color: color || DEFAULT_COLOR, ...(venueId ? { venueId, courtId } : {}) };
  const current = await loadRecentCourts(userId);
  const next = [entry, ...current.filter((item) => courtKey(item) !== courtKey(entry))].slice(0, RECENT_LIMIT);
  try {
    await AsyncStorage.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    // Recent courts are a convenience; scoring never depends on them.
  }
  return next.map(describe);
}
