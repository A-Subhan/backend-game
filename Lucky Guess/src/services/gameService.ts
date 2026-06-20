// ============================================================
// Lucky Guess — Game Service
// Contoura Labs
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../config/database';
import { Room, MatchRecord, Achievement } from '@shared/types';
import { GAME_CONFIGS, COINS_WIN, COINS_LOSS } from '@shared/constants';
import { calculateElo, EloResult } from './eloService';
import { awardCoins } from './coinService';
import { checkAndUnlockAchievements, AchievementContext } from './achievementService';

export type GuessResult = 'higher' | 'lower' | 'correct';

export interface GuessOutcome {
  result: GuessResult;
  attemptsLeft: number;
  isCorrect: boolean;
}

export interface EndGameResult {
  winnerId: string;
  loserId: string;
  winnerEloChange: number;
  loserEloChange: number;
  coinsAwarded: number;
  matchId: string;
  winnerNewElo: number;
  loserNewElo: number;
  newAchievements: Achievement[];
}

/**
 * Create a new online game room in the database.
 */
export async function createOnlineRoom(
  player1Id: string,
  player1Name: string,
  player2Id: string,
  player2Name: string
): Promise<Room> {
  const roomId = uuidv4();
  const config = GAME_CONFIGS['online'];
  const secretNumber = Math.floor(Math.random() * (config.max - config.min + 1)) + config.min;

  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('rooms')
    .insert({
      id: roomId,
      player1_id: player1Id,
      player1_name: player1Name,
      player2_id: player2Id,
      player2_name: player2Name,
      secret_number: secretNumber,
      min_number: config.min,
      max_number: config.max,
      status: 'playing',
      max_attempts: config.maxAttempts,
      player1_attempts: 0,
      player2_attempts: 0,
      created_at: now,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create room: ${error?.message || 'unknown error'}`);
  }

  return {
    id: data.id,
    player1_id: data.player1_id,
    player1_name: data.player1_name,
    player2_id: data.player2_id,
    player2_name: data.player2_name,
    secret_number: data.secret_number,
    min_number: data.min_number,
    max_number: data.max_number,
    status: data.status,
    created_at: data.created_at,
    max_attempts: data.max_attempts,
  };
}

/**
 * Process a guess for a given room.
 * Returns the result (higher/lower/correct) and remaining attempts.
 */
export async function processGuess(
  roomId: string,
  playerId: string,
  guess: number
): Promise<GuessOutcome> {
  // Fetch the room
  const { data: room, error: roomError } = await supabaseAdmin
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (roomError || !room) {
    throw new Error('Room not found');
  }

  if (room.status !== 'playing') {
    throw new Error('Game is no longer in progress');
  }

  // Verify the player is in this room
  if (room.player1_id !== playerId && room.player2_id !== playerId) {
    throw new Error('Player is not in this room');
  }

  // Determine which player is guessing
  const isPlayer1 = room.player1_id === playerId;
  const currentAttempts = isPlayer1 ? (room.player1_attempts as number) : (room.player2_attempts as number);
  const maxAttempts = room.max_attempts as number;

  if (currentAttempts >= maxAttempts) {
    throw new Error('No attempts remaining');
  }

  const newAttempts = currentAttempts + 1;
  const attemptsLeft = maxAttempts - newAttempts;

  // Determine result
  const secretNumber = room.secret_number as number;
  let result: GuessResult;

  if (guess === secretNumber) {
    result = 'correct';
  } else if (guess < secretNumber) {
    result = 'higher';
  } else {
    result = 'lower';
  }

  // Update attempts in DB
  const updateField = isPlayer1 ? 'player1_attempts' : 'player2_attempts';
  const { error: updateError } = await supabaseAdmin
    .from('rooms')
    .update({ [updateField]: newAttempts })
    .eq('id', roomId);

  if (updateError) {
    console.error('Failed to update attempts:', updateError);
  }

  return {
    result,
    attemptsLeft,
    isCorrect: result === 'correct',
  };
}

/**
 * End a game: update room status, create match record, update ELO, coins, achievements.
 */
export async function endGame(
  roomId: string,
  winnerId: string,
  loserId: string,
  winnerAttempts: number
): Promise<EndGameResult> {
  // 1. Fetch the room
  const { data: room, error: roomError } = await supabaseAdmin
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (roomError || !room) {
    throw new Error('Room not found');
  }

  const loserAttempts = room.player1_id === loserId
    ? (room.player1_attempts as number)
    : (room.player2_attempts as number);

  const createdAt = new Date(room.created_at as string);
  const durationSeconds = Math.round((Date.now() - createdAt.getTime()) / 1000);

  // 2. Fetch both players' ELO
  const { data: winner, error: wError } = await supabaseAdmin
    .from('users')
    .select('elo, total_wins, total_losses, total_matches, streak, best_streak, coins')
    .eq('id', winnerId)
    .single();

  const { data: loser, error: lError } = await supabaseAdmin
    .from('users')
    .select('elo, total_wins, total_losses, total_matches, streak, best_streak, coins')
    .eq('id', loserId)
    .single();

  if (wError || !winner || lError || !loser) {
    throw new Error('Failed to fetch player data for ELO calculation');
  }

  // 3. Calculate ELO
  const eloResult: EloResult = calculateElo(
    winner.elo as number,
    loser.elo as number
  );

  // 4. Update room status
  await supabaseAdmin
    .from('rooms')
    .update({ status: 'finished' })
    .eq('id', roomId);

  // 5. Create match record
  const matchId = uuidv4();
  const { error: matchError } = await supabaseAdmin
    .from('matches')
    .insert({
      id: matchId,
      player1_id: room.player1_id,
      player2_id: room.player2_id,
      winner_id: winnerId,
      mode: 'online',
      secret_number: room.secret_number,
      player1_attempts: room.player1_attempts,
      player2_attempts: room.player2_attempts,
      created_at: room.created_at,
      duration_seconds: durationSeconds,
    });

  if (matchError) {
    console.error('Failed to create match record:', matchError);
  }

  // 6. Update winner stats
  const newWinnerStreak = (winner.streak as number) + 1;
  const newWinnerBestStreak = Math.max(winner.best_streak as number, newWinnerStreak);

  await supabaseAdmin
    .from('users')
    .update({
      elo: eloResult.newWinnerElo,
      total_wins: (winner.total_wins as number) + 1,
      total_matches: (winner.total_matches as number) + 1,
      streak: newWinnerStreak,
      best_streak: newWinnerBestStreak,
      updated_at: new Date().toISOString(),
    })
    .eq('id', winnerId);

  // 7. Update loser stats
  await supabaseAdmin
    .from('users')
    .update({
      elo: eloResult.newLoserElo,
      total_losses: (loser.total_losses as number) + 1,
      total_matches: (loser.total_matches as number) + 1,
      streak: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', loserId);

  // 8. Award coins
  const coinResult = await awardCoins(winnerId, COINS_WIN, 'match_win');
  await awardCoins(loserId, COINS_LOSS, 'match_loss');

  // 9. Check achievements for winner
  const winnerContext: AchievementContext = {
    totalWins: (winner.total_wins as number) + 1,
    totalMatches: (winner.total_matches as number) + 1,
    streak: newWinnerStreak,
    bestStreak: newWinnerBestStreak,
    totalCoins: coinResult.success ? coinResult.newTotal : (winner.coins as number),
    lastWinAttempts: winnerAttempts,
  };

  const achievementResult = await checkAndUnlockAchievements(winnerId, winnerContext);

  return {
    winnerId,
    loserId,
    winnerEloChange: eloResult.winnerChange,
    loserEloChange: eloResult.loserChange,
    coinsAwarded: COINS_WIN,
    matchId,
    winnerNewElo: eloResult.newWinnerElo,
    loserNewElo: eloResult.newLoserElo,
    newAchievements: achievementResult.newlyUnlocked,
  };
}

/**
 * End a game by forfeit — the other player wins.
 */
export async function forfeitGame(
  roomId: string,
  forfeiterId: string
): Promise<EndGameResult> {
  // Fetch the room to determine the opponent
  const { data: room, error } = await supabaseAdmin
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (error || !room) {
    throw new Error('Room not found');
  }

  const winnerId = room.player1_id === forfeiterId ? room.player2_id : room.player1_id;
  if (!winnerId) {
    throw new Error('Cannot determine winner');
  }

  // Winner gets the max attempts as their "attempts" (they didn't win by guessing)
  return endGame(roomId, winnerId, forfeiterId, (room.max_attempts as number) + 1);
}