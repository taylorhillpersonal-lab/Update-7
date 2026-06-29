import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { colors, radius, spacing } from "@/src/game/theme";
import { money, abbreviate } from "@/src/game/format";
import { useGame, BuyAmount } from "@/src/game/GameContext";
import { PRESTIGE_BONUS_PER_POINT } from "@/src/game/businesses";
import { LEVEL_MAX, xpToNext } from "@/src/game/levels";
import SettingsSheet from "@/src/audio/SettingsSheet";

const AMOUNTS: BuyAmount[] = [1, 10, 100, "max"];

export default function CurrencyHud({ topInset }: { topInset: number }) {
  const { state, incomePerSec, buyAmount, setBuyAmount } = useGame();
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!state) return null;

  const bonusPct = Math.round(state.prestigePoints * PRESTIGE_BONUS_PER_POINT * 100);
  const boostMs = Math.max(0, state.boostUntil - Date.now());
  const boostActive = boostMs > 0;
  const bm = Math.floor(boostMs / 60000);
  const bs = Math.floor((boostMs % 60000) / 1000);
  const level = state.level ?? 1;
  const xpPct = level >= LEVEL_MAX ? 1 : Math.min(1, (state.xp ?? 0) / xpToNext(level));

  return (
    <BlurView
      intensity={Platform.OS === "ios" ? 40 : 60}
      tint="dark"
      style={[styles.container, { paddingTop: topInset + spacing.sm }]}
    >
      <View style={styles.topRow}>
        <View style={styles.cashBlock}>
          <Text testID="hud-cash" style={styles.cash}>
            {money(state.cash)}
          </Text>
          <View style={styles.incomeRow}>
            <MaterialCommunityIcons
              name="chart-line-variant"
              size={13}
              color={colors.brandSecondary}
            />
            <Text testID="hud-income" style={styles.income}>
              {money(incomePerSec)}/sec
            </Text>
          </View>
        </View>
        <View style={styles.rightGroup}>
          <View style={styles.rightRow}>
            <Pressable
              testID="hud-settings"
              onPress={() => setSettingsOpen(true)}
              style={styles.iconBtn}
            >
              <MaterialCommunityIcons name="cog" size={16} color={colors.brandSecondary} />
            </Pressable>
            <Pressable testID="hud-chat" onPress={() => router.push("/chat" as any)} style={styles.iconBtn}>
              <MaterialCommunityIcons name="chat" size={16} color={colors.brandSecondary} />
            </Pressable>
            <Pressable testID="hud-level" onPress={() => router.push("/profile" as any)} style={styles.levelPill}>
              <MaterialCommunityIcons name="star-four-points" size={11} color={colors.brandTertiary} />
              <Text style={styles.levelText}>LV {level}</Text>
              <View style={styles.xpMini}>
                <View style={[styles.xpMiniFill, { width: `${Math.round(xpPct * 100)}%` }]} />
              </View>
            </Pressable>
          </View>
          <View style={styles.rightRow}>
            <Pressable testID="hud-gems" onPress={() => router.push("/shop")} style={styles.gemPill}>
              <MaterialCommunityIcons name="diamond-stone" size={14} color={colors.brandTertiary} />
              <Text style={styles.gemText}>{abbreviate(state.gems)}</Text>
            </Pressable>
            <Pressable testID="hud-keys" onPress={() => router.push("/shop")} style={styles.keyPill}>
              <MaterialCommunityIcons name="key-variant" size={14} color="#FFD54A" />
              <Text style={styles.keyText}>{abbreviate(state.keys ?? 0)}</Text>
            </Pressable>
          </View>
          {(boostActive || state.prestigePoints > 0) && (
            <View style={styles.rightRow}>
              {boostActive && (
                <View style={styles.boostPill} testID="hud-boost">
                  <MaterialCommunityIcons name="rocket-launch" size={13} color={colors.brandPrimary} />
                  <Text style={styles.boostText}>
                    2x {bm}:{bs.toString().padStart(2, "0")}
                  </Text>
                </View>
              )}
              {state.prestigePoints > 0 && (
                <View style={styles.prestigePill}>
                  <MaterialCommunityIcons name="chart-line" size={13} color={colors.brandSecondary} />
                  <Text style={styles.prestigeText}>+{bonusPct}%</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      <View style={styles.buyRow}>
        <Text style={styles.buyLabel}>BUY</Text>
        {AMOUNTS.map((a) => {
          const active = buyAmount === a;
          return (
            <Pressable
              key={String(a)}
              testID={`buy-amount-${a}`}
              onPress={() => setBuyAmount(a)}
              style={[styles.amountChip, active && styles.amountChipActive]}
            >
              <Text style={[styles.amountText, active && styles.amountTextActive]}>
                {a === "max" ? "MAX" : `x${a}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "rgba(24,26,24,0.6)",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cashBlock: {
    gap: 2,
  },
  cash: {
    color: colors.onSurface,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  incomeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  income: {
    color: colors.brandSecondary,
    fontSize: 14,
    fontWeight: "800",
  },
  prestigePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandSecondary + "22",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  prestigeText: {
    color: colors.brandSecondary,
    fontSize: 14,
    fontWeight: "900",
  },
  rightGroup: {
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  gemPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandTertiary + "22",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  gemText: {
    color: colors.brandTertiary,
    fontSize: 14,
    fontWeight: "900",
  },
  keyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFD54A22",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  keyText: {
    color: "#FFD54A",
    fontSize: 14,
    fontWeight: "900",
  },
  levelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandTertiary + "22",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  levelText: {
    color: colors.brandTertiary,
    fontSize: 13,
    fontWeight: "900",
  },
  xpMini: {
    width: 34,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  xpMiniFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: colors.brandTertiary,
  },
  rightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary + "22",
    alignItems: "center",
    justifyContent: "center",
  },
  boostPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandPrimary + "22",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  boostText: {
    color: colors.brandPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
  buyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  buyLabel: {
    color: colors.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginRight: spacing.xs,
  },
  amountChip: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  amountChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  amountText: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "800",
  },
  amountTextActive: {
    color: colors.onBrandPrimary,
  },
});
