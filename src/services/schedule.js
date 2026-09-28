import { Platform } from 'react-native';
import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';
import { SCHEDULE_ACTIVITY_TYPES } from '../config/scheduleTypes';
import { listDiscoverablePlayerActivities } from './playerActivities';
import { cleanCourtText, courtLabel } from './playCourts';
import { geocode } from '../utils/geocode';
import { recordPlayerEvent } from './playerFunnel';

// Everything the Schedule tab shows is normalized to one calendar entry shape:
//   { id, kind, sourceId, title, startsAt, endsAt, place, area, status, ... }
// kind describes the activity; isPlayerScheduled distinguishes a player's
// calendar activity from an organizer's registration and live event tools.

export const GAME_DURATIONS = [60, 90, 120, 180];
export const DURATION_STEP_MINUTES = 30;
export const MIN_GAME_MINUTES = 30;
export const MAX_GAME_MINUTES = 6 * 60;
export const START_STEP_MINUTES = 5;
const GAME_FIELDS = 'id,host_id,activity_kind,title,notes,starts_at,ends_at,match_type,mode,visibility,capacity,court_label,court_area,venue_id,court_id,status';
// Added by 202609260013 and 202609280005; read separately so older databases keep working.
const OPTIONAL_FIELDS = [',latitude,longitude,skill_level,court_cost', ',latitude,longitude', ''];
const GEOCODE_TIMEOUT_MS = 5000;

const coordinateOrNull = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const schemaMissing = (error) => ['42703', 'PGRST204', 'PGRST202'].includes(error?.code);
const ROSTER_FIELDS = 'user_id,status,profile:profiles!scheduled_game_players_user_id_fkey(id,display_name,avatar_url)';

