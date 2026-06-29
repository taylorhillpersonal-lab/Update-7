import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { storage } from "@/src/utils/storage";
import {
  BUSINESSES,
  BUSINESS_MAP,
  costForLevels,
  maxAffordable,
  perCycleRevenue,
  prestigeGain,
  PRESTIGE_BONUS_PER_POINT,
} from "@/src/game/businesses";
import { claimGrants, reportGrandPrize, syncProfile } from "@/src/game/api";import {
  FREE_GEM_AMOUNT,
  FREE_GEM_INTERVAL_MS,
  FREE_GEM_INTERVAL_FAST_MS,
  GEM_UPGRADES,
  GemUpgradeKey,
  defaultGemUpgrades,
  dailyRewardForStreak,
  PRO_BOOST_MULT,
  prestigeGemReward,
} from "@/src/game/gems";
import { getDecor, getSkin } from "@/src/game/cosmetics";
import {
  EQUIPMENT_MAP,
  EquipSlot,
  EquipmentState,
  emptyEquipment,
  equipmentMultiplier,
} from "@/src/game/equipment";
import { EMP_MAX, employeeCost, staffIncomeMult, staffSpeedMult } from "@/src/game/employees";
import { ACHIEVEMENTS } from "@/src/game/achievements";
import { haptic } from "@/src/game/haptics";
import {
  LEVEL_MAX,
  xpToNext,
  levelIncomeMult,
  levelSpeedMult,
  LEVELUP_GEMS,
  LEVELUP_KEYS,
  LEVELUP_BOOST_MS,
  XP_ACHIEVEMENT,
  XP_BUSINESS_PER_LEVEL,
  XP_MANAGER,
  XP_POWERUP,
} from "@/src/game/levels";

const SAVE_KEY = "tycoon_save_v1";
const DEVICE_KEY = "tycoon_device_id";
const OFFLINE_CAP_SECONDS = 12 * 3600; // 12h offline cap
const OFFLINE_CAP_SECONDS_LONG = 24 * 3600; // with Night Shift perk
const TICK_MS = 200;
// New-player ad grace period: brand-new accounts see no banner or interstitial
// ads for this duration after their very first launch. Set to 0 on existing
// installs so returning players keep seeing ads immediately.
export const NEW_PLAYER_AD_GRACE_MS = 30 * 60 * 1000; // 30 minutes

export type BusinessState = {
  level: number;
  progress: number; // 0..1
  running: boolean;
  hasManager: boolean;
};

export type GemUpgrades = Record<GemUpgradeKey, boolean>;

export type Cosmetics = {
  equipped: Record<string, string>; // businessId -> skinId
  owned: string[]; // owned skin ids + decoration ids
  decorations: string[]; // placed decoration ids
};

export type GameState = {
  cash: number;
  lifetimeEarnings: number; // total ever (net worth)
  earningsSincePrestige: number;
  prestigePoints: number;
  prestigeCount: number;
  businesses: Record<string, BusinessState>;
  lastSeen: number;
  playerName: string;
  deviceId: string;
  // gems economy
  gems: number;
  keys: number;
  gemUpgrades: GemUpgrades;
  proBoosts: Record<string, boolean>;
  employees: Record<string, number>;
  claimedAchievements: string[];
  claimedPurchases: string[];
  lastDailyDay: number;
  dailyStreak: number;
  lastFreeGemAt: number;
  boostUntil: number;
  adsRemoved: boolean;
  cosmetics: Cosmetics;
  lastEventAt: number;
  lastInterstitialAt: number;
  cityBoost: number;
  cityId: string | null;
  lastLootAt: number;
  createdAt: number;
  starterPurchased: boolean;
  followupAvailableAt: number;
  followupPurchased: boolean;
  equipment: EquipmentState;
  ageVerified: boolean;
  verifiedAge: number;
  // Player progression: XP rolls up into levels, granting gems / keys /
  // boost windows. Both fields are initialized in makeInitial() and
  // mutated by grantXp(). Optional so legacy saves (pre-progression)
  // load cleanly — call sites guard with `?? 1` / `?? 0`.
  level?: number;
  xp?: number;
  // Timestamp (ms since epoch) of the player's very first app launch.
  // Used to suppress banner + interstitial ads for the first
  // NEW_PLAYER_AD_GRACE_MS for brand-new players. Set to 0 for existing
  // installs upgrading into this build (so they keep seeing ads).
  firstLaunchAt: number;
};

export type BuyAmount = 1 | 10 | 100 | "max";

type OfflineReport = { earnings: number; seconds: number };

