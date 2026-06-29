import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { admobAvailable, getAdmob } from "@/src/ads/admob";
import { bannerUnitId } from "@/src/ads/adConfig";
import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";

export default function AdBanner() {
  const { state, isInAdGracePeriod } = useGame();
  if (state?.adsRemoved) return null;
  // New-player grace period: hide the banner entirely for the first 30
  // minutes after a brand-new install.
  if (isInAdGracePeriod) return null;

  if (admobAvailable) {
    const m = getAdmob();
    if (m) {
      const { BannerAd, BannerAdSize, TestIds } = m;
      return (
        <View style={styles.real}>
          <BannerAd
            unitId={bannerUnitId(TestIds)}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          />
        </View>
      );
    }
  }
  // Preview / Expo Go / web — simulated banner placeholder.
  return (
    <View style={styles.sim} testID="ad-banner">
      <MaterialCommunityIcons name="bullhorn-variant" size={16} color={colors.onSurfaceTertiary} />
      <Text style={styles.simText}>Sponsored · Your ad could be here</Text>
      <View style={styles.tag}>
        <Text style={styles.tagText}>AD</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  real: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  sim: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  simText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
  tag: {
    position: "absolute",
    right: spacing.md,
    backgroundColor: colors.warning,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  tagText: { color: "#3A2A00", fontSize: 9, fontWeight: "900" },
});
