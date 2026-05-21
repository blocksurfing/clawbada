/** ELO rating math for battle leaderboard. Pure deterministic — lives in
 *  game-logic so both the engine (legacy state-machine consumer) and the
 *  indexer (battle-watcher's BattleSettled accounting, Codex PR-C FU F-01)
 *  can share it without crossing app boundaries. */

const DEFAULT_ELO = 1200;
const K_FACTOR = 32;

/** Standard ELO calculation. K_FACTOR=32 matches the per-match swing used
 *  by lichess / FIDE Class A approximations. */
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
