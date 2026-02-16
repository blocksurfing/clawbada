const DEFAULT_ELO = 1200;
const K_FACTOR = 32;

/**
 * Standard ELO rating calculation for battle matchmaking.
 */
export function calculateNewElo(
  winnerElo: number,
  loserElo: number,
): { newWinnerElo: number; newLoserElo: number } {
  const expectedWin = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLose = 1 - expectedWin;

  const newWinnerElo = Math.round(winnerElo + K_FACTOR * (1 - expectedWin));
  const newLoserElo = Math.round(loserElo + K_FACTOR * (0 - expectedLose));

  return { newWinnerElo, newLoserElo };
}

export function getDefaultElo(): number {
  return DEFAULT_ELO;
}
