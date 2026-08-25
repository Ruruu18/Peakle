import { bookingDateRange, verifiedPublishingVenues, calculatePerformanceRating } from '../database';

describe('bookingDateRange', () => {
  it('converts a Manila-local afternoon time into the correct UTC instant', () => {
    const { startsAt, endsAt } = bookingDateRange('2026-08-10', '2:30 PM', 90);
    expect(startsAt.toISOString()).toBe('2026-08-10T06:30:00.000Z');
    expect(endsAt.toISOString()).toBe('2026-08-10T08:00:00.000Z');
  });

  it('handles the 12-hour clock edge cases for midnight and noon', () => {
    expect(bookingDateRange('2026-08-10', '12:00 AM', 60).startsAt.toISOString()).toBe('2026-08-09T16:00:00.000Z');
    expect(bookingDateRange('2026-08-10', '12:00 PM', 60).startsAt.toISOString()).toBe('2026-08-10T04:00:00.000Z');
  });

  it('ends exactly `duration` minutes after it starts, regardless of duration size', () => {
    const { startsAt, endsAt } = bookingDateRange('2026-08-10', '9:00 AM', 45);
    expect(endsAt.getTime() - startsAt.getTime()).toBe(45 * 60 * 1000);
  });
});

describe('verifiedPublishingVenues', () => {
  it('keeps only active, verified venues', () => {
    const venues = [
      { id: '1', verification_status: 'verified', active: true },
      { id: '2', verification_status: 'pending', active: true },
      { id: '3', verification_status: 'verified', active: false },
      { id: '4', verification_status: 'verified' },
    ];
    expect(verifiedPublishingVenues(venues).map((v) => v.id)).toEqual(['1', '4']);
  });

  it('returns an empty array for missing input', () => {
    expect(verifiedPublishingVenues()).toEqual([]);
  });
});

describe('calculatePerformanceRating', () => {
  it('returns null when there is no match history', () => {
    expect(calculatePerformanceRating([])).toBeNull();
    expect(calculatePerformanceRating(null)).toBeNull();
  });

  it('raises the rating above the 3.0 baseline after a decisive win', () => {
    const rating = calculatePerformanceRating([{ result: 'W', games: [{ homeScore: 11, awayScore: 5 }] }]);
    expect(rating).toBe(3.1);
  });

  it('lowers the rating below the 3.0 baseline after a decisive loss', () => {
    const rating = calculatePerformanceRating([{ result: 'L', games: [{ homeScore: 5, awayScore: 11 }] }]);
    expect(rating).toBe(2.9);
  });

  it('never drops the rating below the 1.0 floor across a long losing streak', () => {
    const losses = Array.from({ length: 40 }, () => ({ result: 'L', games: [{ homeScore: 0, awayScore: 11 }] }));
    expect(calculatePerformanceRating(losses)).toBe(1);
  });
});
