// ============================================================
// Lucky Guess — ELO Calculation Service
// Contoura Labs
// ============================================================

/**
 * Calculate new ELO ratings after a match.
 *
 * Formula:
 *   Expected score = 1 / (1 + 10^((opponentElo - playerElo) / 400))
 *   New elo = old elo + K * (actual - expected)
 *
 * Winner actual score = 1, Loser actual score = 0.
 */
function calculateElo(winnerElo, loserElo, K = 32) {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

  const winnerChange = Math.round(K * (1 - expectedWinner));
  const loserChange = Math.round(K * (0 - expectedLoser));

  const newWinnerElo = winnerElo + winnerChange;
  const newLoserElo = Math.max(0, loserElo + loserChange);

  return {
    newWinnerElo,
    newLoserElo,
    winnerChange,
    loserChange,
  };
}

module.exports = { calculateElo };