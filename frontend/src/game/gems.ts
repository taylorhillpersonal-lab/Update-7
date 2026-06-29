import { colors } from "@/src/game/theme";

// ----- Gem economy tuning -----
export const PRO_BOOST_BASE = 250; // first store's Pro Boost
export const PRO_BOOST_COST = 250; // legacy fallback
export const PRO_BOOST_MULT = 3; // a Pro-boosted business earns x3

// Pro Boost price scales per store: 1st = 250 gems, climbing from there.
export function proBoostCost(index: number): number {
  return Math.round((PRO_BOOST_BASE * Math.pow(1.55, index)) / 5) * 5;
}

export const FREE_GEM_AMOUNT = 5;
export const FREE_GEM_INTERVAL_MS = 30 * 60 * 1000; // every 30 min
export const FREE_GEM_INTERVAL_FAST_MS = 10 * 60 * 1000; // with Gem Fountain perk

// Daily reward grows with the login streak (capped).
export function dailyRewardForStreak(streak: number): number {
  return Math.min(200, 15 + Math.max(0, streak - 1) * 15);
}

export function prestigeGemReward(investorsGained: number): number {
  return Math.max(3, Math.floor(investorsGained / 8));
}

export type GemUpgradeKey =
  | "doubleIncome"
  | "autoTapper"
  | "doubleSpeed"
  | "tycoonRush"
  | "empireSynergy"
  | "offlineOvertime"
  | "luckyFighter"
  | "gemFountain"
  | "megaDaily"
  | "quantumLeap"
  | "compoundInterest"
  | "hyperdrive"
  | "fortuneFavor";

export type GemUpgradeDef = {
  key: GemUpgradeKey;
  title: string;
  desc: string;
  cost: number;
  icon: string;
  color: string;
};

export const GEM_UPGRADES: GemUpgradeDef[] = [
  {
    key: "doubleIncome",
    title: "Golden Touch",
    desc: "Permanently DOUBLE all income",
    cost: 300,
    icon: "cash-multiple",
    color: colors.brandSecondary,
  },
  {
    key: "autoTapper",
    title: "Robo-Hands",
    desc: "Auto-taps businesses that have no manager",
    cost: 200,
    icon: "gesture-double-tap",
    color: colors.brandPrimary,
  },
  {
    key: "doubleSpeed",
    title: "Time Warp",
    desc: "All businesses produce 2x faster",
    cost: 450,
    icon: "lightning-bolt",
    color: colors.brandTertiary,
  },
  {
    key: "tycoonRush",
    title: "Tycoon Rush",
    desc: "+50% income on top of everything",
    cost: 600,
    icon: "trending-up",
    color: colors.brandSecondary,
  },
  {
    key: "empireSynergy",
    title: "Empire Synergy",
    desc: "+25% income across your whole empire",
    cost: 400,
    icon: "office-building-marker",
    color: colors.brandPrimary,
  },
  {
    key: "offlineOvertime",
    title: "Night Shift",
    desc: "Offline earnings cap raised 12h → 24h",
    cost: 350,
    icon: "weather-night",
    color: colors.brandTertiary,
  },
  {
    key: "luckyFighter",
    title: "Lucky Fighter",
    desc: "Win business disputes 65% of the time",
    cost: 500,
    icon: "boxing-glove",
    color: colors.brandSecondary,
  },
  {
    key: "gemFountain",
    title: "Gem Fountain",
    desc: "Free Gem refills every 10 min (was 30)",
    cost: 250,
    icon: "fountain",
    color: colors.brandTertiary,
  },
  {
    key: "megaDaily",
    title: "Mega Daily",
    desc: "Doubles your Daily Reward gems",
    cost: 280,
    icon: "calendar-star",
    color: colors.brandPrimary,
  },
  {
    key: "quantumLeap",
    title: "Quantum Leap",
    desc: "+75% income on your entire empire",
    cost: 750,
    icon: "atom",
    color: colors.brandSecondary,
  },
  {
    key: "compoundInterest",
    title: "Compound Interest",
    desc: "+60% income that stacks with everything",
    cost: 550,
    icon: "chart-line-variant",
    color: colors.brandPrimary,
  },
  {
    key: "hyperdrive",
    title: "Hyperdrive",
    desc: "All businesses produce 50% faster",
    cost: 650,
    icon: "rocket",
    color: colors.brandTertiary,
  },
  {
    key: "fortuneFavor",
    title: "Fortune's Favor",
    desc: "Free Gem refills are 50% bigger",
    cost: 320,
    icon: "clover",
    color: colors.brandSecondary,
  },
];

export function defaultGemUpgrades(): Record<GemUpgradeKey, boolean> {
  return GEM_UPGRADES.reduce(
    (acc, u) => {
      acc[u.key] = false;
      return acc;
    },
    {} as Record<GemUpgradeKey, boolean>,
  );
}

// ----- Gem packs (must mirror backend GEM_PACKS ids/amounts) -----
export type GemPack = {
  id: string;
  gems: number;
  price: string;
  bonus?: string;
  best?: boolean;
};

export const GEM_PACKS: GemPack[] = [
  { id: "pack_xs", gems: 100, price: "$0.99" },
  { id: "pack_s", gems: 550, price: "$4.99", bonus: "+10% bonus" },
  { id: "pack_m", gems: 1200, price: "$9.99", bonus: "+20% bonus" },
  { id: "pack_l", gems: 2500, price: "$19.99", bonus: "+25% bonus", best: true },
  { id: "pack_xl", gems: 6500, price: "$49.99", bonus: "+30% bonus" },
];
