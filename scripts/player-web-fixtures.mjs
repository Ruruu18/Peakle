// Browser-only API fixtures. Nothing in this file is imported by the beta app.
export const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const venueId = '33333333-3333-4333-8333-333333333333';
const courtId = '44444444-4444-4444-8444-444444444444';
export const teamId = '55555555-5555-4555-8555-555555555555';
export const competitionId = '66666666-6666-4666-8666-666666666666';
export const divisionId = '77777777-7777-4777-8777-777777777777';
export const sessionId = 'beta-test-open-play';
const now = Date.now();
const iso = (offset) => new Date(now + offset * 3600000).toISOString();
export const profile = { id: userId, display_name: 'Beta Test Player', home_area: 'Manila', skill_rating: 3, play_preference: 'Singles', onboarding_completed: true, profile_visibility: 'public', matching_enabled: true, avatar_url: null, notification_preferences: {} };
export const authUser = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'beta-test@example.invalid', created_at: iso(-24), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: profile.display_name } };
const tokenPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const session = { access_token: `${tokenPart({ alg: 'HS256', typ: 'JWT' })}.${tokenPart({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(now / 1000) + 7200 })}.fixture`, token_type: 'bearer', refresh_token: 'fixture-refresh-token', expires_in: 7200, expires_at: Math.floor(now / 1000) + 7200, user: authUser };
const court = { id: courtId, venue_id: venueId, name: 'Community Court 1', active: true, hourly_price: 0, environment: 'Outdoor', surface: 'Concrete' };
const venue = { id: venueId, name: 'Community Courts', active: true, verification_status: 'verified', area: 'Manila', address: 'Community sports venue', latitude: 14.5995, longitude: 120.9842, opens_at: '06:00', closes_at: '23:00', time_zone: 'Asia/Manila', courts: [court], amenities: [] };
const booking = { id: '88888888-8888-4888-8888-888888888888', user_id: userId, venue_id: venueId, court_id: courtId, status: 'confirmed', payment_status: 'paid', total_amount: 0, starts_at: iso(-1), ends_at: iso(3), venues: venue, courts: court };
const team = { id: teamId, name: 'Community Clan', tag: 'COM', status: 'active', capacity: 12, member_count: 2, skill_level: 'Open', location: 'Manila', is_discoverable: true, created_at: iso(-48), team_members: [{ user_id: userId, role: 'creator', profiles: profile }, { user_id: otherId, role: 'member', profiles: { display_name: 'Alex Player' } }] };

