import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";

import { colors, radius, spacing } from "@/src/game/theme";
import { abbreviate, formatDuration, money } from "@/src/game/format";
import {
  FREE_GEM_AMOUNT,
  FREE_GEM_INTERVAL_MS,
  FREE_GEM_INTERVAL_FAST_MS,
  GEM_PACKS,
  GEM_UPGRADES,
  dailyRewardForStreak,
} from "@/src/game/gems";
import {
  FREE_BOX,
  FREE_LOOT_INTERVAL_MS,
  LOOT_BOXES,
  LootBox,
  LootReward,
  rollLoot,
} from "@/src/game/lootbox";
import { XP_LOOTBOX, XP_PURCHASE } from "@/src/game/levels";
import { useGame } from "@/src/game/GameContext";
import { useAds } from "@/src/ads/AdsProvider";
import { useOffers } from "@/src/game/OffersProvider";
import { haptic } from "@/src/game/haptics";
import { createCheckout, getPaymentStatus, redeemPromo, getStoreCatalog, StoreItem, getFirstPurchaseStatus } from "@/src/game/api";
import { usePlayBilling } from "@/src/game/playBilling";

const REMOVE_ADS_PRICE = 14.99;

const EXTRA_BUNDLES: {
  id: string;
  tag: string;
  title: string;
  colors: [string, string];
  items: string[];
  fallback: string;
  best?: boolean;
}[] = [
  {
    id: "bundle_value",
    tag: "VALUE PACK",
    title: "Value Pack",
    colors: ["#11998e", "#38ef7d"],
    items: ["💎  +500 Gems", "👥  +300 Investors", "🔑  +15 Loot Keys"],
    fallback: "$9.99",
  },
  {
    id: "bundle_mogul",
    tag: "MOST POPULAR",
    title: "Mega Mogul Bundle",
    colors: ["#8E2DE2", "#4A00E0"],
    items: ["💎  +1,500 Gems", "👥  +1,000 Investors", "🔑  +30 Loot Keys"],
    fallback: "$19.99",
    best: true,
  },
  {
    id: "bundle_ultimate",
    tag: "ULTIMATE",
    title: "Ultimate Empire Bundle",
    colors: ["#f12711", "#f5af19"],
    items: ["💎  +3,000 Gems", "👥  +3,000 Investors", "🔑  +60 Loot Keys"],
    fallback: "$49.99",
  },
];

const discounted = (cost: number, d: number) => Math.max(1, Math.ceil(cost * (1 - d)));

type ShopCategory = "bundles" | "gems" | "powerups" | "keys";

const CATEGORIES: { key: ShopCategory; label: string; icon: string }[] = [
  { key: "bundles", label: "Bundles", icon: "gift" },
  { key: "gems", label: "Gems", icon: "diamond-stone" },
  { key: "powerups", label: "Power-Ups", icon: "rocket-launch" },
  { key: "keys", label: "Keys & Boxes", icon: "treasure-chest" },
];

