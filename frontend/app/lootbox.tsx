import React, { useEffect, useRef, useState } from "react";
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { colors, radius, spacing } from "@/src/game/theme";
import { abbreviate, money, formatDuration } from "@/src/game/format";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";
import {
  FREE_LOOT_INTERVAL_MS,
  FREE_BOX,
  KEY_GEM_COST,
  LOOT_BOXES,
  LootBox,
  LootReward,
  rollLoot,
} from "@/src/game/lootbox";

const KEY_DEALS = [
  { qty: 1, gems: KEY_GEM_COST },
  { qty: 5, gems: KEY_GEM_COST * 5 - 50 },
  { qty: 10, gems: KEY_GEM_COST * 10 - 150 },
];

// ----- CS2-style reel constants -----
const TILE_WIDTH = 96;
const TILE_GAP = 6;
const ITEM_PITCH = TILE_WIDTH + TILE_GAP;
const REEL_LENGTH = 60;
const WINNER_INDEX = 53;       // winning tile sits well inside the reel
const SPIN_DURATION_MS = 5200; // matches CS2's slow-down feel
const WINDOW_HORIZONTAL_PADDING = 32;

// Rarity tiers derived from each reward's table weight.
// Reel borders use these colors so the ride feels like CS2 ("Mil-Spec / Restricted / Classified / Covert / Knife").
function rarityColor(reward: LootReward, table: LootReward[]): string {
  const sorted = [...table].sort((a, b) => b.weight - a.weight); // common -> rare
  const idx = sorted.findIndex((r) => r.id === reward.id);
  if (idx < 0) return "#9E9E9E";
  if (idx === 0) return "#A0A4A8";              // common (grey)
  if (idx === 1) return "#4B69CC";              // uncommon (blue)
  if (idx === 2) return "#8847FF";              // rare (purple)
  if (idx === 3) return "#D32CE6";              // very rare (pink)
  if (idx === 4) return "#EB4B4B";              // covert (red)
  return "#FFD200";                              // exceedingly rare (gold)
}

// Build a reel of REEL_LENGTH tiles, with the winner placed at WINNER_INDEX
// and the rest pulled from rollLoot() so rarities stay believable.
function buildReel(table: LootReward[], winner: LootReward): LootReward[] {
  const reel: LootReward[] = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    if (i === WINNER_INDEX) reel.push(winner);
    else reel.push(rollLoot(table));
  }
  return reel;
}

