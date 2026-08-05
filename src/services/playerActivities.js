import { requireSupabase } from '../lib/supabase';
import { listDiscoverableOpenPlaySessions } from './openPlayRegistration';

function venueFrom(row) {
  const venue = row?.venues || row?.venue || null;
  return venue ? {
    id: venue.id,
    name: venue.name,
    area: venue.area,
    latitude: venue.latitude == null ? null : Number(venue.latitude),
    longitude: venue.longitude == null ? null : Number(venue.longitude),
  } : null;
}

export async function listDiscoverablePlayerActivities() {
  const client = requireSupabase();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const [openPlaySessions, competitions, programs] = await Promise.all([
    listDiscoverableOpenPlaySessions(),
    client
      .from('competitions')
      .select('id,name,kind,status,starts_on,ends_on,capacity,visibility,rules,venues(id,name,area,latitude,longitude,verification_status,active)')
      .eq('visibility', 'public')
      .in('status', ['registration', 'active'])
      .or(`ends_on.is.null,ends_on.gte.${today}`)
      .order('starts_on')
      .limit(20),
    client
      .from('venue_programs')
      .select('id,name,kind,starts_at,ends_at,capacity,price,skill_division,registration_status,description,venues(id,name,area,latitude,longitude,verification_status,active),program_registrations(user_id,status)')
      .eq('registration_status', 'open')
      .gt('ends_at', nowIso)
      .order('starts_at')
      .limit(30),
  ]);
  if (competitions.error) throw competitions.error;
  if (programs.error) throw programs.error;

  const openPlay = openPlaySessions.map((session) => ({
    id: `open-play:${session.id}`,
    sourceId: session.id,
    type: 'open_play',
    typeLabel: 'Open play',
    title: session.name,
    venue: session.venue,
    startsAt: session.scheduledStart,
    endsAt: session.scheduledEnd,
    feeAmount: session.feeAmount,
    capacity: session.capacity,
    registeredCount: session.registeredCount,
    availability: session.registeredCount >= session.capacity ? 'WAITLIST' : `${session.capacity - session.registeredCount} SPOTS`,
  }));
  const publicCompetitions = (competitions.data || [])
    .filter((competition) => competition.venues?.verification_status === 'verified' && competition.venues?.active)
    .map((competition) => ({
      id: `competition:${competition.id}`,
      sourceId: competition.id,
      type: 'competition',
      typeLabel: competition.kind || 'Competition',
      title: competition.name,
      venue: venueFrom(competition),
      startsAt: `${competition.starts_on}T00:00:00+08:00`,
      endsAt: competition.ends_on ? `${competition.ends_on}T23:59:59+08:00` : null,
      feeAmount: null,
      capacity: competition.capacity,
      registeredCount: null,
      availability: competition.status === 'active' ? 'LIVE' : 'REGISTER',
      status: competition.status,
      description: competition.rules,
    }));
  const publicPrograms = (programs.data || [])
    .filter((program) => program.venues?.verification_status === 'verified' && program.venues?.active)
    .map((program) => ({
      id: `program:${program.id}`,
      sourceId: program.id,
      type: 'program',
      typeLabel: program.kind === 'coaching' ? 'Coaching' : program.kind === 'clinic' ? 'Clinic' : program.kind === 'camp' ? 'Camp' : 'Program',
      title: program.name,
      venue: venueFrom(program),
      startsAt: program.starts_at,
      endsAt: program.ends_at,
      feeAmount: Number(program.price || 0),
      capacity: program.capacity,
      registeredCount: null,
      availability: 'OPEN',
      status: program.registration_status,
      description: program.description,
      skillDivision: program.skill_division,
      registration: program.program_registrations?.[0] || null,
    }));

  return [...openPlay, ...publicCompetitions, ...publicPrograms]
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}
