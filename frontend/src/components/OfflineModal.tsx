import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { colors, radius, spacing } from "@/src/game/theme";
import { money, formatDuration } from "@/src/game/format";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";

export default function OfflineModal() {
  const { offline, collectOffline } = useGame();
  const visible = !!offline && offline.earnings > 0;

  const onCollect = () => {
    haptic("success");
    collectOffline();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="cash-multiple" size={42} color={colors.brandSecondary} />
          </View>
          <Text style={styles.title}>Welcome Back, Boss!</Text>
          <Text style={styles.subtitle}>
            Your managers ran the empire for{" "}
            {offline ? formatDuration(offline.seconds) : ""}
          </Text>
          <Text style={styles.amount}>{offline ? money(offline.earnings) : ""}</Text>

          <Pressable testID="collect-offline-button" onPress={onCollect} style={styles.collectBtn}>
            <LinearGradient
              colors={[colors.brandSecondary, "#00C853"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradient}
            >
              <MaterialCommunityIcons name="hand-coin" size={20} color={colors.onBrandSecondary} />
              <Text style={styles.collectText}>COLLECT</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  sheet: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary + "1F",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.onSurface,
    fontSize: 24,
    fontWeight: "900",
  },
  subtitle: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: spacing.xs,
  },
  amount: {
    color: colors.brandSecondary,
    fontSize: 40,
    fontWeight: "900",
    marginVertical: spacing.lg,
  },
  collectBtn: {
    width: "100%",
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  gradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  collectText: {
    color: colors.onBrandSecondary,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
