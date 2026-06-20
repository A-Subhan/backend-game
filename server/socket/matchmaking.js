const supabase = require('../services/supabase');

// In-memory queue — players waiting for a match
// Format: { socketId, userId, username, rating, socket }
const waitingQueue = [];

function initMatchmaking(io, socket) {

  // Player presses "Find Match"
  socket.on('find_match', async () => {
    console.log(`🔍 ${socket.username} is looking for a match (rating: ${socket.rating})`);

    // Check if already in queue
    const alreadyWaiting = waitingQueue.find(p => p.userId === socket.userId);
    if (alreadyWaiting) return socket.emit('error', { message: 'Already in queue' });

    // Add to waiting queue
    waitingQueue.push({
      socketId: socket.id,
      userId: socket.userId,
      username: socket.username,
      rating: socket.rating,
      socket,
      joinedAt: Date.now(),
    });

    socket.emit('matchmaking_status', { status: 'searching', queuePosition: waitingQueue.length });

    // Try to find a match immediately
    tryMatch(io);
  });

  // Player cancels search
  socket.on('cancel_match', () => {
    removeFromQueue(socket.userId);
    socket.emit('matchmaking_status', { status: 'idle' });
  });

  // Clean up when player disconnects
  socket.on('disconnect', () => {
    removeFromQueue(socket.userId);
  });
}

function removeFromQueue(userId) {
  const idx = waitingQueue.findIndex(p => p.userId === userId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

async function tryMatch(io) {
  if (waitingQueue.length < 2) return;

  // Simple matchmaking: take the two players who have been waiting longest
  // Advanced: could sort by rating similarity
  const player1 = waitingQueue.shift();
  const player2 = waitingQueue.shift();

  // Create a room in the database
  const secretNumber = Math.floor(Math.random() * 100) + 1;
  const { data: room, error } = await supabase
    .from('rooms')
    .insert({
      player1_id: player1.userId,
      player2_id: player2.userId,
      status: 'active',
      secret_number: secretNumber, // Stored ONLY on the server
      min_number: 1,
      max_number: 100,
      max_attempts: 10,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create room:', error);
    // Put players back in queue
    waitingQueue.unshift(player1, player2);
    return;
  }

  // Put both players in a Socket.IO "room" (like a private chat channel)
  player1.socket.join(room.id);
  player2.socket.join(room.id);

  // Notify both players — match found!
  const matchData = {
    roomId: room.id,
    opponent: null, // filled per player below
    min: room.min_number,
    max: room.max_number,
    maxAttempts: room.max_attempts,
  };

  player1.socket.emit('match_found', { ...matchData, opponent: { username: player2.username, rating: player2.rating, userId: player2.userId } });
  player2.socket.emit('match_found', { ...matchData, opponent: { username: player1.username, rating: player1.rating, userId: player1.userId } });

  console.log(`✅ Match created: ${player1.username} vs ${player2.username} (Room: ${room.id})`);
}

module.exports = { initMatchmaking };