type GameContextValue = {
  state: GameState | null;
  buyAmount: BuyAmount;
  setBuyAmount: (a: BuyAmount) => void;
  offline: OfflineReport | null;
  collectOffline: () => void;
  incomePerSec: number;
  prestigePending: number;
  multiplierFor: (id: string) => number;
  toast: string | null;
  showToast: (m: string) => void;
  clearToast: () => void;
  // actions
  tapBusiness: (id: string) => void;
  buyBusiness: (id: string) => void;
  hireManager: (id: string) => void;
  hireEmployee: (id: string) => void;
  doPrestige: () => void;
  setPlayerName: (name: string) => void;
  resetGame: () => void;
  syncNow: () => void;
  buyGemUpgrade: (key: GemUpgradeKey, costOverride?: number) => void;
  buyProBoost: (id: string, cost: number) => void;
  claimDaily: () => void;
  claimFreeGem: () => void;
  creditPurchase: (sessionId: string, gems: number) => void;
  applyAdReward: (type: "gems" | "boost") => void;
  setAdsRemoved: () => void;
  adjustCash: (delta: number) => void;
  adjustGems: (delta: number) => void;
  adjustKeys: (delta: number) => void;
  setBusinessLevel: (id: string, level: number) => void;
  buyCosmetic: (id: string) => void;
  equipSkin: (businessId: string, skinId: string) => void;
  markEvent: () => void;
  markInterstitial: () => void;
  setCity: (cityId: string | null, boost: number) => void;
  grantCosmetic: (id: string) => void;
  markLoot: () => void;
  addXp: (amount: number) => void;
  applyBundle: (packId: string, gems: number, investors: number, keys: number, removeAds: boolean) => void;
  buyEquipment: (id: string) => boolean;
  equipItem: (slot: EquipSlot, itemId: string | null) => void;
  verifyAge: (age: number) => boolean;
  claimPendingGrantsNow: () => Promise<{ gems: number; investors: number; keys: number; removeAds: boolean }>;
  // True while a brand-new player is in their 30-minute ad grace period —
  // banner + interstitial ads must be hidden whenever this is true.
  isInAdGracePeriod: boolean;
};

const GameContext = createContext<GameContextValue | null>(null);

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function freshBusinesses(): Record<string, BusinessState> {
  const out: Record<string, BusinessState> = {};
  for (const def of BUSINESSES) {
    out[def.id] = {
      level: def.id === "lemonade" ? 1 : 0,
      progress: 0,
      running: false,
      hasManager: false,
    };
  }
  return out;
}

function makeInitial(deviceId: string): GameState {
  return {
    cash: 0,
    lifetimeEarnings: 0,
    earningsSincePrestige: 0,
    prestigePoints: 0,
    prestigeCount: 0,
    businesses: freshBusinesses(),
    lastSeen: Date.now(),
    playerName: "",
    deviceId,
    gems: 0,
    keys: 0,
    level: 1,
    xp: 0,
    gemUpgrades: defaultGemUpgrades(),
    proBoosts: {},
    employees: {},
    claimedAchievements: [],
    claimedPurchases: [],
    lastDailyDay: 0,
    dailyStreak: 0,
    lastFreeGemAt: 0,
    boostUntil: 0,
    adsRemoved: false,
    cosmetics: { equipped: {}, owned: [], decorations: [] },
    lastEventAt: 0,
    lastInterstitialAt: 0,
    cityBoost: 1,
    cityId: null,
    lastLootAt: 0,
    createdAt: Date.now(),
    starterPurchased: false,
    followupAvailableAt: 0,
    followupPurchased: false,
    equipment: emptyEquipment(),
    ageVerified: false,
    verifiedAge: 0,
    // Brand-new players: stamp now so the 30-minute ad grace period starts.
    firstLaunchAt: Date.now(),
  };
}

function mergeBusinesses(
  saved: Record<string, BusinessState> | undefined,
): Record<string, BusinessState> {
  const base = freshBusinesses();
  if (!saved) return base;
  for (const def of BUSINESSES) {
    if (saved[def.id]) {
      base[def.id] = {
        level: saved[def.id].level ?? base[def.id].level,
        progress: 0,
        running: saved[def.id].hasManager ? true : false,
        hasManager: !!saved[def.id].hasManager,
      };
    }
  }
  return base;
}

function prestigeBonusOf(points: number): number {
  return 1 + points * PRESTIGE_BONUS_PER_POINT;
}

function totalLevels(s: GameState): number {
  let n = 0;
  for (const def of BUSINESSES) n += s.businesses[def.id]?.level ?? 0;
  return n;
}

