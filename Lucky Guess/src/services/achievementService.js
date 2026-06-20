// ============================================================
// Lucky Guess — Achievement Service
// Contoura Labs
// ============================================================

const { supabaseAdmin } = require('../config/database');
const { ACHIEVEMENTS } = require('../../shared/constants');

/**
 * Check all 6 achievement conditions against the user's current context.
 * Insert any newly unlocked achievements and return them.
 */
async function checkAndUnlockAchievements(userId, context) {
  const newlyUnlocked = [];

  // Fetch already-unlocked keys for this user
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('user_achievements')
    .select('achievement_key')
    .eq('user_id', userId);

  if (fetchError) {
    console.error('Failed to fetch existing achievements:', fetchError);
    return { newlyUnlocked: [] };
  }

  const unlockedKeys = new Set(
    (existing || []).map(a => a.achievement_key)
  );

  // Define conditions for each achievement
  const conditions = {
    first_win: () => context.totalWins >= 1,
    lucky_guess: () => context.lastWinAttempts === 1,
    sharpshooter: () => context.lastWinAttempts >= 1 && context.lastWinAttempts <= 3,
    veteran: () => context.totalMatches >= 10,
    streak_3: () => context.bestStreak >= 3,
    collector_500: () => context.totalCoins >= 500,
  };

  // Check each achievement
  for (const def of ACHIEVEMENTS) {
    if (unlockedKeys.has(def.key)) continue;

    const checker = conditions[def.key];
    if (checker && checker()) {
      const { error: insertError } = await supabaseAdmin
        .from('user_achievements')
        .insert({
          user_id: userId,
          achievement_key: def.key,
          unlocked_at: new Date().toISOString(),
        });

      if (!insertError) {
        newlyUnlocked.push({
          id: `${userId}_${def.key}`,
          key: def.key,
          title: def.title,
          description: def.description,
          icon: def.icon,
          unlocked_at: new Date().toISOString(),
        });
      } else {
        console.error(`Failed to unlock achievement ${def.key}:`, insertError);
      }
    }
  }

  return { newlyUnlocked };
}

module.exports = { checkAndUnlockAchievements };