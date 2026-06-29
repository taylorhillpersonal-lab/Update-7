// ----- Random business events -----
// Every ~5 minutes a scenario puts something at stake: cash, gems, or a whole
// property. Settle to make it go away, or gamble with the shown odds (5%–70%).

export type StakeType = "cash" | "gems" | "property";

export type GameEvent = {
  id: string;
  icon: string; // MaterialCommunityIcons
  title: string;
  body: string;
  payLabel: string;
  fightLabel: string;
  winText: string;
  loseText: string;
  stake: StakeType;
  odds: number; // shown win probability, 0.05–0.70
};

export const EVENTS: GameEvent[] = [
  {
    id: "hair",
    icon: "alert-octagon",
    title: "A Hair in the Lemonade!",
    body: "A customer claims they found a hair in their drink and is threatening to post it everywhere.",
    payLabel: "Pay them off",
    fightLabel: "Fight it — it's their hair!",
    winText: "The lab proved it was THEIR hair. They paid you damages!",
    loseText: "The story went viral. You paid a fat settlement.",
    stake: "cash",
    odds: 0.55,
  },
  {
    id: "inspector",
    icon: "clipboard-alert",
    title: "Surprise Health Inspection",
    body: "An inspector found a 'violation' and hints a bribe could make it disappear.",
    payLabel: "Slip them the cash",
    fightLabel: "Demand a re-inspection",
    winText: "The re-inspection was spotless. The crooked inspector got fired!",
    loseText: "They slapped you with a hefty fine.",
    stake: "cash",
    odds: 0.45,
  },
  {
    id: "critic",
    icon: "star-off",
    title: "Brutal Food Critic",
    body: "A famous critic threatens a 1-star review unless you comp their whole party.",
    payLabel: "Comp the meal",
    fightLabel: "Stand your ground",
    winText: "Diners defended you online — sales boomed!",
    loseText: "The bad review tanked your week.",
    stake: "cash",
    odds: 0.6,
  },
  {
    id: "tax",
    icon: "file-document-alert",
    title: "Tax Audit",
    body: "The taxman says you owe back taxes. Your accountant thinks it's bogus.",
    payLabel: "Just pay it",
    fightLabel: "Challenge the audit",
    winText: "Your accountant won — they even refunded you!",
    loseText: "The audit stuck. You paid up.",
    stake: "cash",
    odds: 0.4,
  },
  {
    id: "supplier",
    icon: "truck-alert",
    title: "Shady Supplier Demand",
    body: "Your supplier 'lost' a shipment and wants a gem payment to find it.",
    payLabel: "Pay the gems",
    fightLabel: "Find a new supplier",
    winText: "You found a cheaper supplier AND got gems back!",
    loseText: "The delay cost you gems in lost deals.",
    stake: "gems",
    odds: 0.5,
  },
  {
    id: "influencer",
    icon: "instagram",
    title: "Influencer Shakedown",
    body: "An influencer wants free gems or they'll trash your brand to millions.",
    payLabel: "Pay the gems",
    fightLabel: "Call their bluff",
    winText: "Their followers called them out — you gained clout (and gems)!",
    loseText: "The smear campaign cost you gems.",
    stake: "gems",
    odds: 0.65,
  },
  {
    id: "heist",
    icon: "safe",
    title: "Vault Heist Attempt",
    body: "Thieves are eyeing your gem vault. Pay for security or risk it.",
    payLabel: "Hire guards (gems)",
    fightLabel: "Set a trap for them",
    winText: "You caught the crew and seized their loot!",
    loseText: "They cracked the vault and took your gems.",
    stake: "gems",
    odds: 0.2,
  },
  {
    id: "rival",
    icon: "sword-cross",
    title: "Rival Tycoon Lawsuit",
    body: "A rival is suing to seize one of your properties over a 'stolen' recipe.",
    payLabel: "Settle in cash",
    fightLabel: "See them in court",
    winText: "The judge tossed the case — your property is safe!",
    loseText: "The court handed your property to your rival!",
    stake: "property",
    odds: 0.35,
  },
  {
    id: "patent",
    icon: "gavel",
    title: "Patent Troll",
    body: "A patent troll claims one of your shops infringes their patent.",
    payLabel: "Pay to license it",
    fightLabel: "Fight the patent",
    winText: "The patent was invalid — case dismissed!",
    loseText: "You lost the shop in the ruling.",
    stake: "property",
    odds: 0.3,
  },
];

export function randomEvent(): GameEvent {
  return EVENTS[Math.floor(Math.random() * EVENTS.length)];
}

// Cash stake = a random 20%–90% slice of cash.
export function computeStake(cash: number): number {
  const pct = 0.2 + Math.random() * 0.7;
  return Math.max(1, Math.floor(cash * pct));
}

// Gem stake = a random 20%–70% slice of held gems (min 5).
export function computeGemStake(gems: number): number {
  const pct = 0.2 + Math.random() * 0.5;
  return Math.max(5, Math.floor(gems * pct));
}

export const EVENT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
