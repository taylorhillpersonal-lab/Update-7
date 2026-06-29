const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type SyncBody = {
  device_id: string;
  name: string;
  net_worth: number;
  prestige_points: number;
  cash?: number;
  gems?: number;
  total_levels?: number;
  save_data?: Record<string, unknown> | null;
};

export type LeaderboardMetric = "net_worth" | "cash" | "gems" | "levels" | "investors";

export type LeaderboardEntry = {
  device_id: string;
  name: string;
  net_worth: number;
  prestige_points: number;
  cash: number;
  gems: number;
  total_levels: number;
  updated_at: string;
  rank: number;
};

export type LeaderboardResult = {
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
};

export async function syncProfile(body: SyncBody): Promise<void> {
  try {
    await fetch(`${BASE}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // offline: ignore, local save is source of truth
  }
}

export async function fetchLeaderboard(
  metric: LeaderboardMetric = "net_worth",
  deviceId?: string,
): Promise<LeaderboardResult> {
  const params = new URLSearchParams({ metric });
  if (deviceId) params.set("device_id", deviceId);
  const res = await fetch(`${BASE}/api/leaderboard?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load leaderboard");
  return res.json();
}

// ----- Public profiles -----
export type PublicProfile = {
  device_id: string;
  name: string;
  net_worth: number;
  prestige_points: number;
  cash: number;
  gems: number;
  total_levels: number;
  city_name: string | null;
  city_tag: string | null;
  updated_at: string;
};

export async function fetchPublicProfile(deviceId: string): Promise<PublicProfile> {
  const res = await fetch(`${BASE}/api/player/${encodeURIComponent(deviceId)}`);
  if (!res.ok) throw new Error("Profile not found");
  return res.json();
}

// ----- Cities (clans) -----
export type CityMember = {
  device_id: string;
  name: string;
  net_worth: number;
  prestige_points: number;
  is_mayor: boolean;
};

export type CityPendingRequest = {
  device_id: string;
  name: string;
  net_worth: number;
  prestige_points: number;
};

export type City = {
  id: string;
  name: string;
  tag: string;
  mayor_device_id: string;
  member_count: number;
  boost: number;
  member_boost: number;
  upgrade_level: number;
  upgrade_boost: number;
  next_upgrade_cost: number | null;
  upgrade_maxed: boolean;
  total_net_worth: number;
  members: CityMember[];
  join_policy: "open" | "manual";
  pending_requests: CityPendingRequest[];
  pending_count: number;
};

// Gems required to found a new City (deducted client-side).
export const CITY_FOUND_COST = 1000;

export type CitySummary = {
  id: string;
  name: string;
  tag: string;
  member_count: number;
  boost: number;
  total_net_worth: number;
  rank: number;
  join_policy: "open" | "manual";
  requested?: boolean;
};

export async function fetchMyCity(deviceId: string): Promise<City | null> {
  const res = await fetch(`${BASE}/api/cities/mine?device_id=${encodeURIComponent(deviceId)}`);
  if (!res.ok) throw new Error("Failed");
  const data = await res.json();
  return data.city;
}

export async function fetchCities(deviceId?: string): Promise<{ cities: CitySummary[]; prize_pool: number }> {
  const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  const res = await fetch(`${BASE}/api/cities${q}`);
  if (!res.ok) throw new Error("Failed to load cities");
  return res.json();
}

export async function cancelJoinRequest(cityId: string, deviceId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/cities/${cityId}/cancel-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw new Error("Failed to cancel request");
}

export async function createCity(deviceId: string, name: string, tag: string): Promise<City> {
  const res = await fetch(`${BASE}/api/cities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, name, tag }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to create");
  return res.json();
}

export async function joinCity(
  cityId: string,
  deviceId: string,
): Promise<{ status: "joined" | "requested"; city?: City }> {
  const res = await fetch(`${BASE}/api/cities/${cityId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw new Error("Failed to join");
  return res.json();
}

export async function approveCityRequest(cityId: string, mayorId: string, targetId: string): Promise<City> {
  const res = await fetch(`${BASE}/api/cities/${cityId}/requests/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: mayorId, target_device_id: targetId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to approve");
  return res.json();
}

export async function rejectCityRequest(cityId: string, mayorId: string, targetId: string): Promise<City> {
  const res = await fetch(`${BASE}/api/cities/${cityId}/requests/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: mayorId, target_device_id: targetId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to reject");
  return res.json();
}

export async function kickCityMember(cityId: string, mayorId: string, targetId: string): Promise<City> {
  const res = await fetch(`${BASE}/api/cities/${cityId}/kick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: mayorId, target_device_id: targetId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to remove member");
  return res.json();
}

export async function setCityPolicy(cityId: string, mayorId: string, policy: "open" | "manual"): Promise<City> {
  const res = await fetch(`${BASE}/api/cities/${cityId}/policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: mayorId, join_policy: policy }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to update policy");
  return res.json();
}

// ----- City Chat -----
export type CityChatMessage = {
  id: string;
  city_id: string;
  device_id: string;
  name: string;
  text: string;
  created_at: string;
};

export async function fetchCityChatHistory(cityId: string, limit = 50): Promise<CityChatMessage[]> {
  const res = await fetch(`${BASE}/api/cities/${cityId}/chat/history?limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}

// ----- Gem transfers (player -> player) -----
export async function transferGems(
  fromDeviceId: string,
  toDeviceId: string,
  amount: number,
): Promise<{ ok: boolean; amount: number; recipient_name: string }> {
  const res = await fetch(`${BASE}/api/gems/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from_device_id: fromDeviceId, to_device_id: toDeviceId, amount }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Couldn't send gems");
  return res.json();
}

export async function leaveCity(cityId: string, deviceId: string): Promise<void> {
  await fetch(`${BASE}/api/cities/${cityId}/leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
}

export async function upgradeCity(cityId: string, deviceId: string): Promise<City> {
  const res = await fetch(`${BASE}/api/cities/${cityId}/upgrade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to upgrade");
  return res.json();
}

export type CheckoutResponse = {
  url: string;
  session_id: string;
  gems: number;
  investors?: number;
  keys?: number;
  remove_ads?: boolean;
  product?: string;
};

export async function createCheckout(
  packId: string,
  deviceId: string,
  returnUrl: string,
): Promise<CheckoutResponse> {
  const res = await fetch(`${BASE}/api/payments/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack_id: packId, device_id: deviceId, return_url: returnUrl }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body && body.detail) || (res.status === 409 ? "Already purchased" : "Checkout unavailable");
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function getPaymentStatus(
  sessionId: string,
): Promise<{ payment_status: string; gems: number; investors?: number; remove_ads?: boolean; product?: string }> {
  const res = await fetch(`${BASE}/api/payments/status/${sessionId}`);
  if (!res.ok) throw new Error("Status unavailable");
  return res.json();
}


// ----- Auth + Admin -----
export type AuthUser = {
  user_id: string;
  email: string;
  name: string;
  picture: string | null;
  is_admin: boolean;
  device_id?: string | null;
};

export async function postSession(sessionId: string, deviceId: string): Promise<{ session_token: string; user: AuthUser }> {
  const res = await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, device_id: deviceId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Sign-in failed");
  return res.json();
}

export async function fetchMe(token: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("unauthenticated");
  return res.json();
}

export async function postLogout(token: string): Promise<void> {
  await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchAnnouncement(): Promise<{ message: string } | null> {
  try {
    const res = await fetch(`${BASE}/api/announcements`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.announcement ?? null;
  } catch {
    return null;
  }
}

export async function redeemPromo(code: string, deviceId: string): Promise<{ gems: number }> {
  const res = await fetch(`${BASE}/api/promo/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, device_id: deviceId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Invalid code");
  return res.json();
}

// ----- Player reports -----
export async function reportPlayer(body: {
  reporter_device_id: string;
  reported_device_id: string;
  reason: string;
  reporter_name?: string;
  reported_name?: string;
  reporter_email?: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/api/report-player`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))).detail;
    throw new Error(detail || "Couldn't submit report. Please try again.");
  }
}

export async function claimGrants(
  deviceId: string,
): Promise<{ gems: number; investors: number; keys: number; remove_ads: boolean; cash: number }> {
  try {
    const res = await fetch(`${BASE}/api/grants/claim?device_id=${encodeURIComponent(deviceId)}`);
    if (!res.ok) return { gems: 0, investors: 0, keys: 0, remove_ads: false, cash: 0 };
    const j = await res.json();
    return {
      gems: Number(j.gems) || 0,
      investors: Number(j.investors) || 0,
      keys: Number(j.keys) || 0,
      remove_ads: Boolean(j.remove_ads),
      cash: Number(j.cash) || 0,
    };
  } catch {
    return { gems: 0, investors: 0, keys: 0, remove_ads: false, cash: 0 };
  }
}

// ----- Email auth (custom JWT issued by /api/auth/email/*) -----
export async function postEmailRegister(body: {
  email: string;
  password: string;
  name: string;
  referral_code?: string;
  device_id?: string;
}): Promise<{ session_token: string; user: AuthUser }> {
  const res = await fetch(`${BASE}/api/auth/email/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Sign-up failed");
  return res.json();
}

export async function postEmailLogin(body: {
  email: string;
  password: string;
  device_id?: string;
}): Promise<{ session_token: string; user: AuthUser }> {
  const res = await fetch(`${BASE}/api/auth/email/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Sign-in failed");
  return res.json();
}

// ----- Affiliate / referral -----
export type AffiliateMe = {
  code: string;
  redeemed_code: string | null;
  referrals_count: number;
  gems_earned: number;
  gems_per_referral: number;
  cap: number;
  share_url_path: string;
};

export async function fetchAffiliateMe(deviceId: string): Promise<AffiliateMe> {
  const res = await fetch(`${BASE}/api/affiliate/me?device_id=${encodeURIComponent(deviceId)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Couldn't load invite stats");
  return res.json();
}

export async function postAffiliateRedeem(body: { code: string; device_id: string; player_name?: string }): Promise<{
  ok: boolean;
  referee_gems_awarded: number;
  referee_cash_awarded: number;
  referrer_gems_awarded: number;
  referrer_capped: boolean;
}> {
  const res = await fetch(`${BASE}/api/affiliate/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Couldn't redeem code");
  return res.json();
}

const authHeaders = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

export async function adminSetAnnouncement(token: string, message: string, active: boolean): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/announcement`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ message, active }),
  });
  if (!res.ok) throw new Error("Failed to update announcement");
}

export type PromoCode = { code: string; gems: number; max_uses: number; uses: number };

export async function adminListPromos(token: string): Promise<PromoCode[]> {
  const res = await fetch(`${BASE}/api/admin/promocodes`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed");
  return (await res.json()).codes;
}

export async function adminCreatePromo(token: string, code: string, gems: number, maxUses: number): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/promocodes`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ code, gems, max_uses: maxUses }),
  });
  if (!res.ok) throw new Error("Failed to create code");
}

export async function adminListBans(token: string): Promise<{ device_id: string }[]> {
  const res = await fetch(`${BASE}/api/admin/bans`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed");
  return (await res.json()).bans;
}

export async function adminBan(token: string, deviceId: string, ban: boolean): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/${ban ? "ban" : "unban"}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw new Error("Failed");
}

export type IpBan = { ip: string; device_id: string; name?: string; created_at?: string };

export async function adminListIpBans(token: string): Promise<IpBan[]> {
  const res = await fetch(`${BASE}/api/admin/ipbans`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed");
  return (await res.json()).ip_bans;
}

export async function adminIpBan(token: string, deviceId: string): Promise<{ ip: string }> {
  const res = await fetch(`${BASE}/api/admin/ipban`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to IP ban");
  return res.json();
}

export async function adminIpUnban(token: string, ip: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/ipunban`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ ip }),
  });
  if (!res.ok) throw new Error("Failed to remove IP ban");
}

export type PlayerAchievements = {
  device_id: string;
  name: string;
  achievements: string[];
  net_worth: number;
  prestige_points: number;
  total_levels: number;
  gems: number;
  last_ip: string;
  updated_at: string;
  grand_prize: { name: string; is_first: boolean; created_at: string } | null;
};

export async function adminPlayerAchievements(token: string, deviceId: string): Promise<PlayerAchievements> {
  const res = await fetch(`${BASE}/api/admin/player-achievements?device_id=${encodeURIComponent(deviceId)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Lookup failed");
  return res.json();
}

// Fires when a player completes the world-first $1,000 USD challenge.
export async function reportGrandPrize(deviceId: string, name: string): Promise<{ ok: boolean; first: boolean }> {
  const res = await fetch(`${BASE}/api/achievements/grand-prize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, name }),
  });
  if (!res.ok) throw new Error("Failed to report grand prize");
  return res.json();
}

