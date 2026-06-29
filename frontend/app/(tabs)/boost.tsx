import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { ManagersList } from "@/app/(tabs)/managers";
import { PrestigeBody } from "@/app/(tabs)/prestige";
import InventoryBody from "@/src/components/InventoryBody";
import { haptic } from "@/src/game/haptics";

type Section = "managers" | "prestige" | "inventory";

// Tiny pub/sub so Profile can deep-link straight into the Inventory sub-tab.
let setSectionOverride: ((s: Section) => void) | null = null;
export function openBoostSection(s: Section) {
  setSectionOverride?.(s);
}

const SECTIONS: { id: Section; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { id: "managers", label: "Managers", icon: "account-tie" },
  { id: "prestige", label: "Prestige", icon: "restart" },
  { id: "inventory", label: "Inventory", icon: "treasure-chest" },
];

export default function BoostScreen() {
  const insets = useSafeAreaInsets();
  const [section, setSection] = useState<Section>("managers");

  React.useEffect(() => {
    setSectionOverride = (s) => setSection(s);
    return () => {
      setSectionOverride = null;
    };
  }, []);

  return (
    <View style={styles.container} testID="boost-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Boost</Text>
        <Text style={styles.subtitle}>
          {section === "managers"
            ? "Hire staff to automate your businesses"
            : section === "prestige"
            ? "Reset for permanent income multipliers"
            : "Everything you currently own"}
        </Text>

        <View style={styles.segment} testID="boost-segment">
          {SECTIONS.map((s) => {
            const active = section === s.id;
            return (
              <Pressable
                key={s.id}
                testID={`boost-segment-${s.id}`}
                onPress={() => {
                  if (section !== s.id) {
                    haptic("light");
                    setSection(s.id);
                  }
                }}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              >
                <MaterialCommunityIcons
                  name={s.icon}
                  size={16}
                  color={active ? colors.onBrandPrimary : colors.onSurfaceTertiary}
                />
                <Text
                  style={[
                    styles.segmentLabel,
                    { color: active ? colors.onBrandPrimary : colors.onSurfaceTertiary },
                  ]}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.body}>
        {section === "managers" ? <ManagersList /> : section === "prestige" ? <PrestigeBody /> : <InventoryBody />}
      </View>
    </View>
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
  segment: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: colors.surface,
    padding: 4,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  segmentBtnActive: {
    backgroundColor: colors.brandPrimary,
  },
  segmentLabel: { fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  body: { flex: 1 },
});
