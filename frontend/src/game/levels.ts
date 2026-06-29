// ----- Player Leveling System -----
// Levels cap at 1000. Each level gives a very slight permanent boost to income
// multiplier (+1% per level) and to business speed (+1% per level). Leveling up
// gets progressively harder and rewards 5 gems, 1 key and a 5-minute 2x boost.

export const LEVEL_MAX = 1000;

// Level-up rewards
export const LEVELUP_GEMS = 5;
export const LEVELUP_KEYS = 1;
export const LEVELUP_BOOST_MS = 5 * 60 * 1000; // 2x for 5 minutes

// XP awarded by each source
export const XP_ACHIEVEMENT = 100;
export const XP_LOOTBOX = 20;
export const XP_BUSINESS_PER_LEVEL = 2;
export const XP_MANAGER = 25;
export const XP_POWERUP = 25;
export const XP_PURCHASE = 50;

// XP required to advance FROM `level` TO `level + 1`. Progressively harder.
export function xpToNext(level: number): number {
  if (level >= LEVEL_MAX) return Infinity;
  return Math.floor(100 + 60 * Math.pow(level, 1.55));
}

// Permanent income multiplier factor from the player's level (level 1 = neutral).
export function levelIncomeMult(level: number): number {
  return 1 + 0.01 * Math.max(0, (level ?? 1) - 1);
}

// Permanent business speed factor from the player's level (level 1 = neutral).
export function levelSpeedMult(level: number): number {
  return 1 + 0.01 * Math.max(0, (level ?? 1) - 1);
}