export async function adminGrant(token: string, deviceId: string, gems: number, investors: number): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/grant`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ device_id: deviceId, gems, investors }),
  });
  if (!res.ok) throw new Error("Failed to grant");
}

export type GrantedPackage = {
  gems: number;
  investors: number;
  keys: number;
  remove_ads: boolean;
  pack_name: string;
};

export async function adminGrantPackage(
  token: string,
  deviceId: string,
  packId: string,
): Promise<GrantedPackage> {
  const res = await fetch(`${BASE}/api/admin/grant-package`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ device_id: deviceId, pack_id: packId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to grant package");
  return (await res.json()).granted;
}

// ----- Admin: player reports -----
export type ReportChatLog = { name: string; text: string; created_at: string };

export type AdminReport = {
  id: string;
  reporter_device_id: string;
  reporter_name: string;
  reporter_email: string;
  reported_device_id: string;
  reported_name: string;
  reason: string;
  created_at: string;
  resolved: boolean;
  reported_banned: boolean;
  reporter_logs: ReportChatLog[];
  reported_logs: ReportChatLog[];
};

export async function adminListReports(token: string, status: "all" | "open" | "resolved" = "all"): Promise<AdminReport[]> {
  const res = await fetch(`${BASE}/api/admin/reports?status=${status}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load reports");
  return (await res.json()).reports;
}

