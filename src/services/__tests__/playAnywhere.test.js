import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  areaFromLocationLabel, courtKey, courtLabel, customCourt, listedCourtOptions, loadRecentCourts, matchesCourtQuery, rememberCourt,
} from '../playCourts';
import { matchCourtValues } from '../database';
import {
  clockFromMinutes, dayKey, earliestStartMinutes, entriesByDay, formatDuration, googleCalendarUrl, maskClockInput, parseClockInput, parseHoursInput, isOnMyCalendar, monthGrid, nextOnMyCalendar, playSetupFromGame, shiftMonthKey,
} from '../schedule';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn(), supabase: null }));

describe('play-anywhere courts', () => {
  beforeEach(() => AsyncStorage.clear());

  it('builds a custom court with a readable label and ignores blank names', () => {
    const court = customCourt({ name: '  Kapitolyo   Court ', courtName: 'Court 2', area: 'Pasig' });
    expect(court).toMatchObject({ source: 'custom', name: 'Kapitolyo Court', courtName: 'Court 2', area: 'Pasig', detail: 'Court 2 · Pasig' });
    expect(courtLabel(court)).toBe('Kapitolyo Court · Court 2');
    expect(customCourt({ name: '   ' })).toBeNull();
  });

  it('flattens listed venues into selectable courts with venue references', () => {
    const [court] = listedCourtOptions([{ id: 'v1', name: 'Rockwell Club', area: 'Makati', courts: [{ id: 'c1', name: 'Court 1', active: true }, { id: 'c2', name: 'Court 2', active: false }] }]);
    expect(court).toMatchObject({ source: 'listed', venueId: 'v1', courtId: 'c1', name: 'Rockwell Club', courtName: 'Court 1' });
    expect(matchCourtValues(court)).toEqual({ venue_id: 'v1', court_id: 'c1', court_label: 'Rockwell Club · Court 1', court_area: 'Makati' });
  });

  it('saves custom courts as labels only and keeps demo court ids working', () => {
    expect(matchCourtValues(customCourt({ name: 'Covered court', area: 'Cebu City' }))).toEqual({ venue_id: null, court_id: null, court_label: 'Covered court', court_area: 'Cebu City' });
    expect(matchCourtValues({ id: 'yard-3', name: 'The Yard' })).toMatchObject({ venue_id: 'yard', court_id: 'yard-court-3' });
  });

  it('ignores placeholder location labels when prefilling the area', () => {
    expect(areaFromLocationLabel('Pasig · Metro Manila')).toBe('Pasig');
    expect(areaFromLocationLabel('Your area')).toBe('');
  });

  it('remembers recent courts newest first without duplicates', async () => {
    const first = customCourt({ name: 'Court A' });
    await rememberCourt('u1', first);
    await rememberCourt('u1', customCourt({ name: 'Court B' }));
    const recent = await rememberCourt('u1', customCourt({ name: 'court a' }));
    expect(recent.map((court) => court.name)).toEqual(['court a', 'Court B']);
    expect(await loadRecentCourts('someone-else')).toEqual([]);
    expect(courtKey(first)).toBe(courtKey(customCourt({ name: 'COURT A' })));
    expect(matchesCourtQuery(first, 'court')).toBe(true);
  });
});

