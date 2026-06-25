// ============================================================
// Lucky Guess — Coin Service
// Contoura Labs
// ============================================================

const { supabaseAdmin } = require('../config/database');

/**
 * Award coins to a user.
 */
async function awardCoins(userId, amount, _reason) {
  try {
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('coins')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      return { success: false, newTotal: 0, error: 'User not found' };
    }

    const newTotal = user.coins + amount;

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ coins: newTotal, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to award coins:', updateError);
      return { success: false, newTotal: user.coins, error: 'Failed to update coins' };
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
async function deductCoins(userId, amount) {
  try {
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('coins')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      return { success: false, newTotal: 0, error: 'User not found' };
    }

    const currentCoins = user.coins;

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

module.exports = { awardCoins, deductCoins };