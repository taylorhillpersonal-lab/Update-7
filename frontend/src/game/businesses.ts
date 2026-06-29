export type BusinessDef = {
  id: string;
  name: string;
  icon: string; // MaterialCommunityIcons name
  color: string;
  baseCost: number;
  baseRevenue: number;
  time: number; // seconds per cycle
  costMult: number;
  managerCost: number;
  managerName: string;
};

// Classic mix + food empire. Balanced AdVenture-Capitalist-style curve.
export const BUSINESSES: BusinessDef[] = [
  {
    id: "lemonade",
    name: "Lemonade Stand",
    icon: "cup",
    color: "#FFD54F",
    baseCost: 4,
    baseRevenue: 1,
    time: 1,
    costMult: 1.07,
    managerCost: 1000,
    managerName: "Lily",
  },
  {
    id: "cafe",
    name: "Corner Cafe",
    icon: "coffee",
    color: "#FFB300",
    baseCost: 60,
    baseRevenue: 60,
    time: 3,
    costMult: 1.15,
    managerCost: 15000,
    managerName: "Marco",
  },
  {
    id: "pizza",
    name: "Pizza Shop",
    icon: "pizza",
    color: "#FF5722",
    baseCost: 720,
    baseRevenue: 540,
    time: 6,
    costMult: 1.14,
    managerCost: 100000,
    managerName: "Tony",
  },
  {
    id: "bakery",
    name: "Sweet Bakery",
    icon: "bread-slice",
    color: "#FFCA28",
    baseCost: 8640,
    baseRevenue: 4320,
    time: 12,
    costMult: 1.13,
    managerCost: 500000,
    managerName: "Nina",
  },
  {
    id: "carwash",
    name: "Car Wash",
    icon: "car-wash",
    color: "#00E676",
    baseCost: 103680,
    baseRevenue: 51840,
    time: 24,
    costMult: 1.12,
    managerCost: 1200000,
    managerName: "Dre",
  },
  {
    id: "restaurant",
    name: "Fine Restaurant",
    icon: "silverware-fork-knife",
    color: "#FF7043",
    baseCost: 1244160,
    baseRevenue: 622080,
    time: 96,
    costMult: 1.11,
    managerCost: 10000000,
    managerName: "Chef Remy",
  },
  {
    id: "burger",
    name: "Burger Chain",
    icon: "hamburger",
    color: "#FFC107",
    baseCost: 14929920,
    baseRevenue: 7464960,
    time: 384,
    costMult: 1.1,
    managerCost: 111111111,
    managerName: "Sam",
  },
  {
    id: "bank",
    name: "City Bank",
    icon: "bank",
    color: "#00E676",
    baseCost: 179159040,
    baseRevenue: 89579520,
    time: 1536,
    costMult: 1.09,
    managerCost: 1111111111,
    managerName: "Mr. Vault",
  },
  {
    id: "hotel",
    name: "Grand Hotel",
    icon: "bed",
    color: "#FFA726",
    baseCost: 2149908480,
    baseRevenue: 1074954240,
    time: 6144,
    costMult: 1.08,
    managerCost: 12345678900,
    managerName: "Olivia",
  },
  {
    id: "oilrig",
    name: "Oil Rig",
    icon: "oil",
    color: "#FF5252",
    baseCost: 25798901760,
    baseRevenue: 12899450880,
    time: 36864,
    costMult: 1.07,
    managerCost: 123456789000,
    managerName: "Tex",
  },
];

export const BUSINESS_MAP: Record<string, BusinessDef> = BUSINESSES.reduce(
  (acc, b) => {
    acc[b.id] = b;
    return acc;
  },
  {} as Record<string, BusinessDef>,
);

const MILESTONES = [25, 50, 100, 200, 300, 400, 500, 750, 1000];

export function milestoneMultiplier(level: number): number {
  let m = 1;
  for (const t of MILESTONES) if (level >= t) m *= 2;
  return m;
}

export function nextMilestone(level: number): number | null {
  for (const t of MILESTONES) if (level < t) return t;
  return null;
}

export function perCycleRevenue(
  def: BusinessDef,
  level: number,
  prestigeBonus: number,
): number {
  if (level <= 0) return 0;
  return def.baseRevenue * level * milestoneMultiplier(level) * prestigeBonus;
}

// Geometric cost for buying `n` levels starting from `currentLevel`.
export function costForLevels(
  def: BusinessDef,
  currentLevel: number,
  n: number,
): number {
  const r = def.costMult;
  const c0 = def.baseCost * Math.pow(r, currentLevel);
  return (c0 * (Math.pow(r, n) - 1)) / (r - 1);
}

export function maxAffordable(
  def: BusinessDef,
  currentLevel: number,
  cash: number,
): number {
  const r = def.costMult;
  const c0 = def.baseCost * Math.pow(r, currentLevel);
  if (cash < c0) return 0;
  const n = Math.floor(Math.log((cash * (r - 1)) / c0 + 1) / Math.log(r));
  return Math.max(0, n);
}

// Prestige: investors earned from earnings accumulated since last reset.
export const PRESTIGE_UNLOCK = 1_000_000;

export function prestigeGain(earningsSincePrestige: number): number {
  if (earningsSincePrestige < PRESTIGE_UNLOCK) return 0;
  return Math.floor(150 * Math.sqrt(earningsSincePrestige / 1e9));
}

export const PRESTIGE_BONUS_PER_POINT = 0.02; // +2% income per investor
