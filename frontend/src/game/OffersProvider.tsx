import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

import { colors, radius, spacing } from "@/src/game/theme";
import { haptic } from "@/src/game/haptics";
import { storage } from "@/src/utils/storage";
import { useGame } from "@/src/game/GameContext";
import { useTutorialActive } from "@/src/components/TutorialGate";
import {
  OFFER_DURATION_MS,
  OFFER_INTERVAL_MS,
  OFFER_POPUP_COOLDOWN_MS,
  OfferTarget,
  randomOffer,
  SpecialOffer,
} from "@/src/game/offers";

type OffersContextValue = {
  offer: SpecialOffer | null;
  timeLeftMs: number;
  discountFor: (target: OfferTarget) => number;
};

const OffersContext = createContext<OffersContextValue | null>(null);

const POPUP_LAST_SHOWN_KEY = "tycoon_offer_popup_last_shown";

export function OffersProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { state } = useGame();
  const tutorialActive = useTutorialActive();
  const hasName = !!(state?.playerName ?? "").trim();
  const [offer, setOffer] = useState<SpecialOffer | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [popup, setPopup] = useState<SpecialOffer | null>(null);
  const lastPopupRef = useRef<number>(0);
  const readyRef = useRef<boolean>(false);

  // Load the last popup timestamp once at startup so the 10-min cooldown
  // is preserved across reloads, not just within a single session.
  useEffect(() => {
    (async () => {
      const v = await storage.getItem(POPUP_LAST_SHOWN_KEY, 0);
      lastPopupRef.current = typeof v === "number" ? v : 0;
      readyRef.current = true;
    })();
  }, []);

  const start = useCallback(() => {
    if (!readyRef.current) return; // wait until cooldown is loaded
    const o = randomOffer();
    setOffer(o);
    setExpiresAt(Date.now() + OFFER_DURATION_MS);
    // Throttle the popup to at most once every OFFER_POPUP_COOLDOWN_MS.
    const since = Date.now() - lastPopupRef.current;
    if (since >= OFFER_POPUP_COOLDOWN_MS) {
      lastPopupRef.current = Date.now();
      storage.setItem(POPUP_LAST_SHOWN_KEY, lastPopupRef.current);
      setPopup(o);
      haptic("medium");
    }
  }, []);

  // Run the offer rotation every OFFER_INTERVAL_MS. We schedule the first
  // tick after the cooldown is loaded so we never bypass it on cold start.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const armWhenReady = () => {
      if (readyRef.current) {
        start();
        intervalId = setInterval(start, OFFER_INTERVAL_MS);
      } else {
        timeoutId = setTimeout(armWhenReady, 250);
      }
    };
    armWhenReady();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [start]);

  // 1s ticker to drive countdown + auto-expire.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const active = offer && now < expiresAt;
  const timeLeftMs = active ? expiresAt - now : 0;

  const discountFor = useCallback(
    (target: OfferTarget) => (active && offer?.target === target ? offer.discount : 0),
    [active, offer],
  );

  return (
    <OffersContext.Provider value={{ offer: active ? offer : null, timeLeftMs, discountFor }}>
      {children}
      <Modal visible={!!popup && hasName && !tutorialActive} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.card} testID="offer-popup">
            <View style={[styles.iconWrap, { backgroundColor: (popup?.color ?? colors.brandPrimary) + "22" }]}>
              <MaterialCommunityIcons
                name={(popup?.icon ?? "sale") as any}
                size={40}
                color={popup?.color ?? colors.brandPrimary}
              />
            </View>
            <View style={styles.flashTag}>
              <Text style={styles.flashText}>FLASH SALE</Text>
            </View>
            <Text style={styles.title}>{popup?.title}</Text>
            <Text style={styles.blurb}>{popup?.blurb}</Text>
            <Pressable
              testID="offer-popup-cta"
              onPress={() => {
                haptic("success");
                setPopup(null);
                router.push("/shop" as any);
              }}
              style={styles.cta}
            >
              <LinearGradient
                colors={[colors.brandPrimary, "#FF8F00"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.ctaGrad}
              >
                <Text style={styles.ctaText}>GRAB THE DEAL</Text>
              </LinearGradient>
            </Pressable>
            <Pressable testID="offer-popup-dismiss" onPress={() => setPopup(null)} style={styles.dismiss}>
              <Text style={styles.dismissText}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </OffersContext.Provider>
  );
}

export function useOffers(): OffersContextValue {
  const ctx = useContext(OffersContext);
  if (!ctx) throw new Error("useOffers must be used within OffersProvider");
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
  card: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  flashTag: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  flashText: { color: colors.onBrandTertiary, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "900", textAlign: "center" },
  blurb: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  cta: { width: "100%", borderRadius: radius.pill, overflow: "hidden" },
  ctaGrad: { paddingVertical: spacing.lg, alignItems: "center" },
  ctaText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "900", letterSpacing: 1 },
  dismiss: { paddingVertical: spacing.md },
  dismissText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
});