export const SKILL_LEVELS = [
  { value: 'any', label: 'All levels' },
  { value: 'beginner', label: 'Beginner friendly' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];
export const skillLevelLabel = (value) => SKILL_LEVELS.find((level) => level.value === value)?.label || 'All levels';

function mapGame(row, userId, waitlist = []) {
  const roster = (row.scheduled_game_players || []).map((player) => ({
    id: player.user_id,
    status: player.status,
    name: player.profile?.display_name || 'Player',
    avatar: player.profile?.avatar_url || null,
  }));
  const me = roster.find((player) => player.id === userId);
  const going = roster.filter((player) => player.status === 'going');
  const waiting = waitlist.find((entry) => entry.game_id === row.id);
  return {
    id: `game:${row.id}`,
    kind: row.activity_kind || 'game',
    typeLabel: SCHEDULE_ACTIVITY_TYPES[row.activity_kind || 'game']?.name || 'Game',
    isPlayerScheduled: true,
    sourceId: row.id,
    title: row.title,
    notes: row.notes || '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    place: row.court_label,
    area: row.court_area || '',
    latitude: coordinateOrNull(row.latitude),
    longitude: coordinateOrNull(row.longitude),
    matchType: row.match_type,
    mode: row.mode,
    visibility: row.visibility,
    capacity: row.capacity,
    status: row.status,
    hostId: row.host_id,
    isHost: row.host_id === userId,
    myStatus: row.host_id === userId ? 'going' : me?.status || null,
    roster,
    going,
    spotsLeft: Math.max(0, row.capacity - going.length),
    skillLevel: row.skill_level || 'any',
    courtCost: row.court_cost || '',
    waitlistPlace: waiting?.place || null,
    waitlistCount: waiting?.waiting || 0,
    court: { id: row.court_id || `custom:${row.id}`, source: row.venue_id ? 'listed' : 'custom', name: row.court_label, courtName: '', area: row.court_area || '', venueId: row.venue_id, courtId: row.court_id, color: '#1C6B66', detail: row.court_area || 'Scheduled game' },
  };
}

export function scheduleEntryFromActivity(activity) {
  const registrationStatus = activity.registration?.registration_status || activity.registration?.status || null;
  return {
    id: activity.id,
    kind: activity.type,
    isPlayerScheduled: false,
    sourceId: activity.sourceId,
    title: activity.title,
    startsAt: activity.startsAt,
    endsAt: activity.endsAt || activity.startsAt,
    place: activity.venue?.name || 'Location shared by organizer',
    area: activity.venue?.area || '',
    status: activity.status || 'scheduled',
    typeLabel: activity.typeLabel,
    availability: activity.availability,
    feeAmount: activity.feeAmount,
    joined: Boolean(registrationStatus && !['cancelled', 'rejected', 'declined'].includes(registrationStatus)),
    activity,
  };
}

async function currentUserId(client) {
  const { data } = await client.auth.getSession();
  return data?.session?.user?.id || null;
}

// Fetch personal activities independently so public discovery cannot crowd
// them out. Page through the personal calendar; discovery stays bounded.
export async function listScheduledGames({ from, to }) {
  if (DEMO_MODE) return [];
  const client = requireSupabase();
  const userId = await currentUserId(client);
  if (!userId) return [];
  const fields = (optional) => `${GAME_FIELDS}${optional},scheduled_game_players(${ROSTER_FIELDS})`;
  const read = async (build) => {
    let result;
    for (const optional of OPTIONAL_FIELDS) {
      result = await build(fields(optional));
      if (!['42703', 'PGRST204'].includes(result.error?.code)) break;
    }
    if (result.error) throw result.error;
    return result.data || [];
  };
  const loadPages = async (build) => {
    const rows = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const data = await read((selection) => build(selection).order('starts_at').order('id').range(offset, offset + pageSize - 1));
      rows.push(...data);
      if (data.length < pageSize) return rows;
    }
  };
  const loadMine = async () => {
    try {
      return await loadPages((selection) => client.rpc('list_my_scheduled_games', { p_from: from, p_to: to }).select(selection));
    } catch (error) {
      if (!['PGRST202', '42883'].includes(error?.code)) throw error;
      // During a rolling database deploy, use separately filtered table
      // queries. Never fall back to the shared discovery limit for My schedule.
      const [hosted, joined] = await Promise.all([
        loadPages((selection) => client.from('scheduled_games').select(selection)
          .eq('host_id', userId).gte('ends_at', from).lt('starts_at', to)),
        loadPages((selection) => client.from('scheduled_games')
          .select(`${selection},my_registration:scheduled_game_players!inner(user_id)`)
          .eq('my_registration.user_id', userId).neq('host_id', userId)
          .gte('ends_at', from).lt('starts_at', to)),
      ]);
      return [...hosted, ...joined];
    }
  };
  const [mine, discovery, waitlist] = await Promise.all([
    loadMine(),
    read((selection) => client.from('scheduled_games').select(selection)
      .eq('visibility', 'open').eq('status', 'scheduled')
      .gte('ends_at', from).lt('starts_at', to)
      .order('starts_at').order('id').limit(200)),
    loadWaitlist(client),
  ]);
  const rows = new Map(discovery.map((row) => [row.id, row]));
  mine.forEach((row) => rows.set(row.id, row));
  return [...rows.values()]
    .map((row) => mapGame(row, userId, waitlist))
    .filter((game) => game.status === 'scheduled' || game.myStatus)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt) || a.id.localeCompare(b.id));
}

// The player's place on each waitlist, and the size of hosted activities' waitlists.
async function loadWaitlist(client) {
  const { data, error } = await client.rpc('list_scheduled_game_waitlists');
  return error ? [] : data || [];
}

export async function listScheduleEvents() {
  const activities = await listDiscoverablePlayerActivities();
  return activities.map(scheduleEntryFromActivity);
}

