import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";

import { colors, radius, spacing } from "@/src/game/theme";
import { money, formatTime } from "@/src/game/format";
import {
  BusinessDef,
  costForLevels,
  maxAffordable,
  nextMilestone,
  perCycleRevenue,
} from "@/src/game/businesses";
import { useGame } from "@/src/game/GameContext";
import { haptic, playSfx } from "@/src/game/haptics";
import ProgressBar from "@/src/components/ProgressBar";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function BusinessCard({ def }: { def: BusinessDef }) {
  const { state, buyAmount, tapBusiness, buyBusiness, multiplierFor } = useGame();
  const scale = useSharedValue(1);

  const b = state?.businesses[def.id];
  const level = b?.level ?? 0;
  const owned = level > 0;
  const cash = state?.cash ?? 0;
  const isPro = !!state?.proBoosts[def.id];
  const speed = state?.gemUpgrades.doubleSpeed ? 2 : 1;
  const dispTime = def.time / speed;

  const count =
    buyAmount === "max" ? maxAffordable(def, level, cash) : buyAmount;
  const cost = costForLevels(def, level, Math.max(1, count));
  const affordable = cash >= cost && (buyAmount !== "max" || count > 0);

  const cycleRevenue = perCycleRevenue(def, Math.max(1, level), multiplierFor(def.id));
  const nextMs = nextMilestone(level);

  const tapStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    // entrance: subtle pop handled by parent stagger; keep static here
  }, []);

  const onTapBody = () => {
    if (!owned || b?.hasManager) return;
    haptic("light");
    playSfx("business_tap");
    scale.value = withSequence(
      withSpring(0.96, { damping: 12 }),
      withSpring(1, { damping: 10 }),
    );
    tapBusiness(def.id);
  };

  const onBuy = () => {
    if (!affordable) return;
    haptic("medium");
    buyBusiness(def.id);
  };

  const buyLabel = owned
    ? `x${buyAmount === "max" ? Math.max(count, 0) : count}`
    : "BUY";

  return (
    <View style={[styles.card, !owned && styles.cardLocked]}>
      <View style={styles.row}>
        <AnimatedPressable
          testID={`business-tap-${def.id}`}
          onPress={onTapBody}
          style={[styles.iconWrap, { backgroundColor: def.color + "22" }, tapStyle]}
        >
          <MaterialCommunityIcons
            name={def.icon as any}
            size={32}
            color={def.color}
          />
          {owned && (
            <View style={[styles.levelBadge, { backgroundColor: def.color }]}>
              <Text style={styles.levelText}>{level}</Text>
            </View>
          )}
        </AnimatedPressable>

        <View style={styles.middle}>
          <Text style={styles.name} numberOfLines={1}>
            {def.name}
          </Text>
          <Text style={styles.revenue} numberOfLines={1}>
            {money(cycleRevenue)}
            <Text style={styles.muted}> / {formatTime(dispTime)}</Text>
          </Text>
          <View style={styles.tagRow}>
            {b?.hasManager ? (
              <View style={[styles.tag, { backgroundColor: colors.brandSecondary + "26" }]}>
                <MaterialCommunityIcons name="robot" size={11} color={colors.brandSecondary} />
                <Text style={[styles.tagText, { color: colors.brandSecondary }]}>AUTO</Text>
              </View>
            ) : owned ? (
              <View style={[styles.tag, { backgroundColor: colors.brandPrimary + "26" }]}>
                <MaterialCommunityIcons name="gesture-tap" size={11} color={colors.brandPrimary} />
                <Text style={[styles.tagText, { color: colors.brandPrimary }]}>TAP</Text>
              </View>
            ) : null}
            {isPro && (
              <View style={[styles.tag, { backgroundColor: colors.brandTertiary + "26" }]}>
                <MaterialCommunityIcons name="diamond-stone" size={11} color={colors.brandTertiary} />
                <Text style={[styles.tagText, { color: colors.brandTertiary }]}>PRO x3</Text>
              </View>
            )}
            {nextMs && (
              <View style={[styles.tag, { backgroundColor: colors.surfaceTertiary }]}>
                <MaterialCommunityIcons name="star-four-points" size={11} color={colors.warning} />
                <Text style={[styles.tagText, { color: colors.onSurfaceTertiary }]}>
                  x2 @ {nextMs}
                </Text>
              </View>
            )}
          </View>
        </View>

        <Pressable
          testID={`business-buy-${def.id}`}
          onPress={onBuy}
          disabled={!affordable}
          style={[
            styles.buyBtn,
            { backgroundColor: affordable ? colors.brandPrimary : colors.surfaceTertiary },
          ]}
        >
          <Text
            style={[
              styles.buyAmount,
              { color: affordable ? colors.onBrandPrimary : colors.onSurfaceTertiary },
            ]}
          >
            {buyLabel}
          </Text>
          <Text
            style={[
              styles.buyCost,
              { color: affordable ? colors.onBrandPrimary : colors.onSurfaceTertiary },
            ]}
            numberOfLines={1}
          >
            {money(cost)}
          </Text>
        </Pressable>
      </View>

      {owned && (
        <View style={styles.progressWrap}>
          <ProgressBar progress={b?.progress ?? 0} color={def.color} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLocked: {
    opacity: 0.92,
    borderStyle: "dashed",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  levelBadge: {
    position: "absolute",
    bottom: -6,
    right: -6,
    minWidth: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: colors.surfaceSecondary,
  },
  levelText: {
    color: colors.onSurfaceInverse,
    fontSize: 12,
    fontWeight: "900",
  },
  middle: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "800",
  },
  revenue: {
    color: colors.brandSecondary,
    fontSize: 14,
    fontWeight: "800",
  },
  muted: {
    color: colors.onSurfaceTertiary,
    fontWeight: "600",
  },
  tagRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: 2,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "800",
  },
  buyBtn: {
    minWidth: 90,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buyAmount: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  buyCost: {
    fontSize: 15,
    fontWeight: "900",
  },
  progressWrap: {
    marginTop: spacing.sm,
  },
});
