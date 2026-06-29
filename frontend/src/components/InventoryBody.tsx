import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { abbreviate, money } from "@/src/game/format";
import { BUSINESSES } from "@/src/game/businesses";
import { GEM_UPGRADES } from "@/src/game/gems";
import { EQUIPMENT_MAP, SLOT_META, equipmentMultiplier } from "@/src/game/equipment";
import { useGame } from "@/src/game/GameContext";

type ResourceTile = {
  id: string;
  label: string;
  value: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
};

export default function InventoryBody() {
  const { state } = useGame();
  const insets = useSafeAreaInsets();

  if (!state) return <View style={styles.container} />;

  const tiles: ResourceTile[] = [
    { id: "cash", label: "Cash", value: money(state.cash), icon: "cash", color: "#2ECC71" },
    { id: "gems", label: "Gems", value: abbreviate(state.gems), icon: "diamond-stone", color: "#E91E63" },
    { id: "keys", label: "Loot Keys", value: abbreviate(state.keys ?? 0), icon: "key-variant", color: "#FFB300" },
    { id: "investors", label: "Investors", value: abbreviate(state.prestigePoints), icon: "account-multiple", color: "#7B2FF7" },
  ];

  const businessesOwned = BUSINESSES.filter((b) => (state.businesses[b.id]?.level ?? 0) > 0);
  const managersHired = BUSINESSES.filter((b) => state.businesses[b.id]?.hasManager);
  const proBoosts = BUSINESSES.filter((b) => state.proBoosts?.[b.id]);
  const employees = BUSINESSES.filter((b) => (state.employees?.[b.id] ?? 0) > 0);
  const gemPerks = GEM_UPGRADES.filter((u) => state.gemUpgrades?.[u.key]);
  const eq = state.equipment ?? { owned: [], equipped: {} };
  const ownedEquip = eq.owned.map((id) => EQUIPMENT_MAP[id]).filter(Boolean);
  const eqPct = Math.round((equipmentMultiplier(eq) - 1) * 100);

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
      showsVerticalScrollIndicator={false}
      testID="inventory-body"
    >
      {/* Resources */}
      <View style={styles.tileGrid}>
        {tiles.map((t) => (
          <View key={t.id} style={styles.tile} testID={`inv-tile-${t.id}`}>
            <View style={[styles.tileIcon, { backgroundColor: t.color + "22" }]}>
              <MaterialCommunityIcons name={t.icon} size={22} color={t.color} />
            </View>
            <Text style={styles.tileValue}>{t.value}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      {/* Businesses owned */}
      <Section title="Businesses Owned" count={businessesOwned.length} empty="No businesses yet — head to Empire to buy your first">
        {businessesOwned.map((def) => {
          const b = state.businesses[def.id];
          return (
            <Row
              key={def.id}
              icon="store"
              color={def.color}
              title={def.name}
              right={`Lv ${b.level}`}
              testID={`inv-business-${def.id}`}
            />
          );
        })}
      </Section>

      {/* Managers */}
      <Section title="Managers Hired" count={managersHired.length} empty="No managers yet — hire them on the Managers tab">
        {managersHired.map((def) => (
          <Row
            key={def.id}
            icon="account-tie"
            color="#00E676"
            title={def.managerName}
            right={`Runs ${def.name}`}
            testID={`inv-manager-${def.id}`}
          />
        ))}
      </Section>

      {/* Pro boosts */}
      <Section title="Active Pro Boosts" count={proBoosts.length} empty="No Pro Boosts — buy with gems on the Managers tab">
        {proBoosts.map((def) => (
          <Row
            key={def.id}
            icon="rocket"
            color="#E91E63"
            title={`${def.name} Pro`}
            right="3x payout"
            testID={`inv-pro-${def.id}`}
          />
        ))}
      </Section>

      {/* Employees */}
      <Section title="Staff" count={employees.length} empty="No staff hired yet">
        {employees.map((def) => {
          const count = state.employees[def.id];
          return (
            <Row
              key={def.id}
              icon="account-hard-hat"
              color="#FFB300"
              title={def.name}
              right={`${count} staff · +${count * 10}% income`}
              testID={`inv-emp-${def.id}`}
            />
          );
        })}
      </Section>

      {/* Equipment */}
      <Section title={`Equipment (+${eqPct}% income)`} count={ownedEquip.length} empty="No gear yet — equip items from your Character screen">
        {ownedEquip.map((item) => {
          const slotMeta = SLOT_META[item.slot];
          const isEquipped = eq.equipped[item.slot] === item.id;
          return (
            <Row
              key={item.id}
              icon={item.icon as any}
              color={item.color}
              title={`${item.name}${isEquipped ? " ★" : ""}`}
              right={`${slotMeta.label} · +${Math.round(item.boostPct * 100)}%`}
              testID={`inv-equip-${item.id}`}
            />
          );
        })}
      </Section>

      {/* Permanent gem perks */}
      <Section title="Permanent Perks" count={gemPerks.length} empty="No permanent perks yet — unlock them in Shop → Power-Ups">
        {gemPerks.map((u) => (
          <Row
            key={u.key}
            icon={(u.icon as keyof typeof MaterialCommunityIcons.glyphMap) || "star"}
            color={colors.brandTertiary}
            title={u.title}
            right={"OWNED"}
            testID={`inv-perk-${u.key}`}
          />
        ))}
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      {count === 0 ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        <View style={styles.list}>{children}</View>
      )}
    </View>
  );
}

function Row({
  icon,
  color,
  title,
  right,
  testID,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  title: string;
  right: string;
  testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <View style={[styles.rowIcon, { backgroundColor: color + "22" }]}>
        <MaterialCommunityIcons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.rowRight}>{right}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.lg },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tile: {
    flexGrow: 1,
    flexBasis: "47%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  tileValue: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  tileLabel: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  sectionCount: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  empty: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    fontWeight: "600",
    fontStyle: "italic",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  list: { gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  rowRight: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "900" },
});
