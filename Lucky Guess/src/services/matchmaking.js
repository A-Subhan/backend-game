// ============================================================
// Lucky Guess — Matchmaking Queue Service
// Contoura Labs
// ============================================================

/**
 * Simple FIFO matchmaking queue.
 * When 2+ players are in the queue, pairs the first two.
 */
class MatchmakingQueue {
  constructor() {
    this.queue = new Map();
  }

  /**
   * Add a player to the matchmaking queue.
   */
  add(player) {
    if (this.queue.has(player.userId)) {
      return; // Already queued
    }

    this.queue.set(player.userId, {
      ...player,
      joinedAt: Date.now(),
    });
  }

  /**
   * Remove a player from the queue.
   */
  remove(userId) {
    const player = this.queue.get(userId);
    if (player) {
      this.queue.delete(userId);
    }
    return player;
  }

  /**
   * Try to find a match. If 2+ players are in queue,
   * pair the first two (FIFO).
   */
  tryMatch() {
    if (this.queue.size < 2) {
      return null;
    }

    const entries = Array.from(this.queue.entries());
    const [player1Id, player1] = entries[0];
    const [player2Id, player2] = entries[1];

    // Remove both from queue
    this.queue.delete(player1Id);
    this.queue.delete(player2Id);

    return { player1, player2 };
  }

  /**
   * Check if a user is currently in the queue.
   */
  has(userId) {
    return this.queue.has(userId);
  }

  /**
   * Get the current queue size.
   */
  get size() {
    return this.queue.size;
  }

  /**
   * Get all queued players (for debugging/monitoring).
   */
  getAll() {
    return Array.from(this.queue.values());
  }

  /**
   * Clear the entire queue.
   */
  clear() {
    this.queue.clear();
  }
}

module.exports = { MatchmakingQueue };