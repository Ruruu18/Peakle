const babel = require('@babel/core');

function transpile(file) {
  return babel.transformFileSync(file, {
    presets: ['babel-preset-expo'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
}

function loadModule(code, imports = {}) {
  const module = { exports: {} };
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(imports, id)
    ? imports[id]
    : require(id);
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`);
  }
}

const shout = loadModule(transpile('src/utils/shoutScoring.js'));
const commands = loadModule(transpile('src/utils/voiceMatchCommands.js'), { './shoutScoring': shout });
const scoring = loadModule(transpile('src/utils/liveMatchScoring.js'));
const transcriptBuffer = loadModule(transpile('src/utils/transcriptBuffer.js'));
const players = [
  ['Alex Santos', 'Ben Cruz'],
  ['Carla Reyes', 'Dana Lim'],
];

const parserCases = [
  ['Alex serving', 0, { type: 'serve', server: 0, servingPlayerIndex: 0, serviceNumber: 1, playerExplicit: true }],
  ['Dana server two', 0, { type: 'serve', server: 1, servingPlayerIndex: 1, serviceNumber: 2, playerExplicit: true }],
  ['team two serve', 0, { type: 'serve', server: 1, servingPlayerIndex: 0, serviceNumber: 1, playerExplicit: false }],
  ['score two one two', 0, { type: 'score', scores: [2, 1], serviceNumber: 2 }],
  ['score is 2 1 1', 1, { type: 'score', scores: [1, 2], serviceNumber: 1 }],
  ['point team one', 0, { type: 'rally', team: 0 }],
  ['Carla scores', 0, { type: 'rally', team: 1, playerName: 'Carla Reyes' }],
  ['team one', 0, null],
  ['Alex', 0, null],
  ['2 1 1', 0, null],
  ['nice rally', 0, null],
];

for (const [phrase, currentServer, expected] of parserCases) {
  const actual = commands.parseVoiceMatchCommand(phrase, players, currentServer);
  if (expected === null) {
    assertEqual(actual, null, `Parser must reject “${phrase}”`);
  } else {
    const selected = Object.fromEntries(Object.keys(expected).map((key) => [key, actual?.[key]]));
    assertEqual(selected, expected, `Parser failed for “${phrase}”`);
  }
}

const scoringCases = [
  {
    label: 'Serving team scores and retains the same server',
    state: { matchType: 'doubles', scores: [0, 0], server: 0, servingPlayerIndex: 0, serviceNumber: 2, evenSidePlayerIndexes: [0, 0] },
    winner: 0,
    expected: [[1, 0], 0, 0, 2, true, 'Point'],
  },
  {
    label: 'Opening receiver win produces an immediate side out',
    state: { matchType: 'doubles', scores: [0, 0], server: 0, servingPlayerIndex: 0, serviceNumber: 2, evenSidePlayerIndexes: [0, 0] },
    winner: 1,
    expected: [[0, 0], 1, 0, 1, false, 'Side out'],
  },
  {
    label: 'First-server loss keeps service on the same team and moves to the partner',
    state: { matchType: 'doubles', scores: [0, 0], server: 0, servingPlayerIndex: 0, serviceNumber: 1, evenSidePlayerIndexes: [0, 0] },
    winner: 1,
    expected: [[0, 0], 0, 1, 2, false, 'Second server'],
  },
  {
    label: 'Second-server loss moves service to the receiving team',
    state: { matchType: 'doubles', scores: [0, 0], server: 0, servingPlayerIndex: 1, serviceNumber: 2, evenSidePlayerIndexes: [0, 0] },
    winner: 1,
    expected: [[0, 0], 1, 0, 1, false, 'Side out'],
  },
  {
    label: 'Odd receiving score selects that team’s partner on side out',
    state: { matchType: 'doubles', scores: [0, 1], server: 0, servingPlayerIndex: 1, serviceNumber: 2, evenSidePlayerIndexes: [0, 0] },
    winner: 1,
    expected: [[0, 1], 1, 1, 1, false, 'Side out'],
  },
  {
    label: 'A custom even-side player is respected on side out',
    state: { matchType: 'doubles', scores: [2, 0], server: 1, servingPlayerIndex: 0, serviceNumber: 2, evenSidePlayerIndexes: [1, 0] },
    winner: 0,
    expected: [[2, 0], 0, 1, 1, false, 'Side out'],
  },
  {
    label: 'Singles receiver wins an immediate side out',
    state: { matchType: 'singles', scores: [2, 3], server: 0, servingPlayerIndex: 0, serviceNumber: 1, evenSidePlayerIndexes: [0, 0] },
    winner: 1,
    expected: [[2, 3], 1, 0, 1, false, 'Side out'],
  },
  {
    label: 'Serving team never changes service number when scoring',
    state: { matchType: 'doubles', scores: [3, 2], server: 1, servingPlayerIndex: 1, serviceNumber: 2, evenSidePlayerIndexes: [0, 0] },
    winner: 1,
    expected: [[3, 3], 1, 1, 2, true, 'Point'],
  },
];

for (const test of scoringCases) {
  const result = scoring.resolveRallyState(test.state, test.winner);
  assertEqual(
    [result.scores, result.server, result.servingPlayerIndex, result.serviceNumber, result.pointAdded, result.action],
    test.expected,
    test.label,
  );
}

assertEqual(scoring.evenSidePlayerFromCurrentServer(1, 1, 'doubles'), 0, 'Odd-score server correction must preserve the even-side identity');
const fragmentCases = [
  ['point team', 'one', 'point team one'],
  ['point team', 'team one', 'point team one'],
  ['point team', 'point team one', 'point team one'],
  ['score two', 'two one two', 'score two one two'],
  ['', 'Alex serving', 'Alex serving'],
];

for (const [previous, next, expected] of fragmentCases) {
  assertEqual(
    transcriptBuffer.mergeTranscriptFragments(previous, next),
    expected,
    `Transcript fragments must merge: “${previous}” + “${next}”`,
  );
}

assertEqual(
  transcriptBuffer.moreCompleteTranscript('point team', 'point team one'),
  'point team one',
  'The most complete interim transcript must survive a shorter final result',
);

console.log(`Voice scoring checks passed: ${parserCases.length} parser cases, 9 scoring invariants, and ${fragmentCases.length + 1} transcript-buffer cases.`);
