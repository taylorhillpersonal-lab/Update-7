import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "@/src/game/theme";
import { BUSINESSES } from "@/src/game/businesses";
import { useGame } from "@/src/game/GameContext";
import BusinessCard from "@/src/components/BusinessCard";
import CurrencyHud from "@/src/components/CurrencyHud";
import OfflineModal from "@/src/components/OfflineModal";
import AnnouncementBanner from "@/src/components/AnnouncementBanner";

export default function EmpireScreen() {
  const { state } = useGame();
  const insets = useSafeAreaInsets();

  if (!state) {
    return (
      <View style={styles.loading} testID="empire-loading">
        <ActivityIndicator size="large" color={colors.brandPrimary} />
        <Text style={styles.loadingText}>Building Empire...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="empire-screen">
      <CurrencyHud topInset={insets.top} />
      <AnnouncementBanner />
      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {BUSINESSES.map((def) => (
          <BusinessCard key={def.id} def={def} />
        ))}
      </ScrollView>
      <OfflineModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  loadingText: {
    color: colors.onSurfaceTertiary,
    fontSize: 16,
    fontWeight: "700",
  },
  list: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
