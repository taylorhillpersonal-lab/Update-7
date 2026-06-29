import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { money, abbreviate } from "@/src/game/format";
import { fetchLeaderboard, LeaderboardEntry, LeaderboardMetric } from "@/src/game/api";
import { useGame } from "@/src/game/GameContext";
import { useReport } from "@/src/game/ReportProvider";

const MEDALS: Record<number, string> = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" };

const TABS: { key: LeaderboardMetric; label: string; icon: string }[] = [
  { key: "cash", label: "Cash", icon: "cash" },
  { key: "gems", label: "Gems", icon: "diamond-stone" },
  { key: "investors", label: "Investors", icon: "account-cash" },
];

function valueFor(metric: LeaderboardMetric, e: LeaderboardEntry): string {
  if (metric === "gems") return abbreviate(e.gems);
  if (metric === "investors") return `${e.prestige_points} investors`;
  if (metric === "levels") return `${e.total_levels} lv`;
  return money(e.cash);
}

export default function LeaderboardScreen() {
  const { state, syncNow } = useGame();
  const { report } = useReport();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [metric, setMetric] = useState<LeaderboardMetric>("cash");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [me, setMe] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (m: LeaderboardMetric) => {
      setError(false);
      try {
        syncNow();
        const data = await fetchLeaderboard(m, state?.deviceId);
        setEntries(data.entries);
        setMe(data.me);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [syncNow, state?.deviceId],
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(metric);
    }, [load, metric]),
  );

  const switchMetric = (m: LeaderboardMetric) => {
    if (m === metric) return;
    setMetric(m);
    setLoading(true);
    load(m);
  };

  const renderItem = ({ item }: { item: LeaderboardEntry }) => {
    const isMe = item.device_id === state?.deviceId;
    const medal = MEDALS[item.rank];
    return (
      <View testID={`leaderboard-row-${item.rank}`} style={[styles.row, isMe && styles.rowMe]}>
        <View style={styles.rankWrap}>
          {medal ? (
            <MaterialCommunityIcons name="medal" size={26} color={medal} />
          ) : (
            <Text style={styles.rank}>{item.rank}</Text>
          )}
        </View>
        <View style={styles.nameWrap}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
            {isMe ? "  (You)" : ""}
          </Text>
          <Text style={styles.investors}>{item.prestige_points} investors</Text>
        </View>
        <Text style={styles.worth}>{valueFor(metric, item)}</Text>
        {!isMe && (
          <Pressable
            testID={`leaderboard-report-${item.device_id}`}
            onPress={() => report(item.device_id, item.name)}
            hitSlop={8}
            style={styles.reportIcon}
          >
            <MaterialCommunityIcons name="flag-outline" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container} testID="leaderboard-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="leaderboard-back" onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View>
          <Text style={styles.title}>Top Tycoons</Text>
          <Text style={styles.subtitle}>Compete across three boards</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = t.key === metric;
          return (
            <Pressable
              key={t.key}
              testID={`leaderboard-tab-${t.key}`}
              onPress={() => switchMetric(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <MaterialCommunityIcons
                name={t.icon as any}
                size={16}
                color={active ? colors.onBrandPrimary : colors.onSurfaceTertiary}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Pinned "you" banner */}
      {me && (
        <View style={styles.meBanner} testID="leaderboard-me">
          <View style={styles.meRank}>
            <Text style={styles.meRankText}>#{me.rank}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.meName} numberOfLines={1}>
              {me.name} (You)
            </Text>
            <Text style={styles.meSub}>Your position on this board</Text>
          </View>
          <Text style={styles.meValue}>{valueFor(metric, me)}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="cloud-off-outline" size={48} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Couldn&apos;t load rankings</Text>
          <Pressable testID="leaderboard-retry" onPress={() => load(metric)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.device_id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xxl }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={() => load(metric)} tintColor={colors.brandPrimary} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <MaterialCommunityIcons name="trophy-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No tycoons yet. Be the first!</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "900" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", marginTop: 2 },
  tabs: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "800" },
  tabTextActive: { color: colors.onBrandPrimary },
  meBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary + "1A",
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  meRank: {
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
  },
  meRankText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "900" },
  meName: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  meSub: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  meValue: { color: colors.brandPrimary, fontSize: 16, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingTop: spacing.xxxl },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 15, fontWeight: "700" },
  retryBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  retryText: { color: colors.onBrandPrimary, fontWeight: "900" },
  list: { padding: spacing.lg, gap: spacing.sm, paddingTop: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowMe: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "14" },
  rankWrap: { width: 36, alignItems: "center" },
  rank: { color: colors.onSurfaceTertiary, fontSize: 18, fontWeight: "900" },
  nameWrap: { flex: 1, gap: 2 },
  name: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  investors: { color: colors.brandTertiary, fontSize: 12, fontWeight: "700" },
  worth: { color: colors.brandSecondary, fontSize: 16, fontWeight: "900" },
  reportIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
});
