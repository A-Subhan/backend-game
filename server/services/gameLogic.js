// All game validation happens SERVER-SIDE — the client never sees the secret number

/**
 * Calculate rating change after a match
 * Winner gains points, loser loses points
 * Bigger rating difference = smaller gain for favorite, bigger gain for underdog
 */
function calculateRatingChange(winnerRating, loserRating) {
  const K = 32; // How much ratings change per game (standard chess K-factor)
  const expectedWin = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const change = Math.round(K * (1 - expectedWin));
  return Math.max(10, Math.min(50, change)); // Clamp between 10 and 50
}

/**
 * Validate a guess against the secret number stored on the server
 */
function validateGuess(guess, secretNumber, min, max) {
  if (typeof guess !== 'number' || isNaN(guess)) {
    return { valid: false, error: 'Invalid number' };
  }
  if (guess < min || guess > max) {
    return { valid: false, error: `Number must be between ${min} and ${max}` };
  }
  if (guess === secretNumber) {
    return { valid: true, result: 'correct' };
  }
  return { valid: true, result: guess < secretNumber ? 'higher' : 'lower' };
}

module.exports = { calculateRatingChange, validateGuess };