import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname } from "expo-router";

import { colors, radius, spacing } from "@/src/game/theme";
import { money, abbreviate } from "@/src/game/format";
import { haptic } from "@/src/game/haptics";
import { BUSINESSES } from "@/src/game/businesses";
import { useGame } from "@/src/game/GameContext";
import { useAds } from "@/src/ads/AdsProvider";
import {
  computeGemStake,
  computeStake,
  EVENT_INTERVAL_MS,
  EVENTS,
  GameEvent,
  randomEvent,
} from "@/src/game/events";

const INTERSTITIAL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const POLL_MS = 30 * 1000;
const MIN_CASH_FOR_EVENT = 100;

type Phase = "prompt" | "win" | "lose";
type Prop = { id: string; name: string; level: number } | null;

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const { state, adjustCash, adjustGems, setBusinessLevel, markEvent, markInterstitial } = useGame();
  const { showRewarded, showInterstitial } = useAds();
  const pathname = usePathname();

  // Scenario events are an Empire-tab-only mechanic. Track current route so
  // the trigger interval can skip when the player is elsewhere and so the
  // modal hides if they navigate away mid-prompt.
  const onEmpireRef = useRef(false);
  onEmpireRef.current = pathname === "/" || pathname === "";

  const [event, setEvent] = useState<GameEvent | null>(null);
  const [amount, setAmount] = useState(0); // cash or gems (property: cash fine)
  const [reward, setReward] = useState(0); // property win → gem reward
  const [prop, setProp] = useState<Prop>(null);
  const [phase, setPhase] = useState<Phase>("prompt");
  const [adBusy, setAdBusy] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const openRef = useRef(false);
  openRef.current = event !== null;

  const stakeIsGems = event?.stake === "gems";
  const isProperty = event?.stake === "property";

  // Random business events (~every 5 minutes once the player has some cash).
  // Only fire while the Empire tab is the active route — these are an
  // Empire-tab mechanic by design.
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      if (!s || openRef.current) return;
      if (!onEmpireRef.current) return;
      if (s.cash < MIN_CASH_FOR_EVENT) return;
      if (s.lastEventAt && Date.now() - s.lastEventAt < EVENT_INTERVAL_MS) return;

      let ev = randomEvent();
      const owned = BUSINESSES.filter((d) => (s.businesses[d.id]?.level ?? 0) > 0);

      // Fall back to a cash scenario when the stake type isn't viable.
      if (ev.stake === "gems" && s.gems < 10) ev = EVENTS.find((e) => e.stake === "cash")!;
      if (ev.stake === "property" && owned.length < 2) ev = EVENTS.find((e) => e.stake === "cash")!;

      if (ev.stake === "property") {
        const pick = owned[Math.floor(Math.random() * owned.length)];
        setProp({ id: pick.id, name: pick.name, level: s.businesses[pick.id].level });
        setAmount(computeStake(s.cash)); // cash fine to settle
        setReward(20 + Math.floor(Math.random() * 30));
      } else if (ev.stake === "gems") {
        setProp(null);
        setAmount(computeGemStake(s.gems));
      } else {
        setProp(null);
        setAmount(computeStake(s.cash));
      }
      setPhase("prompt");
      setEvent(ev);
      markEvent();
      haptic("heavy");
    }, POLL_MS);
    return () => clearInterval(id);
  }, [markEvent]);

  // Baseline so the interstitial doesn't fire on first load.
  useEffect(() => {
    if (state && state.lastInterstitialAt === 0) markInterstitial();
  }, [state, markInterstitial]);

  // Unskippable interstitial every 10 minutes (unless ads removed, or the
  // brand-new player is still inside their 30-minute ad-free grace window).
  useEffect(() => {
    const id = setInterval(async () => {
      const s = stateRef.current;
      if (!s || openRef.current || s.adsRemoved || s.lastInterstitialAt === 0) return;
      if (s.firstLaunchAt && Date.now() - s.firstLaunchAt < 30 * 60 * 1000) return;
      if (Date.now() - s.lastInterstitialAt < INTERSTITIAL_INTERVAL_MS) return;
      markInterstitial();
      await showInterstitial();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [markInterstitial, showInterstitial]);

  const winChance = Math.min(0.85, (event?.odds ?? 0.5) + (state?.gemUpgrades.luckyFighter ? 0.15 : 0));

  const close = useCallback(() => {
    setEvent(null);
    setPhase("prompt");
    setAdBusy(false);
    setProp(null);
  }, []);

  const onPay = useCallback(() => {
    haptic("medium");
    if (stakeIsGems) adjustGems(-amount);
    else adjustCash(-amount); // property settles with a cash fine
    close();
  }, [stakeIsGems, adjustGems, adjustCash, amount, close]);

  const onFight = useCallback(() => {
    haptic("heavy");
    const won = Math.random() < winChance;
    if (won) {
      if (event?.stake === "cash") adjustCash(amount);
      else if (event?.stake === "gems") adjustGems(amount);
      else adjustGems(reward); // property kept + gem reward
      setPhase("win");
    } else {
      if (event?.stake === "cash") adjustCash(-amount);
      else if (event?.stake === "gems") adjustGems(-amount);
      else if (prop) setBusinessLevel(prop.id, 0); // lose the property
      setPhase("lose");
    }
  }, [winChance, event, amount, reward, prop, adjustCash, adjustGems, setBusinessLevel]);

  // Win: 30s ad to TRIPLE the reward (we gave 1x; add 2x more).
  const onTriple = useCallback(async () => {
    setAdBusy(true);
    const ok = await showRewarded({ seconds: 30, title: "Watch to Triple Your Winnings", reward: "3x reward" });
    if (ok) {
      if (event?.stake === "cash") adjustCash(amount * 2);
      else if (event?.stake === "gems") adjustGems(amount * 2);
      else adjustGems(reward * 2);
      haptic("success");
    }
    close();
  }, [showRewarded, event, amount, reward, adjustCash, adjustGems, close]);

  // Lose: 30s ad to undo the loss.
  const onSave = useCallback(async () => {
    setAdBusy(true);
    const ok = await showRewarded({ seconds: 30, title: "Watch to Undo the Loss", reward: "Get it back" });
    if (ok) {
      if (event?.stake === "cash") adjustCash(amount);
      else if (event?.stake === "gems") adjustGems(amount);
      else if (prop) setBusinessLevel(prop.id, prop.level); // restore property
      haptic("success");
    }
    close();
  }, [showRewarded, event, amount, prop, adjustCash, adjustGems, setBusinessLevel, close]);

  const GemVal = ({ n, color }: { n: number; color?: string }) => (
    <View style={styles.gemVal}>
      <MaterialCommunityIcons name="diamond-stone" size={26} color={color ?? colors.brandTertiary} />
      <Text style={[styles.stakeVal, { color: color ?? colors.brandTertiary }]}>{abbreviate(n)}</Text>
    </View>
  );

  return (
    <>
      {children}
      <Modal visible={!!event} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.card} testID="event-modal">
            {phase === "prompt" && event && (
              <>
                <View style={[styles.iconWrap, { backgroundColor: colors.warning + "22" }]}>
                  <MaterialCommunityIcons name={event.icon as any} size={40} color={colors.warning} />
                </View>
                <Text style={styles.title}>{event.title}</Text>
                <Text style={styles.body}>{event.body}</Text>

                <View style={styles.stakeBox}>
                  <Text style={styles.stakeLabel}>{isProperty ? "PROPERTY AT RISK" : "AT STAKE"}</Text>
                  {isProperty ? (
                    <Text testID="event-stake" style={[styles.stakeVal, { color: colors.warning }]}>
                      {prop?.name}
                    </Text>
                  ) : stakeIsGems ? (
                    <GemVal n={amount} color={colors.warning} />
                  ) : (
                    <Text testID="event-stake" style={styles.stakeVal}>
                      {money(amount)}
                    </Text>
                  )}
                  <View style={styles.oddsPill}>
                    <MaterialCommunityIcons name="dice-multiple" size={13} color={colors.onSurface} />
                    <Text testID="event-odds" style={styles.oddsText}>
                      Win chance if you fight: {Math.round(winChance * 100)}%
                    </Text>
                  </View>
                </View>

                <Pressable testID="event-pay-button" onPress={onPay} style={styles.payBtn}>
                  <MaterialCommunityIcons
                    name={stakeIsGems ? "diamond-stone" : "cash"}
                    size={18}
                    color={colors.onSurface}
                  />
                  <Text style={styles.payText}>
                    {event.payLabel}
                    {isProperty ? ` (${money(amount)})` : ""}
                  </Text>
                </Pressable>
                <Pressable testID="event-fight-button" onPress={onFight} style={styles.fightBtn}>
                  <LinearGradient
                    colors={[colors.brandTertiary, "#D84315"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.fightGrad}
                  >
                    <MaterialCommunityIcons name="sword-cross" size={18} color={colors.onBrandTertiary} />
                    <Text style={styles.fightText}>{event.fightLabel}</Text>
                  </LinearGradient>
                </Pressable>
              </>
            )}

            {phase === "win" && event && (
              <>
                <View style={[styles.iconWrap, { backgroundColor: colors.brandSecondary + "22" }]}>
                  <MaterialCommunityIcons name="trophy" size={40} color={colors.brandSecondary} />
                </View>
                <Text style={styles.title}>You Won!</Text>
                <Text style={styles.body}>{event.winText}</Text>
                {isProperty ? (
                  <View style={styles.gemVal}>
                    <Text style={[styles.stakeVal, { color: colors.brandSecondary }]}>+</Text>
                    <GemVal n={reward} color={colors.brandSecondary} />
                  </View>
                ) : stakeIsGems ? (
                  <GemVal n={amount} color={colors.brandSecondary} />
                ) : (
                  <Text testID="event-result-amount" style={[styles.stakeVal, { color: colors.brandSecondary }]}>
                    +{money(amount)}
                  </Text>
                )}
                <Pressable testID="event-triple-button" onPress={onTriple} disabled={adBusy} style={styles.fightBtn}>
                  <LinearGradient
                    colors={[colors.brandPrimary, "#FF8F00"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.fightGrad}
                  >
                    <MaterialCommunityIcons name="play-circle" size={18} color={colors.onBrandPrimary} />
                    <Text style={[styles.fightText, { color: colors.onBrandPrimary }]}>Watch ad → TRIPLE it</Text>
                  </LinearGradient>
                </Pressable>
                <Pressable testID="event-collect-button" onPress={close} style={styles.dismiss}>
                  <Text style={styles.dismissText}>Just collect</Text>
                </Pressable>
              </>
            )}

            {phase === "lose" && event && (
              <>
                <View style={[styles.iconWrap, { backgroundColor: colors.error + "22" }]}>
                  <MaterialCommunityIcons name="emoticon-sad" size={40} color={colors.error} />
                </View>
                <Text style={styles.title}>You Lost</Text>
                <Text style={styles.body}>{event.loseText}</Text>
                {isProperty ? (
                  <Text testID="event-result-amount" style={[styles.stakeVal, { color: colors.error }]}>
                    Lost {prop?.name}
                  </Text>
                ) : stakeIsGems ? (
                  <GemVal n={amount} color={colors.error} />
                ) : (
                  <Text testID="event-result-amount" style={[styles.stakeVal, { color: colors.error }]}>
                    -{money(amount)}
                  </Text>
                )}
                <Pressable testID="event-save-button" onPress={onSave} disabled={adBusy} style={styles.fightBtn}>
                  <LinearGradient
                    colors={[colors.brandSecondary, "#00C853"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.fightGrad}
                  >
                    <MaterialCommunityIcons name="play-circle" size={18} color={colors.onBrandSecondary} />
                    <Text style={[styles.fightText, { color: colors.onBrandSecondary }]}>
                      {isProperty ? "Watch ad → Save your property" : "Watch ad → Get it back"}
                    </Text>
                  </LinearGradient>
                </Pressable>
                <Pressable testID="event-accept-button" onPress={close} style={styles.dismiss}>
                  <Text style={styles.dismissText}>Accept the loss</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
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
    borderColor: colors.border,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "900", textAlign: "center" },
  body: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  stakeBox: {
    alignItems: "center",
    marginVertical: spacing.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    width: "100%",
  },
  stakeLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  stakeVal: { color: colors.warning, fontSize: 28, fontWeight: "900", marginVertical: spacing.sm },
  gemVal: { flexDirection: "row", alignItems: "center", gap: 6 },
  oddsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  oddsText: { color: colors.onSurface, fontSize: 12, fontWeight: "800" },
  payBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    width: "100%",
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  payText: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  fightBtn: { width: "100%", borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.md },
  fightGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  fightText: { color: colors.onBrandTertiary, fontSize: 15, fontWeight: "900" },
  dismiss: { paddingVertical: spacing.md, marginTop: spacing.xs },
  dismissText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
});
