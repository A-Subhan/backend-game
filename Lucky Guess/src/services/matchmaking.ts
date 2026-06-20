// ============================================================
// Lucky Guess — Matchmaking Queue Service
// Contoura Labs
// ============================================================

export interface QueuedPlayer {
  userId: string;
  userName: string;
  elo: number;
  socketId: string;
  joinedAt: number;
}

export interface MatchPair {
  player1: QueuedPlayer;
  player2: QueuedPlayer;
}

/**
 * Simple FIFO matchmaking queue.
 * When 2+ players are in the queue, pairs the first two.
 */
export class MatchmakingQueue {
  private queue: Map<string, QueuedPlayer> = new Map();

  /**
   * Add a player to the matchmaking queue.
   * If the player is already in the queue, this is a no-op.
   */
  add(player: Omit<QueuedPlayer, 'joinedAt'>): void {
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
  remove(userId: string): QueuedPlayer | undefined {
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
  tryMatch(): MatchPair | null {
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
  has(userId: string): boolean {
    return this.queue.has(userId);
  }

  /**
   * Get the current queue size.
   */
  get size(): number {
    return this.queue.size;
  }

  /**
   * Get all queued players (for debugging/monitoring).
   */
  getAll(): QueuedPlayer[] {
    return Array.from(this.queue.values());
  }

  /**
   * Clear the entire queue.
   */
  clear(): void {
    this.queue.clear();
  }
}