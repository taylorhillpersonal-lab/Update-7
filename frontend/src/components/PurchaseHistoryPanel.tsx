import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, radius, spacing } from "@/src/game/theme";
import { fetchPurchaseHistory, PurchaseEntry } from "@/src/game/api";

function relTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function rewardLine(p: PurchaseEntry): string {
  const bits: string[] = [];
  if (p.gems) bits.push(`💎 +${p.gems}`);
  if (p.investors) bits.push(`👥 +${p.investors}`);
  if (p.keys) bits.push(`🔑 +${p.keys}`);
  if (p.remove_ads) bits.push(`🚫 No Ads`);
  return bits.join("  ");
}

export default function PurchaseHistoryPanel({ deviceId }: { deviceId?: string }) {
  const [items, setItems] = useState<PurchaseEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    setErr(null);
    try {
      const list = await fetchPurchaseHistory(deviceId);
      setItems(list);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.wrap} testID="purchase-history-panel">
      <View style={styles.head}>
        <MaterialCommunityIcons name="receipt" size={18} color={colors.brandSecondary} />
        <Text style={styles.title}>Purchased Content</Text>
        <Pressable testID="purchase-history-refresh" onPress={load} disabled={loading} hitSlop={8} style={styles.refresh}>
          {loading ? <ActivityIndicator size="small" /> : <MaterialCommunityIcons name="refresh" size={18} color={colors.brandSecondary} />}
        </Pressable>
      </View>
      {err && <Text style={styles.err}>{err}</Text>}
      {items && items.length === 0 && !err && (
        <Text style={styles.empty} testID="purchase-history-empty">No purchases yet.</Text>
      )}
      {items && items.map((p) => {
        const isGrant = p.source === "admin_grant";
        return (
          <View key={p.id} style={styles.row} testID={`purchase-row-${p.id}`}>
            <View style={styles.rowMain}>
              <Text style={styles.name} numberOfLines={1}>{p.pack_name}</Text>
              <Text style={styles.sub}>{rewardLine(p) || "—"}</Text>
              <Text style={styles.meta}>{relTime(p.paid_at)} · {isGrant ? "Admin grant" : p.provider.replace("_", " ")}</Text>
            </View>
            <View style={[styles.priceBubble, isGrant && styles.priceBubbleGrant]}>
              <Text style={[styles.price, isGrant && styles.priceGrant]} testID={`purchase-amount-${p.id}`}>
                {p.amount_label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md, gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: colors.onSurface, fontWeight: "700", fontSize: 16 },
  refresh: { padding: 4 },
  empty: { color: colors.onSurfaceTertiary, fontSize: 13 },
  err: { color: colors.error, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  rowMain: { flex: 1, gap: 2 },
  name: { color: colors.onSurface, fontWeight: "600", fontSize: 14 },
  sub: { color: colors.onSurfaceTertiary, fontSize: 12 },
  meta: { color: colors.onSurfaceTertiary, fontSize: 11, opacity: 0.8 },
  priceBubble: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.brandSecondary + "22" },
  priceBubbleGrant: { backgroundColor: "#6c5ce722" },
  price: { color: colors.brandSecondary, fontWeight: "700", fontSize: 13 },
  priceGrant: { color: "#a29bfe" },
});
