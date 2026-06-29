/**
 * Immersive Tutorial — page-by-page walkthrough.
 *
 * On first run (after the user picks a tycoon name), the tutorial takes
 * control of router navigation and steps through each main page of the
 * app: Empire, Managers, Prestige, Boost, Cities, Games, Shop, Profile.
 * Each step renders an overlay above the live page so the player actually
 * sees the screen being explained — taps on the page itself are absorbed
 * by a translucent scrim so they can't accidentally buy a business or
 * trigger an offer while the tour is running.
 *
 * Exports kept identical to the previous static modal version so the
 * Profile "Replay tutorial" button (and any other caller) keeps working:
 *   - default `TutorialGate`
 *   - `openTutorial()`  → force-show
 *   - `resetTutorial()` → clear the "seen" flag
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { storage } from "@/src/utils/storage";
import { haptic } from "@/src/game/haptics";

const TUTORIAL_SEEN_KEY = "tycoon_tutorial_v2_seen";

// Pub/sub so the Profile "Replay tutorial" button can force the tour open
// without unmounting the gate.
let showOverride: (() => void) | null = null;
export function openTutorial() {
  showOverride?.();
}

export async function resetTutorial() {
  await storage.removeItem(TUTORIAL_SEEN_KEY);
}

// --- Active-state subscription -------------------------------------------------
// Other modal-style components (GrandPrizePromo, OffersProvider Flash Sale)
// MUST NOT render on top of the tutorial — on react-native-web a portal'd
// Modal always wins z-order regardless of declaration order. They subscribe
// to this signal and hide themselves while the tour is running.
let tutorialActive = false;
const listeners = new Set<(active: boolean) => void>();
function setTutorialActive(v: boolean) {
  if (tutorialActive === v) return;
  tutorialActive = v;
  listeners.forEach((l) => l(v));
}
export function isTutorialActive(): boolean {
  return tutorialActive;
}
export function useTutorialActive(): boolean {
  const [v, setV] = useState(tutorialActive);
  useEffect(() => {
    const fn = (next: boolean) => setV(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return v;
}

type Step = {
  key: string;
  /** Route to navigate to (or null for screens that don't move the camera). */
  route: string | null;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  accent: string;
  title: string;
  body: string;
  /** Where the explanation card sits on screen — keep it away from what
   *  we want the user to look at. */
  cardPosition: "bottom" | "top";
};

const STEPS: Step[] = [
  {
    key: "welcome",
    route: "/",
    icon: "crown",
    accent: colors.brandPrimary,
    title: "Welcome, Tycoon",
    body:
      "Quick guided tour of your empire — about a minute. I'll walk you through every page so you know exactly where things live before we cut you loose.",
    cardPosition: "bottom",
  },
  {
    key: "empire",
    route: "/",
    icon: "store",
    accent: "#FFB300",
    title: "Empire — your main floor",
    body:
      "Each row is a business. Tap one to run a cycle and collect cash; the bigger green BUY button raises its level so it earns more next time. Watch the milestone numbers (25, 50, 100…) — hitting them multiplies a business's payout permanently.",
    cardPosition: "bottom",
  },
  {
    key: "managers",
    route: "/managers",
    icon: "account-tie",
    accent: "#00E676",
    title: "Managers — go AFK",
    body:
      "Hire a manager and that business runs itself, forever, even while you're offline. This is how you stop tapping and start scaling — the offline earnings you collect on your next launch come from managed businesses.",
    cardPosition: "bottom",
  },
  {
    key: "prestige",
    route: "/prestige",
    icon: "restart",
    accent: "#FF5722",
    title: "Prestige — reset to grow",
    body:
      "Trade your empire in for Investors, a permanent global income multiplier. The trick: prestige early and often. Each run starts faster than the last because every Investor sticks around.",
    cardPosition: "bottom",
  },
  {
    key: "boost",
    route: "/boost",
    icon: "rocket-launch",
    accent: "#7B2FF7",
    title: "Boost — temporary rocket fuel",
    body:
      "Watch a rewarded ad or spend gems to crank your income x2/x3 for a few minutes. Stack these right before a prestige run to multiply how many Investors you walk away with.",
    cardPosition: "bottom",
  },
  {
    key: "cities",
    route: "/cities",
    icon: "city-variant",
    accent: "#4A90E2",
    title: "Cities — your clan",
    body:
      "Cities are clans. Join one to unlock shared city-wide income bonuses, chat with members in real time, and gift gems back and forth. The bigger your city, the higher the multiplier.",
    cardPosition: "bottom",
  },
  {
    key: "minigames",
    route: "/minigames",
    icon: "gamepad-variant",
    accent: "#00BCD4",
    title: "Games — free rewards",
    body:
      "Daily minigames (Wordle, Tycoon Time, scratchers) pay out gems, cash, and loot keys. Five minutes here every day = thousands of free gems a month. Don't skip them.",
    cardPosition: "bottom",
  },
  {
    key: "shop",
    route: "/shop",
    icon: "diamond-stone",
    accent: "#F2994A",
    title: "Shop — gems, lootboxes, perks",
    body:
      "Gem bundles, Pro Boosts (permanent passive bonuses), the Remove-Ads pack, and Lootboxes (open with Keys for random gems). The Daily Deal at the top rotates every 24h — usually the best gem-per-dollar in the game.",
    cardPosition: "bottom",
  },
  {
    key: "profile",
    route: "/profile",
    icon: "account-circle",
    accent: "#26C6DA",
    title: "Profile — settings & invites",
    body:
      "Your account, audio toggles, your invite code (50 gems per friend who joins) and the Replay Tutorial button live here. If you ever forget a feature — come back to this page.",
    cardPosition: "bottom",
  },
  {
    key: "done",
    route: "/",
    icon: "check-circle",
    accent: colors.brandSecondary,
    title: "You're ready",
    body:
      "Tap businesses, hire managers, prestige early, watch your income compound. Build the world's biggest empire — and have fun doing it.",
    cardPosition: "bottom",
  },
];