function globalMultiplier(s: GameState): number {
  const boost = Date.now() < (s.boostUntil ?? 0) ? 2 : 1;
  const u = s.gemUpgrades;
  return (
    prestigeBonusOf(s.prestigePoints) *
    (u.doubleIncome ? 2 : 1) *
    (u.tycoonRush ? 1.5 : 1) *
    (u.empireSynergy ? 1.25 : 1) *
    (u.quantumLeap ? 1.75 : 1) *
    (u.compoundInterest ? 1.6 : 1) *
    (s.cityBoost ?? 1) *
    boost *
    levelIncomeMult(s.level ?? 1) *
    equipmentMultiplier(s.equipment)
  );
}

function businessMultiplier(s: GameState, id: string): number {
  return (
    globalMultiplier(s) *
    (s.proBoosts[id] ? PRO_BOOST_MULT : 1) *
    staffIncomeMult(s.employees?.[id] ?? 0)
  );
}

function effTime(s: GameState, id: string, time: number): number {
  const speed = (s.gemUpgrades.doubleSpeed ? 2 : 1) * (s.gemUpgrades.hyperdrive ? 1.5 : 1) * staffSpeedMult(s.employees?.[id] ?? 0) * levelSpeedMult(s.level ?? 1);
  return time / speed;
}

// Add XP and process any level-ups (each grants gems, a key and a 2x boost).
function grantXp(prev: GameState, amount: number): GameState {
  if (amount <= 0) return prev;
  let level = prev.level ?? 1;
  let xp = (prev.xp ?? 0) + amount;
  let gems = prev.gems;
  let keys = prev.keys ?? 0;
  let gained = 0;
  while (level < LEVEL_MAX) {
    const need = xpToNext(level);
    if (xp < need) break;
    xp -= need;
    level += 1;
    gained += 1;
    gems += LEVELUP_GEMS;
    keys += LEVELUP_KEYS;
  }
  if (level >= LEVEL_MAX) xp = 0;
  const boostUntil =
    gained > 0
      ? Math.max(Date.now(), prev.boostUntil ?? 0) + LEVELUP_BOOST_MS * gained
      : prev.boostUntil;
  return { ...prev, level, xp, gems, keys, boostUntil };
}

function step(prev: GameState, dtSec: number): GameState {
  let cash = prev.cash;
  let life = prev.lifetimeEarnings;
  let sp = prev.earningsSincePrestige;
  const businesses: Record<string, BusinessState> = {};

  for (const def of BUSINESSES) {
    const b = prev.businesses[def.id];
    if (!b) continue;
    const auto = b.hasManager || prev.gemUpgrades.autoTapper;
    if (b.level <= 0 || (!b.running && !auto)) {
      businesses[def.id] = b;
      continue;
    }
    const rev = perCycleRevenue(def, b.level, businessMultiplier(prev, def.id));
    const time = effTime(prev, def.id, def.time);
    let progress = b.progress + dtSec / time;
    let running = b.running;

    if (auto) {
      const cycles = Math.floor(progress);
      if (cycles > 0) {
        const pay = cycles * rev;
        cash += pay;
        life += pay;
        sp += pay;
        progress -= cycles;
      }
      running = true;
    } else {
      if (progress >= 1) {
        cash += rev;
        life += rev;
        sp += rev;
        progress = 0;
        running = false;
      }
    }
    businesses[def.id] = { ...b, progress, running };
  }

  return {
    ...prev,
    cash,
    lifetimeEarnings: life,
    earningsSincePrestige: sp,
    businesses,
    lastSeen: Date.now(),
  };
}