export default function ShopScreen() {
  const {
    state,
    buyGemUpgrade,
    claimDaily,
    claimFreeGem,
    creditPurchase,
    applyAdReward,
    setAdsRemoved,
    applyBundle,
    adjustGems,
    adjustKeys,
    adjustCash,
    markLoot,
    addXp,
    showToast,
  } = useGame();
  const { showRewarded } = useAds();
  const { offer, timeLeftMs, discountFor } = useOffers();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [promo, setPromo] = useState("");
  const [category, setCategory] = useState<ShopCategory>("bundles");
  const [catalog, setCatalog] = useState<Record<string, StoreItem>>({});
  const [lootResult, setLootResult] = useState<{ box: LootBox; reward: LootReward; detail: string } | null>(null);
  const [opening, setOpening] = useState<LootBox | null>(null);
  const [contentsBox, setContentsBox] = useState<LootBox | null>(null);
  const [firstBonus, setFirstBonus] = useState(false);
  const pendingRef = useRef<{ box: LootBox; reward: LootReward; free: boolean } | null>(null);
  const playBilling = usePlayBilling(state?.deviceId);
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const glow = useSharedValue(0);
  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotateZ: `${rotate.value}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: 0.8 + glow.value * 0.8 }],
  }));

  const priceOf = (id: string, fallback: string) => catalog[id]?.final_price ?? fallback;
  const baseOf = (id: string, fallback: string) => catalog[id]?.base_price ?? fallback;
  const saleOf = (id: string) => catalog[id]?.on_sale ?? false;
  const bundleValueOf = (id: string) => catalog[id]?.bundle_value_price;
  const bundleSavingsOf = (id: string) => catalog[id]?.bundle_savings_pct;

  const onRedeem = async () => {
    const code = promo.trim();
    if (!code || !state) return;
    try {
      const { gems } = await redeemPromo(code, state.deviceId);
      adjustGems(gems);
      haptic("success");
      showToast(`Code redeemed: +${gems} gems!`);
      setPromo("");
    } catch (e: any) {
      showToast(e?.message || "Invalid code");
    }
  };

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    getStoreCatalog().then(setCatalog).catch(() => {});
  }, []);

  // First-purchase 2x bonus availability. Re-checked when a purchase finishes
  // so the banner hides immediately after the doubler is burned.
  const deviceId = state?.deviceId;
  const refreshFirstBonus = useCallback(() => {
    if (!deviceId) return;
    getFirstPurchaseStatus(deviceId)
      .then((r) => setFirstBonus(!!r.available))
      .catch(() => {});
  }, [deviceId]);
  useEffect(() => {
    refreshFirstBonus();
  }, [refreshFirstBonus]);

  if (!state) return <View style={styles.container} />;

  const gems = state.gems;
  const today = Math.floor(now / 86400000);
  const canDaily = state.lastDailyDay !== today;
  const nextStreak = state.lastDailyDay === today - 1 ? state.dailyStreak + 1 : 1;
  const dailyAmount = dailyRewardForStreak(nextStreak) * (state.gemUpgrades.megaDaily ? 2 : 1);
  const msToMidnight = 86400000 - (now % 86400000);

  const STARTER_WINDOW_MS = 72 * 60 * 60 * 1000;
  const starterActive = !state.starterPurchased && now - state.createdAt < STARTER_WINDOW_MS;
  const starterRemaining = Math.max(0, STARTER_WINDOW_MS - (now - state.createdAt));
  const followupActive =
    state.starterPurchased &&
    !state.followupPurchased &&
    state.followupAvailableAt > 0 &&
    now >= state.followupAvailableAt;
  const freeInterval = state.gemUpgrades.gemFountain ? FREE_GEM_INTERVAL_FAST_MS : FREE_GEM_INTERVAL_MS;
  const freeReady = now - state.lastFreeGemAt >= freeInterval;
  const freeRemaining = Math.max(0, freeInterval - (now - state.lastFreeGemAt));

  const keyBalance = state.keys ?? 0;
  const freeBoxReady = now - state.lastLootAt >= FREE_LOOT_INTERVAL_MS;
  const freeBoxRemaining = Math.max(0, FREE_LOOT_INTERVAL_MS - (now - state.lastLootAt));

  const powerDiscount = discountFor("powerups");

  const pollAndCredit = async (
    sessionId: string,
    opts: { packId: string; gems: number; investors: number; keys: number; removeAds: boolean; product: string },
  ) => {
    for (let i = 0; i < 6; i++) {
      try {
        const s = await getPaymentStatus(sessionId);
        if (s.payment_status === "paid") {
          if (opts.product === "remove_ads") {
            setAdsRemoved();
            showToast("Ads removed — enjoy!");
          } else if (opts.product === "keys") {
            adjustKeys(opts.keys);
            showToast(`+${opts.keys} loot keys!`);
          } else if (opts.product === "bundle") {
            applyBundle(opts.packId, opts.gems, opts.investors, opts.keys, opts.removeAds);
            const bits = [`+${opts.gems} gems`, `+${opts.investors} investors`];
            if (opts.keys) bits.push(`+${opts.keys} keys`);
            showToast(`Bundle unlocked: ${bits.join(", ")}!`);
          } else {
            creditPurchase(sessionId, opts.gems);
            showToast(`Purchased ${opts.gems} gems!`);
          }
          haptic("success");
          addXp(XP_PURCHASE);
          return;
        }
      } catch {
        // ignore and retry
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    showToast("Payment pending — unlocks once confirmed");
  };

  const onBuyPack = async (packId: string) => {
    setBusy(packId);
    try {
      // On Android with Play Billing configured, use the native store path.
      if (playBilling.isAndroid && playBilling.available) {
        const r = await playBilling.buy(packId);
        if (r.status === "verified" || r.status === "duplicate") {
          const product = r.product ?? "gems";
          if (product === "remove_ads") {
            setAdsRemoved();
            showToast("Ads removed — enjoy!");
          } else if (product === "keys") {
            adjustKeys(r.keys ?? 0);
            showToast(`+${r.keys ?? 0} loot keys!`);
          } else if (product === "bundle") {
            applyBundle(packId, r.gems ?? 0, r.investors ?? 0, r.keys ?? 0, !!r.remove_ads);
            const bits = [`+${r.gems ?? 0} gems`, `+${r.investors ?? 0} investors`];
            if (r.keys) bits.push(`+${r.keys} keys`);
            showToast(`Bundle unlocked: ${bits.join(", ")}!`);
          } else {
            creditPurchase(r.session_id ?? `pb_${packId}_${Date.now()}`, r.gems ?? 0);
            showToast(`Purchased ${r.gems ?? 0} gems!`);
          }
          haptic("success");
          addXp(XP_PURCHASE);
        } else if (r.status === "cancelled") {
          /* user cancelled — no toast */
        } else {
          showToast(r.message || "Purchase failed");
        }
        return;
      }

      // Fallback / web / iOS: existing Google Pay hosted checkout flow.
      const returnUrl = Linking.createURL("shop");
      const resp = await createCheckout(packId, state.deviceId, returnUrl);
      const opts = {
        packId,
        gems: resp.gems,
        investors: resp.investors ?? 0,
        keys: resp.keys ?? 0,
        removeAds: resp.remove_ads ?? false,
        product: resp.product ?? "gems",
      };
      if (Platform.OS === "web") {
        window.open(resp.url, "_blank");
        await pollAndCredit(resp.session_id, opts);
      } else {
        const result = await WebBrowser.openAuthSessionAsync(resp.url, returnUrl);
        if (result.type === "success") await pollAndCredit(resp.session_id, opts);
      }
    } catch (e: any) {
      const msg = e?.message === "Already purchased" ? "Already purchased" : "Store isn't available yet";
      showToast(msg);
    } finally {
      setBusy(null);
      refreshFirstBonus();
    }
  };

  const onWatchGems = async () => {
    const ok = await showRewarded({ seconds: 15, title: "Watch to earn Gems", reward: "+5 Gems" });
    if (ok) {
      applyAdReward("gems");
      haptic("success");
      showToast("+5 gems earned!");
    }
  };

  const onWatchBoost = async () => {
    const ok = await showRewarded({
      seconds: 30,
      title: "Watch to Boost Income",
      reward: "2x income for 5 min",
    });
    if (ok) {
      applyAdReward("boost");
      haptic("success");
      showToast("2x income for 5 minutes!");
    }
  };

  const resolveLoot = (reward: LootReward): string => {
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

  const runOpenAnimation = (box: LootBox) => {
    setOpening(box);
    scale.value = 0.7;
    rotate.value = 0;
    glow.value = 0;
    scale.value = withSequence(
      withTiming(1.18, { duration: 900, easing: Easing.out(Easing.quad) }),
      withTiming(1.32, { duration: 250, easing: Easing.out(Easing.back(3)) }),
    );
    rotate.value = withRepeat(
      withSequence(withTiming(-12, { duration: 80 }), withTiming(12, { duration: 80 })),
      8,
      true,
    );
    glow.value = withRepeat(withTiming(1, { duration: 350 }), -1, true);
  };

  const openBox = (box: LootBox, free: boolean) => {
    if (opening) return;
    if (free) {
      if (!freeBoxReady) return;
    } else if (keyBalance < box.keyCost) {
      showToast(`Need ${box.keyCost} keys to open this`);
      return;
    }
    haptic("heavy");
    const reward = rollLoot(box.table);
    addXp(XP_LOOTBOX);
    pendingRef.current = { box, reward, free };
    runOpenAnimation(box);
    setTimeout(() => {
      const p = pendingRef.current;
      cancelAnimation(rotate);
      cancelAnimation(glow);
      setOpening(null);
      if (!p) return;
      if (p.free) markLoot();
      else adjustKeys(-p.box.keyCost);
      const detail = resolveLoot(p.reward);
      haptic("success");
      setLootResult({ box: p.box, reward: p.reward, detail });
      pendingRef.current = null;
    }, 1500);
  };

  return (
    <View style={styles.container} testID="shop-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Gem Shop</Text>
        <View style={styles.balancesRow}>
          <View style={styles.keysPill}>
            <MaterialCommunityIcons name="key-variant" size={16} color="#FFD54A" />
            <Text testID="shop-key-balance" style={styles.keysPillText}>
              {abbreviate(keyBalance)}
            </Text>
          </View>
          <View style={styles.balancePill}>
            <MaterialCommunityIcons name="diamond-stone" size={18} color={colors.brandTertiary} />
            <Text testID="shop-gem-balance" style={styles.balanceText}>
              {abbreviate(gems)}
            </Text>
          </View>
        </View>
      </View>

      {/* Category nav bar */}
      <View style={styles.navWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.navContent}
        >
          {CATEGORIES.map((c) => {
            const active = category === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`shop-tab-${c.key}`}
                onPress={() => {
                  haptic("light");
                  setCategory(c.key);
                }}
                style={[styles.navChip, active && styles.navChipActive]}
              >
                <MaterialCommunityIcons
                  name={c.icon as any}
                  size={15}
                  color={active ? colors.onBrandTertiary : colors.onSurfaceTertiary}
                />
                <Text style={[styles.navChipText, active && styles.navChipTextActive]}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Flash sale banner — always visible */}
        {offer && (
          <View style={styles.saleBanner} testID="shop-sale-banner">
            <MaterialCommunityIcons name={offer.icon as any} size={22} color={colors.onBrandTertiary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.saleTitle}>{offer.title}</Text>
              <Text style={styles.saleSub}>{offer.blurb}</Text>
            </View>
            <View style={styles.saleTimer}>
              <Text style={styles.saleTimerText}>{formatDuration(timeLeftMs / 1000)}</Text>
            </View>
          </View>
        )}

        {/* First-purchase 2x bonus banner — only while still available. */}
        {firstBonus && (
          <View style={styles.firstBonusBanner} testID="shop-first-bonus-banner">
            <MaterialCommunityIcons name="gift" size={22} color={colors.onBrandSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.firstBonusTitle}>2× FIRST PURCHASE BONUS</Text>
              <Text style={styles.firstBonusSub}>Double gems, keys & investors on your next purchase</Text>
            </View>
          </View>
        )}

        {/* ============ BUNDLES ============ */}
        {category === "bundles" && (
          <View style={styles.catGroup} testID="shop-category-bundles">
        {/* Starter bundle (first 72h) */}
        {starterActive && (
          <Pressable testID="buy-bundle-starter" onPress={() => onBuyPack("bundle_starter")} disabled={busy !== null}>
            <LinearGradient
              colors={["#7B2FF7", "#F107A3"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.bundleCard}
            >
              <View style={styles.bundleHead}>
                <Text style={styles.bundleTag}>STARTER BUNDLE</Text>
                {bundleSavingsOf("bundle_starter") ? (
                  <View style={styles.savingsBadge} testID="bundle-starter-savings">
                    <Text style={styles.savingsBadgeText}>
                      {bundleSavingsOf("bundle_starter")}% OFF
                    </Text>
                  </View>
                ) : null}
                <View style={styles.bundleTimer}>
                  <MaterialCommunityIcons name="clock-fast" size={12} color="#FFF" />
                  <Text style={styles.bundleTimerText}>{formatDuration(starterRemaining / 1000)}</Text>
                </View>
              </View>
              <Text style={styles.bundleTitle}>New Tycoon Special</Text>
              <View style={styles.bundleItems}>
                <Text style={styles.bundleItem}>🚫  No Ads forever</Text>
                <Text style={styles.bundleItem}>👥  +100 Investors</Text>
                <Text style={styles.bundleItem}>💎  +2,500 Gems</Text>
                <Text style={styles.bundleItem}>🔑  +10 Loot Keys</Text>
              </View>
              <View style={styles.bundleBuy}>
                <View style={styles.bundlePriceWrap}>
                  {bundleValueOf("bundle_starter") ? (
                    <Text style={styles.bundleStrike} testID="bundle-starter-strike">
                      {bundleValueOf("bundle_starter")}
                    </Text>
                  ) : saleOf("bundle_starter") ? (
                    <Text style={styles.bundleStrike}>{baseOf("bundle_starter", "$4.99")}</Text>
                  ) : null}
                  <Text style={styles.bundlePrice}>{busy === "bundle_starter" ? "..." : priceOf("bundle_starter", "$4.99")}</Text>
                </View>
                <Text style={styles.bundleCta}>Grab it →</Text>
              </View>
            </LinearGradient>
          </Pressable>
        )}

        {/* Follow-up bundle (10 min after starter) */}
        {followupActive && (
          <Pressable testID="buy-bundle-followup" onPress={() => onBuyPack("bundle_followup")} disabled={busy !== null}>
            <LinearGradient
              colors={["#F2994A", "#EB5757"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.bundleCard}
            >
              <View style={styles.bundleHead}>
                <Text style={styles.bundleTag}>LIMITED FOLLOW-UP</Text>
              </View>
              <Text style={styles.bundleTitle}>Tycoon Boost Bundle</Text>
              <View style={styles.bundleItems}>
                <Text style={styles.bundleItem}>👥  +500 Investors</Text>
                <Text style={styles.bundleItem}>💎  +2,500 Gems</Text>
                <Text style={styles.bundleItem}>🔑  +10 Loot Keys</Text>
              </View>
              <View style={styles.bundleBuy}>
                <View style={styles.bundlePriceWrap}>
                  {saleOf("bundle_followup") && (
                    <Text style={styles.bundleStrike}>{baseOf("bundle_followup", "$4.99")}</Text>
                  )}
                  <Text style={styles.bundlePrice}>{busy === "bundle_followup" ? "..." : priceOf("bundle_followup", "$4.99")}</Text>
                </View>
                <Text style={styles.bundleCta}>Grab it →</Text>
              </View>
            </LinearGradient>
          </Pressable>
        )}

        {/* Remove Ads */}
        <Text style={styles.sectionTitle}>No More Ads</Text>
        {state.adsRemoved ? (
          <View style={styles.removeAdsOwned} testID="ads-removed-state">
            <MaterialCommunityIcons name="check-decagram" size={26} color={colors.brandSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.upgradeTitle}>Ads Removed</Text>
              <Text style={styles.upgradeDesc}>Thanks for supporting the game!</Text>
            </View>
          </View>
        ) : (
          <Pressable
            testID="buy-remove-ads"
            onPress={() => onBuyPack("remove_ads")}
            disabled={busy !== null}
            style={styles.removeAdsCard}
          >
            <View style={[styles.adIcon, { backgroundColor: colors.brandSecondary + "22" }]}>
              <MaterialCommunityIcons name="block-helper" size={26} color={colors.brandSecondary} />
            </View>
            <View style={styles.adMid}>
              <Text style={styles.adTitle}>Remove All Ads</Text>
              <Text style={styles.adDesc}>One-time purchase · banners & video ads gone forever</Text>
            </View>
            <LinearGradient
              colors={[colors.brandSecondary, "#00C853"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.removeAdsPrice}
            >
              {saleOf("remove_ads") && (
                <Text style={styles.strikePrice}>{baseOf("remove_ads", `$${REMOVE_ADS_PRICE.toFixed(2)}`)}</Text>
              )}
              <Text style={styles.removeAdsPriceText}>
                {busy === "remove_ads" ? "..." : priceOf("remove_ads", `$${REMOVE_ADS_PRICE.toFixed(2)}`)}
              </Text>
            </LinearGradient>
          </Pressable>
        )}
          </View>
        )}

        {/* ============ GEMS ============ */}
        {category === "gems" && (
          <View style={styles.catGroup} testID="shop-category-gems">
        {/* Free rewards */}
        <Text style={styles.sectionTitle}>Free Gems</Text>
        <View style={styles.freeRow}>
          <Pressable
            testID="claim-daily-button"
            onPress={() => {
              if (canDaily) {
                haptic("success");
                claimDaily();
                showToast(`Day ${nextStreak} reward: +${dailyAmount} gems`);
              }
            }}
            disabled={!canDaily}
            style={[styles.freeCard, !canDaily && styles.freeCardDisabled]}
          >
            <MaterialCommunityIcons name="calendar-check" size={26} color={colors.brandSecondary} />
            <Text style={styles.freeTitle}>Daily Reward</Text>
            <Text style={styles.freeAmt}>+{dailyAmount}</Text>
            <Text style={styles.streakTag}>🔥 Day {nextStreak} streak</Text>
            <Text style={styles.freeHint}>
              {canDaily ? "Tap to claim" : `Next in ${formatDuration(msToMidnight / 1000)}`}
            </Text>
          </Pressable>

          <Pressable
            testID="claim-free-gem-button"
            onPress={() => {
              if (freeReady) {
                haptic("success");
                claimFreeGem();
                showToast(`+${FREE_GEM_AMOUNT} gems`);
              }
            }}
            disabled={!freeReady}
            style={[styles.freeCard, !freeReady && styles.freeCardDisabled]}
          >
            <MaterialCommunityIcons name="gift" size={26} color={colors.brandPrimary} />
            <Text style={styles.freeTitle}>Free Gem</Text>
            <Text style={styles.freeAmt}>+{FREE_GEM_AMOUNT}</Text>
            <Text style={styles.freeHint}>
              {freeReady ? "Tap to claim" : formatDuration(freeRemaining / 1000)}
            </Text>
          </Pressable>
        </View>

        {/* Promo code */}
        <Text style={styles.sectionTitle}>Redeem Code</Text>
        <View style={styles.promoRow}>
          <TextInput
            testID="promo-input"
            value={promo}
            onChangeText={(t) => setPromo(t.toUpperCase())}
            placeholder="Enter promo code"
            placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="characters"
            style={styles.promoInput}
            maxLength={24}
          />
          <Pressable testID="promo-redeem-button" onPress={onRedeem} style={styles.promoBtn}>
            <Text style={styles.promoBtnText}>Redeem</Text>
          </Pressable>
        </View>

        {/* Watch & Earn */}
        <Text style={styles.sectionTitle}>Watch & Earn</Text>
        <Pressable testID="watch-ad-gems" onPress={onWatchGems} style={styles.adRow}>
          <View style={[styles.adIcon, { backgroundColor: colors.brandTertiary + "22" }]}>
            <MaterialCommunityIcons name="play-circle" size={26} color={colors.brandTertiary} />
          </View>
          <View style={styles.adMid}>
            <Text style={styles.adTitle}>Free Gems</Text>
            <Text style={styles.adDesc}>Watch a 15s ad for +5 gems</Text>
          </View>
          <View style={[styles.adCta, { backgroundColor: colors.brandTertiary }]}>
            <MaterialCommunityIcons name="diamond-stone" size={13} color={colors.onBrandTertiary} />
            <Text style={[styles.adCtaText, { color: colors.onBrandTertiary }]}>+5</Text>
          </View>
        </Pressable>
        <Pressable testID="watch-ad-boost" onPress={onWatchBoost} style={styles.adRow}>
          <View style={[styles.adIcon, { backgroundColor: colors.brandPrimary + "22" }]}>
            <MaterialCommunityIcons name="rocket-launch" size={26} color={colors.brandPrimary} />
          </View>
          <View style={styles.adMid}>
            <Text style={styles.adTitle}>2x Income Boost</Text>
            <Text style={styles.adDesc}>Watch a 30s ad for 2x income (5 min)</Text>
          </View>
          <View style={[styles.adCta, { backgroundColor: colors.brandPrimary }]}>
            <MaterialCommunityIcons name="lightning-bolt" size={13} color={colors.onBrandPrimary} />
            <Text style={[styles.adCtaText, { color: colors.onBrandPrimary }]}>2x</Text>
          </View>
        </Pressable>
          </View>
        )}

        {/* ============ POWER-UPS ============ */}
        {category === "powerups" && (
          <View style={styles.catGroup} testID="shop-category-powerups">
        {/* Power-ups */}
        <View style={styles.powerHead}>
          <Text style={styles.sectionTitle}>Power-Ups</Text>
          {powerDiscount > 0 && (
            <View style={styles.salePill}>
              <Text style={styles.salePillText}>50% OFF</Text>
            </View>
          )}
        </View>
        {GEM_UPGRADES.map((u) => {
          const owned = state.gemUpgrades[u.key];
          const cost = powerDiscount > 0 ? discounted(u.cost, powerDiscount) : u.cost;
          const affordable = gems >= cost && !owned;
          return (
            <View key={u.key} style={styles.upgradeCard}>
              <View style={[styles.upgradeIcon, { backgroundColor: u.color + "22" }]}>
                <MaterialCommunityIcons name={u.icon as any} size={26} color={u.color} />
              </View>
              <View style={styles.upgradeMid}>
                <Text style={styles.upgradeTitle}>{u.title}</Text>
                <Text style={styles.upgradeDesc}>{u.desc}</Text>
              </View>
              {owned ? (
                <View style={[styles.upgradeBtn, styles.upgradeOwned]}>
                  <MaterialCommunityIcons name="check-bold" size={16} color={colors.brandSecondary} />
                </View>
              ) : (
                <Pressable
                  testID={`buy-upgrade-${u.key}`}
                  onPress={() => {
                    if (affordable) {
                      haptic("heavy");
                      buyGemUpgrade(u.key, cost);
                      showToast(`${u.title} activated!`);
                    }
                  }}
                  disabled={!affordable}
                  style={[
                    styles.upgradeBtn,
                    { backgroundColor: affordable ? colors.brandTertiary : colors.surfaceTertiary },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="diamond-stone"
                    size={13}
                    color={affordable ? colors.onBrandTertiary : colors.onSurfaceTertiary}
                  />
                  <Text
                    style={[
                      styles.upgradeCost,
                      { color: affordable ? colors.onBrandTertiary : colors.onSurfaceTertiary },
                    ]}
                  >
                    {cost}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
          </View>
        )}

        {/* ============ GEMS (buy) ============ */}
        {category === "gems" && (
          <View style={styles.catGroup} testID="shop-category-gems-buy">
        {/* Buy gems */}
        <View style={styles.powerHead}>
          <Text style={styles.sectionTitle}>Buy Gems</Text>
        </View>
        <View style={styles.packGrid}>
          {GEM_PACKS.map((p) => (
            <Pressable
              key={p.id}
              testID={`buy-pack-${p.id}`}
              onPress={() => onBuyPack(p.id)}
              disabled={busy !== null}
              style={[styles.packCard, p.best && styles.packBest]}
            >
              {p.best && (
                <View style={styles.bestTag}>
                  <Text style={styles.bestText}>BEST VALUE</Text>
                </View>
              )}
              <MaterialCommunityIcons name="diamond-stone" size={30} color={colors.brandTertiary} />
              <Text style={styles.packGems}>{p.gems.toLocaleString()}</Text>
              {saleOf(p.id) ? (
                <Text style={styles.packSaleTag}>{catalog[p.id]?.discount_pct}% OFF</Text>
              ) : (
                p.bonus && <Text style={styles.packBonus}>{p.bonus}</Text>
              )}
              {saleOf(p.id) && (
                <Text style={styles.packStrike} testID={`${p.id}-strike`}>
                  {baseOf(p.id, p.price)}
                </Text>
              )}
              <LinearGradient
                colors={[colors.brandPrimary, "#FF8F00"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.packPrice}
              >
                <Text style={styles.packPriceText}>
                  {busy === p.id ? "..." : priceOf(p.id, p.price)}
                </Text>
              </LinearGradient>
            </Pressable>
          ))}
        </View>
          </View>
        )}

        {/* ============ KEYS ============ */}
        {category === "keys" && (
          <View style={styles.catGroup} testID="shop-category-keys">
        {/* Loot keys */}
        <Text style={styles.sectionTitle}>Loot Keys</Text>
        <View style={styles.keysRow}>
          {[
            { id: "keys_s", qty: 5, fallback: "$1.99" },
            { id: "keys_m", qty: 20, fallback: "$4.99", best: true },
            { id: "keys_l", qty: 50, fallback: "$9.99" },
          ].map((k) => (
            <Pressable
              key={k.id}
              testID={`buy-${k.id}`}
              onPress={() => onBuyPack(k.id)}
              disabled={busy !== null}
              style={[styles.keyPackCard, k.best && styles.keyPackBest]}
            >
              {k.best && <Text style={styles.keyPackBadge}>BEST</Text>}
              <MaterialCommunityIcons name="key-variant" size={28} color="#FFD54A" />
              <Text style={styles.keyPackQty}>x{k.qty}</Text>
              {saleOf(k.id) && <Text style={styles.packSaleTag}>{catalog[k.id]?.discount_pct}% OFF</Text>}
              {saleOf(k.id) && (
                <Text style={styles.keyPackStrike} testID={`${k.id}-strike`}>
                  {baseOf(k.id, k.fallback)}
                </Text>
              )}
              <View style={styles.keyPackPrice}>
                <Text style={styles.keyPackPriceText}>{busy === k.id ? "..." : priceOf(k.id, k.fallback)}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Loot boxes */}
        <View style={styles.lootHead}>
          <Text style={styles.sectionTitle}>Loot Boxes</Text>
          <View style={styles.keyBalancePill}>
            <MaterialCommunityIcons name="key-variant" size={14} color="#FFD54A" />
            <Text style={styles.keyBalanceText}>{abbreviate(keyBalance)}</Text>
          </View>
        </View>

        <LinearGradient colors={["#3A2C5E", "#241B3D"]} style={styles.freeLootCard}>
          <MaterialCommunityIcons name="gift-open" size={40} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.freeLootTitle}>Free Daily Box</Text>
            <Text style={styles.freeLootDesc}>A free Bronze box every 8 hours</Text>
          </View>
          <Pressable
            testID="shop-open-free-lootbox"
            onPress={() => openBox(FREE_BOX, true)}
            disabled={!freeBoxReady || !!opening}
            style={[styles.freeLootBtn, !freeBoxReady && styles.freeLootBtnDisabled]}
          >
            <Text style={styles.freeLootBtnText}>
              {freeBoxReady ? "OPEN" : formatDuration(freeBoxRemaining / 1000)}
            </Text>
          </Pressable>
        </LinearGradient>

        {LOOT_BOXES.map((box) => {
          const affordable = keyBalance >= box.keyCost;
          return (
            <LinearGradient key={box.id} colors={box.gradient} style={styles.lootBoxCard}>
              <View style={styles.lootBoxIcon}>
                <MaterialCommunityIcons name={box.icon as any} size={34} color="#FFFFFF" />
              </View>
              <Pressable
                testID={`shop-box-info-${box.id}`}
                onPress={() => { haptic("light"); setContentsBox(box); }}
                style={{ flex: 1 }}
              >
                <Text style={styles.lootBoxName}>{box.name}</Text>
                <Text style={styles.lootBoxDesc}>{box.desc}</Text>
                <View style={styles.lootBoxOddsRow}>
                  <MaterialCommunityIcons name="information-outline" size={12} color="rgba(255,255,255,0.95)" />
                  <Text style={styles.lootBoxOdds}>View {box.table.length} rewards & odds</Text>
                </View>
              </Pressable>
              <Pressable
                testID={`shop-open-box-${box.id}`}
                onPress={() => openBox(box, false)}
                disabled={!affordable || !!opening}
                style={[styles.lootBoxBtn, !affordable && styles.lootBoxBtnDisabled]}
              >
                <MaterialCommunityIcons name="key-variant" size={14} color={affordable ? "#1A1A1A" : "rgba(255,255,255,0.6)"} />
                <Text style={[styles.lootBoxBtnText, !affordable && styles.lootBoxBtnTextDisabled]}>{box.keyCost}</Text>
              </Pressable>
            </LinearGradient>
          );
        })}
          </View>
        )}

        {/* ============ BUNDLES (deals) ============ */}
        {category === "bundles" && (
          <View style={styles.catGroup} testID="shop-category-bundles-deals">
        {/* Bundle deals */}
        <Text style={styles.sectionTitle}>Bundle Deals</Text>
        {EXTRA_BUNDLES.map((b) => (
          <Pressable
            key={b.id}
            testID={`buy-${b.id}`}
            onPress={() => onBuyPack(b.id)}
            disabled={busy !== null}
          >
            <LinearGradient colors={b.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bundleCard}>
              <View style={styles.bundleHead}>
                <Text style={styles.bundleTag}>{b.tag}</Text>
                <View style={styles.bundleDiscountBadge}>
                  <Text style={styles.bundleDiscountText}>{catalog[b.id]?.discount_pct ?? 75}% OFF</Text>
                </View>
                {b.best && (
                  <View style={styles.bundleBestTag}>
                    <Text style={styles.bundleBestText}>BEST VALUE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.bundleTitle}>{b.title}</Text>
              <View style={styles.bundleItems}>
                {b.items.map((it) => (
                  <Text key={it} style={styles.bundleItem}>{it}</Text>
                ))}
              </View>
              <View style={styles.bundleBuy}>
                <View style={styles.bundlePriceWrap}>
                  {saleOf(b.id) && <Text style={styles.bundleStrike}>{baseOf(b.id, b.fallback)}</Text>}
                  <Text style={styles.bundlePrice}>{busy === b.id ? "..." : priceOf(b.id, b.fallback)}</Text>
                </View>
                <Text style={styles.bundleCta}>Grab it →</Text>
              </View>
            </LinearGradient>
          </Pressable>
        ))}
          </View>
        )}

      </ScrollView>

      {/* Loot box opening animation */}
      <Modal visible={!!opening} transparent animationType="fade">
        <View style={styles.lootOpenBackdrop}>
          <Animated.View
            style={[styles.lootOpenGlow, glowStyle, { backgroundColor: (opening?.glow ?? colors.brandPrimary) + "55" }]}
          />
          <Animated.View style={boxStyle}>
            <MaterialCommunityIcons
              name={(opening?.icon ?? "treasure-chest") as any}
              size={130}
              color={opening?.glow ?? colors.brandPrimary}
            />
          </Animated.View>
          <Text style={styles.lootOpeningText}>Opening {opening?.name}...</Text>
        </View>
      </Modal>

      {/* Loot box reward modal */}
      <Modal visible={!!lootResult} transparent animationType="fade">
        <View style={styles.lootBackdrop}>
          <View style={styles.lootResultCard} testID="shop-lootbox-result">
            <View style={[styles.lootResultIcon, { backgroundColor: (lootResult?.reward.color ?? colors.brandPrimary) + "22" }]}>
              <MaterialCommunityIcons
                name={(lootResult?.reward.icon ?? "gift") as any}
                size={44}
                color={lootResult?.reward.color ?? colors.brandPrimary}
              />
            </View>
            <Text style={styles.lootResultTitle}>{lootResult?.box.name} reward</Text>
            <Text style={styles.lootResultLabel}>{lootResult?.detail}</Text>
            <Pressable
              testID="shop-lootbox-collect"
              onPress={() => { haptic("success"); setLootResult(null); }}
              style={styles.lootCollectBtn}
            >
              <LinearGradient colors={[colors.brandPrimary, "#FF8F00"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.lootCollectGrad}>
                <Text style={styles.lootCollectText}>COLLECT</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Loot box contents / odds */}
      <Modal visible={!!contentsBox} transparent animationType="fade" onRequestClose={() => setContentsBox(null)}>
        <Pressable style={styles.lootBackdrop} onPress={() => setContentsBox(null)}>
          <Pressable style={styles.contentsCard} testID="shop-box-contents" onPress={() => {}}>
            <View style={styles.contentsHead}>
              <View style={[styles.contentsIcon, { backgroundColor: (contentsBox?.glow ?? colors.brandPrimary) + "22" }]}>
                <MaterialCommunityIcons name={(contentsBox?.icon ?? "treasure-chest") as any} size={26} color={contentsBox?.glow ?? colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contentsTitle}>{contentsBox?.name}</Text>
                <Text style={styles.contentsSub}>Possible rewards & drop rates</Text>
              </View>
              <View style={styles.contentsKeyCost}>
                <MaterialCommunityIcons name="key-variant" size={13} color="#FFD54A" />
                <Text style={styles.contentsKeyCostText}>{contentsBox?.keyCost}</Text>
              </View>
            </View>
            <ScrollView style={styles.contentsList} showsVerticalScrollIndicator={false}>
              {contentsBox &&
                [...contentsBox.table]
                  .sort((a, b) => b.weight - a.weight)
                  .map((r) => {
                    const total = contentsBox.table.reduce((n, x) => n + x.weight, 0);
                    const pct = (r.weight / total) * 100;
                    return (
                      <View key={r.id} style={styles.contentsRow} testID={`box-reward-${r.id}`}>
                        <View style={[styles.contentsRewardIcon, { backgroundColor: r.color + "22" }]}>
                          <MaterialCommunityIcons name={r.icon as any} size={18} color={r.color} />
                        </View>
                        <Text style={styles.contentsRewardLabel}>{r.label}</Text>
                        <Text style={styles.contentsRewardPct}>{pct < 1 ? pct.toFixed(1) : Math.round(pct)}%</Text>
                      </View>
                    );
                  })}
            </ScrollView>
            <Pressable testID="shop-contents-close" onPress={() => setContentsBox(null)} style={styles.contentsCloseBtn}>
              <Text style={styles.contentsCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "900" },
  balancesRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  keysPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFD54A1F",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  keysPillText: { color: "#FFD54A", fontSize: 18, fontWeight: "900" },
  balancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandTertiary + "1F",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  balanceText: { color: colors.brandTertiary, fontSize: 18, fontWeight: "900" },
  content: { padding: spacing.lg, gap: spacing.sm },
  catGroup: { gap: spacing.sm },
  navWrap: {
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  navChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  navChipActive: {
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brandTertiary,
  },
  navChipText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "800" },
  navChipTextActive: { color: colors.onBrandTertiary },
  lootHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  keyBalancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFD54A1F",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  keyBalanceText: { color: "#FFD54A", fontSize: 14, fontWeight: "900" },
  freeLootCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  freeLootTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  freeLootDesc: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "600", marginTop: 2 },
  freeLootBtn: {
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minWidth: 80,
    alignItems: "center",
  },
  freeLootBtnDisabled: { backgroundColor: "rgba(255,255,255,0.18)" },
  freeLootBtnText: { color: colors.onBrandSecondary, fontSize: 14, fontWeight: "900" },
  lootBoxCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  lootBoxIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  lootBoxName: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  lootBoxDesc: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600", marginTop: 1 },
  lootBoxOddsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  lootBoxOdds: { color: "rgba(255,255,255,0.95)", fontSize: 11, fontWeight: "800", textDecorationLine: "underline" },
  contentsCard: {
    width: "100%",
    maxHeight: "78%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contentsHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  contentsIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  contentsTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "900" },
  contentsSub: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", marginTop: 1 },
  contentsKeyCost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FFD54A1F",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  contentsKeyCostText: { color: "#FFD54A", fontSize: 13, fontWeight: "900" },
  contentsList: { flexGrow: 0 },
  contentsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  contentsRewardIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  contentsRewardLabel: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  contentsRewardPct: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "900" },
  contentsCloseBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
  },
  contentsCloseText: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  lootBoxBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFD54A",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minWidth: 60,
    justifyContent: "center",
  },
  lootBoxBtnDisabled: { backgroundColor: "rgba(255,255,255,0.18)" },
  lootBoxBtnText: { color: "#1A1A1A", fontSize: 15, fontWeight: "900" },
  lootBoxBtnTextDisabled: { color: "rgba(255,255,255,0.6)" },
  lootBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  lootOpenBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  lootOpenGlow: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
  },
  lootOpeningText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", marginTop: spacing.xxl },
  lootResultCard: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  lootResultIcon: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  lootResultTitle: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "700" },
  lootResultLabel: { color: colors.onSurface, fontSize: 22, fontWeight: "900", textAlign: "center", marginVertical: spacing.sm },
  lootCollectBtn: { width: "100%", borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.md },
  lootCollectGrad: { paddingVertical: spacing.lg, alignItems: "center" },
  lootCollectText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "900", letterSpacing: 1 },
  saleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  saleTitle: { color: colors.onBrandTertiary, fontSize: 15, fontWeight: "900" },
  saleSub: { color: colors.onBrandTertiary, fontSize: 12, fontWeight: "600", opacity: 0.9 },
  saleTimer: {
    backgroundColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  saleTimerText: { color: colors.onBrandTertiary, fontSize: 13, fontWeight: "900" },
  firstBonusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  firstBonusTitle: { color: colors.onBrandSecondary, fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  firstBonusSub: { color: colors.onBrandSecondary, fontSize: 12, fontWeight: "600", opacity: 0.95 },
  bundleCard: { borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm },
  bundleHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bundleTag: { color: "#FFF", fontSize: 11, fontWeight: "900", letterSpacing: 1.5, opacity: 0.95 },
  bundleTimer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  bundleTimerText: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  bundleTitle: { color: "#FFF", fontSize: 22, fontWeight: "900", marginTop: spacing.xs },
  bundleItems: { marginTop: spacing.sm, gap: 4 },
  bundleItem: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  bundleBuy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bundlePrice: { color: "#FFF", fontSize: 20, fontWeight: "900" },
  bundlePriceWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bundleStrike: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "800", textDecorationLine: "line-through" },
  savingsBadge: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginLeft: spacing.xs,
  },
  savingsBadgeText: { color: "#D32F2F", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  bundleBestTag: { backgroundColor: "rgba(255,255,255,0.25)", borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  bundleBestText: { color: "#FFF", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  bundleDiscountBadge: { backgroundColor: "#FFFFFF", borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  bundleDiscountText: { color: "#D32F2F", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  packSaleTag: { color: colors.error, fontSize: 11, fontWeight: "900" },
  packStrike: {
    color: colors.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "800",
    textDecorationLine: "line-through",
  },
  keysRow: { flexDirection: "row", gap: spacing.sm },
  keyPackCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyPackBest: { borderColor: "#FFD54A" },
  keyPackBadge: { color: "#FFD54A", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  keyPackQty: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  keyPackPrice: {
    backgroundColor: "#FFD54A",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  keyPackPriceText: { color: "#1A1A1A", fontSize: 14, fontWeight: "900" },
  keyPackStrike: {
    color: colors.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "800",
    textDecorationLine: "line-through",
  },
  bundleCta: { color: "#FFF", fontSize: 15, fontWeight: "900" },
  sectionTitle: {
    color: colors.onSurfaceTertiary,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  powerHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  promoRow: { flexDirection: "row", gap: spacing.sm },
  promoInput: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  promoBtn: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  promoBtnText: { color: colors.onBrandTertiary, fontSize: 14, fontWeight: "900" },
  salePill: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  salePillText: { color: colors.onBrandTertiary, fontSize: 10, fontWeight: "900" },
  removeAdsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  removeAdsOwned: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brandSecondary + "14",
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  removeAdsPrice: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  removeAdsPriceText: { color: colors.onBrandSecondary, fontSize: 15, fontWeight: "900" },
  strikePrice: {
    color: colors.onBrandSecondary,
    fontSize: 11,
    fontWeight: "700",
    textDecorationLine: "line-through",
    opacity: 0.8,
  },
  freeRow: { flexDirection: "row", gap: spacing.md },
  freeCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  freeCardDisabled: { opacity: 0.5 },
  freeTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800", marginTop: spacing.xs },
  freeAmt: { color: colors.brandTertiary, fontSize: 20, fontWeight: "900" },
  freeHint: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700" },
  streakTag: { color: colors.brandPrimary, fontSize: 11, fontWeight: "900" },
  adRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  adIcon: {
    width: 50,
    height: 50,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  adMid: { flex: 1, gap: 2 },
  adTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  adDesc: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  adCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  adCtaText: { fontSize: 14, fontWeight: "900" },
  upgradeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  upgradeIcon: {
    width: 50,
    height: 50,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  upgradeMid: { flex: 1, gap: 2 },
  upgradeTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  upgradeDesc: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    minWidth: 64,
    justifyContent: "center",
  },
  upgradeOwned: { backgroundColor: colors.brandSecondary + "1F" },
  upgradeCost: { fontSize: 14, fontWeight: "900" },
  packGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  packCard: {
    width: "47%",
    flexGrow: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  packBest: { borderColor: colors.brandPrimary },
  bestTag: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  bestText: { color: colors.onBrandPrimary, fontSize: 8, fontWeight: "900" },
  packGems: { color: colors.onSurface, fontSize: 22, fontWeight: "900" },
  packBonus: { color: colors.brandSecondary, fontSize: 11, fontWeight: "800" },
  packPrice: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
  packPriceText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900" },
  achRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  achIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  achMid: { flex: 1, gap: 2 },
  achTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  achDesc: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  achReward: { flexDirection: "row", alignItems: "center", gap: 3 },
  achGems: { color: colors.brandTertiary, fontSize: 13, fontWeight: "900" },
});
