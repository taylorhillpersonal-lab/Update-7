import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";
import {
  PromoCode,
  AdminReport,
  StoreItem,
  IpBan,
  PlayerAchievements,
  adminBan,
  adminClearSale,
  adminCreatePromo,
  adminGrant,
  adminGrantPackage,
  adminIpBan,
  adminIpUnban,
  adminListBans,
  adminListIpBans,
  adminListPromos,
  adminListReports,
  adminListSales,
  adminListPurchases,
  adminDownloadPurchasesCsv,
  type AdminPurchaseEntry,
  adminPlayerAchievements,
  adminReportsCount,
  adminResolveReport,
  adminSetSale,
  adminSetAnnouncement,
} from "@/src/game/api";
import { ACHIEVEMENTS } from "@/src/game/achievements";

export default function AdminScreen() {
  const { user, token } = useAuth();
  const { showToast } = useGame();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [announce, setAnnounce] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoGems, setPromoGems] = useState("");
  const [promoMax, setPromoMax] = useState("");
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [banId, setBanId] = useState("");
  const [bans, setBans] = useState<{ device_id: string }[]>([]);
  const [ipBans, setIpBans] = useState<IpBan[]>([]);
  const [achLookupId, setAchLookupId] = useState("");
  const [achResult, setAchResult] = useState<PlayerAchievements | null>(null);
  const [achLoading, setAchLoading] = useState(false);
  const [grantId, setGrantId] = useState("");
  const [grantGems, setGrantGems] = useState("");
  const [grantInv, setGrantInv] = useState("");
  const [pkgId, setPkgId] = useState("");
  const [pkgPackId, setPkgPackId] = useState<string>("");
  const [pkgBusy, setPkgBusy] = useState(false);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [reportFilter, setReportFilter] = useState<"all" | "open" | "resolved">("open");
  const [openCount, setOpenCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sales, setSales] = useState<StoreItem[]>([]);
  const [saleInputs, setSaleInputs] = useState<Record<string, string>>({});
  const [purchases, setPurchases] = useState<AdminPurchaseEntry[]>([]);
  const [revenueLabel, setRevenueLabel] = useState<string>("$0.00");
  const [grantCount, setGrantCount] = useState<number>(0);
  const [purchSearch, setPurchSearch] = useState<string>("");
  const [purchFrom, setPurchFrom] = useState<string>("");
  const [purchTo, setPurchTo] = useState<string>("");
  const [purchSource, setPurchSource] = useState<"all" | "purchase" | "admin_grant">("all");
  const [purchExporting, setPurchExporting] = useState(false);
  const [tab, setTab] = useState<"reports" | "store" | "economy" | "moderation">("reports");

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setCodes(await adminListPromos(token));
      setBans(await adminListBans(token));
      setIpBans(await adminListIpBans(token));
      setReports(await adminListReports(token, reportFilter));
      setOpenCount((await adminReportsCount(token)).open);
      setSales(await adminListSales(token));
      try {
        const log = await adminListPurchases(token, 200, {
          device_id: purchSearch.trim() || undefined,
          from_date: purchFrom.trim() || undefined,
          to_date: purchTo.trim() || undefined,
          source: purchSource === "all" ? undefined : purchSource,
        });
        setPurchases(log.items);
        setRevenueLabel(log.revenue_label);
        setGrantCount(log.grant_count);
      } catch { /* purchases panel optional */ }
    } catch {
      // ignore
    }
  }, [token, reportFilter, purchSearch, purchFrom, purchTo, purchSource]);

  const onExportPurchasesCsv = async () => {
    if (!token) return;
    setPurchExporting(true);
    try {
      const { filename, csv } = await adminDownloadPurchasesCsv(token, {
        device_id: purchSearch.trim() || undefined,
        from_date: purchFrom.trim() || undefined,
        to_date: purchTo.trim() || undefined,
        source: purchSource === "all" ? undefined : purchSource,
      }, 5000);
      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showToast(`Downloaded ${filename}`);
      } else {
        const { Share } = await import("react-native");
        await Share.share({ message: csv, title: filename });
      }
    } catch (e: any) {
      showToast(e?.message || "CSV export failed");
    } finally {
      setPurchExporting(false);
    }
  };

  const onSetSale = async (packId: string) => {
    const pct = parseInt(saleInputs[packId] ?? "", 10);
    if (isNaN(pct) || pct < 1 || pct > 90) {
      showToast("Enter a discount between 1 and 90");
      return;
    }
    try {
      await adminSetSale(token, packId, pct);
      haptic("success");
      showToast("Sale applied");
      setSaleInputs((p) => ({ ...p, [packId]: "" }));
      refresh();
    } catch (e: any) {
      showToast(e?.message || "Failed to set sale");
    }
  };

  const onClearSale = async (packId: string) => {
    try {
      await adminClearSale(token, packId);
      haptic("light");
      showToast("Sale removed");
      refresh();
    } catch {
      showToast("Failed to remove sale");
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!user || !user.is_admin || !token) {
    return (
      <View style={[styles.container, styles.center]}>
        <MaterialCommunityIcons name="shield-lock" size={48} color={colors.onSurfaceTertiary} />
        <Text style={styles.denied}>Admin access only</Text>
        <Pressable onPress={() => router.back()} style={styles.backPill}>
          <Text style={styles.backPillText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const onAnnounce = async (active: boolean) => {
    try {
      await adminSetAnnouncement(token, announce, active);
      haptic("success");
      showToast(active ? "Announcement published" : "Announcement cleared");
      if (!active) setAnnounce("");
    } catch {
      showToast("Failed to update announcement");
    }
  };

  const onCreatePromo = async () => {
    const gems = parseInt(promoGems, 10);
    if (!promoCode.trim() || !gems) {
      showToast("Enter a code and gem amount");
      return;
    }
    try {
      await adminCreatePromo(token, promoCode.trim(), gems, parseInt(promoMax, 10) || 0);
      haptic("success");
      showToast("Promo code created");
      setPromoCode("");
      setPromoGems("");
      setPromoMax("");
      refresh();
    } catch {
      showToast("Failed to create code");
    }
  };

  const onBan = async (ban: boolean, id?: string) => {
    const target = (id ?? banId).trim();
    if (!target) return;
    try {
      await adminBan(token, target, ban);
      haptic("medium");
      showToast(ban ? "Player banned" : "Player unbanned");
      setBanId("");
      refresh();
    } catch {
      showToast("Action failed");
    }
  };

  const onIpBan = async (id?: string) => {
    const target = (id ?? banId).trim();
    if (!target) {
      showToast("Enter a player UUID");
      return;
    }
    try {
      const res = await adminIpBan(token, target);
      haptic("heavy");
      showToast(`IP banned (${res.ip})`);
      setBanId("");
      refresh();
    } catch (e: any) {
      showToast(e?.message || "IP ban failed");
    }
  };

  const onIpUnban = async (ip: string) => {
    try {
      await adminIpUnban(token, ip);
      haptic("light");
      showToast("IP ban removed");
      refresh();
    } catch {
      showToast("Failed to remove IP ban");
    }
  };

  const onLookupAchievements = async () => {
    const id = achLookupId.trim();
    if (!id) {
      showToast("Enter a player UUID");
      return;
    }
    setAchLoading(true);
    setAchResult(null);
    try {
      const res = await adminPlayerAchievements(token, id);
      setAchResult(res);
      haptic("light");
    } catch (e: any) {
      showToast(e?.message || "Lookup failed");
    } finally {
      setAchLoading(false);
    }
  };

  const onGrant = async () => {
    if (!grantId.trim()) {
      showToast("Enter a player UUID");
      return;
    }
    try {
      await adminGrant(token, grantId.trim(), parseInt(grantGems, 10) || 0, parseInt(grantInv, 10) || 0);
      haptic("success");
      showToast("Grant queued for player");
      setGrantId("");
      setGrantGems("");
      setGrantInv("");
    } catch {
      showToast("Failed to grant");
    }
  };

  const onGrantPackage = async () => {
    const uuid = pkgId.trim();
    if (!uuid) {
      showToast("Enter a player UUID");
      return;
    }
    if (!pkgPackId) {
      showToast("Pick a package first");
      return;
    }
    setPkgBusy(true);
    try {
      const granted = await adminGrantPackage(token, uuid, pkgPackId);
      haptic("success");
      const bits: string[] = [];
      if (granted.gems > 0) bits.push(`${granted.gems.toLocaleString()} gems`);
      if (granted.investors > 0) bits.push(`${granted.investors.toLocaleString()} investors`);
      if (granted.keys > 0) bits.push(`${granted.keys.toLocaleString()} loot keys`);
      if (granted.remove_ads) bits.push("Remove Ads");
      showToast(`Sent "${granted.pack_name}" — ${bits.join(" + ") || "no rewards"}`);
      setPkgId("");
    } catch (e: any) {
      showToast(e?.message || "Failed to grant package");
    } finally {
      setPkgBusy(false);
    }
  };

  const onResolve = async (id: string) => {
    try {
      await adminResolveReport(token, id);
      haptic("success");
      showToast("Report marked resolved");
      refresh();
    } catch {
      showToast("Failed to resolve report");
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="admin-back" onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Admin Panel</Text>
          <Text style={styles.subtitle}>{user.email}</Text>
        </View>
        <MaterialCommunityIcons name="shield-crown" size={26} color={colors.brandPrimary} />
      </View>

      <View style={styles.navWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navRow}>
          {([
            { key: "reports", label: "Reports", icon: "flag" },
            { key: "store", label: "Store", icon: "tag" },
            { key: "economy", label: "Economy", icon: "cash" },
            { key: "moderation", label: "Moderation", icon: "shield-account" },
          ] as const).map((t) => {
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                testID={`admin-nav-${t.key}`}
                onPress={() => { haptic("light"); setTab(t.key); }}
                style={[styles.navChip, active && styles.navChipActive]}
              >
                <MaterialCommunityIcons name={t.icon} size={15} color={active ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.navChipText, active && styles.navChipTextActive]}>{t.label}</Text>
                {t.key === "reports" && openCount > 0 && (
                  <View style={styles.navBadge}><Text style={styles.navBadgeText}>{openCount}</Text></View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        testID="admin-screen"
      >
        {tab === "reports" && (
        <>
        {/* Player reports */}
        <View style={styles.reportsHead}>
          <Text style={styles.section}>🚩 Player Reports</Text>
          {openCount > 0 && (
            <View testID="admin-open-reports-badge" style={styles.openBadge}>
              <Text style={styles.openBadgeText}>{openCount} open</Text>
            </View>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {(["open", "resolved", "all"] as const).map((f) => {
            const active = reportFilter === f;
            return (
              <Pressable
                key={f}
                testID={`admin-report-filter-${f}`}
                onPress={() => setReportFilter(f)}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {f === "open" ? "Open" : f === "resolved" ? "Resolved" : "All"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {reports.length === 0 && (
          <Text style={styles.empty}>
            {reportFilter === "open" ? "No open reports 🎉" : "No reports"}
          </Text>
        )}
        {reports.map((r) => (
          <View key={r.id} testID={`admin-report-${r.id}`} style={[styles.reportCard, r.resolved && styles.reportResolved]}>
            <View style={styles.reportTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle} numberOfLines={1}>
                  {r.reported_name}
                  {r.reported_banned ? "  🔨" : ""}
                </Text>
                <Text style={styles.reportUuid} numberOfLines={1}>{r.reported_device_id}</Text>
              </View>
              {r.resolved ? (
                <View style={styles.resolvedTag}>
                  <Text style={styles.resolvedTagText}>RESOLVED</Text>
                </View>
              ) : (
                <View style={styles.openTag}>
                  <Text style={styles.openTagText}>OPEN</Text>
                </View>
              )}
            </View>
            <Text style={styles.reportReason}>{r.reason}</Text>
            <Text style={styles.reportMeta} numberOfLines={1}>
              by {r.reporter_name}
              {r.reporter_email ? ` · ${r.reporter_email}` : ""} · {r.created_at.slice(0, 16).replace("T", " ")}
            </Text>
            <Pressable
              testID={`admin-report-expand-${r.id}`}
              onPress={() => setExpandedId(expandedId === r.id ? null : r.id)}
              style={styles.expandBtn}
            >
              <MaterialCommunityIcons
                name={expandedId === r.id ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.brandPrimary}
              />
              <Text style={styles.expandText}>
                {expandedId === r.id ? "Hide chat history" : "View chat history"}
              </Text>
            </Pressable>
            {expandedId === r.id && (
              <View testID={`admin-report-logs-${r.id}`} style={styles.logsWrap}>
                <Text style={styles.logsHeading}>🚩 {r.reported_name} (reported)</Text>
                {r.reported_logs.length === 0 ? (
                  <Text style={styles.logsEmpty}>No recent messages</Text>
                ) : (
                  r.reported_logs.map((m, i) => (
                    <View key={`rd-${i}`} style={styles.logLine}>
                      <Text style={styles.logTime}>{(m.created_at || "").slice(11, 16)}</Text>
                      <Text style={styles.logText}>{m.text}</Text>
                    </View>
                  ))
                )}
                <Text style={[styles.logsHeading, { marginTop: spacing.md }]}>👤 {r.reporter_name} (reporter)</Text>
                {r.reporter_logs.length === 0 ? (
                  <Text style={styles.logsEmpty}>No recent messages</Text>
                ) : (
                  r.reporter_logs.map((m, i) => (
                    <View key={`rp-${i}`} style={styles.logLine}>
                      <Text style={styles.logTime}>{(m.created_at || "").slice(11, 16)}</Text>
                      <Text style={styles.logText}>{m.text}</Text>
                    </View>
                  ))
                )}
              </View>
            )}
            <View style={styles.reportActions}>
              {!r.reported_banned && (
                <Pressable
                  testID={`admin-report-ban-${r.id}`}
                  onPress={() => onBan(true, r.reported_device_id)}
                  style={[styles.reportBtn, { backgroundColor: colors.error }]}
                >
                  <MaterialCommunityIcons name="hammer" size={14} color="#fff" />
                  <Text style={styles.reportBtnText}>Ban player</Text>
                </Pressable>
              )}
              {!r.resolved && (
                <Pressable
                  testID={`admin-report-resolve-${r.id}`}
                  onPress={() => onResolve(r.id)}
                  style={[styles.reportBtn, { backgroundColor: colors.brandSecondary }]}
                >
                  <MaterialCommunityIcons name="check" size={14} color={colors.onBrandSecondary} />
                  <Text style={[styles.reportBtnText, { color: colors.onBrandSecondary }]}>Resolve</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}

        </>
        )}

        {tab === "store" && (
        <>
        {/* All purchases log */}
        <Text style={styles.section}>🧾 All Purchases</Text>
        <Text style={styles.saleHintText} testID="admin-purchases-summary">
          Total revenue: {revenueLabel} · Admin grants: {grantCount}
        </Text>

        {/* Filters */}
        <View style={styles.purchFilterRow}>
          <TextInput
            testID="admin-purchases-search"
            value={purchSearch}
            onChangeText={setPurchSearch}
            placeholder="Search by UUID"
            placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="none"
            style={[styles.input, styles.purchFilterInput]}
          />
        </View>
        <View style={styles.purchFilterRow}>
          <TextInput
            testID="admin-purchases-from"
            value={purchFrom}
            onChangeText={setPurchFrom}
            placeholder="From (YYYY-MM-DD)"
            placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="none"
            style={[styles.input, styles.purchFilterInput]}
          />
          <TextInput
            testID="admin-purchases-to"
            value={purchTo}
            onChangeText={setPurchTo}
            placeholder="To (YYYY-MM-DD)"
            placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="none"
            style={[styles.input, styles.purchFilterInput]}
          />
        </View>
        <View style={styles.purchFilterRow}>
          {(["all", "purchase", "admin_grant"] as const).map((s) => (
            <Pressable
              key={s}
              testID={`admin-purchases-source-${s}`}
              onPress={() => setPurchSource(s)}
              style={[styles.purchPill, purchSource === s && styles.purchPillActive]}
            >
              <Text style={[styles.purchPillText, purchSource === s && styles.purchPillTextActive]}>
                {s === "all" ? "All" : s === "purchase" ? "Paid" : "Grants"}
              </Text>
            </Pressable>
          ))}
          <Pressable
            testID="admin-purchases-clear"
            onPress={() => { setPurchSearch(""); setPurchFrom(""); setPurchTo(""); setPurchSource("all"); }}
            style={[styles.purchPill, { marginLeft: "auto" }]}
          >
            <Text style={styles.purchPillText}>Clear</Text>
          </Pressable>
          <Pressable
            testID="admin-purchases-export-csv"
            onPress={onExportPurchasesCsv}
            disabled={purchExporting}
            style={[styles.saleApply, purchExporting && { opacity: 0.6 }]}
          >
            <Text style={styles.saleApplyText}>{purchExporting ? "Exporting…" : "Export CSV"}</Text>
          </Pressable>
        </View>

        {purchases.length === 0 ? (
          <Text style={styles.saleHintText} testID="admin-purchases-empty">No purchases match these filters.</Text>
        ) : null}
        {purchases.map((p) => (
          <View key={p.id} testID={`admin-purchase-${p.id}`} style={styles.saleCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.saleName} numberOfLines={1}>{p.pack_name}</Text>
              <Text style={styles.saleHintText} selectable numberOfLines={1} testID={`admin-purchase-uuid-${p.id}`}>
                UUID: {p.device_id}
              </Text>
              <Text style={styles.saleHintText}>
                {p.source === "admin_grant" ? "Admin grant" : p.provider.replace("_", " ")} · {new Date(p.paid_at).toLocaleString()}
              </Text>
            </View>
            <Text
              style={[styles.saleNew, p.source === "admin_grant" && { color: colors.onSurfaceTertiary }]}
              testID={`admin-purchase-amount-${p.id}`}
            >
              {p.amount_label}
            </Text>
          </View>
        ))}

        {/* Real-money sales */}
        <Text style={styles.section}>🏷️ Real-Money Sales</Text>
        <Text style={styles.saleHint}>Put any paid item on sale. Discount applies to the live Google Pay price.</Text>
        {sales.map((it) => (
          <View key={it.id} testID={`admin-sale-${it.id}`} style={styles.saleCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.saleName}>{it.name}</Text>
              <Text style={styles.salePrice}>
                {it.on_sale ? (
                  <>
                    <Text style={styles.saleOld}>{it.base_price}</Text>
                    {"  "}
                    <Text style={styles.saleNew}>{it.final_price} ({it.discount_pct}% off)</Text>
                  </>
                ) : (
                  it.base_price
                )}
              </Text>
            </View>
            <TextInput
              testID={`admin-sale-input-${it.id}`}
              value={saleInputs[it.id] ?? ""}
              onChangeText={(t) => setSaleInputs((p) => ({ ...p, [it.id]: t.replace(/[^0-9]/g, "") }))}
              placeholder="%"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="number-pad"
              maxLength={2}
              style={styles.saleInput}
            />
            <Pressable testID={`admin-sale-apply-${it.id}`} onPress={() => onSetSale(it.id)} style={styles.saleApply}>
              <Text style={styles.saleApplyText}>Set</Text>
            </Pressable>
            {it.on_sale && (
              <Pressable testID={`admin-sale-clear-${it.id}`} onPress={() => onClearSale(it.id)} style={styles.saleClear}>
                <MaterialCommunityIcons name="close" size={16} color={colors.error} />
              </Pressable>
            )}
          </View>
        ))}

        {/* Announcement */}
        <Text style={styles.section}>📣 Banner Announcement</Text>
        <TextInput
          testID="admin-announce-input"
          value={announce}
          onChangeText={setAnnounce}
          placeholder="Message shown to all players"
          placeholderTextColor={colors.onSurfaceTertiary}
          style={styles.input}
          maxLength={200}
        />
        <View style={styles.row}>
          <Pressable testID="admin-announce-publish" onPress={() => onAnnounce(true)} style={[styles.btn, { backgroundColor: colors.brandPrimary }]}>
            <Text style={styles.btnText}>Publish</Text>
          </Pressable>
          <Pressable testID="admin-announce-clear" onPress={() => onAnnounce(false)} style={[styles.btn, { backgroundColor: colors.surfaceTertiary }]}>
            <Text style={[styles.btnText, { color: colors.onSurface }]}>Clear</Text>
          </Pressable>
        </View>

        {/* Promo codes */}
        <Text style={styles.section}>🎟️ Promo Codes</Text>
        <TextInput
          testID="admin-promo-code"
          value={promoCode}
          onChangeText={(t) => setPromoCode(t.toUpperCase())}
          placeholder="CODE (e.g. WELCOME)"
          placeholderTextColor={colors.onSurfaceTertiary}
          autoCapitalize="characters"
          style={styles.input}
          maxLength={24}
        />
        <View style={styles.row}>
          <TextInput
            testID="admin-promo-gems"
            value={promoGems}
            onChangeText={setPromoGems}
            placeholder="Gems"
            placeholderTextColor={colors.onSurfaceTertiary}
            keyboardType="number-pad"
            style={[styles.input, { flex: 1 }]}
          />
          <TextInput
            testID="admin-promo-max"
            value={promoMax}
            onChangeText={setPromoMax}
            placeholder="Max uses (0=∞)"
            placeholderTextColor={colors.onSurfaceTertiary}
            keyboardType="number-pad"
            style={[styles.input, { flex: 1 }]}
          />
        </View>
        <Pressable testID="admin-promo-create" onPress={onCreatePromo} style={[styles.btn, { backgroundColor: colors.brandTertiary }]}>
          <Text style={[styles.btnText, { color: colors.onBrandTertiary }]}>Create Code</Text>
        </Pressable>
        {codes.map((c) => (
          <View key={c.code} style={styles.listRow}>
            <Text style={styles.listMain}>{c.code}</Text>
            <Text style={styles.listSub}>{c.gems} gems · {c.uses}/{c.max_uses || "∞"} used</Text>
          </View>
        ))}

        </>
        )}

        {tab === "economy" && (
        <>
        {/* Grant stats */}
        <Text style={styles.section}>💰 Grant Stats to Player</Text>
        <TextInput
          testID="admin-grant-id"
          value={grantId}
          onChangeText={setGrantId}
          placeholder="Player UUID"
          placeholderTextColor={colors.onSurfaceTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <View style={styles.row}>
          <TextInput
            testID="admin-grant-gems"
            value={grantGems}
            onChangeText={setGrantGems}
            placeholder="Gems"
            placeholderTextColor={colors.onSurfaceTertiary}
            keyboardType="number-pad"
            style={[styles.input, { flex: 1 }]}
          />
          <TextInput
            testID="admin-grant-investors"
            value={grantInv}
            onChangeText={setGrantInv}
            placeholder="Investors"
            placeholderTextColor={colors.onSurfaceTertiary}
            keyboardType="number-pad"
            style={[styles.input, { flex: 1 }]}
          />
        </View>
        <Pressable testID="admin-grant-submit" onPress={onGrant} style={[styles.btn, { backgroundColor: colors.brandSecondary }]}>
          <Text style={[styles.btnText, { color: colors.onBrandSecondary }]}>Grant</Text>
        </Pressable>

        {/* Execute (gift) any paid Package to a player by UUID */}
        <Text style={styles.section}>🎁 Execute Package for Player</Text>
        <Text style={styles.sectionHint}>
          Sends the entire contents of any paid package (gems, investors, loot keys, remove-ads)
          straight into the player&apos;s account. They&apos;ll see it as a toast on their next sync.
        </Text>
        <TextInput
          testID="admin-pkg-uuid"
          value={pkgId}
          onChangeText={setPkgId}
          placeholder="Player UUID"
          placeholderTextColor={colors.onSurfaceTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.sectionHint}>Package</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xs }}
        >
          {sales.map((item) => {
            const active = pkgPackId === item.id;
            return (
              <Pressable
                key={item.id}
                testID={`admin-pkg-pick-${item.id}`}
                onPress={() => {
                  haptic("light");
                  setPkgPackId(item.id);
                }}
                style={[
                  styles.pkgChip,
                  {
                    backgroundColor: active ? colors.brandPrimary : colors.surfaceTertiary,
                    borderColor: active ? colors.brandPrimary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pkgChipText,
                    { color: active ? colors.onBrandPrimary : colors.onSurface },
                  ]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Text
                  style={[
                    styles.pkgChipPrice,
                    { color: active ? colors.onBrandPrimary : colors.onSurfaceTertiary },
                  ]}
                >
                  {item.final_price}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          testID="admin-pkg-execute"
          disabled={pkgBusy || !pkgPackId || !pkgId.trim()}
          onPress={onGrantPackage}
          style={[
            styles.btn,
            {
              backgroundColor:
                pkgBusy || !pkgPackId || !pkgId.trim() ? colors.surfaceTertiary : colors.brandPrimary,
              marginTop: spacing.sm,
            },
          ]}
        >
          {pkgBusy ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>
              Execute Package
            </Text>
          )}
        </Pressable>

        </>
        )}

        {tab === "moderation" && (
        <>
        {/* Bans */}
        <Text style={styles.section}>🔨 Ban Players</Text>
        <View style={styles.row}>
          <TextInput
            testID="admin-ban-id"
            value={banId}
            onChangeText={setBanId}
            placeholder="Player UUID"
            placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable testID="admin-ban-submit" onPress={() => onBan(true)} style={[styles.btn, { backgroundColor: colors.error, paddingHorizontal: spacing.lg }]}>
            <Text style={styles.btnText}>Ban</Text>
          </Pressable>
        </View>
        <Pressable testID="admin-ipban-submit" onPress={() => onIpBan()} style={[styles.btn, { backgroundColor: "#7B1FA2", marginTop: spacing.xs }]}>
          <MaterialCommunityIcons name="account-cancel" size={15} color="#fff" />
          <Text style={[styles.btnText, { marginLeft: 6 }]}>IP Ban (by UUID)</Text>
        </Pressable>
        <Text style={styles.saleHint}>IP ban blocks the player&apos;s last-seen IP from chat and also device-bans them.</Text>
        {bans.map((b) => (
          <View key={b.device_id} style={styles.listRow}>
            <Text style={styles.listMain} numberOfLines={1}>{b.device_id}</Text>
            <Pressable testID={`admin-unban-${b.device_id}`} onPress={() => onBan(false, b.device_id)} style={styles.unbanBtn}>
              <Text style={styles.unbanText}>Unban</Text>
            </Pressable>
          </View>
        ))}
        {bans.length === 0 && <Text style={styles.empty}>No active bans</Text>}

        {/* IP Bans */}
        <Text style={styles.section}>🚫 IP Bans</Text>
        {ipBans.map((b) => (
          <View key={b.ip} testID={`admin-ipban-row-${b.ip}`} style={styles.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listMain} numberOfLines={1}>{b.ip}</Text>
              {!!b.name && <Text style={styles.listSub} numberOfLines={1}>{b.name}</Text>}
            </View>
            <Pressable testID={`admin-ipunban-${b.ip}`} onPress={() => onIpUnban(b.ip)} style={styles.unbanBtn}>
              <Text style={styles.unbanText}>Unban IP</Text>
            </Pressable>
          </View>
        ))}
        {ipBans.length === 0 && <Text style={styles.empty}>No IP bans</Text>}

        {/* Achievements lookup */}
        <Text style={styles.section}>🏅 Player Achievements (by UUID)</Text>
        <View style={styles.row}>
          <TextInput
            testID="admin-ach-id"
            value={achLookupId}
            onChangeText={setAchLookupId}
            placeholder="Player UUID"
            placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable testID="admin-ach-lookup" onPress={onLookupAchievements} style={[styles.btn, { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg }]}>
            <Text style={styles.btnText}>Look up</Text>
          </Pressable>
        </View>
        {achLoading && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.md }} />}
        {achResult && (
          <View style={styles.achCard} testID="admin-ach-result">
            <Text style={styles.achName}>{achResult.name}</Text>
            <Text style={styles.achMeta}>
              {achResult.achievements.length}/{ACHIEVEMENTS.length} unlocked · {achResult.total_levels} total levels
            </Text>
            {achResult.grand_prize && (
              <View style={styles.grandBadge}>
                <MaterialCommunityIcons name="trophy" size={15} color="#3A2A00" />
                <Text style={styles.grandText}>
                  GRAND PRIZE {achResult.grand_prize.is_first ? "· FIRST PLACE ($1,000)" : "· (not first)"}
                </Text>
              </View>
            )}
            {achResult.achievements.length === 0 ? (
              <Text style={styles.empty}>No achievements unlocked yet</Text>
            ) : (
              ACHIEVEMENTS.filter((a) => achResult.achievements.includes(a.id)).map((a) => (
                <View key={a.id} style={styles.achRow}>
                  <MaterialCommunityIcons name={a.icon as any} size={16} color={colors.brandSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.achTitle}>{a.title}</Text>
                    <Text style={styles.achDesc}>{a.desc}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
        </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  navWrap: { backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  navRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  navChip: {
    flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0,
    paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  navChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  navChipText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "800" },
  navChipTextActive: { color: colors.onBrandPrimary },
  navBadge: { backgroundColor: colors.error, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  navBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md },
  denied: { color: colors.onSurfaceTertiary, fontSize: 16, fontWeight: "800" },
  backPill: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill },
  backPillText: { color: colors.onSurface, fontWeight: "800" },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary,
  },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "900" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  content: { padding: spacing.lg, gap: spacing.sm },
  section: { color: colors.onSurface, fontSize: 16, fontWeight: "900", marginTop: spacing.lg, marginBottom: spacing.xs },
  sectionHint: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", marginBottom: spacing.xs },
  pkgChip: {
    flexShrink: 0,
    minWidth: 140,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  pkgChipText: { fontSize: 13, fontWeight: "900" },
  pkgChipPrice: { fontSize: 11, fontWeight: "800", marginTop: 2 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.onSurface, fontSize: 15, fontWeight: "700",
    borderWidth: 1, borderColor: colors.border,
  },
  row: { flexDirection: "row", gap: spacing.sm },
  btn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  listRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm,
  },
  listMain: { color: colors.onSurface, fontSize: 13, fontWeight: "800", flex: 1 },
  listSub: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  achCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  achName: { color: colors.onSurface, fontSize: 16, fontWeight: "900" },
  achMeta: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  grandBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "#FFD700",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  grandText: { color: "#3A2A00", fontSize: 11, fontWeight: "900" },
  achRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  achTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  achDesc: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "600" },
  unbanBtn: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  unbanText: { color: colors.brandSecondary, fontSize: 12, fontWeight: "900" },
  empty: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", textAlign: "center", paddingVertical: spacing.md },
  reportsHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  openBadge: {
    backgroundColor: colors.error,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  openBadgeText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  filterRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  filterChip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterChipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "800" },
  filterChipTextActive: { color: colors.onBrandPrimary },
  saleHint: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", marginBottom: spacing.sm },
  saleHintText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "500" },
  purchFilterRow: { flexDirection: "row", gap: spacing.xs, alignItems: "center", marginTop: spacing.xs, flexWrap: "wrap" },
  purchFilterInput: { flex: 1, marginBottom: 0, minWidth: 120 },
  purchPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.divider },
  purchPillActive: { backgroundColor: colors.brandSecondary + "33", borderColor: colors.brandSecondary },
  purchPillText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  purchPillTextActive: { color: colors.onSurface },
  saleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saleName: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  salePrice: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700", marginTop: 2 },
  saleOld: { color: colors.onSurfaceTertiary, textDecorationLine: "line-through" },
  saleNew: { color: colors.brandSecondary, fontWeight: "900" },
  saleInput: {
    width: 48,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  saleApply: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  saleApplyText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "900" },
  saleClear: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.error + "22",
  },
  reportCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reportResolved: { opacity: 0.6 },
  reportTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  reportTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  reportUuid: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "600", marginTop: 1 },
  reportReason: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600", marginTop: 2 },
  reportMeta: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700" },
  reportActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  expandBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs, paddingVertical: 4 },
  expandText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  logsWrap: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logsHeading: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "900", marginBottom: spacing.xs },
  logsEmpty: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", fontStyle: "italic" },
  logLine: { flexDirection: "row", gap: spacing.sm, paddingVertical: 2 },
  logTime: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", width: 36 },
  logText: { flex: 1, color: colors.onSurface, fontSize: 12, fontWeight: "500" },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  reportBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  openTag: { backgroundColor: colors.error + "26", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  openTagText: { color: colors.error, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  resolvedTag: { backgroundColor: colors.brandSecondary + "26", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  resolvedTagText: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
});
