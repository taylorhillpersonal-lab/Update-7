import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";
import { money, abbreviate } from "@/src/game/format";
import {
  EQUIPMENT,
  EquipItem,
  EquipSlot,
  SLOT_META,
  SLOT_ORDER,
  equipmentMultiplier,
  equippedItem,
  itemsForSlot,
} from "@/src/game/equipment";

export default function CharacterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, buyEquipment, equipItem, showToast } = useGame();
  const [activeSlot, setActiveSlot] = useState<EquipSlot>("wallet");

  if (!state) return <View style={styles.container} />;

  const eq = state.equipment ?? { owned: [], equipped: {} };
  const totalPct = Math.round((equipmentMultiplier(eq) - 1) * 100);

  const onBuy = (item: EquipItem) => {
    haptic("medium");
    const ok = buyEquipment(item.id);
    if (!ok) {
      showToast(item.currency === "gems" ? "Not enough gems" : "Not enough cash");
      haptic("error");
    } else {
      showToast(`${item.name} equipped! +${Math.round(item.boostPct * 100)}% income`);
    }
  };

  const onEquip = (item: EquipItem) => {
    haptic("light");
    equipItem(item.slot, item.id);
  };

  const onUnequip = (slot: EquipSlot) => {
    haptic("light");
    equipItem(slot, null);
  };

  return (
    <View style={styles.container} testID="character-screen">
      <LinearGradient
        colors={["#1A237E", "#7B1FA2"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.md }]}
      >
        <View style={styles.headerTop}>
          <Pressable testID="character-back" onPress={() => router.back()} style={styles.backBtn}>
            <MaterialCommunityIcons name="chevron-left" size={26} color="#FFF" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Your Tycoon</Text>
            <Text style={styles.subtitle}>Equip gear to boost your income</Text>
          </View>
          <View style={styles.totalPill}>
            <MaterialCommunityIcons name="trending-up" size={16} color="#FFB300" />
            <Text style={styles.totalText}>+{totalPct}%</Text>
          </View>
        </View>

        {/* Character avatar with equipped slots */}
        <View style={styles.charBox} testID="character-avatar">
          <View style={styles.charAvatar}>
            <MaterialCommunityIcons
              name={equippedItem(eq, "sunglasses") ? "incognito" : "account-circle"}
              size={86}
              color="#FFF"
            />
            {equippedItem(eq, "suit") && (
              <View style={styles.charSuitBadge}>
                <MaterialCommunityIcons name="tie" size={18} color="#FFD54F" />
              </View>
            )}
          </View>
          <Text style={styles.charName} numberOfLines={1}>
            {state.playerName || "Anonymous Tycoon"}
          </Text>
          <View style={styles.slotRow}>
            {SLOT_ORDER.map((slot) => {
              const item = equippedItem(eq, slot);
              const meta = SLOT_META[slot];
              return (
                <Pressable
                  key={slot}
                  testID={`slot-chip-${slot}`}
                  onPress={() => { haptic("light"); setActiveSlot(slot); }}
                  style={[styles.slotChip, activeSlot === slot && { borderColor: meta.color, backgroundColor: meta.color + "33" }]}
                >
                  <MaterialCommunityIcons name={meta.icon as any} size={16} color={item ? meta.color : "#FFFFFFAA"} />
                  <Text style={[styles.slotChipText, { color: item ? "#FFF" : "#FFFFFFAA" }]}>
                    {item ? `+${Math.round(item.boostPct * 100)}%` : "—"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </LinearGradient>

      {/* Slot tabs */}
      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {SLOT_ORDER.map((slot) => {
            const meta = SLOT_META[slot];
            const active = activeSlot === slot;
            return (
              <Pressable
                key={slot}
                testID={`slot-tab-${slot}`}
                onPress={() => { haptic("light"); setActiveSlot(slot); }}
                style={[styles.tab, active && { backgroundColor: meta.color, borderColor: meta.color }]}
              >
                <MaterialCommunityIcons name={meta.icon as any} size={16} color={active ? "#000" : meta.color} />
                <Text style={[styles.tabText, { color: active ? "#000" : colors.onSurface }]}>{meta.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Currently equipped row */}
        {(() => {
          const cur = equippedItem(eq, activeSlot);
          const meta = SLOT_META[activeSlot];
          return (
            <View style={[styles.equippedRow, { borderColor: meta.color + "55" }]}>
              <View style={[styles.equippedIcon, { backgroundColor: meta.color + "22" }]}>
                <MaterialCommunityIcons name={(cur?.icon ?? meta.icon) as any} size={24} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.equippedLabel}>EQUIPPED — {meta.label.toUpperCase()}</Text>
                <Text style={styles.equippedName}>{cur ? cur.name : "Nothing equipped"}</Text>
              </View>
              {cur && (
                <Pressable
                  testID={`unequip-${activeSlot}`}
                  onPress={() => onUnequip(activeSlot)}
                  style={styles.unequipBtn}
                >
                  <Text style={styles.unequipText}>Unequip</Text>
                </Pressable>
              )}
            </View>
          );
        })()}

        {/* Items in this slot */}
        {itemsForSlot(activeSlot).map((item) => {
          const owned = eq.owned.includes(item.id);
          const equipped = eq.equipped[item.slot] === item.id;
          const canAfford = item.currency === "gems"
            ? state.gems >= item.price
            : state.cash >= item.price;
          return (
            <View key={item.id} style={[styles.itemCard, equipped && { borderColor: SLOT_META[item.slot].color }]} testID={`equip-card-${item.id}`}>
              <View style={[styles.itemIcon, { backgroundColor: item.color + "22" }]}>
                <MaterialCommunityIcons name={item.icon as any} size={28} color={item.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.itemTitleRow}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                  <View style={[styles.tierPill, { backgroundColor: tierColor(item.tier) + "33" }]}>
                    <Text style={[styles.tierText, { color: tierColor(item.tier) }]}>T{item.tier}</Text>
                  </View>
                </View>
                <View style={styles.boostRow}>
                  <MaterialCommunityIcons name="trending-up" size={13} color={colors.brandSecondary} />
                  <Text style={styles.boostText}>+{Math.round(item.boostPct * 100)}% income</Text>
                </View>
              </View>
              {equipped ? (
                <View style={[styles.cta, { backgroundColor: colors.brandSecondary + "33" }]}>
                  <MaterialCommunityIcons name="check-bold" size={14} color={colors.brandSecondary} />
                  <Text style={[styles.ctaText, { color: colors.brandSecondary }]}>Equipped</Text>
                </View>
              ) : owned ? (
                <Pressable testID={`equip-${item.id}`} onPress={() => onEquip(item)} style={[styles.cta, { backgroundColor: colors.brandPrimary }]}>
                  <Text style={[styles.ctaText, { color: colors.onBrandPrimary }]}>Equip</Text>
                </Pressable>
              ) : (
                <Pressable
                  testID={`buy-${item.id}`}
                  onPress={() => onBuy(item)}
                  disabled={!canAfford}
                  style={[styles.cta, { backgroundColor: canAfford ? (item.currency === "gems" ? colors.brandTertiary : colors.brandPrimary) : colors.surfaceTertiary }]}
                >
                  <MaterialCommunityIcons
                    name={item.currency === "gems" ? "diamond-stone" : "cash"}
                    size={13}
                    color={canAfford ? (item.currency === "gems" ? "#FFF" : colors.onBrandPrimary) : colors.onSurfaceTertiary}
                  />
                  <Text style={[styles.ctaText, { color: canAfford ? (item.currency === "gems" ? "#FFF" : colors.onBrandPrimary) : colors.onSurfaceTertiary }]}>
                    {item.currency === "gems" ? abbreviate(item.price) : money(item.price)}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function tierColor(tier: 1 | 2 | 3): string {
  if (tier === 1) return "#9E9E9E";
  if (tier === 2) return "#42A5F5";
  return "#FFB300";
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFF", fontSize: 22, fontWeight: "900" },
  subtitle: { color: "#FFFFFFCC", fontSize: 12, fontWeight: "600", marginTop: 2 },
  totalPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#000000AA",
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  totalText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
  charBox: { alignItems: "center", marginTop: spacing.lg },
  charAvatar: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: "#FFFFFF22",
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "#FFFFFF55",
  },
  charSuitBadge: {
    position: "absolute", bottom: 4, right: 4,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#000",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#FFD54F",
  },
  charName: { color: "#FFF", fontSize: 17, fontWeight: "900", marginTop: spacing.sm },
  slotRow: { flexDirection: "row", gap: 6, marginTop: spacing.md, flexWrap: "wrap", justifyContent: "center" },
  slotChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#00000055",
    borderWidth: 1.5, borderColor: "#FFFFFF44",
  },
  slotChipText: { fontSize: 11, fontWeight: "900" },
  tabsWrap: {
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tabs: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border,
    flexShrink: 0,
  },
  tabText: { fontSize: 13, fontWeight: "800" },
  list: { padding: spacing.md, gap: spacing.sm },
  equippedRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  equippedIcon: {
    width: 44, height: 44, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
  },
  equippedLabel: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  equippedName: { color: colors.onSurface, fontSize: 15, fontWeight: "900", marginTop: 2 },
  unequipBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
  },
  unequipText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" },
  itemCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  itemIcon: {
    width: 52, height: 52, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
  },
  itemTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemName: { color: colors.onSurface, fontSize: 15, fontWeight: "900", flexShrink: 1 },
  tierPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  tierText: { fontSize: 10, fontWeight: "900" },
  boostRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  boostText: { color: colors.brandSecondary, fontSize: 12, fontWeight: "800" },
  cta: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, minWidth: 80, justifyContent: "center",
  },
  ctaText: { fontSize: 13, fontWeight: "900" },
});
