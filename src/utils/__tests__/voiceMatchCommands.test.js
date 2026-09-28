import { mentionsScoring, parseVoiceMatchCommand } from '../voiceMatchCommands';

const players = [['Alex Cruz', 'Katie Lim'], ['Jon Reyes', 'Theo Tan']];

describe('parseVoiceMatchCommand', () => {
  it('reads exact rally calls', () => {
    expect(parseVoiceMatchCommand('point team one', players)).toEqual({ type: 'rally', team: 0, playerName: null });
    expect(parseVoiceMatchCommand('point Theo', players)).toMatchObject({ type: 'rally', team: 1 });
  });

  it('tolerates common mishearings of the command words', () => {
    expect(parseVoiceMatchCommand('points teen two', players)).toMatchObject({ type: 'rally', team: 1 });
    expect(parseVoiceMatchCommand('paint team won', players)).toMatchObject({ type: 'rally', team: 0 });
    expect(parseVoiceMatchCommand('point team1', players)).toMatchObject({ type: 'rally', team: 0 });
  });

  it('matches misheard player names', () => {
    expect(parseVoiceMatchCommand('point John', players)).toMatchObject({ type: 'rally', team: 1, playerName: 'Jon Reyes' });
    expect(parseVoiceMatchCommand('point Katy', players)).toMatchObject({ type: 'rally', team: 0, playerName: 'Katie Lim' });
    expect(parseVoiceMatchCommand('Alec serving', players)).toMatchObject({ type: 'serve', server: 0, servingPlayerIndex: 0 });
  });

  it('does not treat ordinary words as names', () => {
    expect(parseVoiceMatchCommand('point to the net', players)).toBeNull();
    expect(parseVoiceMatchCommand('nice point', players)).toBeNull();
  });

  it('reads score calls with filler and compact digits', () => {
    expect(parseVoiceMatchCommand('score two one two', players, 0)).toEqual({ type: 'score', scores: [2, 1], serviceNumber: 2 });
    expect(parseVoiceMatchCommand('okay score 212', players, 0)).toEqual({ type: 'score', scores: [2, 1], serviceNumber: 2 });
    expect(parseVoiceMatchCommand('store for three one', players, 1)).toEqual({ type: 'score', scores: [3, 4], serviceNumber: 1 });
  });

  it('still ignores chatter without a command word', () => {
    expect(parseVoiceMatchCommand('Alex and Jon', players)).toBeNull();
    expect(parseVoiceMatchCommand('two one two', players)).toBeNull();
  });
});

describe('role, fault and undo calls', () => {
  it('gives side out and unnamed faults to the receiving team', () => {
    expect(parseVoiceMatchCommand('side out', players, 0)).toMatchObject({ type: 'rally', team: 1 });
    expect(parseVoiceMatchCommand('sideout', players, 1)).toMatchObject({ type: 'rally', team: 0 });
    expect(parseVoiceMatchCommand('foot fault', players, 0)).toMatchObject({ type: 'rally', team: 1 });
  });

  it('gives a named fault to the other side', () => {
    expect(parseVoiceMatchCommand('fault team two', players, 0)).toMatchObject({ type: 'rally', team: 0 });
    expect(parseVoiceMatchCommand('fault on Alex', players, 1)).toMatchObject({ type: 'rally', team: 1 });
  });

  it('reads serving and receiving team points', () => {
    expect(parseVoiceMatchCommand('point serving team', players, 1)).toMatchObject({ type: 'rally', team: 1 });
    expect(parseVoiceMatchCommand('point receiving team', players, 1)).toMatchObject({ type: 'rally', team: 0 });
  });

  it('reads other ways of naming the rally winner', () => {
    expect(parseVoiceMatchCommand('Theo wins it', players)).toMatchObject({ type: 'rally', team: 1 });
    expect(parseVoiceMatchCommand('team two takes it', players)).toMatchObject({ type: 'rally', team: 1 });
    expect(parseVoiceMatchCommand("that's Katie's point", players)).toMatchObject({ type: 'rally', team: 0 });
  });

  it('reads undo', () => {
    expect(parseVoiceMatchCommand('undo', players)).toEqual({ type: 'undo' });
    expect(parseVoiceMatchCommand('take that back', players)).toEqual({ type: 'undo' });
  });

  it('ignores disagreements and chatter', () => {
    expect(parseVoiceMatchCommand("that's not a fault", players)).toBeNull();
    expect(parseVoiceMatchCommand('go back to the baseline', players)).toBeNull();
    expect(parseVoiceMatchCommand('I think that one was a fault honestly', players)).toBeNull();
  });
});

describe('mentionsScoring', () => {
  it('separates scoring speech from chatter', () => {
    expect(mentionsScoring('point team')).toBe(true);
    expect(mentionsScoring('side out')).toBe(true);
    expect(mentionsScoring('nice shot')).toBe(false);
    expect(mentionsScoring('ball was out')).toBe(false);
  });
});
