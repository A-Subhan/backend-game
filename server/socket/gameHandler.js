const supabase = require('../services/supabase');
const { validateGuess, calculateRatingChange } = require('../services/gameLogic');

function initGameHandler(io, socket) {

  // Player submits a guess
  socket.on('submit_guess', async ({ roomId, guess }) => {
    try {
      // Fetch the room with the secret number
      const { data: room, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
        .single();

      if (error || !room) return socket.emit('error', { message: 'Room not found' });
      if (room.status !== 'active') return socket.emit('error', { message: 'Game is not active' });

      // Server-side validation — client never sees the secret number
      const result = validateGuess(guess, room.secret_number, room.min_number, room.max_number);
      if (!result.valid) return socket.emit('guess_error', { message: result.error });

      const newAttempts = room.attempts_used + 1;
      const isCorrect = result.result === 'correct';
      const outOfAttempts = newAttempts >= room.max_attempts && !isCorrect;

      // Update attempts in DB
      await supabase.from('rooms').update({ attempts_used: newAttempts }).eq('id', roomId);

      // Broadcast result to both players in the room
      io.to(roomId).emit('guess_result', {
        guesserUserId: socket.userId,
        guess,
        hint: result.result,   // 'correct', 'higher', or 'lower'
        attemptsUsed: newAttempts,
        attemptsRemaining: room.max_attempts - newAttempts,
      });

      // Game over?
      if (isCorrect || outOfAttempts) {
        await endGame(io, room, socket.userId, isCorrect, newAttempts);
      }
    } catch (err) {
      console.error('Guess error:', err);
      socket.emit('error', { message: 'Server error processing guess' });
    }
  });

  // Player forfeits
  socket.on('forfeit', async ({ roomId }) => {
    const { data: room } = await supabase.from('rooms').select('*').eq('id', roomId).single();
    if (room) await endGame(io, room, socket.userId, false, room.attempts_used, true);
  });
}

async function endGame(io, room, guesserUserId, guesserWon, attempts, forfeit = false) {
  // Determine winner and loser IDs
  const winnerId = guesserWon ? guesserUserId : (guesserUserId === room.player1_id ? room.player2_id : room.player1_id);
  const loserId = guesserWon ? (guesserUserId === room.player1_id ? room.player2_id : room.player1_id) : guesserUserId;

  // Fetch both players' ratings
  const { data: winner } = await supabase.from('users').select('rating').eq('id', winnerId).single();
  const { data: loser } = await supabase.from('users').select('rating').eq('id', loserId).single();

  const ratingChange = calculateRatingChange(winner.rating, loser.rating);

  // Update ratings and stats
  await Promise.all([
    supabase.from('users').update({
      rating: winner.rating + ratingChange,
      wins: supabase.rpc('increment', { row_id: winnerId, column: 'wins' }),
      games_played: supabase.rpc('increment', { row_id: winnerId, column: 'games_played' }),
    }).eq('id', winnerId),
    supabase.from('users').update({
      rating: Math.max(100, loser.rating - ratingChange),
      losses: supabase.rpc('increment', { row_id: loserId, column: 'losses' }),
      games_played: supabase.rpc('increment', { row_id: loserId, column: 'games_played' }),
    }).eq('id', loserId),
    supabase.from('rooms').update({ status: 'finished' }).eq('id', room.id),
    supabase.from('matches').insert({
      room_id: room.id,
      winner_id: winnerId,
      loser_id: loserId,
      winner_rating_change: ratingChange,
      loser_rating_change: -ratingChange,
      target_number: room.secret_number,
      total_attempts: attempts,
      mode: 'ranked',
    }),
  ]);

  // Notify both players
  io.to(room.id).emit('game_over', {
    winnerId,
    loserId,
    targetNumber: room.secret_number,
    totalAttempts: attempts,
    ratingChange,
    forfeit,
  });
}

module.exports = { initGameHandler };