// ============================================================
// Lucky Guess — Achievement Service
// Contoura Labs
//
// Checks all 6 achievement conditions against the user's
// current context and inserts any newly unlocked achievements.
//
// Works with both `user_achievements` (current schema) and
// `achievements` (legacy schema) tables.
// ============================================================

const { supabaseAdmin } = require('../config/database');
const { ACHIEVEMENTS } = require('../../shared/constants');

/**
 * Find the user's already-unlocked achievement keys.
 * Returns a Set of keys.
 */
async function fetchUnlockedKeys(userId) {
  // Try the current schema first.
  const { data: uaRows, error: uaError } = await supabaseAdmin
    .from('user_achievements')
    .select('achievement_key')
    .eq('user_id', userId);

  if (!uaError && uaRows && uaRows.length > 0) {
    return new Set(uaRows.map(a => a.achievement_key));
  }

  // Fall back to the legacy `achievements` table.
  const { data: aRows, error: aError } = await supabaseAdmin
    .from('achievements')
    .select('key')
    .eq('user_id', userId);

  if (aError || !aRows) return new Set();
  return new Set(aRows.map(a => a.key));
}

/**
 * Insert a newly-unlocked achievement row. Tries the current
 * schema first, then falls back to the legacy table.
 */
async function insertUnlock(userId, def) {
  const now = new Date().toISOString();

  const { error: uaError } = await supabaseAdmin
    .from('user_achievements')
    .insert({
      user_id: userId,
      achievement_key: def.key,
      unlocked_at: now,
    });

  if (!uaError) return true;

  // Fall back to the legacy schema.
  const { error: aError } = await supabaseAdmin
    .from('achievements')
    .insert({
      user_id: userId,
      key: def.key,
      title: def.title,
      description: def.description,
      icon: def.icon,
      unlocked_at: now,
    });

  if (aError) {
    console.error(`[Achievements] Failed to unlock ${def.key}:`, aError);
    return false;
  }
  return true;
}

/**
 * Check all 6 achievement conditions against the user's current
 * context. Insert any newly unlocked achievements and return them.
 *
 * context: { totalWins, totalMatches, streak, bestStreak,
 *            totalCoins, lastWinAttempts }
 */
async function checkAndUnlockAchievements(userId, context) {
  const newlyUnlocked = [];

  const unlockedKeys = await fetchUnlockedKeys(userId);

  const conditions = {
    first_win:     () => context.totalWins >= 1,
    lucky_guess:   () => context.lastWinAttempts === 1,
    sharpshooter:  () => context.lastWinAttempts >= 1 && context.lastWinAttempts <= 3,
    veteran:       () => context.totalMatches >= 10,
    streak_3:      () => context.bestStreak >= 3,
    collector_500: () => context.totalCoins >= 500,
  };

  for (const def of ACHIEVEMENTS) {
    if (unlockedKeys.has(def.key)) continue;

    const checker = conditions[def.key];
    if (checker && checker()) {
      const ok = await insertUnlock(userId, def);
      if (ok) {
        newlyUnlocked.push({
          id: `${userId}_${def.key}`,
          key: def.key,
          title: def.title,
          description: def.description,
          icon: def.icon,
          unlocked_at: new Date().toISOString(),
        });
      }
    }
  }

  return { newlyUnlocked };
}

module.exports = { checkAndUnlockAchievements, fetchUnlockedKeys, insertUnlock };
