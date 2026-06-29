import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";
import { storage } from "@/src/utils/storage";

const SPIN_KEY = "tycoon_daily_spin_at";
const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Weighted gem rewards for the Daily Spin. Big rewards are rare.
// Each reward also carries an icon so the reel tiles read at a glance.
type SpinReward = { gems: number; weight: number; label: string; color: string; icon: string };
const SPIN_REWARDS: SpinReward[] = [
  { gems: 5,    weight: 35,  label: "+5 gems",      color: "#9E9E9E", icon: "diamond-stone" },
  { gems: 10,   weight: 25,  label: "+10 gems",     color: "#7E8A99", icon: "diamond-stone" },
  { gems: 25,   weight: 18,  label: "+25 gems",     color: "#42A5F5", icon: "diamond-stone" },
  { gems: 50,   weight: 12,  label: "+50 gems",     color: "#26C6DA", icon: "diamond" },
  { gems: 100,  weight: 7,   label: "+100 gems",    color: "#9C27B0", icon: "diamond" },
  { gems: 250,  weight: 2.5, label: "+250 gems",    color: "#FFB300", icon: "treasure-chest" },
  { gems: 1000, weight: 0.5, label: "+1,000 gems!", color: "#F4511E", icon: "crown" },
];

function rollReward(): SpinReward {
  const total = SPIN_REWARDS.reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  for (const reward of SPIN_REWARDS) {
    r -= reward.weight;
    if (r <= 0) return reward;
  }
  return SPIN_REWARDS[0];
}

// CS-style reel constants (mirrors the loot-box implementation).
const TILE_WIDTH = 96;
const TILE_GAP = 8;
const ITEM_PITCH = TILE_WIDTH + TILE_GAP;
const REEL_LENGTH = 60;
const WINNER_INDEX = 53;
const SPIN_DURATION_MS = 4200;
const WINDOW_HORIZONTAL_PADDING = 48;

// Build a 60-tile reel with the winning reward at WINNER_INDEX so the
// ticker always lands on it after the strip animates.
function buildReel(winner: SpinReward): SpinReward[] {
  const out: SpinReward[] = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    if (i === WINNER_INDEX) out.push(winner);
    else out.push(SPIN_REWARDS[Math.floor(Math.random() * SPIN_REWARDS.length)]);
  }
  return out;
}

