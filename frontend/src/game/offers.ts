import { colors } from "@/src/game/theme";

// ----- Flash-sale special offers -----
// Every few minutes a limited-time 50% OFF deal appears. These ONLY target
// gem-spend items (Power-Ups & Pro Boosts) whose price we fully control
// client-side, so the advertised discount always actually applies. Real-money
// Google Pay items (gem packs, remove-ads, bundles) use the server sale system.

export type OfferTarget = "powerups" | "proboost";

export type SpecialOffer = {
  id: string;
  target: OfferTarget;
  discount: number; // 0.5 = 50% off
  title: string;
  blurb: string;
  icon: string;
  color: string;
};

export const OFFER_POOL: Omit<SpecialOffer, "id">[] = [
  {
    target: "powerups",
    discount: 0.5,
    title: "50% OFF Power-Ups",
    blurb: "Every permanent Power-Up is half price — for a limited time!",
    icon: "lightning-bolt",
    color: colors.brandPrimary,
  },
  {
    target: "proboost",
    discount: 0.5,
    title: "50% OFF Pro Boosts",
    blurb: "Triple a business's income for half the gems!",
    icon: "rocket-launch",
    color: colors.brandTertiary,
  },
];

export const OFFER_DURATION_MS = 10 * 60 * 1000; // active for 10 min
export const OFFER_INTERVAL_MS = 10 * 60 * 1000; // a new one every 10 min
export const OFFER_POPUP_COOLDOWN_MS = 10 * 60 * 1000; // popup ad: once every 10 min

export function randomOffer(): SpecialOffer {
  const base = OFFER_POOL[Math.floor(Math.random() * OFFER_POOL.length)];
  return { ...base, id: `${base.target}-${Date.now()}` };
}
