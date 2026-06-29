import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { admobAvailable, showRewardedAdmob, showInterstitialAdmob } from "@/src/ads/admob";
import { colors, radius, spacing } from "@/src/game/theme";
import { haptic } from "@/src/game/haptics";

export type ShowAdOpts = { seconds: number; title: string; reward: string };

type AdsContextValue = {
  showRewarded: (o: ShowAdOpts) => Promise<boolean>;
  showInterstitial: () => Promise<void>;
};

const AdsContext = createContext<AdsContextValue | null>(null);

export function AdsProvider({ children }: { children: React.ReactNode }) {
  const [sim, setSim] = useState<ShowAdOpts | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [done, setDone] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Full-screen unskippable interstitial (separate from rewarded)
  const [inter, setInter] = useState(false);
  const [interLeft, setInterLeft] = useState(0);
  const interResolver = useRef<(() => void) | null>(null);
  const interTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const finish = useCallback((v: boolean) => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setSim(null);
    setDone(false);
    setRemaining(0);
    const r = resolver.current;
    resolver.current = null;
    if (r) r(v);
  }, []);

  const showRewarded = useCallback(async (o: ShowAdOpts) => {
    if (admobAvailable) {
      return showRewardedAdmob();
    }
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setSim(o);
      setDone(false);
      setRemaining(o.seconds);
      timer.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            if (timer.current) clearInterval(timer.current);
            timer.current = null;
            setDone(true);
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    });
  }, []);

  const finishInter = useCallback(() => {
    if (interTimer.current) clearInterval(interTimer.current);
    interTimer.current = null;
    setInter(false);
    setInterLeft(0);
    const r = interResolver.current;
    interResolver.current = null;
    if (r) r();
  }, []);

  // Unskippable interstitial: real AdMob in a native build, else a short
  // simulated countdown with a Continue button (preview / Expo Go / web).
  const showInterstitial = useCallback(async () => {
    if (admobAvailable) {
      const shown = await showInterstitialAdmob();
      if (shown) return;
      // fall through to the simulated interstitial if the ad failed to load
    }
    return new Promise<void>((resolve) => {
      interResolver.current = resolve;
      setInter(true);
      setInterLeft(5);
      interTimer.current = setInterval(() => {
        setInterLeft((r) => {
          if (r <= 1) {
            if (interTimer.current) clearInterval(interTimer.current);
            interTimer.current = null;
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    });
  }, []);

  return (
    <AdsContext.Provider value={{ showRewarded, showInterstitial }}>
      {children}
      <Modal visible={!!sim} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="simulated-ad-sheet">
            <View style={styles.adTag}>
              <Text style={styles.adTagText}>AD</Text>
            </View>
            <Text style={styles.title}>{sim?.title}</Text>
            <Text style={styles.reward}>Reward: {sim?.reward}</Text>

            <View style={styles.videoBox}>
              <MaterialCommunityIcons name="television-play" size={44} color={colors.onSurfaceTertiary} />
              <Text style={styles.videoText}>Simulated video ad</Text>
            </View>

            {done ? (
              <Pressable
                testID="ad-claim-button"
                onPress={() => {
                  haptic("success");
                  finish(true);
                }}
                style={styles.claimBtn}
              >
                <LinearGradient
                  colors={[colors.brandSecondary, "#00C853"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.claimGrad}
                >
                  <MaterialCommunityIcons name="gift" size={18} color={colors.onBrandSecondary} />
                  <Text style={styles.claimText}>CLAIM REWARD</Text>
                </LinearGradient>
              </Pressable>
            ) : (
              <View style={styles.countRow}>
                <MaterialCommunityIcons name="timer-sand" size={16} color={colors.onSurfaceTertiary} />
                <Text style={styles.countText}>Reward in {remaining}s</Text>
              </View>
            )}

            <Pressable testID="ad-close-button" onPress={() => finish(false)} style={styles.closeBtn}>
              <Text style={styles.closeText}>{done ? "Close" : "Skip (no reward)"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={inter} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="interstitial-ad">
            <View style={styles.adTag}>
              <Text style={styles.adTagText}>AD</Text>
            </View>
            <Text style={styles.title}>Advertisement</Text>
            <View style={styles.videoBox}>
              <MaterialCommunityIcons name="television-classic" size={44} color={colors.onSurfaceTertiary} />
              <Text style={styles.videoText}>Your game continues after this ad</Text>
            </View>
            {interLeft > 0 ? (
              <View style={styles.countRow}>
                <MaterialCommunityIcons name="timer-sand" size={16} color={colors.onSurfaceTertiary} />
                <Text style={styles.countText}>Continue in {interLeft}s</Text>
              </View>
            ) : (
              <Pressable
                testID="interstitial-continue-button"
                onPress={() => {
                  haptic("light");
                  finishInter();
                }}
                style={styles.claimBtn}
              >
                <LinearGradient
                  colors={[colors.brandPrimary, "#FF8F00"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.claimGrad}
                >
                  <Text style={[styles.claimText, { color: colors.onBrandPrimary }]}>CONTINUE</Text>
                </LinearGradient>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </AdsContext.Provider>
  );
}

export function useAds(): AdsContextValue {
  const ctx = useContext(AdsContext);
  if (!ctx) throw new Error("useAds must be used within AdsProvider");
  return ctx;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
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
  adTag: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  adTagText: { color: "#3A2A00", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "900", textAlign: "center" },
  reward: { color: colors.brandSecondary, fontSize: 15, fontWeight: "800", marginTop: 2 },
  videoBox: {
    width: "100%",
    height: 150,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  videoText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
  claimBtn: { width: "100%", borderRadius: radius.pill, overflow: "hidden" },
  claimGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  claimText: { color: colors.onBrandSecondary, fontSize: 16, fontWeight: "900", letterSpacing: 1 },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  countText: { color: colors.onSurfaceSecondary, fontSize: 15, fontWeight: "800" },
  closeBtn: { paddingVertical: spacing.md },
  closeText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
});
