// ============================================================
// Lucky Guess — Coin Service
// Contoura Labs
// ============================================================

import { supabaseAdmin } from '../config/database';

export interface CoinResult {
  success: boolean;
  newTotal: number;
  error?: string;
}

/**
 * Award coins to a user.
 */
export async function awardCoins(
  userId: string,
  amount: number,
  _reason: string
): Promise<CoinResult> {
  try {
    // Fetch current coins
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('coins')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      return { success: false, newTotal: 0, error: 'User not found' };
    }

    const newTotal = (user.coins as number) + amount;

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ coins: newTotal, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to award coins:', updateError);
      return { success: false, newTotal: user.coins as number, error: 'Failed to update coins' };
    }

    return { success: true, newTotal };
  } catch (error) {
    console.error('Award coins error:', error);
    return { success: false, newTotal: 0, error: 'Internal error' };
  }
}

/**
 * Deduct coins from a user if they have enough.
 */
export async function deductCoins(
  userId: string,
  amount: number
): Promise<CoinResult> {
  try {
    // Fetch current coins
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('coins')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      return { success: false, newTotal: 0, error: 'User not found' };
    }

    const currentCoins = user.coins as number;

    if (currentCoins < amount) {
      return { success: false, newTotal: currentCoins, error: 'Insufficient coins' };
    }

    const newTotal = currentCoins - amount;

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ coins: newTotal, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to deduct coins:', updateError);
      return { success: false, newTotal: currentCoins, error: 'Failed to update coins' };
    }

    return { success: true, newTotal };
  } catch (error) {
    console.error('Deduct coins error:', error);
    return { success: false, newTotal: 0, error: 'Internal error' };
  }
}