export async function installBackend(page, baseUrl, handleRequest) {
  const requests = [];
  const matches = new Map();
  const controls = { failMatchWrites: false, denyAccountAccess: false, layoutFixtures: false };
  const groupMessages = [];
  const division = { id: divisionId, competition_id: competitionId, name: 'Community Singles', format: 'singles', participant_division: 'open', skill_category: 'open', entry_type: 'player', capacity: 16, fee_amount: 0, status: 'registration', competition_entries: [], competition_bracket_matches: [] };
  const competition = { id: competitionId, venue_id: venueId, name: 'Community Beta Cup', kind: 'tournament', status: 'registration', starts_on: iso(24).slice(0, 10), venues: venue, competition_divisions: [division] };
  const openPlay = { id: sessionId, name: 'Community Open Play', session_code: 'BETA26', status: 'scheduled', visibility: 'public', approval_mode: 'auto', capacity: 16, fee_amount: 0, match_format: 'singles', scheduled_start: iso(-1), scheduled_end: iso(3), venue, organizer: { display_name: 'Community Organizer' }, registered_count: 0, my_registration: null, live_state: null };
  const reply = (request, data, status = 200) => request.respond({ status, contentType: 'application/json', body: request.method() === 'HEAD' ? '' : JSON.stringify(data), headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/1' } });
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const url = new URL(request.url());
      if (url.origin === new URL(baseUrl).origin || ['data:', 'blob:'].includes(url.protocol)) return void request.continue();
      if (!url.hostname.endsWith('.supabase.co')) return void reply(request, []);
      if (request.method() === 'OPTIONS') return void reply(request, {});
      const resource = url.pathname.split('/').at(-1);
      const body = request.postData() ? JSON.parse(request.postData()) : {};
      requests.push({ resource, method: request.method(), body });
      if (handleRequest && await handleRequest({ request, url, resource, body, reply })) return;
      if (controls.denyAccountAccess && url.pathname.startsWith('/rest/v1/')) {
        return void reply(request, { code: 'PT403', message: 'Account access is suspended or this session has been revoked. Please sign in again or contact support@peakle.app.' }, 403);
      }
      if (url.pathname.startsWith('/auth/v1/')) {
        if (resource === 'user') return void reply(request, authUser);
        if (resource === 'token') return void reply(request, session);
        if (resource === 'signup') return void reply(request, { user: authUser, session: null });
        return void reply(request, {});
      }
      if (url.pathname.includes('/rpc/')) {
        if (resource === 'get_public_player_profile') return void reply(request, [profile]);
        if (resource === 'get_my_profile') return void reply(request, [profile]);
        if (resource === 'get_chat_safety_status' || resource === 'acknowledge_chat_safety') return void reply(request, { acknowledged: true, is_adult: true, eligible: true });
        if (resource === 'get_player_follow_counts') return void reply(request, { followers: 2, following: 3 });
        if (resource === 'get_direct_message_permission') return void reply(request, { is_following: false });
        if (resource === 'list_discoverable_open_play_sessions' || resource === 'get_open_play_session') return void reply(request, [openPlay]);
        if (resource === 'get_open_play_live_state') return void reply(request, {});
        if (resource === 'get_my_open_play_match') return void reply(request, null);
        if (resource === 'join_open_play_session') {
          openPlay.my_registration = { id: 'beta-registration', session_id: sessionId, user_id: userId, registration_status: 'approved', status: 'registered', profiles: profile, joined_at: iso(0) };
          return void reply(request, openPlay.my_registration);
        }
        if (resource === 'check_in_open_play_player') { openPlay.my_registration.checked_in_at = iso(0); openPlay.my_registration.status = 'waiting'; return void reply(request, openPlay.my_registration); }
        if (resource === 'register_for_competition_division') { const entry = { id: 'beta-entry', user_id: userId, status: 'registered', eligibility_status: 'not_required', profiles: profile, played: 0, won: 0, standing_points: 0 }; division.competition_entries.push(entry); return void reply(request, entry); }
        if (resource === 'send_team_message') { const message = { id: `group-message-${groupMessages.length}`, team_id: teamId, sender_id: userId, body: body.p_body, created_at: iso(0), profiles: profile, team_message_reactions: [] }; groupMessages.push(message); return void reply(request, message); }
        return void reply(request, []);
      }
      let data = [];
      if (resource === 'profiles') { if (request.method() === 'PATCH') Object.assign(profile, body); data = [profile]; }
      if (resource === 'venues') data = controls.layoutFixtures && !url.searchParams.has('id')
        ? Array.from({ length: 6 }, (_, index) => ({ ...venue, id: index ? `33333333-3333-4333-8333-33333333333${index}` : venue.id, name: index ? `Community Courts ${index + 1}` : venue.name }))
        : [venue];
      if (resource === 'courts') data = [court];
      if (resource === 'bookings') data = url.searchParams.has('or') ? [] : [booking];
      if (resource === 'teams') data = [team];
      if (resource === 'competitions') data = [competition];
      if (resource === 'competition_divisions') data = [{ ...division, competitions: competition }];
      if (resource === 'team_messages') {
        if (request.method() === 'POST') groupMessages.push({ ...body, id: `group-message-${groupMessages.length}`, created_at: iso(0), profiles: profile, team_message_reactions: [] });
        data = groupMessages;
      }
      if (resource === 'get_public_player_profile') data = [profile];
      if (resource === 'player_ratings') data = [{ user_id: userId, format: 'singles', rating: 3, verified_matches: 2, wins: 1, losses: 1, profile }];
      if (resource === 'matches') {
        if (controls.failMatchWrites && ['POST', 'PATCH'].includes(request.method())) return void reply(request, { message: 'Simulated network outage' }, 503);
        if (request.method() === 'POST' || request.method() === 'PATCH') {
          const id = body.id || url.searchParams.get('id')?.replace('eq.', '') || '99999999-9999-4999-8999-999999999999';
          const previous = matches.get(id) || { match_games: [], match_participants: [], venues: venue, courts: court };
          matches.set(id, { ...previous, ...body, id });
          data = [matches.get(id)];
        } else data = [...matches.values()].filter((match) => !url.searchParams.has('status') || url.searchParams.get('status') === `eq.${match.status}`);
      }
      for (const [table, field] of [['match_games', 'match_games'], ['match_participants', 'match_participants']]) {
        if (resource === table && request.method() === 'POST') for (const row of Array.isArray(body) ? body : [body]) matches.get(row.match_id)?.[field].push(row);
        if (resource === table && request.method() === 'DELETE') { const id = url.searchParams.get('match_id')?.replace('eq.', ''); if (matches.has(id)) matches.get(id)[field] = []; }
      }
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      return void reply(request, single ? data[0] || null : data);
    } catch (error) { console.error('Fixture error:', error.message); if (!request.isInterceptResolutionHandled()) void request.abort(); }
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*supabase.co/realtime/*'] });
  return { requests, matches, groupMessages, openPlay, division, controls };
}

export async function signInFixture(page, baseUrl) {
  await page.goto(baseUrl);
  await page.locator('input[placeholder="you@example.com"]').fill(authUser.email);
  await page.locator('input[placeholder="Password"]').fill('Fixture-password-only-123!');
  await page.locator('::-p-text(Log in)').click();
  await page.waitForSelector('[aria-label="Play tab"]', { timeout: 20000 });
}