export async function adminReportsCount(token: string): Promise<{ open: number; total: number }> {
  const res = await fetch(`${BASE}/api/admin/reports/count`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load report count");
  return res.json();
}

// ----- Store catalog + sales -----
export type StoreItem = {
  id: string;
  name: string;
  product: string;
  base_cents: number;
  base_price: string;
  discount_pct: number;
  final_cents: number;
  final_price: string;
  on_sale: boolean;
  // Optional — only present for bundle products. Reflects the combined
  // catalog value of the bundle's individual components.
  bundle_value_cents?: number;
  bundle_value_price?: string;
  bundle_savings_pct?: number;
};

export async function getStoreCatalog(): Promise<Record<string, StoreItem>> {
  const res = await fetch(`${BASE}/api/store/catalog`);
  if (!res.ok) throw new Error("Failed to load store");
  const items: StoreItem[] = (await res.json()).items;
  return items.reduce((acc, i) => {
    acc[i.id] = i;
    return acc;
  }, {} as Record<string, StoreItem>);
}

export async function adminListSales(token: string): Promise<StoreItem[]> {
  const res = await fetch(`${BASE}/api/admin/sales`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load sales");
  return (await res.json()).items;
}

export async function getFirstPurchaseStatus(deviceId: string): Promise<{ available: boolean; multiplier: number }> {
  const res = await fetch(`${BASE}/api/store/first-purchase?device_id=${encodeURIComponent(deviceId)}`);
  if (!res.ok) return { available: false, multiplier: 1 };
  return res.json();
}

export async function adminSetSale(token: string, packId: string, discountPct: number): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/sales`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ pack_id: packId, discount_pct: discountPct }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))).detail;
    throw new Error(detail || "Failed to set sale");
  }
}

export async function adminClearSale(token: string, packId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/sales/${encodeURIComponent(packId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Failed to clear sale");
}

export async function adminResolveReport(token: string, reportId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Failed to resolve report");
}

// ----- Purchase history (player) + admin purchase log -----
export type PurchaseEntry = {
  id: string;
  pack_id: string;
  pack_name: string;
  product: string;
  amount_cents: number;
  amount_label: string;
  paid_at: string;
  source: "purchase" | "admin_grant";
  provider: string;
  gems: number;
  investors: number;
  keys: number;
  remove_ads: boolean;
  first_purchase_bonus: boolean;
};

export async function fetchPurchaseHistory(deviceId: string): Promise<PurchaseEntry[]> {
  const res = await fetch(`${BASE}/api/payments/history?device_id=${encodeURIComponent(deviceId)}`);
  if (!res.ok) throw new Error("Failed to load purchase history");
  return (await res.json()).items as PurchaseEntry[];
}

export type AdminPurchaseEntry = {
  id: string;
  device_id: string;
  pack_id: string;
  pack_name: string;
  amount_cents: number;
  amount_label: string;
  paid_at: string;
  source: "purchase" | "admin_grant";
  provider: string;
  first_purchase_bonus: boolean;
};

export type AdminPurchaseLog = {
  items: AdminPurchaseEntry[];
  revenue_cents: number;
  revenue_label: string;
  paid_count: number;
  grant_count: number;
};

export type AdminPurchaseFilters = {
  device_id?: string;
  from_date?: string;
  to_date?: string;
  source?: "purchase" | "admin_grant";
};

function qs(params: Record<string, string | number | undefined>) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function adminListPurchases(token: string, limit = 200, filters: AdminPurchaseFilters = {}): Promise<AdminPurchaseLog> {
  const url = `${BASE}/api/admin/purchases${qs({ limit, ...filters })}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load purchase log");
  return res.json();
}

export function adminPurchasesCsvUrl(filters: AdminPurchaseFilters = {}, limit = 5000): string {
  return `${BASE}/api/admin/purchases.csv${qs({ limit, ...filters })}`;
}

export async function adminDownloadPurchasesCsv(token: string, filters: AdminPurchaseFilters = {}, limit = 5000): Promise<{ filename: string; csv: string }> {
  const res = await fetch(adminPurchasesCsvUrl(filters, limit), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("CSV export failed");
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="([^"]+)"/.exec(cd);
  const filename = m ? m[1] : "purchases.csv";
  const csv = await res.text();
  return { filename, csv };
}