// The next thing on the player's own calendar, for Home's "Next up" card.
export function nextOnMyCalendar(entries, now = Date.now()) {
  return entries
    .filter((entry) => isOnMyCalendar(entry) && entry.status !== 'cancelled' && new Date(entry.endsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] || null;
}

export function isOnMyCalendar(entry) {
  if (isPlayerScheduledEntry(entry)) return Boolean(entry.isHost || (entry.myStatus && entry.myStatus !== 'declined'));
  return Boolean(entry.joined);
}

export function isPlayerScheduledEntry(entry) {
  return Boolean(entry && (entry.isPlayerScheduled || entry.kind === 'game'));
}

const DEMO_WRITE_ERROR = 'Scheduling is turned off in the demo.';

export async function createScheduledActivity({ kind = 'game', title, startsAt, durationMinutes, matchType = 'doubles', mode = 'casual', visibility = 'invite', capacity: requestedCapacity = 16, court, notes = '', invitees = [], skillLevel = 'any', courtCost = '' }) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  if (!Object.hasOwn(SCHEDULE_ACTIVITY_TYPES, kind)) throw new Error('Choose an activity type.');
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || durationMinutes <= 0 || durationMinutes > 12 * 60) {
    throw new Error('Choose a valid start time and a duration of at most 12 hours.');
  }
  const capacity = kind === 'game' ? (matchType === 'singles' ? 2 : 4) : requestedCapacity;
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 16) throw new Error('Choose a player limit from 2 to 16.');
  const client = requireSupabase();
  const params = {
    p_activity_kind: kind,
    p_title: cleanCourtText(title) || (kind === 'game' ? `${matchType === 'singles' ? 'Singles' : 'Doubles'} game` : SCHEDULE_ACTIVITY_TYPES[kind].name),
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_match_type: matchType,
    p_mode: kind === 'game' ? mode : 'casual',
    p_visibility: visibility,
    p_capacity: capacity,
    p_court_label: courtLabel(court),
    p_court_area: cleanCourtText(court?.area) || null,
    p_venue_id: court?.venueId || null,
    p_court_id: court?.venueId ? court.courtId || null : null,
    p_notes: notes.trim() || null,
    p_invitee_ids: invitees.map((player) => player.id).filter(Boolean),
  };
  // Listed courts get their venue's pin on the server; a typed-in court is
  // looked up on the map so others can see how far away it is.
  const position = court?.venueId ? null : await courtCoordinates(court);
  let { data, error } = await client.rpc('create_scheduled_activity', position ? { ...params, p_latitude: position.latitude, p_longitude: position.longitude } : params);
  if (position && schemaMissing(error)) ({ data, error } = await client.rpc('create_scheduled_activity', params));
  if (error) throw error;
  const created = Array.isArray(data) ? data[0] : data;
  recordPlayerEvent('activity_created', { gameId: created?.id });
  // Details added by 202609280005. The activity already exists, so a database
  // without them keeps it and simply skips the extra details.
  if (created?.id && (skillLevel !== 'any' || cleanCourtText(courtCost))) {
    const { error: detailError } = await client.rpc('update_scheduled_game', { p_game_id: created.id, p_skill_level: skillLevel, p_court_cost: cleanCourtText(courtCost) || '' });
    if (detailError && !schemaMissing(detailError)) console.warn('Activity details were not saved:', detailError.message);
  }
  return created;
}

// Host changes to an upcoming activity. Only the fields passed are changed;
// moving the time or court notifies everyone invited or going.
export async function updateScheduledGame(gameId, { startsAt, durationMinutes, court, skillLevel, courtCost, notes, title } = {}) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const params = { p_game_id: gameId };
  if (startsAt) {
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    if (!Number.isFinite(start.getTime()) || !(durationMinutes > 0) || durationMinutes > 12 * 60) throw new Error('Choose a valid start time and a duration of at most 12 hours.');
    params.p_starts_at = start.toISOString();
    params.p_ends_at = end.toISOString();
  }
  if (court) {
    params.p_court_label = courtLabel(court);
    params.p_court_area = cleanCourtText(court.area) || null;
    params.p_venue_id = court.venueId || null;
    params.p_court_id = court.venueId ? court.courtId || null : null;
    const position = court.venueId ? null : await courtCoordinates(court);
    params.p_latitude = position?.latitude ?? null;
    params.p_longitude = position?.longitude ?? null;
  }
  if (skillLevel) params.p_skill_level = skillLevel;
  if (courtCost !== undefined) params.p_court_cost = cleanCourtText(courtCost) || '';
  if (notes !== undefined) params.p_notes = notes.trim();
  if (title !== undefined) params.p_title = cleanCourtText(title) || null;
  const { data, error } = await requireSupabase().rpc('update_scheduled_game', params);
  if (schemaMissing(error)) throw new Error('Editing activities is not available yet. Please try again after the next update.');
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// "Play again next week": the same activity, a week later, with the players
// who went already picked. The host still reviews and saves it.
export function nextWeekDraft(game) {
  const start = new Date(new Date(game.startsAt).getTime() + 7 * 24 * 60 * 60000);
  const durationMinutes = Math.round((new Date(game.endsAt) - new Date(game.startsAt)) / 60000);
  return {
    kind: game.kind || 'game',
    title: game.title,
    day: dayKey(start),
    startMinutes: minutesOfDay(start),
    durationMinutes,
    matchType: game.matchType,
    mode: game.mode,
    visibility: game.visibility,
    capacity: game.capacity,
    court: game.court,
    notes: game.notes || '',
    skillLevel: game.skillLevel || 'any',
    courtCost: game.courtCost || '',
    invitees: (game.going || []).filter((player) => player.id !== game.hostId).map((player) => ({ id: player.id, name: player.name, avatar: player.avatar })),
  };
}

