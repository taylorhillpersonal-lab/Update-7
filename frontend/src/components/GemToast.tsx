import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";

export default function GemToast() {
  const { toast, clearToast } = useGame();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(clearToast, 2600);
    return () => clearTimeout(id);
  }, [toast, clearToast]);

  if (!toast) return null;

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(16)}
      exiting={FadeOutUp}
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + spacing.sm }]}
    >
      <View style={styles.toast} testID="gem-toast">
        <MaterialCommunityIcons name="diamond-stone" size={18} color={colors.brandTertiary} />
        <Text style={styles.text} numberOfLines={1}>
          {toast}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 1000,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    maxWidth: "90%",
  },
  text: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "800",
  },
});
