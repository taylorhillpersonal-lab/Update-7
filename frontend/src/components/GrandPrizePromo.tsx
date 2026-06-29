import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";
import { useTutorialActive } from "@/src/components/TutorialGate";

const GOLD = "#FFD700";
const PROMO_LINE = "Be the FIRST player to reach Level 1000 on ALL businesses and win $1,000 USD!";

// In-memory only — both the banner and the entry popup reappear on a fresh app launch.
export default function GrandPrizePromo() {
  const insets = useSafeAreaInsets();
  const { state } = useGame();
  const tutorialActive = useTutorialActive();
  const hasName = !!(state?.playerName ?? "").trim();
  const [bannerVisible, setBannerVisible] = useState(true);
  const [popupVisible, setPopupVisible] = useState(true);

  // While the first-run guided tour is on, never show our overlay popup — it
  // portal-mounts above TutorialGate on react-native-web and blocks taps on
  // the tutorial's Next/Skip buttons.
  const popupGated = popupVisible && hasName && !tutorialActive;

  return (
    <>
      {bannerVisible && (
        <View style={[styles.banner, { paddingTop: insets.top + 8 }]} testID="promo-banner">
          <MaterialCommunityIcons name="trophy" size={18} color="#3A2A00" />
          <Text style={styles.bannerText} numberOfLines={1}>
            Win $1,000 USD — first to Level 1000 on all businesses!
          </Text>
          <Pressable
            testID="promo-banner-close"
            onPress={() => { haptic("light"); setBannerVisible(false); }}
            hitSlop={10}
            style={styles.bannerClose}
          >
            <MaterialCommunityIcons name="close" size={18} color="#3A2A00" />
          </Pressable>
        </View>
      )}

      <Modal visible={popupGated} transparent animationType="fade" onRequestClose={() => setPopupVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card} testID="promo-popup">
            <View style={styles.trophyWrap}>
              <MaterialCommunityIcons name="trophy" size={48} color={GOLD} />
            </View>
            <Text style={styles.prize}>$1,000 USD</Text>
            <Text style={styles.title}>Grand Prize Challenge</Text>
            <Text style={styles.body}>{PROMO_LINE}</Text>
            <Pressable
              testID="promo-popup-close"
              onPress={() => { haptic("success"); setPopupVisible(false); }}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>Let&apos;s build!</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: 8,
    backgroundColor: GOLD,
  },
  bannerText: { flex: 1, color: "#3A2A00", fontSize: 13, fontWeight: "900" },
  bannerClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 2,
    borderColor: GOLD,
  },
  trophyWrap: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: GOLD + "1F",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  prize: { color: GOLD, fontSize: 34, fontWeight: "900", letterSpacing: 0.5 },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "900", marginTop: 2 },
  body: {
    color: colors.onSurfaceTertiary,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 21,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  cta: {
    backgroundColor: GOLD,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    width: "100%",
    alignItems: "center",
  },
  ctaText: { color: "#3A2A00", fontSize: 16, fontWeight: "900" },
});