// Minutes after midnight in the scheduling time zone.
export function minutesOfDay(value) {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', { timeZone: SCHEDULE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)).split(':').map(Number);
  return hour * 60 + minute;
}

export async function joinScheduledGameWaitlist(gameId) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { data, error } = await requireSupabase().rpc('join_scheduled_game_waitlist', { p_game_id: gameId });
  if (schemaMissing(error)) throw new Error('Waitlists are not available yet. Please try again after the next update.');
  if (error) throw error;
  recordPlayerEvent('waitlist_joined', { gameId });
  return data;
}

export async function leaveScheduledGameWaitlist(gameId) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { error } = await requireSupabase().rpc('leave_scheduled_game_waitlist', { p_game_id: gameId });
  if (error) throw error;
}

// ---------- "Tell me when a game opens here" ----------

export async function getGameAlert() {
  if (DEMO_MODE) return null;
  const client = requireSupabase();
  const userId = await currentUserId(client);
  if (!userId) return null;
  const { data, error } = await client.from('scheduled_game_alerts').select('area,created_at').eq('user_id', userId).maybeSingle();
  return error ? null : data;
}

export async function setGameAlert(area) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { data, error } = await requireSupabase().rpc('set_scheduled_game_alert', { p_area: area });
  if (schemaMissing(error)) throw new Error('Game alerts are not available yet. Please try again after the next update.');
  if (error) throw error;
  recordPlayerEvent('game_alert_set');
  return Array.isArray(data) ? data[0] : data;
}

export async function clearGameAlert() {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { error } = await requireSupabase().rpc('clear_scheduled_game_alert');
  if (error) throw error;
}

// Discover filters. Area matching mirrors the server's game alerts: either
// name may contain the other ("Pasig" and "Kapitolyo, Pasig").
export function matchesArea(entry, area) {
  const wanted = String(area || '').trim().toLowerCase();
  if (!wanted) return true;
  const where = `${entry.area || ''} ${entry.place || ''}`.toLowerCase();
  return where.includes(wanted) || (entry.area && wanted.includes(entry.area.trim().toLowerCase()));
}

export function matchesSkill(entry, skill) {
  if (!skill || skill === 'any') return true;
  return !isPlayerScheduledEntry(entry) || !entry.skillLevel || entry.skillLevel === 'any' || entry.skillLevel === skill;
}

// Best effort: a court that cannot be found is still scheduled, just without
// a distance. Courts picked with coordinates (e.g. "use my location") keep them.
async function courtCoordinates(court) {
  const latitude = coordinateOrNull(court?.latitude);
  const longitude = coordinateOrNull(court?.longitude);
  if (latitude != null && longitude != null) return { latitude, longitude };
  const query = [court?.name, court?.area].map(cleanCourtText).filter(Boolean).join(', ');
  if (!query) return null;
  let timeout;
  try {
    const results = await Promise.race([
      geocode(query),
      new Promise((resolve) => { timeout = setTimeout(() => resolve([]), GEOCODE_TIMEOUT_MS); }),
    ]);
    const [first] = results || [];
    return first && Number.isFinite(first.latitude) && Number.isFinite(first.longitude) ? { latitude: first.latitude, longitude: first.longitude } : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function createScheduledGame(options) {
  return createScheduledActivity({ ...options, kind: 'game' });
}

export async function respondToScheduledGame(gameId, going) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { data, error } = await requireSupabase().rpc('respond_scheduled_game', { p_game_id: gameId, p_going: going });
  if (error) throw error;
  if (going) recordPlayerEvent('activity_joined', { gameId });
  return data;
}

export async function cancelScheduledGame(gameId) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { error } = await requireSupabase().rpc('cancel_scheduled_game', { p_game_id: gameId });
  if (error) throw error;
}

// ---------- Sharing: links, extra invites and sending to chats ----------

const SHARE_UNAVAILABLE = 'Sharing activities is not available yet. Please try again after the next update.';
const SHARE_CODE_PATTERN = /\/games\/([a-z0-9]{10})\b/i;
// Web links open the web app; the native app handles peakle:// and, once set,
// EXPO_PUBLIC_APP_URL so links shared from a phone also work in a browser.
const APP_URL = (process.env.EXPO_PUBLIC_APP_URL || '').replace(/\/+$/, '');