export default function LootBoxScreen() {
  const { state, adjustGems, adjustKeys, adjustCash, applyAdReward, markLoot, showToast } = useGame();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now());
  const [opening, setOpening] = useState<LootBox | null>(null);
  const [reel, setReel] = useState<LootReward[] | null>(null);
  const [revealReady, setRevealReady] = useState(false);
  const [result, setResult] = useState<{ box: LootBox; reward: LootReward; detail: string } | null>(null);
  const pendingRef = useRef<{ box: LootBox; reward: LootReward; free: boolean; detail: string } | null>(null);

  // Reel uses a single translateX shared value — exactly like the CS2 ride.
  const offsetX = useSharedValue(0);
  // Tiny flash that pops when the winner stops under the ticker.
  const flash = useSharedValue(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const reelAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  if (!state) return <View style={styles.container} />;

  const keys = state.keys ?? 0;
  const freeReady = now - state.lastLootAt >= FREE_LOOT_INTERVAL_MS;
  const freeRemaining = Math.max(0, FREE_LOOT_INTERVAL_MS - (now - state.lastLootAt));

  const resolveReward = (reward: LootReward): string => {
    if (reward.type === "gems") {
      adjustGems(reward.amount ?? 0);
      return `+${reward.amount} gems`;
    }
    if (reward.type === "cash") {
      const amount = Math.max(1000, Math.floor(Math.max(state.lifetimeEarnings, 50000) * (reward.pct ?? 0.03)));
      adjustCash(amount);
      return `+${money(amount)}`;
    }
    if (reward.type === "boost") {
      applyAdReward("boost");
      return "2x income for 5 min";
    }
    adjustGems(reward.amount ?? 25);
    return `+${reward.amount ?? 25} gems`;
  };

  // Called from the worklet when the spin ends — finishes settlement.
  const onSpinFinished = () => {
    const p = pendingRef.current;
    if (!p) return;
    if (p.free) markLoot();
    else adjustKeys(-p.box.keyCost);
    haptic("success");
    setRevealReady(true);
    flash.value = withSequence(
      withTiming(1, { duration: 140 }),
      withTiming(0, { duration: 600 }),
    );
    // Show the result modal a beat later so the winning tile flashes first.
    setTimeout(() => {
      setResult({ box: p.box, reward: p.reward, detail: p.detail });
      setOpening(null);
      setReel(null);
      setRevealReady(false);
      pendingRef.current = null;
    }, 900);
  };

  const open = (box: LootBox, free: boolean) => {
    if (free) {
      if (!freeReady) return;
    } else if (keys < box.keyCost) {
      showToast(`Need ${box.keyCost} keys to open this`);
      return;
    }
    haptic("heavy");
    const reward = rollLoot(box.table);
    const detail = ""; // resolveReward credits + returns label; we run it after the spin so cash/gems pop with the reveal
    const builtReel = buildReel(box.table, reward);

    pendingRef.current = { box, reward, free, detail };
    setReel(builtReel);
    setOpening(box);
    setRevealReady(false);

    // Window inner width (the strip we look through).
    const screenW = Dimensions.get("window").width;
    const innerW = Math.min(screenW - WINDOW_HORIZONTAL_PADDING, 420);
    // Land winner centered under the ticker line, with a small horizontal jitter
    // so it doesn't look perfectly aligned — exactly like CS2.
    const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.45);
    const target =
      innerW / 2 - (WINNER_INDEX * ITEM_PITCH + TILE_WIDTH / 2) + jitter;
    const startOffset = innerW / 2 - TILE_WIDTH / 2; // first tile centered

    offsetX.value = startOffset;
    // Settle the reward AFTER the visual spin so the toast/HUD updates timed
    // with the reveal feel earned. resolveReward returns the label.
    offsetX.value = withTiming(
      target,
      {
        duration: SPIN_DURATION_MS,
        // Aggressive ease-out so the reel rips by, then crawls into place.
        easing: Easing.bezier(0.08, 0.82, 0.17, 1),
      },
      (finished) => {
        if (finished) {
          // Credit the reward + flash on the JS thread.
          runOnJS(creditAndFlash)();
        }
      },
    );
  };

  // Wrapper so the worklet can hop back to JS to mutate game state.
  const creditAndFlash = () => {
    const p = pendingRef.current;
    if (!p) return;
    const label = resolveReward(p.reward);
    pendingRef.current = { ...p, detail: label };
    onSpinFinished();
  };

  const buyKeys = (qty: number, gems: number) => {
    if (state.gems < gems) {
      showToast("Not enough gems");
      return;
    }
    adjustGems(-gems);
    adjustKeys(qty);
    haptic("success");
    showToast(`+${qty} loot ${qty === 1 ? "key" : "keys"}`);
  };

  const screenW = Dimensions.get("window").width;
  const innerW = Math.min(screenW - WINDOW_HORIZONTAL_PADDING, 420);

  return (
    <View style={styles.container} testID="lootbox-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="lootbox-back" onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Loot Boxes</Text>
          <Text style={styles.subtitle}>Use keys to crack open rewards</Text>
        </View>
        <View style={styles.keyPill} testID="lootbox-key-balance">
          <MaterialCommunityIcons name="key-variant" size={16} color="#FFD54A" />
          <Text style={styles.keyText}>{abbreviate(keys)}</Text>
        </View>
        <View style={styles.gemPill}>
          <MaterialCommunityIcons name="diamond-stone" size={16} color={colors.brandTertiary} />
          <Text style={styles.gemText}>{abbreviate(state.gems)}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
        {/* Free box */}
        <LinearGradient colors={["#3A2C5E", "#241B3D"]} style={styles.freeCard}>
          <MaterialCommunityIcons name="gift-open" size={56} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.freeTitle}>Free Daily Box</Text>
            <Text style={styles.freeDesc}>A free Bronze box every 8 hours</Text>
          </View>
          <Pressable
            testID="open-free-lootbox-button"
            onPress={() => open(FREE_BOX, true)}
            disabled={!freeReady || !!opening}
            style={[styles.freeBtn, !freeReady && styles.freeBtnDisabled]}
          >
            <Text style={styles.freeBtnText}>
              {freeReady ? "OPEN" : formatDuration(freeRemaining / 1000)}
            </Text>
          </Pressable>
        </LinearGradient>

        {/* Boxes */}
        <Text style={styles.sectionTitle}>Loot Boxes</Text>
        {LOOT_BOXES.map((box) => {
          const affordable = keys >= box.keyCost;
          return (
            <LinearGradient key={box.id} colors={box.gradient} style={styles.boxCard}>
              <View style={styles.boxIconWrap}>
                <MaterialCommunityIcons name={box.icon as any} size={44} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.boxName}>{box.name}</Text>
                <Text style={styles.boxDesc}>{box.desc}</Text>
                <View style={styles.boxOdds}>
                  {box.table.slice(-1).map((r) => (
                    <Text key={r.id} style={styles.boxOddsText}>Top prize: {r.label}</Text>
                  ))}
                </View>
              </View>
              <Pressable
                testID={`open-box-${box.id}`}
                onPress={() => open(box, false)}
                disabled={!affordable || !!opening}
                style={[styles.boxBtn, !affordable && styles.boxBtnDisabled]}
              >
                <MaterialCommunityIcons name="key-variant" size={15} color={affordable ? "#1A1A1A" : "rgba(255,255,255,0.6)"} />
                <Text style={[styles.boxBtnText, !affordable && styles.boxBtnTextDisabled]}>{box.keyCost}</Text>
              </Pressable>
            </LinearGradient>
          );
        })}

        {/* Get keys with gems */}
        <Text style={styles.sectionTitle}>Get Keys with Gems</Text>
        <View style={styles.keyDealRow}>
          {KEY_DEALS.map((d) => (
            <Pressable
              key={d.qty}
              testID={`buy-keys-gems-${d.qty}`}
              onPress={() => buyKeys(d.qty, d.gems)}
              style={styles.keyDealCard}
            >
              <View style={styles.keyDealTop}>
                <MaterialCommunityIcons name="key-variant" size={22} color="#FFD54A" />
                <Text style={styles.keyDealQty}>x{d.qty}</Text>
              </View>
              <View style={styles.keyDealPrice}>
                <MaterialCommunityIcons name="diamond-stone" size={13} color={colors.brandTertiary} />
                <Text style={styles.keyDealPriceText}>{d.gems}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Pressable testID="lootbox-to-shop" onPress={() => router.push("/(tabs)/shop" as any)} style={styles.shopLink}>
          <MaterialCommunityIcons name="cart" size={16} color={colors.brandPrimary} />
          <Text style={styles.shopLinkText}>Buy Key Bundles in the Shop</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.brandPrimary} />
        </Pressable>
      </ScrollView>

      {/* ============ CS2-style opening reel ============ */}
      <Modal visible={!!opening} transparent animationType="fade">
        <View style={styles.reelBackdrop} testID="lootbox-reel">
          <Text style={styles.reelOpening}>Opening {opening?.name}…</Text>

          {/* Window with horizontal reel */}
          <View
            style={[
              styles.reelWindow,
              { width: innerW, borderColor: opening?.glow ?? colors.brandPrimary },
            ]}
            testID="lootbox-reel-window"
          >
            {/* Side fades */}
            <LinearGradient
              colors={["rgba(10,10,10,1)", "rgba(10,10,10,0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.fadeLeft}
              pointerEvents="none"
            />
            <LinearGradient
              colors={["rgba(10,10,10,0)", "rgba(10,10,10,1)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.fadeRight}
              pointerEvents="none"
            />

            {/* The reel itself */}
            <Animated.View style={[styles.reelStrip, reelAnimStyle]}>
              {reel?.map((item, idx) => {
                const rare = rarityColor(item, opening?.table ?? []);
                return (
                  <View
                    key={idx}
                    style={[
                      styles.reelTile,
                      { borderBottomColor: rare, width: TILE_WIDTH },
                    ]}
                    testID={idx === WINNER_INDEX ? "lootbox-reel-winner" : undefined}
                  >
                    <View style={[styles.reelTileIcon, { backgroundColor: rare + "22" }]}>
                      <MaterialCommunityIcons
                        name={item.icon as any}
                        size={34}
                        color={rare}
                      />
                    </View>
                    <Text style={styles.reelTileLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                );
              })}
            </Animated.View>

            {/* Center ticker line */}
            <View pointerEvents="none" style={styles.tickerLine} />
            {/* Top + bottom arrows */}
            <View pointerEvents="none" style={styles.tickerTopArrow} />
            <View pointerEvents="none" style={styles.tickerBottomArrow} />
            {/* Flash overlay on stop */}
            <Animated.View pointerEvents="none" style={[styles.reelFlash, flashStyle]} />
          </View>

          <Text style={styles.reelHint}>
            {revealReady ? "🎉 Winner!" : "Watch the ticker…"}
          </Text>
        </View>
      </Modal>

      {/* ============ Reward reveal ============ */}
      <Modal visible={!!result} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.resultCard} testID="lootbox-result">
            <View style={[styles.resultIcon, { backgroundColor: (result?.reward.color ?? colors.brandPrimary) + "22" }]}>
              <MaterialCommunityIcons
                name={(result?.reward.icon ?? "gift") as any}
                size={48}
                color={result?.reward.color ?? colors.brandPrimary}
              />
            </View>
            <Text style={styles.resultTitle}>{result?.box.name} reward</Text>
            <Text style={styles.resultLabel}>{result?.detail}</Text>
            <Pressable
              testID="lootbox-collect"
              onPress={() => {
                haptic("success");
                setResult(null);
              }}
              style={styles.collectBtn}
            >
              <LinearGradient
                colors={[colors.brandPrimary, "#FF8F00"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.collectGrad}
              >
                <Text style={styles.collectText}>COLLECT</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const REEL_HEIGHT = 120;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "900" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", marginTop: 2 },
  keyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFD54A1F",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  keyText: { color: "#FFD54A", fontSize: 16, fontWeight: "900" },
  gemPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.brandTertiary + "1F",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  gemText: { color: colors.brandTertiary, fontSize: 16, fontWeight: "900" },
  content: { padding: spacing.lg, gap: spacing.sm },
  freeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  freeTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  freeDesc: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "600", marginTop: 2 },
  freeBtn: {
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 84,
    alignItems: "center",
  },
  freeBtnDisabled: { backgroundColor: "rgba(255,255,255,0.18)" },
  freeBtnText: { color: colors.onBrandSecondary, fontSize: 14, fontWeight: "900" },
  sectionTitle: {
    color: colors.onSurfaceTertiary,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  boxCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  boxIconWrap: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  boxName: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  boxDesc: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600", marginTop: 1 },
  boxOdds: { marginTop: 4 },
  boxOddsText: { color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "800" },
  boxBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFD54A",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minWidth: 62,
    justifyContent: "center",
  },
  boxBtnDisabled: { backgroundColor: "rgba(255,255,255,0.18)" },
  boxBtnText: { color: "#1A1A1A", fontSize: 16, fontWeight: "900" },
  boxBtnTextDisabled: { color: "rgba(255,255,255,0.6)" },
  keyDealRow: { flexDirection: "row", gap: spacing.sm },
  keyDealCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyDealTop: { flexDirection: "row", alignItems: "center", gap: 4 },
  keyDealQty: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  keyDealPrice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandTertiary + "1F",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  keyDealPriceText: { color: colors.brandTertiary, fontSize: 14, fontWeight: "900" },
  shopLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shopLinkText: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "800" },

  // ----- CS2 reel -----
  reelBackdrop: {
    flex: 1,
    backgroundColor: "rgba(5,7,11,0.96)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  reelOpening: { color: "#FFF", fontSize: 18, fontWeight: "900", marginBottom: spacing.lg, letterSpacing: 0.5 },
  reelWindow: {
    height: REEL_HEIGHT,
    backgroundColor: "#0A0A0A",
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 2,
  },
  reelStrip: {
    flexDirection: "row",
    gap: TILE_GAP,
    paddingHorizontal: 0,
    height: REEL_HEIGHT,
    alignItems: "center",
  },
  reelTile: {
    height: REEL_HEIGHT - 12,
    marginVertical: 6,
    backgroundColor: "#16191E",
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 4,
    borderTopWidth: 1,
    borderTopColor: "#23262C",
  },
  reelTileIcon: {
    width: 50,
    height: 50,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  reelTileLabel: { color: "#FFF", fontSize: 10, fontWeight: "800", textAlign: "center" },
  tickerLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: 2,
    marginLeft: -1,
    backgroundColor: "#FFD200",
    shadowColor: "#FFD200",
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  tickerTopArrow: {
    position: "absolute",
    top: -1,
    left: "50%",
    marginLeft: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#FFD200",
  },
  tickerBottomArrow: {
    position: "absolute",
    bottom: -1,
    left: "50%",
    marginLeft: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#FFD200",
  },
  fadeLeft: {
    position: "absolute", top: 0, bottom: 0, left: 0, width: 48, zIndex: 2,
  },
  fadeRight: {
    position: "absolute", top: 0, bottom: 0, right: 0, width: 48, zIndex: 2,
  },
  reelFlash: {
    position: "absolute",
    top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: "#FFFFFF",
  },
  reelHint: { color: "#CFD2D6", fontSize: 13, fontWeight: "700", marginTop: spacing.lg, letterSpacing: 0.5 },

  // ----- Result -----
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  resultCard: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  resultIcon: {
    width: 90,
    height: 90,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  resultTitle: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "700" },
  resultLabel: { color: colors.onSurface, fontSize: 24, fontWeight: "900", textAlign: "center", marginVertical: spacing.sm },
  collectBtn: { width: "100%", borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.md },
  collectGrad: { paddingVertical: spacing.lg, alignItems: "center" },
  collectText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "900", letterSpacing: 1 },
});
