// Canned data for EXPO_PUBLIC_DEMO_MODE=1 builds. Every shape here matches
// what the real service functions normally return, so screens render exactly
// as they would with live data — see demoMode.js for the flag.

export const DEMO_USER = {
  id: 'demo-jordan-ellis',
  email: 'jordan.demo@peakle.app',
  name: 'Jordan Ellis',
  picture: null,
  location: 'Austin, TX',
  skill: '4.2',
  preference: 'Doubles',
  presenceStatus: 'free',
  mode: 'player',
  preferences: null,
  onboardingCompleted: true,
  lastLogin: new Date().toISOString(),
  lastSignInMethod: 'email',
  isAdmin: false,
};

const iso = (daysFromNow, hour = 18, minute = 30) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

// ---------------------------------------------------------------------------
// Leaderboard (src/services/leaderboard.js)
// ---------------------------------------------------------------------------

const LEADERBOARD_ROSTER = [
  { id: 'p-marcus-webb', name: 'Marcus Webb', rating: 1684.220, wins: 24, losses: 6, verifiedMatches: 30 },
  { id: 'p-priya-shah', name: 'Priya Shah', rating: 1671.905, wins: 21, losses: 7, verifiedMatches: 28 },
  { id: 'p-diego-ramirez', name: 'Diego Ramirez', rating: 1649.730, wins: 19, losses: 9, verifiedMatches: 28 },
  { id: 'demo-jordan-ellis', name: 'Jordan Ellis', rating: 1612.480, wins: 17, losses: 10, verifiedMatches: 27 },
  { id: 'p-aisha-bello', name: 'Aisha Bello', rating: 1598.115, wins: 16, losses: 11, verifiedMatches: 27 },
  { id: 'p-sam-whitfield', name: 'Sam Whitfield', rating: 1587.340, wins: 15, losses: 11, verifiedMatches: 26 },
  { id: 'p-lena-ostrowski', name: 'Lena Ostrowski', rating: 1571.900, wins: 14, losses: 12, verifiedMatches: 26 },
  { id: 'p-chris-nakamura', name: 'Chris Nakamura', rating: 1559.660, wins: 13, losses: 12, verifiedMatches: 25 },
  { id: 'p-rosa-fontaine', name: 'Rosa Fontaine', rating: 1544.225, wins: 12, losses: 13, verifiedMatches: 25 },
  { id: 'p-tobias-kwan', name: 'Tobias Kwan', rating: 1531.800, wins: 11, losses: 14, verifiedMatches: 25 },
];

export function buildDemoLeaderboard({ format = 'doubles', scope = 'local' } = {}) {
  const standings = LEADERBOARD_ROSTER.map((player, index) => ({
    id: player.id,
    name: player.name,
    avatar: null,
    area: 'Austin, TX',
    rating: player.rating,
    verifiedMatches: player.verifiedMatches,
    wins: player.wins,
    losses: player.losses,
    rank: index + 1,
  }));
  const you = standings.find((player) => player.id === DEMO_USER.id);
  return {
    format,
    scope,
    area: 'Austin, TX',
    homeArea: 'Austin, TX',
    standings,
    user: {
      id: DEMO_USER.id,
      name: DEMO_USER.name,
      avatar: null,
      rating: you.rating,
      verifiedMatches: you.verifiedMatches,
      wins: you.wins,
      losses: you.losses,
      rank: you.rank,
    },
  };
}

// ---------------------------------------------------------------------------
// Booking / venues (src/services/database.js, src/screens/BookScreen.js)
// ---------------------------------------------------------------------------

// Raw shape as returned by the `venues` table (with nested `courts`), for the
// listVenues() guard — BookScreen maps this itself via its own presentVenue().
export const DEMO_VENUE_ROWS = [
  {
    id: 'demo-venue-1',
    name: 'Peak Performance Club',
    area: 'Makati',
    address: '128 Salcedo St, Makati City',
    latitude: 14.5589,
    longitude: 121.0198,
    opens_at: '06:00:00',
    closes_at: '22:00:00',
    venue_type: 'Indoor',
    color: '#1C6B66',
    brand_image_url: null,
    description: 'Air-conditioned indoor courts with pro-grade surfaces.',
    amenities: ['Parking', 'Pro shop', 'Showers'],
    time_zone: 'Asia/Manila',
    cancellation_cutoff_minutes: 240,
    courts: [
      { id: 'demo-court-1a', name: 'Court 1', environment: 'indoor', surface: 'cushioned', hourly_price: 900, active: true, image_url: null },
      { id: 'demo-court-1b', name: 'Court 2', environment: 'indoor', surface: 'cushioned', hourly_price: 900, active: true, image_url: null },
    ],
  },
  {
    id: 'demo-venue-2',
    name: 'Riverside Pickleball Courts',
    area: 'Bonifacio Global City',
    address: '9th Ave, Taguig',
    latitude: 14.5510,
    longitude: 121.0500,
    opens_at: '05:30:00',
    closes_at: '23:00:00',
    venue_type: 'Outdoor',
    color: '#B6472E',
    brand_image_url: null,
    description: 'Riverside outdoor courts with night lighting.',
    amenities: ['Lighting', 'Seating', 'Water station'],
    time_zone: 'Asia/Manila',
    cancellation_cutoff_minutes: 180,
    courts: [
      { id: 'demo-court-2a', name: 'Court A', environment: 'outdoor', surface: 'acrylic', hourly_price: 700, active: true, image_url: null },
    ],
  },
];