export function scheduledGameShareUrl(code) {
  const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : APP_URL;
  return origin ? `${origin}/games/${code}` : `peakle://games/${code}`;
}

export function shareCodeFromText(text) {
  return String(text || '').match(SHARE_CODE_PATTERN)?.[1]?.toLowerCase() || null;
}

export function scheduledGameShareMessage(game, url) {
  const when = `${formatDayLabel(dayKey(game.startsAt), { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatTime(game.startsAt)}`;
  return `Join me for ${game.title} on Peakle\n${when} · ${[game.place, game.area].filter(Boolean).join(', ')}\n${url}`;
}

export async function getScheduledGameShareUrl(gameId) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { data, error } = await requireSupabase().rpc('get_scheduled_game_share_code', { p_game_id: gameId });
  if (schemaMissing(error)) throw new Error(SHARE_UNAVAILABLE);
  if (error) throw error;
  recordPlayerEvent('invite_shared', { gameId });
  return scheduledGameShareUrl(data);
}

// What a shared link invites to, readable before sign-in: public fields only.
export async function getScheduledGamePreview(code) {
  if (DEMO_MODE || !/^[a-z0-9]{10}$/i.test(code || '')) return null;
  const { data, error } = await requireSupabase().rpc('get_scheduled_game_preview', { p_code: code });
  if (error) throw error;
  return data || null;
}

// Adds the player to the activity as invited; returns { gameId, startsAt }.
export async function openScheduledGameLink(code) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { data, error } = await requireSupabase().rpc('open_scheduled_game_link', { p_code: code });
  if (schemaMissing(error)) throw new Error(SHARE_UNAVAILABLE);
  if (error) throw error;
  recordPlayerEvent('invite_opened', { gameId: data?.gameId });
  return data;
}

export async function inviteToScheduledGame(gameId, players) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { data, error } = await requireSupabase().rpc('invite_scheduled_game_players', { p_game_id: gameId, p_player_ids: players.map((player) => player.id).filter(Boolean) });
  if (schemaMissing(error)) throw new Error(SHARE_UNAVAILABLE);
  if (error) throw error;
  return data || 0;
}

export async function setScheduledGameVisibility(gameId, visibility) {
  if (DEMO_MODE) throw new Error(DEMO_WRITE_ERROR);
  const { error } = await requireSupabase().rpc('set_scheduled_game_visibility', { p_game_id: gameId, p_visibility: visibility });
  if (schemaMissing(error)) throw new Error(SHARE_UNAVAILABLE);
  if (error) throw error;
}

// Prefills Play setup from a scheduled game: registered players fill the lineup.
export function playSetupFromGame(game) {
  if (game.kind && game.kind !== 'game') throw new Error('Only games can be started as a match.');
  const going = game.going.map((player) => ({ id: player.id, name: player.name, avatar: player.avatar }));
  return {
    matchType: game.matchType,
    mode: game.mode,
    court: game.court,
    players: going,
    scheduledGameId: game.sourceId,
  };
}

// ---------- Calendar date helpers (Asia/Manila, the app's scheduling zone) ----------

export const SCHEDULE_TIME_ZONE = 'Asia/Manila';

export function dayKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SCHEDULE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  return parts;
}

export function dateFromDayKey(key, time = '12:00') {
  return new Date(`${key}T${time}:00+08:00`);
}

export function shiftDayKey(key, days) {
  const date = dateFromDayKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dayKey(date);
}

export function monthGrid(monthKey) {
  // monthKey: 'YYYY-MM'. Returns 6 weeks of day keys starting on Sunday.
  const first = dateFromDayKey(`${monthKey}-01`);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: SCHEDULE_TIME_ZONE, weekday: 'short' }).format(first));
  const start = shiftDayKey(`${monthKey}-01`, -weekday);
  return Array.from({ length: 42 }, (_, index) => shiftDayKey(start, index));
}

export function shiftMonthKey(monthKey, months) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function entriesByDay(entries) {
  return entries.reduce((days, entry) => {
    const key = dayKey(entry.startsAt);
    (days[key] ||= []).push(entry);
    return days;
  }, {});
}

// 30-minute start slots from 6:00 AM to 10:00 PM, like a booking page.
// First start time (minutes after midnight, Manila) still open on a day: at least
// ten minutes from now, on a five-minute mark. Null when the day is over.
export function earliestStartMinutes(key, now = Date.now()) {
  const offset = now + 10 * 60000 - dateFromDayKey(key, '00:00').getTime();
  if (offset < 0) return 0;
  const minutes = (Math.floor(offset / 60000 / START_STEP_MINUTES) + 1) * START_STEP_MINUTES;
  return minutes < 24 * 60 ? minutes : null;
}

