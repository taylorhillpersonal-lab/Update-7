import { BUSINESSES } from "@/src/game/businesses";

// ----- Cosmetic skins (per building) + global decorations -----
// Some cost in-game cash, some cost gems. Purely visual — no gameplay effect.

export type Skin = {
  id: string;
  businessId: string;
  name: string;
  currency: "cash" | "gems";
  price: number;
  wall: string;
  roof: string;
  door: string;
  accent: string; // window / trim glow
  awning?: string;
};

export type Decor = {
  id: string;
  name: string;
  currency: "cash" | "gems";
  price: number;
  kind: "tree" | "fountain" | "lamp" | "flowers" | "bench" | "pond" | "gnome" | "mailbox";
  color: string;
};

// Default (free) palette for a building, derived from its brand color.
export function defaultSkin(businessId: string): Skin {
  const def = BUSINESSES.find((b) => b.id === businessId)!;
  return {
    id: `${businessId}-default`,
    businessId,
    name: "Classic",
    currency: "cash",
    price: 0,
    wall: "#C9A66B",
    roof: def.color,
    door: "#6B4A2B",
    accent: def.color,
  };
}

// Two purchasable skins per building: a warm "Deluxe" (cash) and a "Neon" (gems).
function buildSkins(): Skin[] {
  const out: Skin[] = [];
  BUSINESSES.forEach((def, i) => {
    out.push({
      id: `${def.id}-deluxe`,
      businessId: def.id,
      name: "Brick Deluxe",
      currency: "cash",
      price: Math.max(2500, Math.round(def.baseCost * 30)),
      wall: "#A4503A",
      roof: "#5C2E1E",
      door: "#3A1B10",
      accent: "#FFD27F",
      awning: "#E8C07D",
    });
    out.push({
      id: `${def.id}-neon`,
      businessId: def.id,
      name: "Neon Nights",
      currency: "gems",
      price: 40 + i * 8,
      wall: "#16182B",
      roof: "#0E1020",
      door: "#222A4A",
      accent: def.color,
    });
    out.push({
      id: `${def.id}-mint`,
      businessId: def.id,
      name: "Cozy Mint",
      currency: "cash",
      price: Math.max(6000, Math.round(def.baseCost * 60)),
      wall: "#BFE3C9",
      roof: "#5BA86F",
      door: "#3E7A52",
      accent: "#FFFFFF",
      awning: "#8FD3A4",
    });
  });
  return out;
}

export const SKINS: Skin[] = buildSkins();

export function skinsForBusiness(businessId: string): Skin[] {
  return [defaultSkin(businessId), ...SKINS.filter((s) => s.businessId === businessId)];
}

export function getSkin(skinId: string): Skin | undefined {
  if (skinId.endsWith("-default")) {
    return defaultSkin(skinId.replace("-default", ""));
  }
  return SKINS.find((s) => s.id === skinId);
}

export const DECORATIONS: Decor[] = [
  { id: "mailbox", name: "Mailbox", currency: "cash", price: 1500, kind: "mailbox", color: "#E2574C" },
  { id: "tree", name: "Oak Tree", currency: "cash", price: 4000, kind: "tree", color: "#4E944F" },
  { id: "flowers", name: "Flower Bed", currency: "cash", price: 9000, kind: "flowers", color: "#E667A8" },
  { id: "bench", name: "Park Bench", currency: "cash", price: 14000, kind: "bench", color: "#8A5A2B" },
  { id: "lamp", name: "Street Lamp", currency: "cash", price: 22000, kind: "lamp", color: "#FFD66B" },
  { id: "gnome", name: "Garden Gnome", currency: "gems", price: 35, kind: "gnome", color: "#E2574C" },
  { id: "fountain", name: "Fountain", currency: "gems", price: 60, kind: "fountain", color: "#5BB8E8" },
  { id: "pond", name: "Koi Pond", currency: "gems", price: 90, kind: "pond", color: "#3E8FC4" },
];

export function getDecor(id: string): Decor | undefined {
  return DECORATIONS.find((d) => d.id === id);
}