export const DEMO_BOOKING_DATE_ISO = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
})();

export const DEMO_BOOKING = {
  id: 'demo-booking-1',
  reference: 'PEAK4821',
  courtOption: { id: 'demo-court-1a', name: 'Court 1' },
  dateIso: DEMO_BOOKING_DATE_ISO,
  time: '6:30 PM',
  duration: 60,
  date: new Date(`${DEMO_BOOKING_DATE_ISO}T18:30:00+08:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  total: 900,
  status: 'confirmed',
  checkout_completed: true,
  payment_status: 'paid',
  payment_method: 'card',
  inviteTeam: false,
};

export const DEMO_QUOTE = {
  id: 'demo-quote-1',
  subtotal: 900,
  discount_amount: 0,
  fee_amount: 0,
  total: 900,
};

// ---------------------------------------------------------------------------
// Matches (src/services/database.js -> listMyMatches)
// ---------------------------------------------------------------------------

export const DEMO_MATCHES = [
  {
    id: 'demo-match-1', opponent: 'Diego Ramirez & Aisha Bello', partner: 'Priya Shah',
    score: '11–7, 9–11, 11–8', games: [{ homeScore: 11, awayScore: 7 }, { homeScore: 9, awayScore: 11 }, { homeScore: 11, awayScore: 8 }],
    result: 'W', date: 'AUG 17', endedAt: iso(-2, 20, 10), startedAt: iso(-2, 19, 15),
    type: 'Ranked Doubles', rating: '+12', venue: 'Peak Performance Club · Court 1',
    duration: '55 min', longestRally: 18, sideOuts: 9, serveWon: 62, returnWon: 48, kitchenWon: 71, errors: 6,
    takeaway: 'Match completed and recorded.', improve: 'Use the score history to plan the next match.',
  },
  {
    id: 'demo-match-2', opponent: 'Sam Whitfield', partner: null,
    score: '11–9, 6–11, 11–6', games: [{ homeScore: 11, awayScore: 9 }, { homeScore: 6, awayScore: 11 }, { homeScore: 11, awayScore: 6 }],
    result: 'W', date: 'AUG 14', endedAt: iso(-5, 18, 40), startedAt: iso(-5, 17, 50),
    type: 'Casual Singles', rating: '+8', venue: 'Riverside Pickleball Courts · Court A',
    duration: '48 min', longestRally: 14, sideOuts: 7, serveWon: 58, returnWon: 44, kitchenWon: 65, errors: 8,
    takeaway: 'Match completed and recorded.', improve: 'Use the score history to plan the next match.',
  },
  {
    id: 'demo-match-3', opponent: 'Lena Ostrowski & Chris Nakamura', partner: 'Priya Shah',
    score: '8–11, 9–11', games: [{ homeScore: 8, awayScore: 11 }, { homeScore: 9, awayScore: 11 }],
    result: 'L', date: 'AUG 10', endedAt: iso(-9, 19, 5), startedAt: iso(-9, 18, 20),
    type: 'Ranked Doubles', rating: '−6', venue: 'Peak Performance Club · Court 2',
    duration: '40 min', longestRally: 21, sideOuts: 11, serveWon: 51, returnWon: 39, kitchenWon: 58, errors: 11,
    takeaway: 'Review the scoring pattern from this match.', improve: 'Use the score history to plan the next match.',
  },
];

// ---------------------------------------------------------------------------
// Teams / team chat (src/services/database.js, src/screens/TeamScreen.js)
// ---------------------------------------------------------------------------

export const DEMO_TEAM_ID = 'demo-team-1';

export const DEMO_TEAMS = [
  {
    id: DEMO_TEAM_ID, name: 'Austin Smashers', tag: 'ATX', location: 'Austin, TX', latitude: 30.2672, longitude: -97.7431,
    members: 4, capacity: 6, rating: '1620', level: 'Intermediate', color: '#1C6B66', icon: 'people-outline',
    role: 'Owner', about: 'Weekly doubles ladder around Central Austin.', image: null, coverImage: null,
    isDiscoverable: true, status: 'active',
    roster: [
      { id: DEMO_USER.id, name: 'Jordan Ellis', initials: 'JE', avatar: null, role: 'Owner', rating: 1612.480, color: '#1C6B66' },
      { id: 'p-priya-shah', name: 'Priya Shah', initials: 'PS', avatar: null, role: 'Admin', rating: 1671.905, color: '#12514D' },
      { id: 'p-diego-ramirez', name: 'Diego Ramirez', initials: 'DR', avatar: null, role: 'Member', rating: 1649.730, color: '#B6472E' },
      { id: 'p-aisha-bello', name: 'Aisha Bello', initials: 'AB', avatar: null, role: 'Member', rating: 1598.115, color: '#8A7FB8' },
    ],
    acceptedMembers: [
      { id: 'p-priya-shah', name: 'Priya Shah', rating: 1671.905 },
      { id: 'p-diego-ramirez', name: 'Diego Ramirez', rating: 1649.730 },
      { id: 'p-aisha-bello', name: 'Aisha Bello', rating: 1598.115 },
    ],
  },
];

// Raw team_messages rows for the listTeamMessages() guard — TeamScreen
// normalizes these itself with its own normalizeTeamMessage().
export const DEMO_TEAM_MESSAGE_ROWS = [
  { id: 'tm-1', team_id: DEMO_TEAM_ID, sender_id: 'p-priya-shah', body: 'Great win tonight! That third game was tight 🔥', created_at: iso(-2, 20, 15), profiles: { display_name: 'Priya Shah', avatar_url: null } },
  { id: 'tm-2', team_id: DEMO_TEAM_ID, sender_id: DEMO_USER.id, body: 'Diego’s serve return was rough on us early', created_at: iso(-2, 20, 17), profiles: { display_name: 'Jordan Ellis', avatar_url: null } },
  { id: 'tm-3', team_id: DEMO_TEAM_ID, sender_id: 'p-diego-ramirez', body: 'Rematch next week? Same court', created_at: iso(-2, 20, 19), profiles: { display_name: 'Diego Ramirez', avatar_url: null } },
];

export const DEMO_TEAM_MESSAGE_DRIP = [
  { id: 'tm-live-1', team_id: DEMO_TEAM_ID, sender_id: 'p-aisha-bello', body: 'I’m in for Saturday morning', created_at: null, profiles: { display_name: 'Aisha Bello', avatar_url: null } },
  { id: 'tm-live-2', team_id: DEMO_TEAM_ID, sender_id: 'p-priya-shah', body: 'Booking Court 1 at Peak Performance now', created_at: null, profiles: { display_name: 'Priya Shah', avatar_url: null } },
  { id: 'tm-live-3', team_id: DEMO_TEAM_ID, sender_id: 'p-diego-ramirez', body: 'Let’s warm up 15 min before', created_at: null, profiles: { display_name: 'Diego Ramirez', avatar_url: null } },
];

// ---------------------------------------------------------------------------
// Direct messages (src/services/directMessages.js, DirectMessagesScreens.js)
// ---------------------------------------------------------------------------

export const DEMO_CONVERSATION_ID = 'demo-convo-1';

export const DEMO_CONVERSATION = {
  id: DEMO_CONVERSATION_ID,
  peer: { id: 'p-priya-shah', name: 'Priya Shah', avatar: null, area: 'Austin, TX' },
  status: 'accepted',
  requesterId: DEMO_USER.id,
  acceptedAt: iso(-10),
  createdAt: iso(-10),
  lastMessageAt: iso(-1, 9, 5),
  lastBody: 'See you at 6:30!',
  lastSenderId: 'p-priya-shah',
  unreadCount: 0,
  peerLastReadAt: iso(-1, 9, 5),
  blockedByMe: false,
  blockedMe: false,
};

export const DEMO_CONVERSATIONS = [DEMO_CONVERSATION];

const dmMessage = (id, mine, text, whenIso) => ({
  id, conversationId: DEMO_CONVERSATION_ID, senderId: mine ? DEMO_USER.id : 'p-priya-shah',
  sender: mine ? 'You' : 'Priya Shah', avatar: null, mine, text, reactions: [], createdAt: whenIso,
  time: new Date(whenIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
});

export const DEMO_DIRECT_MESSAGES = [
  dmMessage('dm-1', false, 'Hey! Still on for pickleball this week?', iso(-1, 8, 55)),
  dmMessage('dm-2', true, 'Yes! Court 1 at Peak Performance, 6:30', iso(-1, 9, 0)),
  dmMessage('dm-3', false, 'See you at 6:30!', iso(-1, 9, 5)),
];

export const DEMO_DIRECT_MESSAGE_DRIP = [
  { id: 'dm-live-1', text: 'On my way, traffic on Salcedo is light tonight' },
  { id: 'dm-live-2', text: 'Bringing an extra ball just in case' },
  { id: 'dm-live-3', text: 'Court’s free early too if you want to warm up' },
];

// ---------------------------------------------------------------------------
// Home dashboard extras (src/services/playerActivities.js, directMessages.js)
// ---------------------------------------------------------------------------

export const DEMO_ACTIVITIES = [
  {
    id: 'activity-open-play-1', sourceId: 'open-play-1', type: 'open_play', typeLabel: 'Open play',
    title: 'Sunday Open Play Ladder', venue: { id: 'demo-venue-1', name: 'Peak Performance Club', area: 'Makati', latitude: 14.5589, longitude: 121.0198 },
    startsAt: iso(3, 9, 0), endsAt: iso(3, 11, 0), feeAmount: 350, capacity: 16, registeredCount: 11, availability: '5 SPOTS',
  },
  {
    id: 'activity-clinic-1', sourceId: 'clinic-1', type: 'program', typeLabel: 'Clinic',
    title: 'Third Shot Drop Lab', venue: { id: 'demo-venue-1', name: 'Peak Performance Club', area: 'Makati', latitude: 14.5589, longitude: 121.0198 },
    startsAt: iso(5, 18, 0), endsAt: iso(5, 19, 30), feeAmount: 550, capacity: 12, registeredCount: 6, availability: 'OPEN', status: 'open',
    description: 'Dial in your soft-game with a certified coach.', skillDivision: 'Intermediate',
  },
];

export const DEMO_SUGGESTIONS = [
  { id: 'p-sam-whitfield', name: 'Sam Whitfield', avatar: null, area: 'Austin, TX', rating: 1587.340, reason: 'Plays near you', followers: 14, following: 9, friends: 9, mutuals: 3, followRequestPending: false },
  { id: 'p-lena-ostrowski', name: 'Lena Ostrowski', avatar: null, area: 'Austin, TX', rating: 1571.900, reason: 'Similar skill level', followers: 8, following: 12, friends: 8, mutuals: 1, followRequestPending: false },
];

export const DEMO_FOLLOWING = [
  { id: 'p-priya-shah', name: 'Priya Shah', avatar: null, area: 'Austin, TX', playerStatus: 'free', isOnline: true },
  { id: 'p-diego-ramirez', name: 'Diego Ramirez', avatar: null, area: 'Austin, TX', playerStatus: 'playing', isOnline: true },
];

export const DEMO_FOLLOW_COUNTS = { followers: 22, following: 15, friends: 15 };

// ---------------------------------------------------------------------------
// Nearby players / find match (src/services/nearbyPlayers.js)
// ---------------------------------------------------------------------------

export const DEMO_NEARBY_PLAYERS = [
  { id: 'p-sam-whitfield', name: 'Sam Whitfield', avatar: null, initials: 'SW', rating: 1587.340, distanceKm: 0.8, distance: '0.8 km', distanceAccuracyM: 15, distanceAccuracy: '15 m', availability: 'available', lastSeenAt: iso(0, 0, 0), color: '#1C6B66' },
  { id: 'p-lena-ostrowski', name: 'Lena Ostrowski', avatar: null, initials: 'LO', rating: 1571.900, distanceKm: 1.4, distance: '1.4 km', distanceAccuracyM: 20, distanceAccuracy: '20 m', availability: 'available', lastSeenAt: iso(0, 0, 0), color: '#1C6B66' },
  { id: 'p-chris-nakamura', name: 'Chris Nakamura', avatar: null, initials: 'CN', rating: 1559.660, distanceKm: 2.1, distance: '2.1 km', distanceAccuracyM: 25, distanceAccuracy: '25 m', availability: 'available', lastSeenAt: iso(0, 0, 0), color: '#1C6B66' },
];

// ---------------------------------------------------------------------------
// Live scoring (src/screens/PlayScreen.js)
// ---------------------------------------------------------------------------

export const DEMO_LIVE_MATCH = {
  setupId: 'demo-setup-1',
  matchType: 'doubles',
  mode: 'casual',
  access: 'public',
  target: 11,
  bestOf: 3,
  winByTwo: true,
  players: [['Jordan Ellis', 'Priya Shah'], ['Diego Ramirez', 'Aisha Bello']],
  registeredPlayers: [{ id: DEMO_USER.id, name: DEMO_USER.name, avatar: null }],
  court: { id: 'demo-court-1a', name: 'Court 1 — Peak Performance Club' },
  scorer: DEMO_USER.name,
  scorerId: DEMO_USER.id,
  scorerSource: 'host',
  scoringMethod: 'manual',
  focusChallenge: null,
  firstServer: 0,
  firstServerPlayer: 'Jordan Ellis',
};
