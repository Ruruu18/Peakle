import { normalizeOrganizerEmail } from '../organizerInterest';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

describe('normalizeOrganizerEmail', () => {
  it('trims and lowercases valid addresses', () => {
    expect(normalizeOrganizerEmail('  Owner@Court.PH ')).toBe('owner@court.ph');
  });

  it('rejects empty or malformed addresses', () => {
    expect(() => normalizeOrganizerEmail('')).toThrow('Enter your email');
    expect(() => normalizeOrganizerEmail('owner@court')).toThrow('look right');
    expect(() => normalizeOrganizerEmail('owner court@x.ph')).toThrow('look right');
  });
});