function computeOffline(state: GameState): OfflineReport {
  const cap = state.gemUpgrades.offlineOvertime ? OFFLINE_CAP_SECONDS_LONG : OFFLINE_CAP_SECONDS;
  const elapsed = Math.min(cap, Math.max(0, (Date.now() - state.lastSeen) / 1000));
  if (elapsed < 1) return { earnings: 0, seconds: 0 };
  let earnings = 0;
  for (const def of BUSINESSES) {
    const b = state.businesses[def.id];
    const auto = b && (b.hasManager || state.gemUpgrades.autoTapper);
    if (!b || b.level <= 0 || !auto) continue;
    const cycles = Math.floor(elapsed / effTime(state, def.id, def.time));
    if (cycles > 0)
      earnings += cycles * perCycleRevenue(def, b.level, businessMultiplier(state, def.id));
  }
  return { earnings, seconds: elapsed };
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState | null>(null);
  const [buyAmount, setBuyAmount] = useState<BuyAmount>(1);
  const [offline, setOffline] = useState<OfflineReport | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const lastTick = useRef<number>(Date.now());
  const ready = state !== null;

  stateRef.current = state;

  // Load / restore
  useEffect(() => {
    (async () => {
      let deviceId: string = (await storage.getItem(DEVICE_KEY, "")) ?? "";
      if (!deviceId) {
        deviceId = uuid();
        await storage.setItem(DEVICE_KEY, deviceId);
      }
      const raw: string = (await storage.getItem(SAVE_KEY, "")) ?? "";
      let loaded: GameState;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as GameState;
          const base = makeInitial(deviceId);
          loaded = {
            ...base,
            ...parsed,
            deviceId,
            businesses: mergeBusinesses(parsed.businesses),
            gemUpgrades: { ...defaultGemUpgrades(), ...(parsed.gemUpgrades || {}) },
            cosmetics: { ...base.cosmetics, ...(parsed.cosmetics || {}) },
            equipment: {
              owned: parsed.equipment?.owned ?? [],
              equipped: parsed.equipment?.equipped ?? {},
            },
            // Existing installs upgrading into this build never had a
            // firstLaunchAt stamp — treat them as existing players (no ad
            // grace period). Saves written after this change keep theirs.
            firstLaunchAt: parsed.firstLaunchAt ?? 0,
          };
          const report = computeOffline(loaded);
          if (report.earnings > 0 && report.seconds > 30) setOffline(report);
        } catch {
          loaded = makeInitial(deviceId);
        }
      } else {
        loaded = makeInitial(deviceId);
      }
      lastTick.current = Date.now();
      setState(loaded);
    })();
  }, []);

  // Game loop
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(2, (now - lastTick.current) / 1000);
      lastTick.current = now;
      setState((prev) => (prev ? step(prev, dt) : prev));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ready]);

  // Auto-save
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      if (stateRef.current) {
        storage.setItem(SAVE_KEY, JSON.stringify(stateRef.current));
      }
    }, 3000);
    return () => clearInterval(id);
  }, [ready]);

  // Cloud sync (leaderboard profile)
  useEffect(() => {
    if (!ready) return;
    const doSync = () => {
      const s = stateRef.current;
      if (!s) return;
      syncProfile({
        device_id: s.deviceId,
        name: s.playerName || "Anonymous Tycoon",
        net_worth: s.lifetimeEarnings,
        prestige_points: s.prestigePoints,
        cash: s.cash,
        gems: s.gems,
        total_levels: totalLevels(s),
        achievements: s.claimedAchievements,
      });
    };
    doSync();
    const id = setInterval(doSync, 20000);
    return () => clearInterval(id);
  }, [ready]);

  // Claim admin-granted gems/investors (server -> client).
  useEffect(() => {
    if (!ready) return;
    const doClaim = async () => {
      const s = stateRef.current;
      if (!s) return;
      const g = await claimGrants(s.deviceId);
      if (g.gems > 0 || g.investors > 0 || g.keys > 0 || g.remove_ads || g.cash > 0) {
        setState((prev) =>
          prev
            ? {
                ...prev,
                cash: prev.cash + (g.cash || 0),
                lifetimeEarnings: prev.lifetimeEarnings + (g.cash || 0),
                gems: prev.gems + (g.gems || 0),
                prestigePoints: prev.prestigePoints + (g.investors || 0),
                keys: (prev.keys ?? 0) + (g.keys || 0),
                adsRemoved: g.remove_ads ? true : prev.adsRemoved,
              }
            : prev,
        );
        const bits: string[] = [];
        if (g.gems > 0) bits.push(`${g.gems.toLocaleString()} gems`);
        if (g.cash > 0) bits.push(`$${g.cash.toLocaleString()}`);
        if (g.investors > 0) bits.push(`${g.investors.toLocaleString()} investors`);
        if (g.keys > 0) bits.push(`${g.keys.toLocaleString()} loot keys`);
        if (g.remove_ads) bits.push("Remove Ads");
        if (bits.length) setToast(`You received ${bits.join(" + ")}!`);
      }
    };
    doClaim();
    const id = setInterval(doClaim, 30000);
    return () => clearInterval(id);
  }, [ready]);

  // Imperative claim — used by minigames (Tycoon Time) to instantly credit
  // a server-recorded payout the moment the local animation settles.
  const claimPendingGrantsNow = useCallback(async () => {
    const s = stateRef.current;
    if (!s) return { gems: 0, investors: 0, keys: 0, removeAds: false };
    const g = await claimGrants(s.deviceId);
    if (g.gems > 0 || g.investors > 0 || g.keys > 0 || g.remove_ads || g.cash > 0) {
      setState((prev) =>
        prev
          ? {
              ...prev,
              cash: prev.cash + (g.cash || 0),
              lifetimeEarnings: prev.lifetimeEarnings + (g.cash || 0),
              gems: prev.gems + (g.gems || 0),
              prestigePoints: prev.prestigePoints + (g.investors || 0),
              keys: (prev.keys ?? 0) + (g.keys || 0),
              adsRemoved: g.remove_ads ? true : prev.adsRemoved,
            }
          : prev,
      );
    }
    return { gems: g.gems, investors: g.investors, keys: g.keys, removeAds: g.remove_ads };
  }, []);

  // Persist on background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" && stateRef.current) {
        storage.setItem(SAVE_KEY, JSON.stringify(stateRef.current));
      } else if (next === "active") {
        lastTick.current = Date.now();
      }
    });
    return () => sub.remove();
  }, []);

  // Auto-award achievement gems
  useEffect(() => {
    if (!state) return;
    for (const a of ACHIEVEMENTS) {
      if (!state.claimedAchievements.includes(a.id) && a.check(state)) {
        setState((prev) =>
          prev
            ? grantXp(
                {
                  ...prev,
                  gems: prev.gems + a.gems,
                  claimedAchievements: [...prev.claimedAchievements, a.id],
                },
                XP_ACHIEVEMENT,
              )
            : prev,
        );
        setToast(`${a.title} unlocked!  +${a.gems} gems`);
        if (a.id === "all_level_1000") {
          // World-first $1,000 USD contest — notify the backend (emails support).
          reportGrandPrize(state.deviceId, state.playerName || "Anonymous Tycoon").catch(() => {});
        }
        break;
      }
    }
  }, [state]);

  // Level-up notification (rewards applied in grantXp).
  const prevLevelRef = useRef<number | null>(null);
  const lvl = state?.level;
  useEffect(() => {
    if (lvl == null) return;
    if (prevLevelRef.current !== null && lvl > prevLevelRef.current) {
      haptic("success");
      setToast(`Level ${lvl}!  +5 gems, +1 key & 2x boost for 5 min`);
    }
    prevLevelRef.current = lvl;
  }, [lvl]);

  // ---- Actions ----
  const tapBusiness = useCallback((id: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const b = prev.businesses[id];
      if (!b || b.level <= 0 || b.hasManager || b.running) return prev;
      return {
        ...prev,
        businesses: { ...prev.businesses, [id]: { ...b, running: true } },
      };
    });
  }, []);

  const buyBusiness = useCallback(
    (id: string) => {
      setState((prev) => {
        if (!prev) return prev;
        const def = BUSINESS_MAP[id];
        const b = prev.businesses[id];
        if (!def || !b) return prev;
        const n =
          buyAmount === "max"
            ? maxAffordable(def, b.level, prev.cash)
            : buyAmount;
        if (n <= 0) return prev;
        const cost = costForLevels(def, b.level, n);
        if (prev.cash < cost) return prev;
        return grantXp(
          {
            ...prev,
            cash: prev.cash - cost,
            businesses: {
              ...prev.businesses,
              [id]: { ...b, level: b.level + n },
            },
          },
          XP_BUSINESS_PER_LEVEL * n,
        );
      });
    },
    [buyAmount],
  );

  const hireManager = useCallback((id: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const def = BUSINESS_MAP[id];
      const b = prev.businesses[id];
      if (!def || !b || b.hasManager || b.level <= 0) return prev;
      if (prev.cash < def.managerCost) return prev;
      return grantXp(
        {
          ...prev,
          cash: prev.cash - def.managerCost,
          businesses: {
            ...prev.businesses,
            [id]: { ...b, hasManager: true, running: true },
          },
        },
        XP_MANAGER,
      );
    });
  }, []);

  const hireEmployee = useCallback((id: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const def = BUSINESS_MAP[id];
      const b = prev.businesses[id];
      if (!def || !b || b.level <= 0) return prev;
      const count = prev.employees[id] ?? 0;
      if (count >= EMP_MAX) return prev;
      const cost = employeeCost(def.managerCost, count);
      if (prev.cash < cost) return prev;
      return {
        ...prev,
        cash: prev.cash - cost,
        employees: { ...prev.employees, [id]: count + 1 },
      };
    });
  }, []);

  const buyGemUpgrade = useCallback((key: GemUpgradeKey, costOverride?: number) => {
    setState((prev) => {
      if (!prev) return prev;
      if (prev.gemUpgrades[key]) return prev;
      const def = GEM_UPGRADES.find((u) => u.key === key);
      if (!def) return prev;
      const cost = costOverride != null && costOverride <= def.cost ? costOverride : def.cost;
      if (prev.gems < cost) return prev;
      return {
        ...prev,
        gems: prev.gems - cost,
        gemUpgrades: { ...prev.gemUpgrades, [key]: true },
      };
    });
  }, []);

  const buyProBoost = useCallback((id: string, cost: number) => {
    setState((prev) => {
      if (!prev) return prev;
      const b = prev.businesses[id];
      if (!b || b.level <= 0 || prev.proBoosts[id] || prev.gems < cost) return prev;
      return grantXp(
        {
          ...prev,
          gems: prev.gems - cost,
          proBoosts: { ...prev.proBoosts, [id]: true },
        },
        XP_POWERUP,
      );
    });
  }, []);

  const claimDaily = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const today = Math.floor(Date.now() / 86400000);
      if (prev.lastDailyDay === today) return prev;
      const streak = prev.lastDailyDay === today - 1 ? prev.dailyStreak + 1 : 1;
      const amount = dailyRewardForStreak(streak) * (prev.gemUpgrades.megaDaily ? 2 : 1);
      return { ...prev, gems: prev.gems + amount, keys: (prev.keys ?? 0) + 1, lastDailyDay: today, dailyStreak: streak };
    });
  }, []);

  const claimFreeGem = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const interval = prev.gemUpgrades.gemFountain
        ? FREE_GEM_INTERVAL_FAST_MS
        : FREE_GEM_INTERVAL_MS;
      if (Date.now() - prev.lastFreeGemAt < interval) return prev;
      const amount = Math.round(FREE_GEM_AMOUNT * (prev.gemUpgrades.fortuneFavor ? 1.5 : 1));
      return {
        ...prev,
        gems: prev.gems + amount,
        lastFreeGemAt: Date.now(),
      };
    });
  }, []);

  // Generic cash adjustment for random events. Positive deltas also grow net worth.
  const adjustCash = useCallback((delta: number) => {
    setState((prev) => {
      if (!prev) return prev;
      const cash = Math.max(0, prev.cash + delta);
      if (delta > 0) {
        return {
          ...prev,
          cash,
          lifetimeEarnings: prev.lifetimeEarnings + delta,
          earningsSincePrestige: prev.earningsSincePrestige + delta,
        };
      }
      return { ...prev, cash };
    });
  }, []);

  const adjustGems = useCallback((delta: number) => {
    setState((prev) => (prev ? { ...prev, gems: Math.max(0, prev.gems + delta) } : prev));
  }, []);

  const adjustKeys = useCallback((delta: number) => {
    setState((prev) => (prev ? { ...prev, keys: Math.max(0, (prev.keys ?? 0) + delta) } : prev));
  }, []);

  // Used by "property at risk" events to wipe / restore a business.
  const setBusinessLevel = useCallback((id: string, level: number) => {
    setState((prev) => {
      if (!prev) return prev;
      const b = prev.businesses[id];
      if (!b) return prev;
      const lvl = Math.max(0, Math.floor(level));
      return {
        ...prev,
        businesses: {
          ...prev.businesses,
          [id]: {
            ...b,
            level: lvl,
            progress: 0,
            running: lvl > 0 ? b.running : false,
            hasManager: lvl > 0 ? b.hasManager : false,
          },
        },
      };
    });
  }, []);

  const buyCosmetic = useCallback((id: string) => {
    setState((prev) => {
      if (!prev || prev.cosmetics.owned.includes(id)) return prev;
      const skin = getSkin(id);
      const decor = getDecor(id);
      const item = skin ?? decor;
      if (!item) return prev;
      if (item.currency === "gems") {
        if (prev.gems < item.price) return prev;
      } else if (prev.cash < item.price) {
        return prev;
      }
      const cosmetics: Cosmetics = {
        equipped: { ...prev.cosmetics.equipped },
        owned: [...prev.cosmetics.owned, id],
        decorations: [...prev.cosmetics.decorations],
      };
      if (skin) cosmetics.equipped[skin.businessId] = skin.id;
      if (decor && !cosmetics.decorations.includes(id)) cosmetics.decorations.push(id);
      return {
        ...prev,
        cash: item.currency === "cash" ? prev.cash - item.price : prev.cash,
        gems: item.currency === "gems" ? prev.gems - item.price : prev.gems,
        cosmetics,
      };
    });
  }, []);

  const equipSkin = useCallback((businessId: string, skinId: string) => {
    setState((prev) => {
      if (!prev) return prev;
      if (!skinId.endsWith("-default") && !prev.cosmetics.owned.includes(skinId)) return prev;
      return {
        ...prev,
        cosmetics: {
          ...prev.cosmetics,
          equipped: { ...prev.cosmetics.equipped, [businessId]: skinId },
        },
      };
    });
  }, []);

  const markEvent = useCallback(() => {
    setState((prev) => (prev ? { ...prev, lastEventAt: Date.now() } : prev));
  }, []);

  const markInterstitial = useCallback(() => {
    setState((prev) => (prev ? { ...prev, lastInterstitialAt: Date.now() } : prev));
  }, []);

  const setCity = useCallback((cityId: string | null, boost: number) => {
    setState((prev) => (prev ? { ...prev, cityId, cityBoost: boost } : prev));
  }, []);

  const markLoot = useCallback(() => {
    setState((prev) => (prev ? { ...prev, lastLootAt: Date.now() } : prev));
  }, []);

  const addXp = useCallback((amount: number) => {
    setState((prev) => (prev ? grantXp(prev, amount) : prev));
  }, []);

  // ----- Equipment -----
  const buyEquipment = useCallback((id: string): boolean => {
    let ok = false;
    setState((prev) => {
      if (!prev) return prev;
      const item = EQUIPMENT_MAP[id];
      if (!item) return prev;
      const eq = prev.equipment ?? emptyEquipment();
      if (eq.owned.includes(id)) return prev;
      if (item.currency === "gems" && prev.gems < item.price) return prev;
      if (item.currency === "cash" && prev.cash < item.price) return prev;
      ok = true;
      return {
        ...prev,
        gems: item.currency === "gems" ? prev.gems - item.price : prev.gems,
        cash: item.currency === "cash" ? prev.cash - item.price : prev.cash,
        equipment: {
          owned: [...eq.owned, id],
          equipped: { ...eq.equipped, [item.slot]: id }, // auto-equip on buy
        },
      };
    });
    return ok;
  }, []);

  const equipItem = useCallback((slot: EquipSlot, itemId: string | null) => {
    setState((prev) => {
      if (!prev) return prev;
      const eq = prev.equipment ?? emptyEquipment();
      if (itemId && !eq.owned.includes(itemId)) return prev;
      const equipped = { ...eq.equipped };
      if (itemId == null) {
        delete equipped[slot];
      } else {
        equipped[slot] = itemId;
      }
      return { ...prev, equipment: { ...eq, equipped } };
    });
  }, []);

  // ----- Age verification -----
  const verifyAge = useCallback((age: number): boolean => {
    if (!Number.isFinite(age) || age < 18 || age > 120) return false;
    setState((prev) => prev ? { ...prev, ageVerified: true, verifiedAge: Math.floor(age) } : prev);
    return true;
  }, []);

  // Starter / follow-up bundles grant gems + investors (+ remove ads).
  const applyBundle = useCallback(
    (packId: string, gems: number, investors: number, keys: number, removeAds: boolean) => {
      setState((prev) => {
        if (!prev) return prev;
        const next: GameState = {
          ...prev,
          gems: prev.gems + gems,
          prestigePoints: prev.prestigePoints + investors,
          keys: (prev.keys ?? 0) + (keys ?? 0),
          adsRemoved: removeAds ? true : prev.adsRemoved,
        };
        if (packId === "bundle_starter") {
          next.starterPurchased = true;
          next.followupAvailableAt = Date.now() + 10 * 60 * 1000;
        } else if (packId === "bundle_followup") {
          next.followupPurchased = true;
        }
        return next;
      });
    },
    [],
  );

  // Grant a cosmetic for free (loot boxes). Skins auto-equip; decorations get placed.
  const grantCosmetic = useCallback((id: string) => {
    setState((prev) => {
      if (!prev || prev.cosmetics.owned.includes(id)) return prev;
      const skin = getSkin(id);
      const decor = getDecor(id);
      if (!skin && !decor) return prev;
      const cosmetics: Cosmetics = {
        equipped: { ...prev.cosmetics.equipped },
        owned: [...prev.cosmetics.owned, id],
        decorations: [...prev.cosmetics.decorations],
      };
      if (skin) cosmetics.equipped[skin.businessId] = skin.id;
      if (decor && !cosmetics.decorations.includes(id)) cosmetics.decorations.push(id);
      return { ...prev, cosmetics };
    });
  }, []);

  const creditPurchase = useCallback((sessionId: string, gems: number) => {
    setState((prev) => {
      if (!prev || prev.claimedPurchases.includes(sessionId)) return prev;
      return {
        ...prev,
        gems: prev.gems + gems,
        claimedPurchases: [...prev.claimedPurchases, sessionId],
      };
    });
  }, []);

  const applyAdReward = useCallback((type: "gems" | "boost") => {
    setState((prev) => {
      if (!prev) return prev;
      if (type === "gems") return { ...prev, gems: prev.gems + 5 };
      const base = Math.max(Date.now(), prev.boostUntil ?? 0);
      return { ...prev, boostUntil: base + 5 * 60 * 1000 };
    });
  }, []);

  const setAdsRemoved = useCallback(() => {
    setState((prev) => (prev ? { ...prev, adsRemoved: true } : prev));
  }, []);

  const doPrestige = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const gain = prestigeGain(prev.earningsSincePrestige);
      if (gain <= 0) return prev;
      return {
        ...prev,
        cash: 0,
        earningsSincePrestige: 0,
        prestigePoints: prev.prestigePoints + gain,
        prestigeCount: prev.prestigeCount + 1,
        gems: prev.gems + prestigeGemReward(gain),
        businesses: freshBusinesses(),
      };
    });
  }, []);

  const setPlayerName = useCallback((name: string) => {
    setState((prev) => (prev ? { ...prev, playerName: name.slice(0, 24) } : prev));
  }, []);

  const resetGame = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const fresh = makeInitial(prev.deviceId);
      fresh.playerName = prev.playerName;
      storage.setItem(SAVE_KEY, JSON.stringify(fresh));
      return fresh;
    });
  }, []);

  const collectOffline = useCallback(() => {
    setState((prev) => {
      if (!prev || !offline) return prev;
      return {
        ...prev,
        cash: prev.cash + offline.earnings,
        lifetimeEarnings: prev.lifetimeEarnings + offline.earnings,
        earningsSincePrestige: prev.earningsSincePrestige + offline.earnings,
      };
    });
    setOffline(null);
  }, [offline]);

  const syncNow = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    storage.setItem(SAVE_KEY, JSON.stringify(s));
    syncProfile({
      device_id: s.deviceId,
      name: s.playerName || "Anonymous Tycoon",
      net_worth: s.lifetimeEarnings,
      prestige_points: s.prestigePoints,
      cash: s.cash,
      gems: s.gems,
      total_levels: totalLevels(s),
      achievements: s.claimedAchievements,
    });
  }, []);

  const incomePerSec = useMemo(() => {
    if (!state) return 0;
    let total = 0;
    for (const def of BUSINESSES) {
      const b = state.businesses[def.id];
      const auto = b && (b.hasManager || state.gemUpgrades.autoTapper);
      if (b && b.level > 0 && auto) {
        total +=
          perCycleRevenue(def, b.level, businessMultiplier(state, def.id)) /
          effTime(state, def.id, def.time);
      }
    }
    return total;
  }, [state]);

  const multiplierFor = useCallback(
    (id: string) => (state ? businessMultiplier(state, id) : 1),
    [state],
  );

  const showToast = useCallback((m: string) => setToast(m), []);
  const clearToast = useCallback(() => setToast(null), []);

  const prestigePending = useMemo(
    () => (state ? prestigeGain(state.earningsSincePrestige) : 0),
    [state],
  );

  // Brand-new players get a 30-minute window with no banner/interstitial
  // ads. Existing installs (firstLaunchAt === 0) are excluded by design.
  // Re-computed every render — the game-loop tick (every 200ms) flips this
  // automatically once the window expires.
  const isInAdGracePeriod = useMemo(() => {
    if (!state || !state.firstLaunchAt) return false;
    return Date.now() - state.firstLaunchAt < NEW_PLAYER_AD_GRACE_MS;
  }, [state]);

  const value: GameContextValue = {
    state,
    buyAmount,
    setBuyAmount,
    offline,
    collectOffline,
    incomePerSec,
    prestigePending,
    multiplierFor,
    toast,
    showToast,
    clearToast,
    tapBusiness,
    buyBusiness,
    hireManager,
    hireEmployee,
    doPrestige,
    setPlayerName,
    resetGame,
    syncNow,
    buyGemUpgrade,
    buyProBoost,
    claimDaily,
    claimFreeGem,
    creditPurchase,
    applyAdReward,
    setAdsRemoved,
    adjustCash,
    adjustGems,
    adjustKeys,
    setBusinessLevel,
    buyCosmetic,
    equipSkin,
    markEvent,
    markInterstitial,
    setCity,
    grantCosmetic,
    markLoot,
    addXp,
    applyBundle,
    buyEquipment,
    equipItem,
    verifyAge,
    claimPendingGrantsNow,
    isInAdGracePeriod,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
