import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { money } from "@/src/game/format";
import { BUSINESSES, BusinessDef } from "@/src/game/businesses";
import { PRO_BOOST_MULT, proBoostCost } from "@/src/game/gems";
import { EMP_MAX, employeeCost } from "@/src/game/employees";
import { useGame } from "@/src/game/GameContext";
import { useOffers } from "@/src/game/OffersProvider";
import { haptic } from "@/src/game/haptics";

function ManagerCard({ def }: { def: BusinessDef }) {
  const { state, hireManager, buyProBoost, hireEmployee } = useGame();
  const { discountFor } = useOffers();
  const b = state?.businesses[def.id];
  const owned = (b?.level ?? 0) > 0;
  const hired = b?.hasManager ?? false;
  const cash = state?.cash ?? 0;
  const gems = state?.gems ?? 0;
  const isPro = !!state?.proBoosts[def.id];
  const proDiscount = discountFor("proboost");
  const proIndex = BUSINESSES.findIndex((x) => x.id === def.id);
  const proBase = proBoostCost(proIndex);
  const proCost = proDiscount > 0 ? Math.max(1, Math.ceil(proBase * (1 - proDiscount))) : proBase;
  const affordable = cash >= def.managerCost && owned && !hired;
  const proAffordable = gems >= proCost && owned && !isPro;

  const empCount = state?.employees[def.id] ?? 0;
  const empCost = employeeCost(def.managerCost, empCount);
  const empMaxed = empCount >= EMP_MAX;
  const empAffordable = owned && cash >= empCost && !empMaxed;

  const initials = def.managerName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const onHire = () => {
    if (!affordable) return;
    haptic("heavy");
    hireManager(def.id);
  };

  return (
    <View style={[styles.card, hired && { borderColor: colors.brandSecondary }]}>
      <View style={[styles.avatar, { backgroundColor: def.color + "26" }]}>
        <Text style={[styles.initials, { color: def.color }]}>{initials}</Text>
      </View>
      <Text style={styles.managerName} numberOfLines={1}>
        {def.managerName}
      </Text>
      <Text style={styles.assigned} numberOfLines={1}>
        Runs {def.name}
      </Text>
      <View style={styles.effectRow}>
        <MaterialCommunityIcons name="robot" size={13} color={colors.brandSecondary} />
        <Text style={styles.effect}>Automates income</Text>
      </View>

      {hired ? (
        <View style={[styles.cta, styles.ctaHired]}>
          <MaterialCommunityIcons name="check-bold" size={16} color={colors.brandSecondary} />
          <Text style={[styles.ctaText, { color: colors.brandSecondary }]}>HIRED</Text>
        </View>
      ) : (
        <Pressable
          testID={`hire-manager-${def.id}`}
          onPress={onHire}
          disabled={!affordable}
          style={[
            styles.cta,
            { backgroundColor: affordable ? colors.brandPrimary : colors.surfaceTertiary },
          ]}
        >
          <Text
            style={[
              styles.ctaText,
              { color: affordable ? colors.onBrandPrimary : colors.onSurfaceTertiary },
            ]}
            numberOfLines={1}
          >
            {owned ? money(def.managerCost) : "Locked"}
          </Text>
        </Pressable>
      )}

      {owned &&
        (isPro ? (
          <View style={[styles.proBtn, { backgroundColor: colors.brandTertiary + "1F" }]}>
            <MaterialCommunityIcons name="diamond-stone" size={13} color={colors.brandTertiary} />
            <Text style={[styles.proText, { color: colors.brandTertiary }]}>
              PRO x{PRO_BOOST_MULT}
            </Text>
          </View>
        ) : (
          <Pressable
            testID={`pro-boost-${def.id}`}
            onPress={() => {
              if (proAffordable) {
                haptic("heavy");
                buyProBoost(def.id, proCost);
              }
            }}
            disabled={!proAffordable}
            style={[
              styles.proBtn,
              { backgroundColor: proAffordable ? colors.brandTertiary : colors.surfaceTertiary },
            ]}
          >
            <MaterialCommunityIcons
              name="diamond-stone"
              size={13}
              color={proAffordable ? colors.onBrandTertiary : colors.onSurfaceTertiary}
            />
            <Text
              style={[
                styles.proText,
                { color: proAffordable ? colors.onBrandTertiary : colors.onSurfaceTertiary },
              ]}
            >
              Pro x{PRO_BOOST_MULT} · {proCost}
              {proDiscount > 0 ? " (50% off)" : ""}
            </Text>
          </Pressable>
        ))}

      {owned && (
        <Pressable
          testID={`hire-employee-${def.id}`}
          onPress={() => {
            if (empAffordable) {
              haptic("medium");
              hireEmployee(def.id);
            }
          }}
          disabled={!empAffordable}
          style={[
            styles.empBtn,
            { backgroundColor: empAffordable ? colors.brandSecondary + "1F" : colors.surfaceTertiary },
          ]}
        >
          <MaterialCommunityIcons
            name="account-hard-hat"
            size={13}
            color={empMaxed ? colors.brandSecondary : empAffordable ? colors.brandSecondary : colors.onSurfaceTertiary}
          />
          <Text
            style={[
              styles.empText,
              { color: empAffordable || empMaxed ? colors.brandSecondary : colors.onSurfaceTertiary },
            ]}
            numberOfLines={1}
          >
            {empMaxed ? `Staff ${empCount}/${EMP_MAX} MAX` : `Staff ${empCount}/${EMP_MAX} · ${money(empCost)}`}
          </Text>
        </Pressable>
      )}
      {empCount > 0 && (
        <Text style={styles.empBoost}>
          +{empCount * 10}% income · +{empCount * 4}% speed
        </Text>
      )}
    </View>
  );
}

export default function ManagersScreen() {
  return <ManagersList />;
}

export function ManagersList() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={[
        styles.grid,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {BUSINESSES.map((def) => (
        <View key={def.id} style={styles.cell}>
          <ManagerCard def={def} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "900" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", marginTop: 2 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: spacing.md,
    gap: spacing.md,
  },
  cell: { width: "47.5%", flexGrow: 1 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  initials: { fontSize: 20, fontWeight: "900" },
  managerName: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  assigned: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  effectRow: { flexDirection: "row", alignItems: "center", gap: 4, marginVertical: spacing.xs },
  effect: { color: colors.brandSecondary, fontSize: 11, fontWeight: "700" },
  cta: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.xs,
  },
  ctaHired: { backgroundColor: colors.brandSecondary + "1F" },
  ctaText: { fontSize: 14, fontWeight: "900" },
  proBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginTop: spacing.xs,
  },
  proText: { fontSize: 12, fontWeight: "900" },
  empBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginTop: spacing.xs,
  },
  empText: { fontSize: 11, fontWeight: "900" },
  empBoost: { color: colors.brandSecondary, fontSize: 10, fontWeight: "800", marginTop: 2 },
});
