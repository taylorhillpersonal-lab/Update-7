import { colors } from "@/src/game/theme";

// ----- Loot Boxes & Keys -----
export const FREE_LOOT_INTERVAL_MS = 8 * 60 * 60 * 1000; // a free box every 8h
export const KEY_GEM_COST = 60; // buy 1 key for 60 gems
export const DAILY_LOGIN_KEYS = 1; // keys granted on daily reward claim

export type LootType = "gems" | "cash" | "boost";

export type LootReward = {
  id: string;
  type: LootType;
  weight: number;
  label: string;
  icon: string;
  color: string;
  amount?: number; // gems
  pct?: number; // cash = pct of net worth
};

export type LootBox = {
  id: string;
  name: string;
  desc: string;
  keyCost: number;
  icon: string;
  gradient: [string, string];
  glow: string;
  table: LootReward[];
};

const G = colors.brandTertiary; // gems
const C = colors.brandSecondary; // cash
const P = colors.brandPrimary; // boost

// Reward tables scale up per tier.
const BRONZE: LootReward[] = [
  { id: "b_g1", type: "gems", weight: 34, amount: 15, label: "15 Gems", icon: "diamond-stone", color: G },
  { id: "b_c1", type: "cash", weight: 28, pct: 0.03, label: "Cash Stash", icon: "cash", color: C },
  { id: "b_g2", type: "gems", weight: 16, amount: 35, label: "35 Gems", icon: "diamond-stone", color: G },
  { id: "b_boost", type: "boost", weight: 14, label: "2x Income (5 min)", icon: "rocket-launch", color: P },
  { id: "b_g3", type: "gems", weight: 8, amount: 75, label: "75 Gems", icon: "diamond-stone", color: G },
];

const SILVER: LootReward[] = [
  { id: "s_g1", type: "gems", weight: 30, amount: 45, label: "45 Gems", icon: "diamond-stone", color: G },
  { id: "s_c1", type: "cash", weight: 26, pct: 0.08, label: "Cash Drop", icon: "cash", color: C },
  { id: "s_g2", type: "gems", weight: 18, amount: 90, label: "90 Gems", icon: "diamond-stone", color: G },
  { id: "s_boost", type: "boost", weight: 14, label: "2x Income (5 min)", icon: "rocket-launch", color: P },
  { id: "s_c2", type: "cash", weight: 8, pct: 0.18, label: "Big Cash Drop", icon: "cash-multiple", color: C },
  { id: "s_jp", type: "gems", weight: 4, amount: 200, label: "200 Gems!", icon: "crown", color: G },
];

const GOLD: LootReward[] = [
  { id: "g_g1", type: "gems", weight: 28, amount: 110, label: "110 Gems", icon: "diamond-stone", color: G },
  { id: "g_c1", type: "cash", weight: 24, pct: 0.15, label: "Cash Haul", icon: "cash-multiple", color: C },
  { id: "g_g2", type: "gems", weight: 20, amount: 220, label: "220 Gems", icon: "diamond-stone", color: G },
  { id: "g_boost", type: "boost", weight: 14, label: "2x Income (5 min)", icon: "rocket-launch", color: P },
  { id: "g_c2", type: "cash", weight: 9, pct: 0.35, label: "Fortune Vault", icon: "treasure-chest", color: C },
  { id: "g_jp", type: "gems", weight: 5, amount: 500, label: "500 Gems!", icon: "crown", color: G },
];

const DIAMOND: LootReward[] = [
  { id: "d_g1", type: "gems", weight: 26, amount: 300, label: "300 Gems", icon: "diamond-stone", color: G },
  { id: "d_c1", type: "cash", weight: 22, pct: 0.3, label: "Mega Cash", icon: "cash-multiple", color: C },
  { id: "d_g2", type: "gems", weight: 20, amount: 600, label: "600 Gems", icon: "diamond-stone", color: G },
  { id: "d_boost", type: "boost", weight: 12, label: "2x Income (5 min)", icon: "rocket-launch", color: P },
  { id: "d_c2", type: "cash", weight: 12, pct: 0.7, label: "Dragon's Hoard", icon: "treasure-chest", color: C },
  { id: "d_jp", type: "gems", weight: 8, amount: 1500, label: "JACKPOT — 1,500 Gems!", icon: "crown", color: G },
];

export const LOOT_BOXES: LootBox[] = [
  {
    id: "bronze",
    name: "Bronze Box",
    desc: "A solid everyday haul",
    keyCost: 1,
    icon: "package-variant-closed",
    gradient: ["#7c5e3b", "#4a3221"],
    glow: "#C88A3B",
    table: BRONZE,
  },
  {
    id: "silver",
    name: "Silver Box",
    desc: "Bigger gems & cash",
    keyCost: 3,
    icon: "package-variant",
    gradient: ["#8a93a6", "#454b57"],
    glow: "#B7C0D0",
    table: SILVER,
  },
  {
    id: "gold",
    name: "Gold Box",
    desc: "Premium rewards & boosts",
    keyCost: 6,
    icon: "treasure-chest",
    gradient: ["#d4a017", "#7a5a00"],
    glow: "#FFD54A",
    table: GOLD,
  },
  {
    id: "diamond",
    name: "Diamond Box",
    desc: "Best odds — chase the jackpot",
    keyCost: 12,
    icon: "diamond",
    gradient: ["#22c1c3", "#6a5acd"],
    glow: "#67E8F0",
    table: DIAMOND,
  },
];

export const FREE_BOX = LOOT_BOXES[0]; // free box rolls the bronze table

export function rollLoot(table: LootReward[]): LootReward {
  const total = table.reduce((n, r) => n + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of table) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return table[0];
}
