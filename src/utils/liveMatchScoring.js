export function evenSidePlayerFromCurrentServer(score, servingPlayerIndex, matchType = 'doubles') {
  if (matchType !== 'doubles') return 0;
  return Number(score) % 2 === 0 ? servingPlayerIndex : 1 - servingPlayerIndex;
}

export function playerForSideOut(score, evenSidePlayerIndex, matchType = 'doubles') {
  if (matchType !== 'doubles') return 0;
  return Number(score) % 2 === 0 ? evenSidePlayerIndex : 1 - evenSidePlayerIndex;
}

/**
 * Returns the serving state after the receiving team wins a rally.
 * No point is added here: callers update only the serve state.
 */
export function nextServeAfterReceiverWin({
  matchType,
  winnerTeam,
  server,
  servingPlayerIndex,
  serviceNumber,
  scores,
  evenSidePlayerIndexes,
}) {
  if (matchType === 'doubles' && serviceNumber === 1) {
    return {
      server,
      servingPlayerIndex: servingPlayerIndex === 0 ? 1 : 0,
      serviceNumber: 2,
      action: 'Second server',
    };
  }

  const nextServer = winnerTeam;
  return {
    server: nextServer,
    servingPlayerIndex: playerForSideOut(
      scores[nextServer],
      evenSidePlayerIndexes?.[nextServer] ?? 0,
      matchType,
    ),
    serviceNumber: 1,
    action: 'Side out',
  };
}

export function resolveRallyState(state, winnerTeam) {
  const scores = [...state.scores];
  if (winnerTeam === state.server) {
    scores[winnerTeam] += 1;
    return {
      scores,
      server: state.server,
      servingPlayerIndex: state.servingPlayerIndex,
      serviceNumber: state.serviceNumber,
      pointAdded: true,
      action: 'Point',
    };
  }

  return {
    scores,
    ...nextServeAfterReceiverWin({ ...state, winnerTeam }),
    pointAdded: false,
  };
}
