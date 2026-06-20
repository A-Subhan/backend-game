// ============================================================
// Lucky Guess — Socket.IO Initialization
// Contoura Labs
// ============================================================

import { Server } from 'socket.io';
import { registerSocketHandlers } from './handlers';

/**
 * Initialize Socket.IO with all event handlers.
 * Called from the main Express server setup.
 */
export function initializeSocket(io: Server): void {
  registerSocketHandlers(io);
  console.log('[Socket] Socket.IO handlers initialized');
}