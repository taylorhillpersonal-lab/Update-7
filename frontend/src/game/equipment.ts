// ----- Character Equipment -----
// 5 equipment slots, 3 tiers each (15 items). Each equipped item adds a flat % income
// boost that multiplies into the global income multiplier (see GameContext).

export type EquipSlot = "wallet" | "phone" | "pen" | "suit" | "sunglasses";

export type EquipItem = {
  id: string;
  slot: EquipSlot;
  name: string;
  tier: 1 | 2 | 3;
  icon: string; // MaterialCommunityIcons name
  boostPct: number; // e.g. 0.05 = +5% income
  currency: "cash" | "gems";
  price: number;
  color: string;
};

export const SLOT_META: Record<EquipSlot, { label: string; icon: string; color: string }> = {
  wallet:     { label: "Wallet",      icon: "wallet",         color: "#FFB300" },
  phone:      { label: "Cell Phone",  icon: "cellphone",      color: "#42A5F5" },
  pen:        { label: "Pen",         icon: "fountain-pen-tip", color: "#9C27B0" },
  suit:       { label: "Suit",        icon: "tie",            color: "#00E676" },
  sunglasses: { label: "Sunglasses",  icon: "sunglasses",     color: "#FF5722" },
};

export const SLOT_ORDER: EquipSlot[] = ["wallet", "phone", "pen", "suit", "sunglasses"];

export const EQUIPMENT: EquipItem[] = [
  // Wallets
  { id: "wallet_leather",  slot: "wallet", name: "Leather Wallet",   tier: 1, icon: "wallet",                boostPct: 0.05, currency: "cash", price: 50_000,         color: "#8D6E63" },
  { id: "wallet_gold",     slot: "wallet", name: "Gold Wallet",      tier: 2, icon: "wallet-membership",     boostPct: 0.15, currency: "gems", price: 80,             color: "#FFD54F" },
  { id: "wallet_diamond",  slot: "wallet", name: "Diamond Wallet",   tier: 3, icon: "wallet-plus",           boostPct: 0.35, currency: "gems", price: 350,            color: "#80DEEA" },

  // Phones
  { id: "phone_basic",     slot: "phone",  name: "Flip Phone",       tier: 1, icon: "cellphone-basic",       boostPct: 0.05, currency: "cash", price: 250_000,        color: "#90A4AE" },
  { id: "phone_smart",     slot: "phone",  name: "Smartphone",       tier: 2, icon: "cellphone",             boostPct: 0.15, currency: "gems", price: 100,            color: "#42A5F5" },
  { id: "phone_quantum",   slot: "phone",  name: "Quantum Phone",    tier: 3, icon: "cellphone-link",        boostPct: 0.40, currency: "gems", price: 400,            color: "#7C4DFF" },

  // Pens
  { id: "pen_bic",         slot: "pen",    name: "Ballpoint Pen",    tier: 1, icon: "pencil",                boostPct: 0.03, currency: "cash", price: 25_000,         color: "#B0BEC5" },
  { id: "pen_fountain",    slot: "pen",    name: "Fountain Pen",     tier: 2, icon: "fountain-pen-tip",      boostPct: 0.10, currency: "gems", price: 60,             color: "#9C27B0" },
  { id: "pen_golden",      slot: "pen",    name: "Golden Pen",       tier: 3, icon: "fountain-pen",          boostPct: 0.25, currency: "gems", price: 250,            color: "#FFD54F" },

  // Suits
  { id: "suit_office",     slot: "suit",   name: "Office Suit",      tier: 1, icon: "tie",                   boostPct: 0.05, currency: "cash", price: 500_000,        color: "#5C6BC0" },
  { id: "suit_tailored",   slot: "suit",   name: "Tailored Suit",    tier: 2, icon: "human-male-board",      boostPct: 0.18, currency: "gems", price: 140,            color: "#00BFA5" },
  { id: "suit_tuxedo",     slot: "suit",   name: "Diamond Tuxedo",   tier: 3, icon: "crown",                 boostPct: 0.45, currency: "gems", price: 500,            color: "#FFD54F" },

  // Sunglasses
  { id: "sun_aviator",     slot: "sunglasses", name: "Aviators",     tier: 1, icon: "sunglasses",            boostPct: 0.05, currency: "cash", price: 100_000,        color: "#B0BEC5" },
  { id: "sun_designer",    slot: "sunglasses", name: "Designer Shades", tier: 2, icon: "glasses",            boostPct: 0.15, currency: "gems", price: 80,             color: "#FF5722" },
  { id: "sun_holo",        slot: "sunglasses", name: "Holo Shades",  tier: 3, icon: "eye",                   boostPct: 0.35, currency: "gems", price: 350,            color: "#00E5FF" },
];

export const EQUIPMENT_MAP: Record<string, EquipItem> = EQUIPMENT.reduce((acc, e) => {
  acc[e.id] = e;
  return acc;
}, {} as Record<string, EquipItem>);

export type EquipmentState = {
  owned: string[];                                // item ids
  equipped: Partial<Record<EquipSlot, string>>;   // slot -> item id
};

export function emptyEquipment(): EquipmentState {
  return { owned: [], equipped: {} };
}

// Combined multiplier from all equipped items, e.g. 0.05 + 0.15 = 1.20 (+20%).
export function equipmentMultiplier(eq: EquipmentState | undefined): number {
  if (!eq?.equipped) return 1;
  let pct = 0;
  for (const slot of SLOT_ORDER) {
    const id = eq.equipped[slot];
    if (!id) continue;
    const item = EQUIPMENT_MAP[id];
    if (item) pct += item.boostPct;
  }
  return 1 + pct;
}

export function equippedItem(eq: EquipmentState | undefined, slot: EquipSlot): EquipItem | null {
  const id = eq?.equipped?.[slot];
  if (!id) return null;
  return EQUIPMENT_MAP[id] ?? null;
}

export function itemsForSlot(slot: EquipSlot): EquipItem[] {
  return EQUIPMENT.filter((e) => e.slot === slot);
}