export function clockFromMinutes(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// Reads a typed start time: "7", "7:10", "7.10pm", "710 pm" or "19:10". Without
// AM/PM in the text, fallbackMeridiem ('am' or 'pm') decides; failing that, 1–5
// means afternoon and 6–11 morning, matching when people play.
export function parseClockInput(text, fallbackMeridiem = null) {
  const match = String(text || '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.\s]?(\d{2}))?\s*([ap])?\.?\s*m?\.?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  // "07:30" is 24-hour, so it ignores the AM/PM toggle just like "19:30" does.
  const twentyFourHour = /^0\d$/.test(match[1]);
  const meridiem = match[3] || (fallbackMeridiem && !twentyFourHour && hour >= 1 && hour <= 12 ? fallbackMeridiem[0] : null);
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  } else if (hour >= 1 && hour <= 5) {
    hour += 12;
  }
  return hour * 60 + minute;
}

// Keeps a start-time field to text that can still become a real time, in
// 12-hour ("1:00 pm") or 24-hour ("13:00") style. Keystrokes that would go past
// 23 hours, 59 minutes or pair an hour over 12 with AM/PM are refused, and the
// colon is added for you ("730" -> "7:30", "193" -> "19:3").
function clockPrefix(text) {
  const match = text.match(/^(\d{0,2})(:?)(\d{0,2})(?:\s?([ap])(m?))?$/);
  if (!match) return null;
  const [, hourText, colon, minuteText, meridiem, m] = match;
  const hour = Number(hourText);
  if ((colon || minuteText || meridiem) && !hourText) return null;
  if (minuteText && !colon) return null;
  if (hour > 23 || Number(minuteText[0]) > 5) return null;
  if (meridiem && (hour < 1 || hour > 12 || /^0/.test(hourText) || minuteText.length === 1 || (colon && !minuteText))) return null;
  return `${hourText}${colon}${minuteText}${meridiem ? ` ${meridiem.toUpperCase()}${m ? 'M' : ''}` : ''}`;
}

export function maskClockInput(previous, next) {
  let text = String(next || '').toLowerCase()
    .replace(/(\d)\.(?=\d|$)/, '$1:')
    .replace(/[^0-9:apm ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s/, '')
    .replace(/(\d)\s(?=\d)/, '$1:');
  const growing = text.length > String(previous || '').length;
  if (growing) {
    // Place the colon once the digits can no longer be just an hour.
    const digits = text.match(/^(\d+)(.*)$/);
    if (digits && !digits[2].startsWith(':') && (digits[1].length > 2 || (digits[1].length === 2 && Number(digits[1]) > 23))) {
      const split = digits[1].length === 2 || Number(digits[1].slice(0, 2)) > 23 ? 1 : 2;
      text = `${digits[1].slice(0, split)}:${digits[1].slice(split)}${digits[2]}`;
    }
    return clockPrefix(text) ?? (previous || '');
  }
  // Deleting never gets stuck: trim back to the longest valid start.
  while (text && clockPrefix(text) === null) text = text.slice(0, -1);
  return text ? clockPrefix(text) : '';
}

// Reads a typed length in hours ("2", "2.5", "1,5") and snaps it to half hours.
export function parseHoursInput(text) {
  const hours = Number(String(text || '').trim().replace(',', '.').replace(/\s*(h|hr|hrs|hours?)$/i, ''));
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const minutes = Math.round((hours * 60) / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
  return Math.min(MAX_GAME_MINUTES, Math.max(MIN_GAME_MINUTES, minutes));
}

export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return `${Number((minutes / 60).toFixed(1))} hr`;
}

export function formatTime(value) {
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: SCHEDULE_TIME_ZONE });
}

export function formatDayLabel(key, options = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return dateFromDayKey(key).toLocaleDateString('en-US', { ...options, timeZone: SCHEDULE_TIME_ZONE });
}

export function googleCalendarUrl(entry) {
  const stamp = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: entry.title,
    dates: `${stamp(entry.startsAt)}/${stamp(entry.endsAt || entry.startsAt)}`,
    details: 'Scheduled on Peakle',
    location: [entry.place, entry.area].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
