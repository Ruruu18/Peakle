import { mapOpenPlayRegistration, mapOpenPlaySession, mapOpenPlayMatch } from '../openPlayRegistration';

describe('mapOpenPlayRegistration', () => {
  it('returns null for a missing row', () => {
    expect(mapOpenPlayRegistration(null)).toBeNull();
  });

  it('prefers the linked profile over a guest name', () => {
    const row = {
      id: 'r1',
      session_id: 's1',
      user_id: 'u1',
      profiles: { display_name: 'Alex Santos', avatar_url: 'https://x/y.png', skill_rating: 3.5 },
      guest_name: 'Should not be used',
      registration_status: 'approved',
      status: 'checked_in',
      games_played: 2,
    };
    const mapped = mapOpenPlayRegistration(row);
    expect(mapped.name).toBe('Alex Santos');
    expect(mapped.skill).toBe(3.5);
    expect(mapped.gamesPlayed).toBe(2);
  });

  it('falls back to a guest name, then "Guest player", when there is no profile', () => {
    expect(mapOpenPlayRegistration({ guest_name: 'Walk-in' }).name).toBe('Walk-in');
    expect(mapOpenPlayRegistration({}).name).toBe('Guest player');
  });

  it('defaults waitingSince to check-in time, then join time, when not set directly', () => {
    const mapped = mapOpenPlayRegistration({ checked_in_at: '2026-08-10T10:00:00Z', joined_at: '2026-08-10T09:00:00Z' });
    expect(mapped.waitingSince).toBe('2026-08-10T10:00:00Z');
  });
});

describe('mapOpenPlaySession', () => {
  it('coerces numeric fields and applies fair-play rotation defaults', () => {
    const mapped = mapOpenPlaySession({ id: 's1', name: 'Sunday Open Play', capacity: '16', fee_amount: '150' });
    expect(mapped.capacity).toBe(16);
    expect(mapped.feeAmount).toBe(150);
    expect(mapped.currency).toBe('PHP');
    expect(mapped.matchFormat).toBe('doubles');
    expect(mapped.maxConsecutiveGames).toBe(2);
    expect(mapped.averageMatchMinutes).toBe(15);
  });

  it('nests the caller\'s own registration when present', () => {
    const mapped = mapOpenPlaySession({ id: 's1', my_registration: { id: 'r1', guest_name: 'Me' } });
    expect(mapped.registration.id).toBe('r1');
  });
});

describe('mapOpenPlayMatch', () => {
  it('derives a fallback court name and default doubles service number', () => {
    const mapped = mapOpenPlayMatch({ id: 'm1', court_number: 3, match_format: 'doubles' });
    expect(mapped.courtName).toBe('Court 3');
    expect(mapped.serviceNumber).toBe(2);
  });

  it('maps player rows into the shape the scoreboard expects', () => {
    const mapped = mapOpenPlayMatch({
      id: 'm1',
      players: [{ player_id: 'p1', user_id: 'u1', name: 'Dana Lim', side: 1, position: 0, is_me: true }],
    });
    expect(mapped.players).toEqual([{
      id: 'p1', userId: 'u1', name: 'Dana Lim', avatar: null, side: 1, position: 0, isMe: true, isScorer: false,
    }]);
  });
});