export default function TutorialGate() {
  const { state } = useGame();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;

  const hasName = !!(state?.playerName ?? "").trim();

  // First-run trigger — only after the name gate has cleared so we don't
  // stack two modals on a brand-new player.
  useEffect(() => {
    if (!hasName) return;
    let cancelled = false;
    (async () => {
      const seen = await storage.getItem(TUTORIAL_SEEN_KEY, "");
      if (!cancelled && seen !== "1") {
        setIndex(0);
        setVisible(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasName]);

  // Imperative opener for Profile → Replay tutorial.
  useEffect(() => {
    showOverride = () => {
      setIndex(0);
      setVisible(true);
    };
    return () => {
      showOverride = null;
    };
  }, []);

  // Drive the camera. Whenever the step changes, route to that page.
  useEffect(() => {
    if (!visible) {
      setTutorialActive(false);
      return;
    }
    setTutorialActive(true);
    const step = STEPS[index];
    if (step.route) {
      // Use replace so we don't pile up a back stack the user could escape through.
      router.replace(step.route as never);
    }
    // Animate the card in.
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, index, router, fade]);

  // Clear the active flag on unmount in case the tour is killed mid-step.
  useEffect(() => () => setTutorialActive(false), []);

  const finish = useCallback(async () => {
    haptic("success");
    await storage.setItem(TUTORIAL_SEEN_KEY, "1");
    setVisible(false);
    router.replace("/" as never);
  }, [router]);

  const next = useCallback(() => {
    if (index < STEPS.length - 1) {
      haptic("light");
      setIndex(index + 1);
    } else {
      finish();
    }
  }, [index, finish]);

  const back = useCallback(() => {
    if (index === 0) return;
    haptic("light");
    setIndex(index - 1);
  }, [index]);

  if (!visible) return null;

  const step = STEPS[index];
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;
  const progress = (index + 1) / STEPS.length;

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "box-none" }]} testID="tutorial-gate">
      {/* Scrim — absorbs taps on the underlying page so users can't bump a
          business mid-tour. Translucent so the page is still visible. */}
      <Pressable
        testID="tutorial-scrim"
        style={[StyleSheet.absoluteFill, styles.scrim]}
        onPress={() => { /* eat taps; no-op */ }}
      />

      {/* Top progress + skip. */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, pointerEvents: "box-none" }]}>
        <View style={styles.progressTrack} testID="tutorial-progress">
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: step.accent }]} />
        </View>
        <Pressable
          testID="tutorial-skip"
          onPress={finish}
          hitSlop={16}
          style={styles.skipBtn}
        >
          <Text style={styles.skipText}>Skip tour</Text>
        </Pressable>
      </View>

      {/* Explanation card at the bottom (well clear of the tab bar). */}
      <Animated.View
        style={[
          styles.cardOuter,
          {
            bottom: insets.bottom + 88, // 88 ≈ tab bar height; sits just above it.
            opacity: fade,
            pointerEvents: "box-none",
            transform: [
              {
                translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
              },
            ],
          },
        ]}
      >
        <View style={styles.card} testID={`tutorial-step-${step.key}`}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconWrap, { backgroundColor: step.accent + "22", borderColor: step.accent }]}>
              <MaterialCommunityIcons name={step.icon} size={24} color={step.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.step}>{index + 1} / {STEPS.length}</Text>
              <Text style={styles.title}>{step.title}</Text>
            </View>
          </View>

          <Text style={styles.body}>{step.body}</Text>

          <View style={styles.actions}>
            <Pressable
              testID="tutorial-back"
              onPress={back}
              disabled={isFirst}
              style={[styles.backBtn, isFirst && styles.disabled]}
            >
              <MaterialCommunityIcons name="arrow-left" size={16} color={colors.onSurface} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>

            <Pressable
              testID={isLast ? "tutorial-done" : "tutorial-next"}
              onPress={next}
              style={[styles.nextBtn, { backgroundColor: step.accent }]}
            >
              <Text style={styles.nextText}>{isLast ? "Start playing" : "Next"}</Text>
              <MaterialCommunityIcons
                name={isLast ? "check" : "arrow-right"}
                size={16}
                color={colors.onBrandPrimary}
              />
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.16)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  skipBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: radius.pill,
  },
  skipText: {
    color: colors.onSurface,
    fontSize: 12,
    fontWeight: "800",
  },

  cardOuter: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  step: {
    color: colors.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    color: colors.onSurface,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  body: {
    color: colors.onSurfaceTertiary,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
  },
  backText: {
    color: colors.onSurface,
    fontSize: 13,
    fontWeight: "800",
  },
  nextBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  nextText: {
    color: colors.onBrandPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.4,
  },
});
