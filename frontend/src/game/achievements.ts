import { BUSINESSES } from "@/src/game/businesses";
import type { GameState } from "@/src/game/GameContext";

function ownedCount(s: GameState): number {
  return BUSINESSES.filter((d) => (s.businesses[d.id]?.level ?? 0) > 0).length;
}

function maxLevel(s: GameState): number {
  return Math.max(0, ...BUSINESSES.map((d) => s.businesses[d.id]?.level ?? 0));
}

function totalLevels(s: GameState): number {
  return BUSINESSES.reduce((n, d) => n + (s.businesses[d.id]?.level ?? 0), 0);
}

function managerCount(s: GameState): number {
  return BUSINESSES.filter((d) => s.businesses[d.id]?.hasManager).length;
}

function proBoostCount(s: GameState): number {
  return Object.values(s.proBoosts ?? {}).filter(Boolean).length;
}

function employeeTotal(s: GameState): number {
  const emp = s.employees ?? {};
  return BUSINESSES.reduce((n, d) => n + (emp[d.id] ?? 0), 0);
}

export type Achievement = {
  id: string;
  title: string;
  desc: string;
  gems: number;
  icon: string;
  check: (s: GameState) => boolean;
};

// Scaled 5 → 100 gems. Easy early wins are cheap; late-game grinds pay big.
export const ACHIEVEMENTS: Achievement[] = [
  // ---- Net worth ladder ----
  { id: "nw_1k", title: "First Dollars", desc: "Reach $1K net worth", gems: 5, icon: "cash", check: (s) => s.lifetimeEarnings >= 1e3 },
  { id: "nw_100k", title: "Pocket Change", desc: "Reach $100K net worth", gems: 10, icon: "cash", check: (s) => s.lifetimeEarnings >= 1e5 },
  { id: "nw_1m", title: "Millionaire", desc: "Reach $1M net worth", gems: 15, icon: "cash-multiple", check: (s) => s.lifetimeEarnings >= 1e6 },
  { id: "nw_10m", title: "Big Spender", desc: "Reach $10M net worth", gems: 20, icon: "cash-multiple", check: (s) => s.lifetimeEarnings >= 1e7 },
  { id: "nw_100m", title: "Mogul", desc: "Reach $100M net worth", gems: 30, icon: "cash-multiple", check: (s) => s.lifetimeEarnings >= 1e8 },
  { id: "nw_1b", title: "Billionaire", desc: "Reach $1B net worth", gems: 40, icon: "bank", check: (s) => s.lifetimeEarnings >= 1e9 },
  { id: "nw_100b", title: "Hectobillionaire", desc: "Reach $100B net worth", gems: 55, icon: "bank", check: (s) => s.lifetimeEarnings >= 1e11 },
  { id: "nw_1t", title: "Trillionaire", desc: "Reach $1T net worth", gems: 70, icon: "diamond-stone", check: (s) => s.lifetimeEarnings >= 1e12 },
  { id: "nw_1qa", title: "Quadrillionaire", desc: "Reach $1Qa net worth", gems: 90, icon: "diamond-stone", check: (s) => s.lifetimeEarnings >= 1e15 },
  { id: "nw_1qi", title: "Untouchable", desc: "Reach $1Qi net worth", gems: 100, icon: "crown", check: (s) => s.lifetimeEarnings >= 1e18 },

  // ---- Business levels ----
  { id: "level_10", title: "Getting Going", desc: "Get any business to level 10", gems: 5, icon: "trending-up", check: (s) => maxLevel(s) >= 10 },
  { id: "level_25", title: "Scaling Up", desc: "Get any business to level 25", gems: 10, icon: "trending-up", check: (s) => maxLevel(s) >= 25 },
  { id: "level_50", title: "Cash Machine", desc: "Reach business level 50", gems: 20, icon: "chart-line", check: (s) => maxLevel(s) >= 50 },
  { id: "level_100", title: "Empire Builder", desc: "Reach business level 100", gems: 35, icon: "office-building", check: (s) => maxLevel(s) >= 100 },
  { id: "level_250", title: "Powerhouse", desc: "Reach business level 250", gems: 60, icon: "office-building-marker", check: (s) => maxLevel(s) >= 250 },
  { id: "level_500", title: "Maxed Out", desc: "Reach business level 500", gems: 90, icon: "rocket-launch", check: (s) => maxLevel(s) >= 500 },
  { id: "total_500", title: "Across the Board", desc: "500 total levels across businesses", gems: 45, icon: "format-list-numbered", check: (s) => totalLevels(s) >= 500 },

  // ---- Ownership ----
  { id: "own_3", title: "Branching Out", desc: "Own 3 different businesses", gems: 5, icon: "store", check: (s) => ownedCount(s) >= 3 },
  { id: "own_5", title: "Diversified", desc: "Own 5 different businesses", gems: 10, icon: "store", check: (s) => ownedCount(s) >= 5 },
  { id: "own_all", title: "Monopoly", desc: "Own all 10 businesses", gems: 40, icon: "crown", check: (s) => ownedCount(s) >= BUSINESSES.length },

  // ---- Managers ----
  { id: "first_manager", title: "Delegator", desc: "Hire your first manager", gems: 8, icon: "account-tie", check: (s) => managerCount(s) >= 1 },
  { id: "managers_5", title: "Middle Management", desc: "Have 5 managers working", gems: 20, icon: "account-group", check: (s) => managerCount(s) >= 5 },
  { id: "managers_all", title: "Hands Off", desc: "Every business has a manager", gems: 50, icon: "account-supervisor", check: (s) => managerCount(s) >= BUSINESSES.length },

  // ---- Employees ----
  { id: "emp_first", title: "Now Hiring", desc: "Hire your first employee", gems: 5, icon: "account-hard-hat", check: (s) => employeeTotal(s) >= 1 },
  { id: "emp_25", title: "Staffed Up", desc: "Hire 25 employees total", gems: 25, icon: "account-multiple-plus", check: (s) => employeeTotal(s) >= 25 },
  { id: "emp_100", title: "Corporate Giant", desc: "Hire 100 employees total", gems: 70, icon: "account-multiple", check: (s) => employeeTotal(s) >= 100 },

  // ---- Pro boosts ----
  { id: "pro_first", title: "Premium Service", desc: "Buy your first Pro Boost", gems: 20, icon: "diamond-stone", check: (s) => proBoostCount(s) >= 1 },
  { id: "pro_5", title: "All-Star Team", desc: "Pro Boost 5 businesses", gems: 55, icon: "diamond-stone", check: (s) => proBoostCount(s) >= 5 },

  // ---- Prestige ----
  { id: "first_prestige", title: "Fresh Start", desc: "Prestige for the first time", gems: 30, icon: "restart", check: (s) => s.prestigeCount >= 1 },
  { id: "prestige_5", title: "Reborn", desc: "Prestige 5 times", gems: 60, icon: "restart", check: (s) => s.prestigeCount >= 5 },
  { id: "investors_100", title: "Angel Backed", desc: "Earn 100 investors", gems: 90, icon: "account-cash", check: (s) => s.prestigePoints >= 100 },

  // ---- Gems & cosmetics ----
  { id: "gems_100", title: "Gem Collector", desc: "Hold 100 gems at once", gems: 10, icon: "diamond-stone", check: (s) => s.gems >= 100 },
  { id: "gems_500", title: "Gem Hoarder", desc: "Hold 500 gems at once", gems: 30, icon: "diamond-stone", check: (s) => s.gems >= 500 },
  { id: "city_join", title: "Citizen", desc: "Join or found a City", gems: 10, icon: "city-variant", check: (s) => !!s.cityId },
  { id: "city_boost", title: "Power in Numbers", desc: "Get a City income boost", gems: 15, icon: "rocket-launch", check: (s) => (s.cityBoost ?? 1) > 1 },

  // ---- GRAND PRIZE 🏆 ----
  // First player in the world to complete this wins $1,000 USD.
  {
    id: "all_level_1000",
    title: "Tycoon Legend (Grand Prize)",
    desc: "Reach Level 1000 on ALL businesses — 1st to do it wins $1,000 USD!",
    gems: 1000,
    icon: "trophy",
    check: (s) => BUSINESSES.every((d) => (s.businesses[d.id]?.level ?? 0) >= 1000),
  },
];

// The world-first $1,000 USD contest achievement.
export const GRAND_PRIZE_ACHIEVEMENT_ID = "all_level_1000";
