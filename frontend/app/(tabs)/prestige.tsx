import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { money, abbreviate } from "@/src/game/format";
import {
  PRESTIGE_BONUS_PER_POINT,
  PRESTIGE_UNLOCK,
} from "@/src/game/businesses";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";

export default function PrestigeScreen() {
  return <PrestigeBody />;
}

export function PrestigeBody() {
  const { state, prestigePending, doPrestige } = useGame();
  const insets = useSafeAreaInsets();
  const [confirm, setConfirm] = useState(false);

  if (!state) return <View style={styles.container} />;

  const currentBonus = Math.round(state.prestigePoints * PRESTIGE_BONUS_PER_POINT * 100);
  const nextPoints = state.prestigePoints + prestigePending;
  const nextBonus = Math.round(nextPoints * PRESTIGE_BONUS_PER_POINT * 100);
  const eligible = prestigePending > 0;
  const progress = Math.min(1, state.earningsSincePrestige / PRESTIGE_UNLOCK);

  const onConfirm = () => {
    haptic("success");
    doPrestige();
    setConfirm(false);
  };

  return (
    <View style={styles.container} testID="prestige-screen">
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.diamondCircle}>
          <MaterialCommunityIcons name="diamond-stone" size={56} color={colors.brandTertiary} />
        </View>
        <Text style={styles.title}>Prestige</Text>
        <Text style={styles.subtitle}>
          Reset your empire to gain permanent income multipliers
        </Text>

        <View style={styles.statsCard}>
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>CURRENT</Text>
            <Text style={styles.statValue}>+{currentBonus}%</Text>
            <Text style={styles.statSub}>{state.prestigePoints} investors</Text>
          </View>
          <MaterialCommunityIcons name="arrow-right-bold" size={28} color={colors.brandPrimary} />
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>AFTER RESET</Text>
            <Text style={[styles.statValue, { color: colors.brandSecondary }]}>+{nextBonus}%</Text>
            <Text style={styles.statSub}>{nextPoints} investors</Text>
          </View>
        </View>

        <View style={styles.gainCard}>
          <Text style={styles.gainLabel}>You will earn</Text>
          <Text style={styles.gainValue}>+{prestigePending} investors</Text>
          {!eligible && (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
              <Text style={styles.gainHint}>
                Earn {money(PRESTIGE_UNLOCK)} this run to unlock (
                {abbreviate(state.earningsSincePrestige)} so far)
              </Text>
            </>
          )}
        </View>

        <View style={styles.infoBox}>
          <MaterialCommunityIcons name="information-outline" size={16} color={colors.onSurfaceTertiary} />
          <Text style={styles.infoText}>
            Resets cash, business levels & managers. Investors and their +2% bonus
            each are kept forever.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          testID="prestige-button"
          disabled={!eligible}
          onPress={() => {
            haptic("medium");
            setConfirm(true);
          }}
          style={styles.prestigeBtn}
        >
          <LinearGradient
            colors={eligible ? [colors.brandTertiary, "#D84315"] : [colors.surfaceTertiary, colors.surfaceTertiary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradient}
          >
            <MaterialCommunityIcons
              name="restart"
              size={20}
              color={eligible ? colors.onBrandTertiary : colors.onSurfaceTertiary}
            />
            <Text
              style={[
                styles.prestigeText,
                { color: eligible ? colors.onBrandTertiary : colors.onSurfaceTertiary },
              ]}
            >
              {eligible ? "PRESTIGE NOW" : "NOT ENOUGH EARNINGS"}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>

      <Modal visible={confirm} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.confirmSheet}>
            <Text style={styles.confirmTitle}>Reset Empire?</Text>
            <Text style={styles.confirmText}>
              You&apos;ll restart from scratch but gain {prestigePending} investors
              (+{prestigePending * 2}% permanent income).
            </Text>
            <View style={styles.confirmRow}>
              <Pressable
                testID="prestige-cancel"
                onPress={() => setConfirm(false)}
                style={[styles.confirmBtn, { backgroundColor: colors.surfaceTertiary }]}
              >
                <Text style={[styles.confirmBtnText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="prestige-confirm"
                onPress={onConfirm}
                style={[styles.confirmBtn, { backgroundColor: colors.brandTertiary }]}
              >
                <Text style={[styles.confirmBtnText, { color: colors.onBrandTertiary }]}>
                  Confirm
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, alignItems: "center" },
  diamondCircle: {
    width: 110,
    height: 110,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary + "1A",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontSize: 32, fontWeight: "900" },
  subtitle: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  statsCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statCol: { alignItems: "center", flex: 1, gap: 2 },
  statLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  statValue: { color: colors.brandPrimary, fontSize: 28, fontWeight: "900" },
  statSub: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  gainCard: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  gainLabel: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
  gainValue: { color: colors.brandSecondary, fontSize: 26, fontWeight: "900" },
  progressTrack: {
    width: "100%",
    height: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  progressFill: { height: 10, backgroundColor: colors.brandTertiary, borderRadius: radius.pill },
  gainHint: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", textAlign: "center" },
  infoBox: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    width: "100%",
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", flex: 1, lineHeight: 18 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  prestigeBtn: { borderRadius: radius.pill, overflow: "hidden" },
  gradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  prestigeText: { fontSize: 17, fontWeight: "900", letterSpacing: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  confirmSheet: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmTitle: { color: colors.onSurface, fontSize: 22, fontWeight: "900", textAlign: "center" },
  confirmText: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginVertical: spacing.md,
    lineHeight: 20,
  },
  confirmRow: { flexDirection: "row", gap: spacing.md },
  confirmBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  confirmBtnText: { fontSize: 15, fontWeight: "900" },
});
