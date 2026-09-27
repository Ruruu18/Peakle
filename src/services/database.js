import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { requireSupabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/supabase';
import { cleanCourtText, courtLabel } from './playCourts';
import { announcePlayerStatusChange } from './playerStatus';
import { DEMO_MODE } from '../config/demoMode';
import {
  DEMO_VENUE_ROWS, DEMO_QUOTE, DEMO_TEAMS, DEMO_MATCHES, DEMO_TEAM_ID,
  DEMO_TEAM_MESSAGE_ROWS,
} from '../config/demoData';

const unfinishedMatchKey = (userId) => `@peakle/unfinished-match/${userId}`;
const LEGACY_PLACEHOLDER_VENUE_IDS = new Set(['yard', 'rockwell', 'valley']);
const excludeLegacyPlaceholderVenues = (venues) => (venues || []).filter((venue) => !LEGACY_PLACEHOLDER_VENUE_IDS.has(venue.id));

function isMissingResumeState(error) {
  return error?.code === '42703' || error?.message?.includes('resume_state') && error.message.includes('does not exist');
}

function isMissingCourtLabel(error) {
  return (error?.code === '42703' || error?.code === 'PGRST204') && /court_(label|area)/.test(error?.message || '');
}

const DEMO_VENUE_IDS = ['yard', 'rockwell', 'valley'];

// A match court is either a listed Peakle court (venueId + courtId) or a court
// the player typed in. Both keep a readable label so history never loses it.
export function matchCourtValues(court) {
  const demoVenueId = DEMO_VENUE_IDS.find((id) => court?.id?.startsWith(id));
  const demoCourtNumber = court?.id?.match(/(\d+)$/)?.[1];
  const venueId = court?.venueId || demoVenueId || null;
  const courtId = court?.courtId || (demoVenueId && demoCourtNumber ? `${demoVenueId}-court-${demoCourtNumber}` : null);
  return {
    venue_id: venueId,
    court_id: venueId ? courtId : null,
    court_label: courtLabel(court) || null,
    court_area: cleanCourtText(court?.area) || null,
  };
}

function withoutCourtLabel({ court_label: _label, court_area: _area, ...values }) {
  return values;
}

function isMissingTeamCoverColumn(error) {
  return (error?.code === '42703' && error?.message?.includes('cover_image_url'))
    || (error?.message?.includes('cover_image_url') && error.message.includes('does not exist'));
}

function teamCoverMigrationError() {
  return new Error('Team cover photos require the latest database update. Apply migration 202607220002_team_cover_image.sql, then try again.');
}

async function readLocalUnfinishedMatch(userId) {
  if (!userId) return null;
  const stored = await AsyncStorage.getItem(unfinishedMatchKey(userId)).catch(() => null);
  if (!stored) return null;
  try { return JSON.parse(stored); } catch { return null; }
}

async function writeLocalUnfinishedMatch(userId, match) {
  if (!userId) return;
  const current = await readLocalUnfinishedMatch(userId);
  if (current?.draftSavedAt > (match.draftSavedAt || 0)) return;
  await AsyncStorage.setItem(unfinishedMatchKey(userId), JSON.stringify(match));
}

async function clearLocalUnfinishedMatch(userId) {
  if (!userId) return;
  await AsyncStorage.removeItem(unfinishedMatchKey(userId)).catch(() => {});
}

function localDateTime(date, time) {
  const [clock, period] = time.split(' ');
  const [rawHour, minute] = clock.split(':').map(Number);
  const hour = (rawHour % 12) + (period === 'PM' ? 12 : 0);
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;
}

export function bookingDateRange(dateIso, time, duration) {
  const startsAt = new Date(localDateTime(dateIso, time));
  return { startsAt, endsAt: new Date(startsAt.getTime() + duration * 60_000) };
}

const oneRow = (data) => Array.isArray(data) ? data[0] : data;

export async function quoteCourtBooking({ courtIds, dateIso, time, duration, promoCode = '' }) {
  if (DEMO_MODE) return { ...DEMO_QUOTE };
  const { startsAt, endsAt } = bookingDateRange(dateIso, time, duration);
  if (startsAt.getTime() <= Date.now()) throw new Error('Choose a future booking time. This time has already started.');
  const { data, error } = await requireSupabase().rpc('quote_booking', {
    p_court_ids: courtIds,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_promo_code: promoCode.trim() || null,
  });
  if (error) throw error;
  const quote = oneRow(data);
  return {
    ...quote,
    subtotal: Number(quote.subtotal || 0),
    discount_amount: Number(quote.discount_amount || 0),
    fee_amount: Number(quote.fee_amount || 0),
    total: Number(quote.total || 0),
  };
}

export async function createMultiCourtBooking({ quoteId, inviteTeam = false, teamId = null, idempotencyKey }) {
  const requestKey = idempotencyKey || Crypto.randomUUID();
  const { data, error } = await requireSupabase().rpc('create_multi_court_booking', {
    p_quote_id: quoteId,
    p_idempotency_key: requestKey,
    p_invite_team: inviteTeam,
    p_team_id: inviteTeam ? teamId : null,
  });
  if (error) throw error;
  return { bookings: data || [], idempotencyKey: requestKey };
}

export async function modifyBooking({ bookingId, quoteId, expectedRevision }) {
  const { data, error } = await requireSupabase().rpc('modify_booking', {
    p_booking_id: bookingId,
    p_quote_id: quoteId,
    p_expected_revision: expectedRevision,
  });
  if (error) throw error;
  return oneRow(data);
}

export async function cancelBooking(bookingId, expectedRevision, reason = '') {
  const { data, error } = await requireSupabase().rpc('cancel_booking', {
    p_booking_id: bookingId,
    p_expected_revision: expectedRevision,
    p_reason: reason.trim() || null,
  });
  if (error) throw error;
  const cancelled = oneRow(data);
  // Best-effort: if nothing is owed back (e.g. still pay-at-venue, or the
  // cancellation forfeits the full amount) the edge function is a no-op.
  // A failure here shouldn't surface as "the cancellation failed" — the
  // booking is already cancelled; admin can retry the refund manually.
  try { await triggerBookingRefund(bookingId); } catch { /* retried from the admin refund queue */ }
  return cancelled;
}

export async function cancelUnpaidBooking(bookingId, expectedRevision) {
  const { data, error } = await requireSupabase().rpc('cancel_unpaid_booking', {
    p_booking_id: bookingId,
    p_expected_revision: expectedRevision,
  });
  if (error) throw error;
  return oneRow(data);
}

export async function startBookingCheckout(bookingId, paymentMethodType) {
  const { data, error } = await requireSupabase().functions.invoke('create-checkout-session', {
    body: { booking_id: bookingId, payment_method_type: paymentMethodType, platform: Platform.OS === 'web' ? 'web' : Platform.OS },
  });
  if (error) throw new Error(error.message || 'Could not start checkout.');
  if (!data?.checkout_url) throw new Error(data?.error || 'Checkout is unavailable right now.');
  return data;
}

export async function triggerBookingRefund(bookingId) {
  const { data, error } = await requireSupabase().functions.invoke('process-refund', {
    body: { booking_id: bookingId },
  });
  if (error) throw new Error(error.message || 'Could not process the refund.');
  return data;
}

export async function joinCourtWaitlist({ courtId, dateIso, time, duration }) {
  const { startsAt, endsAt } = bookingDateRange(dateIso, time, duration);
  const { data, error } = await requireSupabase().rpc('join_court_waitlist', {
    p_court_id: courtId,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
  });
  if (error) throw error;
  return oneRow(data);
}

export async function createBooking({ userId, venue, court, booking }) {
  const client = requireSupabase();
  const startsAt = new Date(localDateTime(booking.dateIso, booking.time));
  const endsAt = new Date(startsAt.getTime() + booking.duration * 60_000);
  if (startsAt.getTime() <= Date.now()) throw new Error('Choose a future booking time. This time has already started.');
  let { data, error } = await client.rpc('create_booking', {
    p_court_id: court.id,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_invite_team: booking.inviteTeam,
    p_team_id: booking.inviteTeam ? booking.teamId : null,
  });
  // Keep court booking available during a rolling deploy where the client can
  // arrive before the migration that adds the team_id RPC argument.
  if (error?.code === 'PGRST202') {
    ({ data, error } = await client.rpc('create_booking', {
      p_court_id: court.id,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_invite_team: booking.inviteTeam,
    }));
  }
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function listVenues({ signal } = {}) {
  if (DEMO_MODE) return DEMO_VENUE_ROWS;
  let query = requireSupabase().from('venues').select('*, courts(*)').eq('active', true).eq('verification_status', 'verified').eq('courts.active', true).order('name');
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return excludeLegacyPlaceholderVenues(data);
}

export async function listManagedVenues() {
  const client = requireSupabase();
  const { data: adminAccess, error: adminError } = await client
    .from('platform_admins')
    .select('user_id')
    .limit(1)
    .maybeSingle();
  if (adminError) throw adminError;
  if (adminAccess) {
    const { data: venues, error: venueError } = await client.from('venues').select('*, courts(*)').order('name');
    if (venueError) throw venueError;
    return excludeLegacyPlaceholderVenues(venues).map((venue) => ({
      ...venue,
      role: 'admin',
      courts: [...(venue.courts || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }));
  }
  const { data, error } = await requireSupabase()
    .from('venue_members')
    .select('role, venues(*, courts(*))')
    .order('created_at');
  if (error) throw error;
  return (data || [])
    .filter((membership) => membership.venues)
    .filter((membership) => !LEGACY_PLACEHOLDER_VENUE_IDS.has(membership.venues.id))
    .map((membership) => ({
      ...membership.venues,
      role: membership.role,
      courts: [...(membership.venues.courts || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }));
}

export async function hasAnyVenueMembership(userId) {
  if (!userId) return false;
  const { data, error } = await requireSupabase()
    .from('venue_members')
    .select('venue_id')
    .eq('user_id', userId)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

export function verifiedPublishingVenues(venues = []) {
  return venues.filter((venue) => venue?.verification_status === 'verified' && venue.active !== false);
}

export async function createManagedVenue(details) {
  const { data, error } = await requireSupabase().rpc('create_venue_application', {
    p_name: details.name.trim(),
    p_area: details.area.trim(),
    p_address: details.address.trim(),
    p_venue_type: details.venueType,
    p_google_maps_url: details.googleMapsUrl.trim(),
    p_description: details.description.trim() || null,
    p_opens_at: details.opensAt,
    p_closes_at: details.closesAt,
    p_latitude: details.latitude,
    p_longitude: details.longitude,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function reviewManagedVenueApplication(venueId, approve) {
  const { data, error } = await requireSupabase().rpc('review_venue_application', {
    p_venue_id: venueId,
    p_approve: Boolean(approve),
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function updateManagedVenueLocation(venueId, { latitude, longitude }) {
  const { data, error } = await requireSupabase()
    .from('venues')
    .update({ latitude: Number(latitude), longitude: Number(longitude) })
    .eq('id', venueId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createManagedCourt({ venueId, name, environment, surface, hourlyPrice }) {
  const { data, error } = await requireSupabase().rpc('create_venue_court', {
    p_venue_id: venueId,
    p_name: name,
    p_environment: environment,
    p_surface: surface,
    p_owner_hourly_price: hourlyPrice,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function updateManagedCourt(courtId, changes) {
  const payload = {};
  if (changes.name !== undefined) payload.name = changes.name.trim();
  if (changes.environment !== undefined) payload.environment = changes.environment;
  if (changes.surface !== undefined) payload.surface = changes.surface.trim();
  if (changes.hourlyPrice !== undefined) payload.owner_hourly_price = changes.hourlyPrice;
  if (changes.active !== undefined) payload.active = changes.active;
  const { data, error } = await requireSupabase().from('courts').update(payload).eq('id', courtId).select().single();
  if (error) throw error;
  return data;
}

export async function listMyBookingsPage({ historyPage = 0, historyPageSize = 30, signal } = {}) {
  if (DEMO_MODE) return { bookings: [], hasMoreHistory: false };
  const client = requireSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error('Sign in before loading your bookings.');
  const now = new Date().toISOString();
  const historyFrom = historyPage * historyPageSize;
  const historyTo = historyFrom + historyPageSize;
  const fields = '*, venues(*), courts(*)';
  let upcomingQuery = client.from('bookings').select(fields)
    .eq('user_id', userId)
    .in('status', ['pending', 'confirmed'])
    .gt('ends_at', now)
    .order('starts_at', { ascending: true });
  let historyQuery = client.from('bookings').select(fields)
    .eq('user_id', userId)
    .or(`status.in.(cancelled,completed,no_show),ends_at.lte.${now}`)
    .order('starts_at', { ascending: false })
    .range(historyFrom, historyTo);
  if (signal) {
    upcomingQuery = upcomingQuery.abortSignal(signal);
    historyQuery = historyQuery.abortSignal(signal);
  }
  const [upcomingResult, historyResult] = await Promise.all([
    upcomingQuery,
    historyQuery,
  ]);
  if (upcomingResult.error) throw upcomingResult.error;
  if (historyResult.error) throw historyResult.error;
  const upcoming = (upcomingResult.data || []).filter((booking) => booking.user_id === userId);
  const history = (historyResult.data || []).filter((booking) => booking.user_id === userId);
  return {
    bookings: [...upcoming, ...history.slice(0, historyPageSize)],
    hasMoreHistory: history.length > historyPageSize,
  };
}

export async function listMyBookings(options) {
  const result = await listMyBookingsPage(options);
  return result.bookings;
}

export async function listMyPaymentHistory({ page = 0, pageSize = 20, signal } = {}) {
  const client = requireSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error('Sign in before loading your payment history.');
  const from = page * pageSize;
  const to = from + pageSize;
  let query = client.from('bookings')
    .select('id, amount, currency, payment_status, payment_method, refund_status, created_at, starts_at, venues(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  return {
    payments: rows.slice(0, pageSize),
    hasMore: rows.length > pageSize,
  };
}

export async function extendBooking(bookingId) {
  const { data, error } = await requireSupabase().rpc('extend_booking', {
    p_booking_id: bookingId,
    p_minutes: 30,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function listCourtSchedule(courtId, dateIso) {
  const start = new Date(`${dateIso}T00:00:00+08:00`).toISOString();
  const end = new Date(`${dateIso}T23:59:59+08:00`).toISOString();
  const { data, error } = await requireSupabase().from('bookings').select('starts_at, ends_at').eq('court_id', courtId).in('status', ['pending', 'confirmed']).lt('starts_at', end).gt('ends_at', start);
  if (error) throw error;
  return data;
}

export async function listCourtAvailability(courtIds, dateIso) {
  if (DEMO_MODE) return [];
  const startsAt = new Date(`${dateIso}T00:00:00+08:00`);
  const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60_000);
  const { data, error } = await requireSupabase().rpc('get_court_schedule', {
    p_court_ids: courtIds,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
  });
  if (!error) return data || [];
  // Preserve single-court availability during a rolling migration deploy.
  if (courtIds.length === 1 && error.code === 'PGRST202') {
    return listCourtSchedule(courtIds[0], dateIso).then((rows) => rows.map((item) => ({ ...item, court_id: courtIds[0], reason: 'Booked' })));
  }
  throw error;
}

export async function getCourtAvailability(courtIds, startsAt, endsAt) {
  if (!courtIds?.length) return [];
  const { data, error } = await requireSupabase().rpc('get_court_availability', {
    p_court_ids: courtIds,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  });
  if (error) throw error;
  return data || [];
}

export async function listVenueBookingRules(venueId) {
  const [{ data: pricing, error: pricingError }, { data: blackouts, error: blackoutError }] = await Promise.all([
    requireSupabase().from('venue_pricing_rules').select('*').eq('venue_id', venueId).order('priority', { ascending: false }),
    requireSupabase().from('court_blackouts').select('*').eq('venue_id', venueId).gte('ends_at', new Date().toISOString()).order('starts_at'),
  ]);
  if (pricingError) throw pricingError;
  if (blackoutError) throw blackoutError;
  return { pricing: pricing || [], blackouts: blackouts || [] };
}

export async function saveVenuePricingRule(rule) {
  const payload = {
    venue_id: rule.venueId,
    court_id: rule.courtId || null,
    name: rule.name.trim(),
    rule_type: rule.ruleType,
    adjustment_type: rule.adjustmentType,
    adjustment_value: Number(rule.adjustmentValue),
    days_of_week: rule.daysOfWeek?.length ? rule.daysOfWeek : null,
    starts_at_local: rule.startsAtLocal || null,
    ends_at_local: rule.endsAtLocal || null,
    valid_from: rule.validFrom || null,
    valid_until: rule.validUntil || null,
    promo_code: rule.promoCode?.trim() || null,
    priority: Number(rule.priority || 0),
    active: rule.active !== false,
  };
  const query = rule.id
    ? requireSupabase().from('venue_pricing_rules').update(payload).eq('id', rule.id)
    : requireSupabase().from('venue_pricing_rules').insert(payload);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function saveCourtBlackout(blackout) {
  const { data, error } = await requireSupabase().from('court_blackouts').insert({
    venue_id: blackout.venueId,
    court_id: blackout.courtId || null,
    kind: blackout.kind,
    reason: blackout.reason.trim(),
    starts_at: blackout.startsAt,
    ends_at: blackout.endsAt,
    created_by: blackout.userId,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteVenuePricingRule(id) {
  const { error } = await requireSupabase().from('venue_pricing_rules').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteCourtBlackout(id) {
  const { error } = await requireSupabase().from('court_blackouts').delete().eq('id', id);
  if (error) throw error;
}

export async function loadActiveOpenPlay() {
  const client = requireSupabase();
  const { data: root, error } = await client.from('open_play_sessions').select('*').eq('status', 'active').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!root) return null;
  const [playerResult, courtResult, matchResult, decisionResult] = await Promise.all([
    client.from('open_play_players').select('*, profiles!open_play_players_user_id_fkey(display_name, avatar_url)').eq('session_id', root.id),
    client.from('open_play_courts').select('*, venue_court:courts(name)').eq('session_id', root.id).order('court_number'),
    client.from('open_play_matches').select('*, open_play_match_players(*)').eq('session_id', root.id).order('started_at'),
    client.from('open_play_rotation_decisions').select('*').eq('session_id', root.id).order('created_at', { ascending: false }).limit(25),
  ]);
  const failure = playerResult.error || courtResult.error || matchResult.error || decisionResult.error;
  if (failure) throw failure;
  const players = playerResult.data
    .filter((player) => player.checked_in_at || player.guest_name)
    .map((player) => ({ id: player.id, userId: player.user_id, name: player.profiles?.display_name || player.guest_name || 'Registered player', avatar: player.profiles?.avatar_url || null, skill: player.profiles?.skill_rating ?? null, registrationStatus: player.registration_status, checkedInAt: player.checked_in_at, departedAt: player.departed_at, waitingSince: player.waiting_since || player.checked_in_at || player.joined_at, consecutiveGames: Number(player.consecutive_games || 0), lastMatchEndedAt: player.last_match_ended_at, playPreference: player.play_preference || 'either', priorityBoost: Number(player.priority_boost || 0), status: player.status, gamesPlayed: player.games_played }));
  const byMatch = (row) => {
    const lineup = [...row.open_play_match_players].sort((a, b) => a.side - b.side || a.position - b.position);
    const playerIds = lineup.map((item) => item.player_id);
    return {
      id: row.id,
      playerIds,
      teams: [lineup.filter((item) => item.side === 0).map((item) => item.player_id), lineup.filter((item) => item.side === 1).map((item) => item.player_id)],
      scorerId: row.scorer_player_id,
      scores: [row.home_score, row.away_score],
      history: [],
      startedAt: new Date(row.started_at).getTime(),
      endedAt: row.ended_at ? new Date(row.ended_at).getTime() : undefined,
      complete: row.status === 'completed',
      winner: row.winner_side,
    };
  };
  const matches = matchResult.data.map(byMatch);
  const courts = courtResult.data.map((court) => ({
    id: court.id,
    number: court.court_number,
    venueCourtId: court.venue_court_id,
    name: court.venue_court?.name || null,
    matchFormat: court.match_format || root.match_format || 'doubles',
    match: matches.find((match) => matchResult.data.find((row) => row.id === match.id)?.session_court_id === court.id && !match.complete) || null,
  }));
  return {
    id: root.id,
    name: root.name,
    code: root.session_code,
    venueId: root.venue_id,
    visibility: root.visibility,
    approvalMode: root.approval_mode,
    capacity: root.capacity,
    skillMin: root.skill_min,
    skillMax: root.skill_max,
    feeAmount: root.fee_amount,
    scheduledStart: root.scheduled_start,
    scheduledEnd: root.scheduled_end,
    rules: root.rules,
    cancellationPolicy: root.cancellation_policy,
    matchFormat: root.match_format || 'doubles',
    averageMatchMinutes: Number(root.average_match_minutes || 15),
    maxConsecutiveGames: Number(root.max_consecutive_games ?? 2),
    restMinutes: Number(root.rest_minutes || 0),
    operationRevision: Number(root.operation_revision || 0),
    players,
    queue: playerResult.data.filter((player) => player.queue_position !== null).sort((a, b) => a.queue_position - b.queue_position).map((player) => player.id),
    courts,
    completedMatches: matches.filter((match) => match.complete),
    assignmentHistory: (decisionResult.data || []).map((row) => ({ matchId: row.match_id, playerIds: row.selected_player_ids, recommendedIds: row.recommended_player_ids, explanation: row.explanation?.reason || '', overridden: row.overridden, overrideReason: row.override_reason, createdAt: row.created_at })),
  };
}

export async function syncOpenPlay(session) {
  if (!session) return;
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw authError || new Error('No authenticated organizer.');
  const rootPayload = {
    id: session.id,
    organizer_id: auth.user.id,
    name: session.name || 'Open play',
    status: 'active',
    court_count: session.courts.length,
    ...(session.venueId ? { venue_id: session.venueId } : {}),
    ...(session.code ? { session_code: session.code } : {}),
    ...(session.visibility ? { visibility: session.visibility } : {}),
    ...(session.approvalMode ? { approval_mode: session.approvalMode } : {}),
    ...(session.capacity ? { capacity: session.capacity } : {}),
    ...(session.skillMin != null ? { skill_min: session.skillMin } : {}),
    ...(session.skillMax != null ? { skill_max: session.skillMax } : {}),
    ...(session.feeAmount != null ? { fee_amount: session.feeAmount } : {}),
    ...(session.scheduledStart ? { scheduled_start: session.scheduledStart } : {}),
    ...(session.scheduledEnd ? { scheduled_end: session.scheduledEnd } : {}),
    ...(session.rules ? { rules: session.rules } : {}),
    ...(session.cancellationPolicy ? { cancellation_policy: session.cancellationPolicy } : {}),
    ...(session.matchFormat ? { match_format: session.matchFormat } : {}),
    ...(session.averageMatchMinutes ? { average_match_minutes: session.averageMatchMinutes } : {}),
    ...(session.maxConsecutiveGames != null ? { max_consecutive_games: session.maxConsecutiveGames } : {}),
    ...(session.restMinutes != null ? { rest_minutes: session.restMinutes } : {}),
  };
  // Updating an owned session remains available after pass expiry so a live
  // event can be recovered and completed. Only a genuinely new row reaches
  // the entitlement-protected INSERT policy.
  const { data: existingRoot, error: updateRootError } = await client
    .from('open_play_sessions')
    .update(rootPayload)
    .eq('id', session.id)
    .select('id')
    .maybeSingle();
  if (updateRootError) throw updateRootError;
  const { error: rootError } = existingRoot
    ? { error: null }
    : await client.from('open_play_sessions').insert(rootPayload);
  if (rootError?.code === '42501') {
    throw new Error('An active Organizer Pass is required to create a new open-play session. Refresh your pass and try again.');
  }
  if (rootError) throw rootError;
  const queuePositions = new Map(session.queue.map((id, index) => [id, index]));
  if (session.players.length) {
    const { error: playerError } = await client.from('open_play_players').upsert(session.players.map((player) => ({
      id: player.id,
      session_id: session.id,
      ...(player.userId ? { user_id: player.userId } : { guest_name: player.name }),
      status: player.status,
      registration_status: 'approved',
      checked_in_at: player.checkedInAt || new Date().toISOString(),
      departed_at: player.status === 'done' ? new Date().toISOString() : null,
      games_played: player.gamesPlayed,
      waiting_since: player.waitingSince || player.checkedInAt || new Date().toISOString(),
      consecutive_games: Number(player.consecutiveGames || 0),
      last_match_ended_at: player.lastMatchEndedAt || null,
      play_preference: player.playPreference || 'either',
      priority_boost: Number(player.priorityBoost || 0),
      queue_position: queuePositions.has(player.id) ? queuePositions.get(player.id) : null,
    })));
    if (playerError) throw playerError;
  }
  const { error: courtError } = await client.from('open_play_courts').upsert(session.courts.map((court) => ({
    id: court.id,
    session_id: session.id,
    court_number: court.number,
    venue_court_id: court.venueCourtId || null,
    match_format: court.matchFormat || (session.matchFormat === 'mixed' ? 'doubles' : session.matchFormat) || 'doubles',
  })));
  if (courtError) throw courtError;
  const activeMatches = session.courts.flatMap((court) => court.match ? [{ ...court.match, courtId: court.id }] : []);
  const completedMatches = session.completedMatches.map((match) => ({ ...match, courtId: session.courts.find((court) => court.number === match.courtNumber)?.id }));
  const matches = [...completedMatches, ...activeMatches].filter((match) => match.courtId);
  for (const match of matches) {
    const complete = Boolean(match.endedAt || match.complete && completedMatches.some((item) => item.id === match.id));
    // Match scoring is server-authoritative. Assign/start and score RPCs create
    // and mutate existing matches atomically, so a delayed organizer snapshot
    // must never overwrite a newer score or completed state.
    const { error: matchError } = await client.from('open_play_matches').upsert({
      id: match.id,
      session_id: session.id,
      session_court_id: match.courtId,
      scorer_player_id: match.scorerId || null,
      home_score: match.scores[0],
      away_score: match.scores[1],
      winner_side: match.winner,
      status: complete ? 'completed' : 'live',
      started_at: new Date(match.startedAt).toISOString(),
      ended_at: match.endedAt ? new Date(match.endedAt).toISOString() : null,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (matchError) throw matchError;
    const lineup = match.teams.flatMap((team, side) => team.map((playerId, position) => ({ match_id: match.id, player_id: playerId, side, position })));
    const { error: lineupError } = await client.from('open_play_match_players').upsert(lineup);
    if (lineupError) throw lineupError;
  }
}

export async function updateOpenPlayMatchScorer(matchId, scorerPlayerId) {
  const { data, error } = await requireSupabase()
    .from('open_play_matches')
    .update({ scorer_player_id: scorerPlayerId })
    .eq('id', matchId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Only the session organizer can change the assigned scorer.');
}

export async function completeOpenPlay(sessionId) {
  if (!sessionId) return;
  const { data, error } = await requireSupabase()
    .from('open_play_sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The live session could not be ended. Refresh it and try again.');
}

export async function listTeams() {
  if (DEMO_MODE) return DEMO_TEAMS;
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('teams').select('*, team_members(user_id, role, profiles(display_name, avatar_url))').neq('status', 'archived').order('created_at', { ascending: false });
  if (error) throw error;
  const unique = data.filter((team, index, arr) => arr.findIndex((t) => t.id === team.id) === index);
  const statsByTeam = await getTeamStats(unique.map((team) => team.id));
  return unique.map((team) => {
    const mine = team.team_members.find((member) => member.user_id === auth.user?.id);
    const stats = statsByTeam[team.id];
    const memberRating = (userId) => stats?.member_ratings?.[userId] != null ? Number(stats.member_ratings[userId]).toFixed(1) : 'Unrated';
    return {
      id: team.id, name: team.name, tag: team.tag, location: team.location || '', latitude: team.latitude, longitude: team.longitude,
      members: team.member_count ?? team.team_members.length, capacity: team.capacity, rating: stats?.rating != null ? Number(stats.rating).toFixed(1) : '—', winRate: stats?.win_rate != null ? `${stats.win_rate}%` : '—', wins: stats?.wins ?? 0, losses: stats?.losses ?? 0, level: team.skill_level || 'Open level', color: team.color || '#1C6B66',
      icon: 'people-outline', role: mine ? ({ creator: 'Owner', admin: 'Admin', co_admin: 'Co-admin', member: 'Member' }[mine.role]) : null, about: team.about || '',
      image: team.image_url, coverImage: team.cover_image_url, isDiscoverable: team.is_discoverable, status: team.status || ((team.member_count ?? team.team_members.length) >= 4 ? 'active' : 'forming'),
      roster: team.team_members.map((member) => ({ id: member.user_id, name: member.profiles?.display_name || 'Player', initials: (member.profiles?.display_name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), avatar: member.profiles?.avatar_url || null, role: ({ creator: 'Owner', admin: 'Admin', co_admin: 'Co-admin', member: 'Member' }[member.role]) || 'Member', rating: memberRating(member.user_id), color: '#1C6B66' })),
      acceptedMembers: team.team_members.filter((member) => member.user_id !== auth.user?.id).map((member) => ({ id: member.user_id, name: member.profiles?.display_name || 'Player', rating: memberRating(member.user_id) })),
    };
  });
}

// Team rating, win rate, and member ratings come from members' completed
// matches (see get_team_stats). Stats are secondary: a missing RPC or error
// leaves the dashes in place instead of failing the Teams list.
export async function getTeamStats(teamIds) {
  if (DEMO_MODE || !teamIds?.length) return {};
  const { data, error } = await requireSupabase().rpc('get_team_stats', { p_team_ids: teamIds });
  if (error) {
    console.warn('Team stats unavailable:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((row) => [row.team_id, row]));
}

export async function createTeamRecord(details) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to create a team.');
  const creationRequestId = details.creationRequestId || Crypto.randomUUID();
  const values = {
    id: creationRequestId,
    creator_id: auth.user.id, name: details.name, tag: details.tag, motto: null, about: details.about,
    location: details.location, latitude: details.latitude, longitude: details.longitude, skill_level: details.level,
    capacity: details.capacity, color: details.color || '#1C6B66', image_url: details.image || null, cover_image_url: details.coverImage || null,
    is_discoverable: Boolean(details.isDiscoverable),
  };
  let { data, error } = await client.from('teams').insert(values).select().single();
  if (isMissingTeamCoverColumn(error)) {
    if (details.coverImage) throw teamCoverMigrationError();
    const { cover_image_url: ignoredCover, ...legacyValues } = values;
    ({ data, error } = await client.from('teams').insert(legacyValues).select().single());
  }
  if (error?.code === '23505') {
    const { data: existing, error: existingError } = await client.from('teams').select().eq('id', creationRequestId).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return existing;
  }
  if (error?.code === '23514' && error.message?.includes('teams_tag_check')) {
    throw new Error('We could not generate a valid team abbreviation. Update the team name and try again.');
  }
  if (error) throw error;
  return data;
}

export async function updateTeamRecord(teamId, details) {
  const client = requireSupabase();
  const values = {
    name: details.name, tag: details.tag, motto: null, about: details.about, location: details.location,
    latitude: details.latitude, longitude: details.longitude, skill_level: details.level, capacity: details.capacity,
    color: details.color, image_url: details.image || null, cover_image_url: details.coverImage || null, is_discoverable: Boolean(details.isDiscoverable),
  };
  let { error } = await client.from('teams').update(values).eq('id', teamId);
  if (isMissingTeamCoverColumn(error)) {
    if (details.coverImage) throw teamCoverMigrationError();
    const { cover_image_url: ignoredCover, ...legacyValues } = values;
    ({ error } = await client.from('teams').update(legacyValues).eq('id', teamId));
  }
  if (error?.code === '23514' && error.message?.includes('teams_tag_check')) {
    throw new Error('We could not generate a valid team abbreviation. Update the team name and try again.');
  }
  if (error) throw error;
}

export async function requestTeamJoin(teamId, note = '') {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to join a team.');
  const { error } = await client.from('team_join_requests').upsert({ team_id: teamId, user_id: auth.user.id, note, status: 'pending' }, { onConflict: 'team_id,user_id' });
  if (error) throw error;
}

export async function cancelTeamJoin(teamId) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to cancel a join request.');
  const { error } = await client
    .from('team_join_requests')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', auth.user.id)
    .eq('status', 'pending');
  if (error) throw error;
}

export async function searchTeamInviteCandidates(query) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to invite a player.');
  const clean = query.trim();
  if (clean.length < 2) return [];
  const { data, error } = await client.from('profiles')
    .select('id, display_name, avatar_url, home_area')
    .neq('id', auth.user.id)
    .ilike('display_name', `%${clean}%`)
    .order('display_name')
    .limit(20);
  if (error) throw error;
  return data;
}

export async function inviteTeamMember(teamId, invitedUserId) {
  const { data, error } = await requireSupabase().rpc('invite_team_member', {
    p_team_id: teamId,
    p_invited_user_id: invitedUserId,
  });
  if (error) throw error;
  return data;
}

export async function listMyTeamInvitations() {
  if (DEMO_MODE) return [];
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await client.from('team_invitations')
    .select('*, teams(id, name, tag, location, skill_level, capacity, image_url, color, is_discoverable, status)')
    .eq('invited_user_id', auth.user.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function respondTeamInvitation(invitationId, accept) {
  const { data, error } = await requireSupabase().rpc('respond_team_invitation', {
    p_invitation_id: invitationId,
    p_accept: Boolean(accept),
  });
  if (error) throw error;
  return data;
}

export async function listTeamRequests(teamIds) {
  if (!teamIds.length) return [];
  const { data, error } = await requireSupabase()
    .from('team_join_requests')
    .select('*, profiles!team_join_requests_user_id_fkey(display_name, avatar_url, home_area, play_preference)')
    .in('team_id', teamIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listMyTeamRequests() {
  if (DEMO_MODE) return [];
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await client.from('team_join_requests').select('team_id').eq('user_id', auth.user.id).eq('status', 'pending');
  if (error) throw error;
  return data.map((item) => item.team_id);
}

export async function reviewTeamRequest(request, accept) {
  const client = requireSupabase();
  const { error } = await client.rpc('review_team_request', { p_request_id: request.id, p_accept: accept });
  if (error) throw error;
}

export async function updateTeamMemberRole(teamId, userId, role) {
  const { data, error } = await requireSupabase().rpc('update_team_member_role', {
    p_team_id: teamId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw error;
  return data;
}

export async function removeTeamMember(teamId, userId) {
  const { error } = await requireSupabase().rpc('remove_team_member', {
    p_team_id: teamId,
    p_user_id: userId,
  });
  if (error) throw error;
}

const TEAM_MESSAGE_SELECT = '*, profiles!team_messages_sender_id_fkey(display_name, avatar_url), team_message_reactions(emoji, user_id), team_message_pins(pinned_by, pinned_at)';
const CHAT_PAGE_SIZE = 40;

async function addSignedChatMedia(client, rows) {
  const paths = [...new Set((rows || []).map((row) => row.media_path).filter(Boolean))];
  if (!paths.length) return (rows || []).map((row) => ({ ...row, media_url: row.image_url || null }));
  const { data, error } = await client.storage.from('team-chat-media').createSignedUrls(paths, 3600);
  if (error) throw error;
  const urls = new Map((data || []).map((item, index) => [paths[index], item.signedUrl]));
  return (rows || []).map((row) => ({ ...row, media_url: row.media_path ? urls.get(row.media_path) || null : row.image_url }));
}

async function removeHiddenChatRows(client, rows) {
  const ids = (rows || []).map((row) => row.id);
  if (!ids.length) return rows || [];
  const { data, error } = await client.from('team_message_hides').select('message_id').in('message_id', ids);
  if (error) throw error;
  const hiddenIds = new Set((data || []).map((item) => item.message_id));
  return rows.filter((row) => !hiddenIds.has(row.id));
}

export async function listTeamMessages(teamId, { before = null, limit = CHAT_PAGE_SIZE } = {}) {
  if (DEMO_MODE) {
    return {
      rows: teamId === DEMO_TEAM_ID && !before ? DEMO_TEAM_MESSAGE_ROWS : [],
      hasMore: false,
      cursor: null,
    };
  }
  const client = requireSupabase();
  let query = client.from('team_messages').select(TEAM_MESSAGE_SELECT).eq('team_id', teamId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (before?.createdAt && before?.id) {
    query = query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
  } else if (before?.createdAt) {
    query = query.lt('created_at', before.createdAt);
  }
  const { data, error } = await query;
  if (error) throw error;
  const page = data || [];
  const hasMore = page.length > limit;
  const rows = page.slice(0, limit);
  const cursorRow = rows[rows.length - 1];
  const visibleRows = (await removeHiddenChatRows(client, rows)).reverse();
  return {
    rows: await addSignedChatMedia(client, visibleRows),
    hasMore,
    cursor: cursorRow ? { createdAt: cursorRow.created_at, id: cursorRow.id } : null,
  };
}

export async function getTeamMessage(messageId) {
  const client = requireSupabase();
  const { data, error } = await client.from('team_messages').select(TEAM_MESSAGE_SELECT).eq('id', messageId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: hidden, error: hiddenError } = await client.from('team_message_hides').select('message_id').eq('message_id', messageId).maybeSingle();
  if (hiddenError) throw hiddenError;
  if (hidden) return null;
  return (await addSignedChatMedia(client, [data]))[0];
}

export async function listPinnedTeamMessages(teamId) {
  const client = requireSupabase();
  const { data: pins, error: pinsError } = await client.from('team_message_pins')
    .select('message_id, pinned_at')
    .eq('team_id', teamId)
    .order('pinned_at', { ascending: false });
  if (pinsError) throw pinsError;
  if (!pins?.length) return [];
  const { data, error } = await client.from('team_messages')
    .select(TEAM_MESSAGE_SELECT)
    .in('id', pins.map((pin) => pin.message_id))
    .is('deleted_at', null);
  if (error) throw error;
  const pinnedAt = new Map(pins.map((pin) => [pin.message_id, pin.pinned_at]));
  const rows = (data || []).sort((a, b) => new Date(pinnedAt.get(b.id)) - new Date(pinnedAt.get(a.id)));
  return addSignedChatMedia(client, await removeHiddenChatRows(client, rows));
}

export async function listTeamSharedMedia(teamId, limit = 120) {
  const client = requireSupabase();
  const { data, error } = await client.from('team_messages')
    .select(TEAM_MESSAGE_SELECT)
    .eq('team_id', teamId)
    .is('deleted_at', null)
    .or('media_path.not.is.null,image_url.not.is.null')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return addSignedChatMedia(client, await removeHiddenChatRows(client, data || []));
}

export async function listTeamMessageReadStates(teamId) {
  const { data, error } = await requireSupabase().from('team_message_reads').select('user_id, last_read_at, profiles(display_name, avatar_url)').eq('team_id', teamId);
  if (error) throw error;
  return data || [];
}

export async function listTeamConversationSummaries(teamIds) {
  if (DEMO_MODE) {
    return teamIds.includes(DEMO_TEAM_ID) ? [{
      team_id: DEMO_TEAM_ID, last_body: 'Rematch next week? Same court', last_has_image: false,
      last_created_at: DEMO_TEAM_MESSAGE_ROWS[DEMO_TEAM_MESSAGE_ROWS.length - 1].created_at,
      last_sender_name: 'Diego Ramirez', unread_count: 0,
    }] : [];
  }
  if (!teamIds.length) return [];
  const { data, error } = await requireSupabase().rpc('list_team_conversations', { p_team_ids: teamIds });
  if (error) throw error;
  return data || [];
}

export async function markTeamConversationRead(teamId) {
  const { error } = await requireSupabase().rpc('mark_team_conversation_read', { p_team_id: teamId });
  if (error) throw error;
}

export async function getChatSafetyStatus() {
  if (DEMO_MODE) return { acknowledged: true, isAdult: true, eligible: true, suspended: false, suspendedUntil: null };
  const { data, error } = await requireSupabase().rpc('get_chat_safety_status');
  if (error) throw error;
  const status = Array.isArray(data) ? data[0] : data;
  return {
    acknowledged: Boolean(status?.acknowledged),
    isAdult: Boolean(status?.is_adult),
    eligible: Boolean(status?.eligible),
    suspended: Boolean(status?.suspended),
    suspendedUntil: status?.suspended_until || null,
  };
}

export async function acknowledgeChatSafety(isAdult) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('acknowledge_chat_safety', { p_is_adult: Boolean(isAdult) });
  if (error) throw error;
  const status = Array.isArray(data) ? data[0] : data;
  // Players waiting on this account's chat gate can re-check right away.
  announcePlayerStatusChange();
  return {
    acknowledged: Boolean(status?.acknowledged),
    isAdult: Boolean(status?.is_adult),
    eligible: Boolean(status?.eligible),
    suspended: Boolean(status?.suspended),
    suspendedUntil: status?.suspended_until || null,
  };
}

export async function listBlockedChatUsers() {
  const { data, error } = await requireSupabase().rpc('list_blocked_chat_users');
  if (error) throw error;
  return (data || []).map((item) => ({
    id: item.user_id,
    name: item.display_name || 'Peakle player',
    avatar: item.avatar_url || null,
    blockedAt: item.blocked_at,
  }));
}

export async function blockChatUser(userId) {
  const { error } = await requireSupabase().rpc('block_chat_user', { p_user_id: userId });
  if (error) throw error;
}

export async function unblockChatUser(userId) {
  const { error } = await requireSupabase().rpc('unblock_chat_user', { p_user_id: userId });
  if (error) throw error;
}

export async function reportTeamMessage(messageId, reason, details = '') {
  const { data, error } = await requireSupabase().rpc('report_team_message', {
    p_message_id: messageId,
    p_reason: reason,
    p_details: details?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function moderateTeamMessage(messageId, reason) {
  const { error } = await requireSupabase().rpc('moderate_team_message', {
    p_message_id: messageId,
    p_reason: reason,
  });
  if (error) throw error;
}

// When any other member's app last checked in, for Sent / Delivered receipts.
// Non-essential: before the migration is applied, or on any error, it is null
// and receipts stay at Sent.
export async function getTeamChatLastActive(teamId) {
  if (DEMO_MODE || !teamId) return null;
  try {
    const { data, error } = await requireSupabase().rpc('get_team_chat_last_active', { p_team_id: teamId });
    return error ? null : data || null;
  } catch {
    return null;
  }
}

export async function sendTeamMessage(teamId, body, media = null) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in before sending a message.');
  const { data, error } = await client.from('team_messages').insert({
    team_id: teamId,
    sender_id: auth.user.id,
    body: body?.trim() || null,
    media_path: media?.path || null,
    media_type: media?.type || null,
    media_name: media?.name || null,
    media_mime: media?.mime || null,
    media_size: media?.size || null,
  }).select(TEAM_MESSAGE_SELECT).single();
  if (error) throw error;
  return (await addSignedChatMedia(client, [data]))[0];
}

export async function editTeamMessage(messageId, body) {
  const client = requireSupabase();
  const { error } = await client.rpc('edit_team_message', { p_message_id: messageId, p_body: body });
  if (error) throw error;
  return getTeamMessage(messageId);
}

export async function unsendTeamMessage(messageId) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('unsend_team_message', { p_message_id: messageId });
  if (error) throw error;
  const mediaPath = Array.isArray(data) ? data[0]?.media_path : data?.media_path;
  if (mediaPath) {
    const { error: removeError } = await client.storage.from('team-chat-media').remove([mediaPath]);
    if (removeError) console.warn('The message was unsent but its media cleanup failed.', removeError.message);
  }
  return getTeamMessage(messageId);
}

export async function hideTeamMessage(messageId) {
  const { error } = await requireSupabase().rpc('hide_team_message', { p_message_id: messageId });
  if (error) throw error;
}

export async function toggleTeamMessageReaction(messageId, emoji) {
  const client = requireSupabase();
  const { error } = await client.rpc('toggle_team_message_reaction', { p_message_id: messageId, p_emoji: emoji });
  if (error) throw error;
  return getTeamMessage(messageId);
}

export async function toggleTeamMessagePin(messageId) {
  const client = requireSupabase();
  const { error } = await client.rpc('toggle_team_message_pin', { p_message_id: messageId });
  if (error) throw error;
  return getTeamMessage(messageId);
}

const mediaExtension = (mime, fileName = '') => {
  const known = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  };
  return known[mime] || fileName.split('.').pop()?.toLowerCase() || 'bin';
};

const CHAT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export async function uploadTeamChatMedia(teamId, asset, requestedType, options) {
  return uploadChatMedia('team-chat-media', (userId) => `${teamId}/${userId}`, asset, requestedType, 'Team', options);
}

// Shared by team and private chats: photos are resized to 1600px JPEGs
// (2 MB max), videos keep their format (15 MB max), and voice recordings are
// uploaded as recorded (10 MB max). folderFor(userId) is the
// storage folder the bucket's policies expect.
// supabase-js storage uploads report no progress, so uploads that show a
// progress ring go through the Storage REST endpoint with XMLHttpRequest.
function uploadStorageObjectWithProgress({ bucket, path, file, contentType, accessToken, onProgress }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    request.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`);
    request.timeout = 5 * 60 * 1000;
    request.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    request.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    request.setRequestHeader('Content-Type', contentType);
    request.setRequestHeader('x-upsert', 'false');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) { resolve(); return; }
      let message = 'The upload failed. Check your connection and try again.';
      try { message = JSON.parse(request.responseText)?.message || message; } catch (_) { /* keep default */ }
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'));
    request.ontimeout = () => reject(new Error('The upload took too long. Check your connection and try again.'));
    request.onabort = () => reject(new Error('The upload was interrupted. Please try again.'));
    request.send(file);
  });
}

// onProgress receives 0–1: preparing the file, uploading it, then signing it.
export async function uploadChatMedia(bucket, folderFor, asset, requestedType, namePrefix = 'Chat', { onProgress } = {}) {
  const report = (value) => onProgress?.(Math.max(0, Math.min(1, value)));
  report(0);
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in before uploading media.');

  const originalMime = asset.mimeType || (requestedType === 'video' ? 'video/mp4' : 'image/jpeg');
  const isGif = originalMime === 'image/gif' || asset.fileName?.toLowerCase().endsWith('.gif');
  if (isGif) throw new Error('GIF sending is temporarily unavailable.');
  if (!['image', 'video', 'audio'].includes(requestedType)) throw new Error('This attachment type is not supported.');

  let uploadUri = asset.uri;
  let mime = originalMime;
  let type = requestedType;
  if (requestedType === 'image' && !CHAT_IMAGE_MIMES.includes(originalMime)) {
    // Photos are sent as the original file so they arrive at full quality on
    // every device. Only formats other devices cannot show (HEIC and friends)
    // are converted, at full size and maximum quality.
    const converted = await ImageManipulator.manipulateAsync(uploadUri, [], { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
    uploadUri = converted.uri;
    mime = 'image/jpeg';
  } else if (requestedType === 'video') {
    const extension = asset.fileName?.split('.').pop()?.toLowerCase();
    if (extension === 'mov') mime = 'video/quicktime';
    else if (extension === 'webm') mime = 'video/webm';
    else if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(mime)) mime = 'video/mp4';
  } else if (requestedType === 'audio') {
    // Native recorders write .m4a files; the web recorder hands over a blob
    // URL, so its caller passes the mime type.
    const extension = (asset.fileName || asset.uri || '').split('?')[0].split('.').pop()?.toLowerCase();
    if (asset.mimeType?.startsWith('audio/')) mime = asset.mimeType.split(';')[0];
    else if (extension === 'webm') mime = 'audio/webm';
    else if (extension === 'ogg') mime = 'audio/ogg';
    else if (extension === 'mp3') mime = 'audio/mpeg';
    else mime = 'audio/mp4';
  }

  report(0.05);
  const response = await fetch(uploadUri);
  const file = await response.arrayBuffer();
  const maxBytes = { image: 50, video: 15, audio: 10 }[type] * 1024 * 1024;
  if (file.byteLength > maxBytes) throw new Error(`${{ video: 'Video', audio: 'Voice message' }[type] || 'Image'} is too large. The limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`);

  const extension = mediaExtension(mime, asset.fileName);
  const path = `${folderFor(auth.user.id)}/${Crypto.randomUUID()}.${extension}`;
  report(0.1);
  const accessToken = onProgress ? (await client.auth.getSession()).data.session?.access_token : null;
  if (accessToken) {
    await uploadStorageObjectWithProgress({ bucket, path, file, contentType: mime, accessToken, onProgress: (sent) => report(0.1 + sent * 0.85) });
  } else {
    const { error } = await client.storage.from(bucket).upload(path, file, { contentType: mime, upsert: false });
    if (error) throw error;
  }
  report(0.95);
  const { data: signed, error: signedError } = await client.storage.from(bucket).createSignedUrl(path, 3600);
  if (signedError) {
    await client.storage.from(bucket).remove([path]).catch(() => {});
    throw signedError;
  }
  report(1);
  return { path, url: signed.signedUrl, type, mime, size: file.byteLength, name: asset.fileName || `${namePrefix} ${type}.${extension}` };
}

export async function deleteTeamChatMedia(path) {
  if (!path) return;
  const { error } = await requireSupabase().storage.from('team-chat-media').remove([path]);
  if (error) throw error;
}

export async function uploadTeamImage(teamId, uri, kind = 'profile') {
  if (!uri || uri.startsWith('http')) return uri;
  const client = requireSupabase();
  // Browser pickers return blob/data URLs without a reliable file extension.
  const optimized = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: kind === 'cover' ? 1600 : 720 } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
  const response = await fetch(optimized.uri);
  const file = await response.arrayBuffer();
  if (file.byteLength > 5 * 1024 * 1024) throw new Error('The team photo is too large. Choose a smaller photo.');
  const safeKind = kind === 'cover' ? 'cover' : 'profile';
  const path = `${teamId}/${safeKind}-${Crypto.randomUUID()}.jpg`;
  const { error } = await client.storage.from('team-images').upload(path, file, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return client.storage.from('team-images').getPublicUrl(path).data.publicUrl;
}

export async function saveCompletedMatch(userId, result, userName) {
  const client = requireSupabase();
  const deterministicMatchId = result.savedMatchId || result.sharedLiveMatchId || result.clientMatchId || null;
  const endedAtTimestamp = Number.isFinite(result.endedAtTimestamp) ? result.endedAtTimestamp : Date.now();
  const startedAtTimestamp = Number.isFinite(result.matchStartedAt) ? result.matchStartedAt : endedAtTimestamp - ((result.elapsed || 0) * 1000);
  const expectedCompletedGames = Number(result.games?.[0] || 0) + Number(result.games?.[1] || 0);
  const rawScores = result.gameScores?.length ? result.gameScores : [result.scores];
  const expectedScoreRows = result.reason === 'completed' ? expectedCompletedGames : rawScores.length;
  const scores = rawScores
    .map((score) => [Number(score?.[0] || 0), Number(score?.[1] || 0)])
    .filter((score, index) => index < Math.max(1, expectedScoreRows) && score[0] + score[1] > 0);
  if (result.reason === 'completed' && (expectedCompletedGames < 1 || scores.length !== expectedCompletedGames)) {
    throw new Error('The completed score is incomplete. Reopen the connected result and retry recording it.');
  }
  if (!scores.length) throw new Error('A 0-0 match cannot be recorded. Add a score or save it as unfinished.');
  if (deterministicMatchId) {
    await writeLocalUnfinishedMatch(userId, { ...result, resultPendingSave: true, draftSavedAt: Date.now() }).catch(() => {});
  }
  const matchValues = {
    ...(deterministicMatchId ? { id: deterministicMatchId } : {}),
    created_by: userId,
    scorer_id: userId,
    ...matchCourtValues(result.court),
    match_type: result.matchType,
    mode: result.mode,
    visibility: result.access === 'public' ? 'public' : 'private',
    target_score: result.target,
    best_of: result.bestOf,
    win_by_two: result.winByTwo,
    status: 'completed',
    started_at: new Date(startedAtTimestamp).toISOString(),
    ended_at: new Date(endedAtTimestamp).toISOString(),
    resume_state: null,
  };
  const persistMatch = (values) => (result.savedMatchId
    ? client.from('matches').update(values).eq('id', result.savedMatchId).eq('created_by', userId)
    : deterministicMatchId
      ? client.from('matches').upsert(values, { onConflict: 'id' })
      : client.from('matches').insert(values)).select().single();
  let { data: match, error } = await persistMatch(matchValues);
  // Older databases may lag behind the client; keep the result, drop the extras.
  if (isMissingCourtLabel(error)) ({ data: match, error } = await persistMatch(withoutCourtLabel(matchValues)));
  if (isMissingResumeState(error)) {
    const { resume_state: _resumeState, ...legacyMatchValues } = withoutCourtLabel(matchValues);
    ({ data: match, error } = await persistMatch(legacyMatchValues));
  }
  if (error) throw error;
  if (deterministicMatchId) {
    const [participants, games] = await Promise.all([
      client.from('match_participants').delete().eq('match_id', match.id),
      client.from('match_games').delete().eq('match_id', match.id),
    ]);
    if (participants.error || games.error) throw participants.error || games.error;
  }
  const normalizedUserName = userName?.trim().toLowerCase();
  const registeredByName = new Map((result.registeredPlayers || [])
    .filter((player) => player?.id && player?.name)
    .map((player) => [player.name.trim().toLowerCase(), player.id]));
  if (normalizedUserName && userId) registeredByName.set(normalizedUserName, userId);
  let userAssigned = false;
  const lineup = result.players.flatMap((team, side) => team.map((guestName, position) => {
    const normalizedName = guestName.trim().toLowerCase();
    const currentUser = !userAssigned && normalizedUserName && normalizedName === normalizedUserName;
    if (currentUser) userAssigned = true;
    const registeredId = registeredByName.get(normalizedName) || null;
    return { match_id: match.id, user_id: registeredId, guest_name: registeredId ? null : guestName, side, position };
  }));
  const { error: participantError } = await client.from('match_participants').insert(lineup);
  if (participantError) throw participantError;
  const { error: gameError } = await client.from('match_games').insert(scores.map((score, index) => ({
    match_id: match.id, game_number: index + 1, home_score: score[0], away_score: score[1], winner_side: score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1, ended_at: new Date().toISOString(),
  })));
  if (gameError) throw gameError;
  // The completed match is already durable at this point. Rating refresh and
  // local cleanup are secondary work and must never turn a successful match
  // save into a false failure (or cause a duplicate when the user retries).
  try {
    const rating = calculatePerformanceRating(await listMyMatches({ limit: 200 }));
    const { error: ratingError } = await client.from('profiles').update({ skill_rating: rating }).eq('id', userId);
    if (ratingError) console.warn('Post-match rating refresh failed:', ratingError.message);
  } catch (ratingError) {
    console.warn('Post-match rating refresh failed:', ratingError.message);
  }
  await clearLocalUnfinishedMatch(userId).catch((cleanupError) => console.warn('Completed-match cleanup failed:', cleanupError.message));
  return match;
}

export async function saveUnfinishedMatch(userId, result, userName) {
  const client = requireSupabase();
  const resumeState = { ...result, draftSavedAt: result.draftSavedAt || Date.now(), savedMatchId: result.savedMatchId || null };
  await writeLocalUnfinishedMatch(userId, resumeState).catch(() => {});
  const values = {
    created_by: userId,
    scorer_id: userId,
    ...matchCourtValues(result.court),
    match_type: result.matchType,
    mode: result.mode,
    visibility: result.access === 'public' ? 'public' : 'private',
    target_score: result.target,
    best_of: result.bestOf,
    win_by_two: result.winByTwo,
    status: 'live',
    started_at: new Date(result.matchStartedAt || Date.now() - (result.elapsed || 0) * 1000).toISOString(),
    ended_at: null,
    resume_state: resumeState,
  };
  const persist = async (row) => {
    const query = result.savedMatchId
      ? client.from('matches').update(row).eq('id', result.savedMatchId).eq('created_by', userId).eq('status', 'live')
      : client.from('matches').insert({ ...row, ...(result.clientMatchId ? { id: result.clientMatchId } : {}) });
    const response = await query.select().single();
    // A retry after a lost response must reuse the same row. Never reopen a
    // completed match if another tab has already finished it.
    if (response.error?.code === '23505' && result.clientMatchId) {
      return client.from('matches').update(row).eq('id', result.clientMatchId).eq('created_by', userId).eq('status', 'live').select().single();
    }
    return response;
  };
  let { data, error } = await persist(values);
  if (isMissingCourtLabel(error)) ({ data, error } = await persist(withoutCourtLabel(values)));
  if (isMissingResumeState(error)) {
    const localMatch = { ...resumeState, savedMatchId: null };
    await writeLocalUnfinishedMatch(userId, localMatch);
    return localMatch;
  }
  if (error) throw error;
  const saved = { ...resumeState, savedMatchId: data.id };
  await writeLocalUnfinishedMatch(userId, saved).catch(() => {});
  return saved;
}

export async function loadUnfinishedMatch() {
  const client = requireSupabase();
  // Local recovery must also work during a network outage. RLS still verifies
  // the session on every server request.
  const { data: auth } = await client.auth.getSession();
  const userId = auth.session?.user?.id;
  if (!userId) return null;
  let local = await readLocalUnfinishedMatch(userId);
  const { data, error } = await client.from('matches')
    .select('id, resume_state')
    .eq('created_by', userId)
    .eq('status', 'live')
    .not('resume_state', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingResumeState(error)) return readLocalUnfinishedMatch(userId);
  if (error && !local) throw error;
  const localId = local?.savedMatchId || local?.clientMatchId;
  if (!error && localId && localId !== data?.id && !local.resultPendingSave) {
    const { data: existing, error: lookupError } = await client.from('matches').select('status').eq('id', localId).eq('created_by', userId).maybeSingle();
    if (!lookupError && existing && existing.status !== 'live') {
      await clearLocalUnfinishedMatch(userId);
      local = null;
    }
  }
  if (local && (!data?.resume_state || local.draftSavedAt > (data.resume_state.draftSavedAt || 0))) return local;
  return data?.resume_state ? { ...data.resume_state, savedMatchId: data.id } : local;
}

export async function listPlayers() {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('profiles').select('id, display_name, avatar_url').neq('id', auth.user.id).limit(25);
  if (error) throw error;
  return data.map((player) => ({ id: player.id, name: player.display_name, avatar: player.avatar_url, initials: player.display_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2), rating: player.skill_rating ?? 'Unrated', distance: 'Available', color: '#1C6B66' }));
}

export async function listMyMatches({ limit } = {}) {
  if (DEMO_MODE) return limit != null ? DEMO_MATCHES.slice(0, limit) : DEMO_MATCHES;
  const client = requireSupabase();
  const { data: auth } = await client.auth.getSession();
  const userId = auth?.session?.user?.id;
  let query = client.from('matches').select('*, match_games(*), match_participants(*, profiles(display_name, avatar_url)), venues(name), courts(name)').eq('status', 'completed').order('ended_at', { ascending: false });
  if (limit != null) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  // A sideline scorer records a connected match without playing in it. It
  // belongs to the registered players, not to the scorer's history or rating.
  const played = data.filter((match) => match.match_participants.some((player) => player.user_id === userId)
    || !match.match_participants.some((player) => player.user_id));
  return played.map((match) => {
    const games = [...match.match_games].sort((a, b) => a.game_number - b.game_number);
    const currentParticipant = match.match_participants.find((player) => player.user_id === userId);
    const currentSide = currentParticipant?.side ?? 0;
    const normalizedGames = games.map((game) => ({ homeScore: currentSide === 0 ? game.home_score : game.away_score, awayScore: currentSide === 0 ? game.away_score : game.home_score }));
    const homeWins = normalizedGames.filter((game) => game.homeScore > game.awayScore).length;
    const awayWins = normalizedGames.filter((game) => game.awayScore > game.homeScore).length;
    const playerName = (player) => player.guest_name || player.profiles?.display_name || 'Player';
    const opponentRows = match.match_participants.filter((player) => player.side !== currentSide).sort((a, b) => a.position - b.position);
    const opponents = opponentRows.map(playerName).join(' & ');
    const opponentPlayers = opponentRows.map((player) => ({ name: playerName(player), avatar: player.guest_name ? null : player.profiles?.avatar_url || null }));
    const partnerRow = currentParticipant
      ? match.match_participants.find((player) => player.side === currentSide && player.user_id !== userId && player.position !== currentParticipant.position)
      : match.match_participants.find((player) => player.side === currentSide && player.position === 1);
    const partner = partnerRow ? playerName(partnerRow) : null;
    return { id: match.id, opponent: opponents || 'Opponent', opponentPlayers, partner, score: normalizedGames.map((game) => `${game.homeScore}–${game.awayScore}`).join(', '), games: normalizedGames, result: homeWins > awayWins ? 'W' : 'L', date: new Date(match.ended_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase(), endedAt: match.ended_at, startedAt: match.started_at, type: `${match.mode === 'ranked' ? 'Ranked' : 'Casual'} ${match.match_type}`, rating: '—', venue: match.venues ? `${match.venues.name}${match.courts ? ` · ${match.courts.name}` : ''}` : match.court_label ? `${match.court_label}${match.court_area ? ` · ${match.court_area}` : ''}` : 'Unlisted court', duration: match.started_at && match.ended_at ? `${Math.max(1, Math.round((new Date(match.ended_at) - new Date(match.started_at)) / 60000))} min` : '—', longestRally: null, sideOuts: null, serveWon: null, returnWon: null, kitchenWon: null, errors: null, takeaway: homeWins > awayWins ? 'Match completed and recorded.' : 'Review the scoring pattern from this match.', improve: 'Use the score history to plan the next match.' };
  });
}

export function calculatePerformanceRating(matches) {
  if (!matches?.length) return null;
  let rating = 3;
  [...matches].reverse().forEach((match) => {
    const games = match.games || [];
    const pointsFor = games.reduce((total, game) => total + Number(game.homeScore || 0), 0);
    const pointsAgainst = games.reduce((total, game) => total + Number(game.awayScore || 0), 0);
    const totalPoints = pointsFor + pointsAgainst;
    const margin = totalPoints ? (pointsFor - pointsAgainst) / totalPoints : 0;
    const resultChange = match.result === 'W' ? 0.12 : -0.12;
    rating = Math.min(5.5, Math.max(1, rating + resultChange + margin * 0.08));
  });
  return Number(rating.toFixed(1));
}