export default function MinigamesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { adjustGems, state, showToast } = useGame();
  const ageVerified = !!state?.ageVerified;
  const [now, setNow] = useState(Date.now());
  const [nextSpinAt, setNextSpinAt] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<SpinReward[] | null>(null);
  const [revealReady, setRevealReady] = useState(false);
  const [result, setResult] = useState<SpinReward | null>(null);
  const pendingRef = useRef<SpinReward | null>(null);

  // Reanimated shared values driving the strip + final-flash.
  const offsetX = useSharedValue(0);
  const flash = useSharedValue(0);

  const reelAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      const last = await storage.getItem(SPIN_KEY, 0);
      const lastNum = typeof last === "number" ? last : 0;
      setNextSpinAt(lastNum + SPIN_COOLDOWN_MS);
    })();
  }, []);

  const canSpin = now >= nextSpinAt;
  const remaining = Math.max(0, nextSpinAt - now);

  const onSpin = async () => {
    if (!canSpin || spinning) return;
    setSpinning(true);
    haptic("medium");

    // Pre-roll the winner & build the visual reel.
    const reward = rollReward();
    const builtReel = buildReel(reward);
    pendingRef.current = reward;
    setReel(builtReel);
    setRevealReady(false);
    flash.value = 0;

    // Window inner width — same math as the loot box reel so the winner
    // lands centred under the ticker line with CS-style jitter.
    const screenW = Dimensions.get("window").width;
    const innerW = Math.min(screenW - WINDOW_HORIZONTAL_PADDING, 420);
    const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.45);
    const target = innerW / 2 - (WINNER_INDEX * ITEM_PITCH + TILE_WIDTH / 2) + jitter;
    const startOffset = innerW / 2 - TILE_WIDTH / 2;

    offsetX.value = startOffset;
    offsetX.value = withTiming(
      target,
      { duration: SPIN_DURATION_MS, easing: Easing.bezier(0.08, 0.82, 0.17, 1) },
      (finished) => {
        if (finished) runOnJS(finishSpin)();
      },
    );
  };

  const finishSpin = async () => {
    const reward = pendingRef.current;
    if (!reward) return;
    adjustGems(reward.gems);
    await storage.setItem(SPIN_KEY, Date.now());
    setNextSpinAt(Date.now() + SPIN_COOLDOWN_MS);
    haptic("success");
    setRevealReady(true);
    // Bright flash on stop.
    flash.value = withTiming(0.8, { duration: 100 }, () => {
      flash.value = withDelay(50, withTiming(0, { duration: 350 }));
    });
    // Hand off to the reward modal after a short beat so the reel reveal
    // has time to register visually.
    setTimeout(() => {
      setResult(reward);
      setReel(null);
      setSpinning(false);
    }, 1100);
  };

  const fmtRemaining = () => {
    const s = Math.ceil(remaining / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  };

  return (
    <View style={styles.container} testID="minigames-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Minigames</Text>
        <Text style={styles.subtitle}>Quick games for bonus rewards</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ============ Daily Spin (playable) — styled to match the loot box cards ============ */}
        <Pressable
          testID="daily-spin-card"
          onPress={onSpin}
          disabled={!canSpin || spinning}
          style={styles.cardWrap}
        >
          <LinearGradient
            colors={["#7B2FF7", "#F107A3"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.lootCard}
          >
            <View style={styles.lootIconWrap}>
              <MaterialCommunityIcons name="ferris-wheel" size={44} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.lootName}>Daily Spin</Text>
              <Text style={styles.lootDesc}>A free spin every 24 hours</Text>
              <View style={styles.lootOdds}>
                <Text style={styles.lootOddsText}>Top prize: 1,000 gems</Text>
              </View>
            </View>
            <View style={[styles.lootBtn, (!canSpin || spinning) && styles.lootBtnDisabled]}>
              <MaterialCommunityIcons
                name={spinning ? "rotate-right" : canSpin ? "diamond-stone" : "clock-outline"}
                size={15}
                color={!canSpin || spinning ? "rgba(255,255,255,0.7)" : "#1A1A1A"}
              />
              <Text style={[styles.lootBtnText, (!canSpin || spinning) && styles.lootBtnTextDisabled]}>
                {spinning ? "..." : canSpin ? "SPIN" : fmtRemaining()}
              </Text>
            </View>
          </LinearGradient>
        </Pressable>

        {/* ============ Wordle (playable) ============ */}
        <Pressable
          testID="wordle-card"
          onPress={() => {
            haptic("light");
            router.push("/wordle" as any);
          }}
          style={styles.cardWrap}
        >
          <LinearGradient
            colors={["#1B5E20", "#FFB300"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gameCard}
          >
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name="alphabetical-variant" size={44} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitle}>Tycoon Wordle</Text>
              <Text style={styles.gameDesc}>Guess the 5-letter word — earn up to 500 gems</Text>
              <View style={styles.spinCta}>
                <MaterialCommunityIcons name="play" size={14} color="#FFF" />
                <Text style={styles.spinCtaText}>PLAY NOW</Text>
              </View>
            </View>
          </LinearGradient>
        </Pressable>

        {/* ============ Tycoon Time wheel (playable) ============ */}
        <Pressable
          testID="tycoontime-card"
          onPress={() => {
            haptic("light");
            if (!ageVerified) {
              showToast("Verify your age in the Profile tab to unlock");
              router.push("/(tabs)/profile" as any);
              return;
            }
            router.push("/tycoontime" as any);
          }}
          style={styles.cardWrap}
        >
          <LinearGradient
            colors={ageVerified ? ["#FF1744", "#7B1FA2"] : ["#3A3A3A", "#1F1F1F"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gameCard}
          >
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name={ageVerified ? "cog-clockwise" : "shield-lock"} size={44} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitle}>Tycoon Time {ageVerified ? "" : "(18+)"}</Text>
              <Text style={styles.gameDesc}>
                {ageVerified ? "Live multiplayer wheel — wager any gems, up to 500× payouts" : "Verify your age in Profile to unlock this minigame"}
              </Text>
              <View style={styles.spinCta}>
                <MaterialCommunityIcons name={ageVerified ? "dice-multiple" : "lock"} size={14} color="#FFF" />
                <Text style={styles.spinCtaText}>{ageVerified ? "PLACE BET" : "LOCKED"}</Text>
              </View>
            </View>
          </LinearGradient>
        </Pressable>

        {/* ============ Coin Flip (coming soon) ============ */}
        <View style={[styles.cardWrap, styles.cardLocked]}>
          <View style={styles.gameCardLocked}>
            <View style={[styles.iconWrap, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <MaterialCommunityIcons name="coin" size={44} color={colors.onSurfaceTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitleLocked}>Coin Flip</Text>
              <Text style={styles.gameDescLocked}>Risk cash for a 50/50 double-or-nothing</Text>
              <View style={styles.soonPill}>
                <Text style={styles.soonText}>COMING SOON</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ============ Slots (coming soon) ============ */}
        <View style={[styles.cardWrap, styles.cardLocked]}>
          <View style={styles.gameCardLocked}>
            <View style={[styles.iconWrap, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <MaterialCommunityIcons name="slot-machine" size={44} color={colors.onSurfaceTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitleLocked}>Tycoon Slots</Text>
              <Text style={styles.gameDescLocked}>Spend gems for a chance at huge multipliers</Text>
              <View style={styles.soonPill}>
                <Text style={styles.soonText}>COMING SOON</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ============ CS-style horizontal reel (mirrors lootbox.tsx) ============ */}
      <Modal visible={!!reel} transparent animationType="fade">
        <View style={styles.reelBackdrop} testID="daily-spin-reel">
          <Text style={styles.reelOpening}>Spinning your Daily Reward…</Text>
          <View style={styles.reelWindow} testID="daily-spin-reel-window">
            <LinearGradient
              colors={["rgba(10,10,10,1)", "rgba(10,10,10,0)"]}
              start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
              style={styles.fadeLeft} pointerEvents="none"
            />
            <LinearGradient
              colors={["rgba(10,10,10,0)", "rgba(10,10,10,1)"]}
              start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
              style={styles.fadeRight} pointerEvents="none"
            />
            <Animated.View style={[styles.reelStrip, reelAnimStyle]}>
              {reel?.map((item, idx) => (
                <View
                  key={idx}
                  style={[styles.reelTile, { borderBottomColor: item.color, width: TILE_WIDTH }]}
                  testID={idx === WINNER_INDEX ? "daily-spin-reel-winner" : undefined}
                >
                  <View style={[styles.reelTileIcon, { backgroundColor: item.color + "22" }]}>
                    <MaterialCommunityIcons name={item.icon as any} size={34} color={item.color} />
                  </View>
                  <Text style={styles.reelTileLabel} numberOfLines={1}>{item.label}</Text>
                </View>
              ))}
            </Animated.View>
            <View pointerEvents="none" style={styles.tickerLine} />
            <View pointerEvents="none" style={styles.tickerTopArrow} />
            <View pointerEvents="none" style={styles.tickerBottomArrow} />
            <Animated.View pointerEvents="none" style={[styles.reelFlash, flashStyle]} />
          </View>
          <Text style={styles.reelHint}>{revealReady ? "🎉 Winner!" : "Watch the ticker…"}</Text>
        </View>
      </Modal>

      <Modal visible={!!result} transparent animationType="fade" onRequestClose={() => setResult(null)}>
        <View style={styles.backdrop}>
          <View style={styles.resultCard} testID="daily-spin-result">
            <View style={[styles.resultIcon, { backgroundColor: (result?.color ?? "#999") + "22" }]}>
              <MaterialCommunityIcons name="diamond-stone" size={56} color={result?.color ?? "#FFF"} />
            </View>
            <Text style={styles.resultLabel}>You won</Text>
            <Text style={[styles.resultValue, { color: result?.color ?? colors.brandTertiary }]}>
              {result?.label}
            </Text>
            <Pressable
              testID="daily-spin-claim"
              onPress={() => setResult(null)}
              style={styles.resultBtn}
            >
              <Text style={styles.resultBtnText}>Collect</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  content: { padding: spacing.md, gap: spacing.md },
  cardWrap: { borderRadius: radius.md, overflow: "hidden" },
  cardLocked: { opacity: 0.6 },
  gameCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  gameCardLocked: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  gameTitle: { color: "#FFF", fontSize: 19, fontWeight: "900" },
  gameDesc: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600", marginTop: 2 },
  gameTitleLocked: { color: colors.onSurface, fontSize: 19, fontWeight: "900" },
  gameDescLocked: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", marginTop: 2 },
  spinCta: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  spinCtaText: { color: "#FFF", fontSize: 12, fontWeight: "900", letterSpacing: 0.5 },

  // Loot-box-style card (mirrors lootbox.tsx `boxCard`/`freeCard` so the
  // Daily Spin reads as part of the same family of free / unlock rewards).
  lootCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  lootIconWrap: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  lootName: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  lootDesc: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600", marginTop: 1 },
  lootOdds: { marginTop: 4 },
  lootOddsText: { color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "800" },
  lootBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFD54A",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 78,
    justifyContent: "center",
  },
  lootBtnDisabled: { backgroundColor: "rgba(255,255,255,0.18)" },
  lootBtnText: { color: "#1A1A1A", fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  lootBtnTextDisabled: { color: "rgba(255,255,255,0.7)" },

  // CS-style horizontal reel (mirrors lootbox.tsx styles so the Daily
  // Spin animation feels identical to opening a loot box).
  reelBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  reelOpening: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  reelWindow: {
    width: "100%",
    maxWidth: 420,
    height: 120,
    backgroundColor: "#0A0A0A",
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.brandPrimary,
    overflow: "hidden",
  },
  reelStrip: {
    flexDirection: "row",
    alignItems: "center",
    height: 120,
    gap: 8,
    paddingHorizontal: 0,
  },
  reelTile: {
    height: 108,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: radius.md,
    borderBottomWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  reelTileIcon: {
    width: 50,
    height: 50,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  reelTileLabel: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  fadeLeft: { position: "absolute", left: 0, top: 0, bottom: 0, width: 48, zIndex: 2 },
  fadeRight: { position: "absolute", right: 0, top: 0, bottom: 0, width: 48, zIndex: 2 },
  tickerLine: {
    position: "absolute",
    top: 0, bottom: 0,
    left: "50%",
    width: 2,
    marginLeft: -1,
    backgroundColor: "#FFD54A",
    zIndex: 3,
  },
  tickerTopArrow: {
    position: "absolute",
    top: -2, left: "50%", marginLeft: -8,
    width: 0, height: 0,
    borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 10,
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: "#FFD54A",
    zIndex: 3,
  },
  tickerBottomArrow: {
    position: "absolute",
    bottom: -2, left: "50%", marginLeft: -8,
    width: 0, height: 0,
    borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 10,
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderBottomColor: "#FFD54A",
    zIndex: 3,
  },
  reelFlash: {
    position: "absolute",
    top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: "#FFFFFF",
    zIndex: 4,
  },
  reelHint: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.md,
  },
  soonPill: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  soonText: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
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
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  resultLabel: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "700" },
  resultValue: { fontSize: 32, fontWeight: "900", marginVertical: spacing.sm },
  resultBtn: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  resultBtnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900" },
});