describe('schedule calendar helpers', () => {
  it('lays out a six-week month grid starting on Sunday', () => {
    const grid = monthGrid('2026-09');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-08-30');
    expect(grid).toContain('2026-09-30');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });

  it('groups entries by Manila day even near midnight UTC', () => {
    const late = { id: 'a', startsAt: '2026-09-25T16:30:00Z' };
    expect(dayKey(late.startsAt)).toBe('2026-09-26');
    expect(Object.keys(entriesByDay([late]))).toEqual(['2026-09-26']);
  });

  it('opens start times ten minutes out on five-minute marks', () => {
    const now = new Date('2026-09-25T10:05:00+08:00').getTime();
    expect(clockFromMinutes(earliestStartMinutes('2026-09-25', now))).toBe('10:20');
    expect(earliestStartMinutes('2026-09-26', now)).toBe(0);
    expect(earliestStartMinutes('2026-09-25', new Date('2026-09-25T23:50:00+08:00').getTime())).toBeNull();
  });

  it('reads typed start times and durations', () => {
    expect(parseClockInput('7:10 pm')).toBe(19 * 60 + 10);
    expect(parseClockInput('710PM')).toBe(19 * 60 + 10);
    expect(parseClockInput('19.45')).toBe(19 * 60 + 45);
    expect(parseClockInput('6:30')).toBe(6 * 60 + 30);
    expect(parseClockInput('3')).toBe(15 * 60);
    expect(parseClockInput('12 am')).toBe(0);
    expect(parseClockInput('7:30', 'pm')).toBe(19 * 60 + 30);
    expect(parseClockInput('3', 'am')).toBe(3 * 60);
    expect(parseClockInput('7pm', 'am')).toBe(19 * 60);
    expect(parseClockInput('18:00', 'am')).toBe(18 * 60);
    expect(parseClockInput('13 pm')).toBeNull();
    expect(parseClockInput('7:75')).toBeNull();
    expect(parseHoursInput('2.5')).toBe(150);
    expect(parseHoursInput('1,25 hr')).toBe(90);
    expect(parseHoursInput('10')).toBe(360);
    expect(parseHoursInput('abc')).toBeNull();
  });

  it('only lets real 12-hour or 24-hour times be typed', () => {
    const typeOut = (text) => [...text].reduce((current, key) => maskClockInput(current, current + key), '');
    expect(typeOut('13:00')).toBe('13:00');
    expect(typeOut('1:00pm')).toBe('1:00 PM');
    expect(typeOut('730')).toBe('7:30');
    expect(typeOut('1930')).toBe('19:30');
    expect(typeOut('25')).toBe('2:5');
    expect(typeOut('24:00')).toBe('2:40');
    expect(typeOut('7:75')).toBe('7:5');
    expect(typeOut('13:00pm')).toBe('13:00');
    expect(typeOut('0:30am')).toBe('0:30');
    expect(typeOut('12:345')).toBe('12:34');
    expect(maskClockInput('7:30', '7:3')).toBe('7:3');
    expect(maskClockInput('7:30 PM', '7:30 P')).toBe('7:30 P');
    expect(maskClockInput('7:30 P', '7:30 ')).toBe('7:30');
    expect(parseClockInput('13:00', 'am')).toBe(13 * 60);
    expect(parseClockInput('07:30', 'pm')).toBe(7 * 60 + 30);
    expect(parseClockInput('1:00 PM', 'am')).toBe(13 * 60);
  });

  it('labels custom durations in hours', () => {
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(90)).toBe('1.5 hr');
    expect(formatDuration(240)).toBe('4 hr');
  });

  it('picks the next game or registered event on my calendar', () => {
    const now = new Date('2026-09-25T08:00:00+08:00').getTime();
    const entries = [
      { id: 'declined', kind: 'game', myStatus: 'declined', status: 'scheduled', startsAt: '2026-09-25T09:00:00+08:00', endsAt: '2026-09-25T10:00:00+08:00' },
      { id: 'event', kind: 'open_play', joined: true, status: 'active', startsAt: '2026-09-26T09:00:00+08:00', endsAt: '2026-09-26T11:00:00+08:00' },
      { id: 'mine', kind: 'game', myStatus: 'going', status: 'scheduled', startsAt: '2026-09-25T18:00:00+08:00', endsAt: '2026-09-25T19:30:00+08:00' },
    ];
    expect(isOnMyCalendar(entries[0])).toBe(false);
    expect(nextOnMyCalendar(entries, now).id).toBe('mine');
  });

  it('builds a Google Calendar link and a Play prefill from a game', () => {
    const game = { title: 'Sunday doubles', startsAt: '2026-09-27T10:00:00Z', endsAt: '2026-09-27T11:30:00Z', place: 'Kapitolyo Court', area: 'Pasig', matchType: 'doubles', mode: 'ranked', court: { name: 'Kapitolyo Court' }, going: [{ id: 'p1', name: 'Ana', avatar: null }], sourceId: 'g1' };
    expect(googleCalendarUrl(game)).toContain('dates=20260927T100000Z%2F20260927T113000Z');
    expect(playSetupFromGame(game)).toEqual({ matchType: 'doubles', mode: 'ranked', court: game.court, players: [{ id: 'p1', name: 'Ana', avatar: null }], scheduledGameId: 'g1' });
  });
});
