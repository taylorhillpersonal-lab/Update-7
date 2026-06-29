import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { colors, radius, spacing } from "@/src/game/theme";
import { haptic } from "@/src/game/haptics";

export type BonusType = "coinflip" | "cashhunt" | "pachinko" | "crazy";

type Props = {
  bonus: BonusType;
  bonusMult: number;          // server-decided multiplier the player will receive
  wager: number;              // their wager on this bonus segment
  topMult: number;            // top-slot multiplier (just for display)
  onDone: () => void;         // called once the bonus reveal is complete
};

export function TycoonTimeBonus({ bonus, bonusMult, wager, topMult, onDone }: Props) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID={`tt-bonus-${bonus}`}>
          {bonus === "coinflip"  && <CoinFlip   bonusMult={bonusMult} wager={wager} topMult={topMult} onDone={onDone} />}
          {bonus === "cashhunt"  && <CashHunt   bonusMult={bonusMult} wager={wager} topMult={topMult} onDone={onDone} />}
          {bonus === "pachinko"  && <Pachinko   bonusMult={bonusMult} wager={wager} topMult={topMult} onDone={onDone} />}
          {bonus === "crazy"     && <CrazyWheel bonusMult={bonusMult} wager={wager} topMult={topMult} onDone={onDone} />}
        </View>
      </View>
    </Modal>
  );
}

type InnerProps = { bonusMult: number; wager: number; topMult: number; onDone: () => void };

// ============================================================
// 1. Coin Flip — red side vs blue side. Coin flips, lands on a side.
//    Both sides show a multiplier; the side that lands up = bonusMult.
// ============================================================
function CoinFlip({ bonusMult, wager, topMult, onDone }: InnerProps) {
  // Server picks the winning multiplier (2× – 50×). We display BOTH sides
  // (winner + a decoy) and auto-flip the coin — no user input required.
  // The decoy is a different value from the same 2–50 pool so the result
  // feels suspenseful even though the outcome is fixed.
  const pool = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];
  const initial = useRef<{ landsRed: boolean; otherMult: number }>({
    landsRed: Math.random() < 0.5,
    otherMult: (() => {
      const choices = pool.filter((m) => m !== bonusMult);
      return choices[Math.floor(Math.random() * choices.length)] ?? bonusMult;
    })(),
  }).current;
  const { landsRed, otherMult } = initial;
  const redMult  = landsRed ? bonusMult : otherMult;
  const blueMult = landsRed ? otherMult : bonusMult;
  const [phase, setPhase] = useState<"flipping" | "revealed">("flipping");
  const rot = useSharedValue(0);

  const flipStyle = useAnimatedStyle(() => ({ transform: [{ rotateY: `${rot.value}deg` }] }));

  // Auto-flip on mount — every player sees the same coin land the same way.
  useEffect(() => {
    haptic("medium");
    const halfTurns = 12 + Math.floor(Math.random() * 4);
    const finalRot = halfTurns * 180 + (landsRed ? 0 : 180);
    rot.value = withTiming(finalRot, { duration: 2400, easing: Easing.bezier(0.05, 0.85, 0.1, 1) }, (finished) => {
      if (finished) runOnJS(reveal)();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reveal = () => {
    haptic("success");
    setPhase("revealed");
  };

  const payout = wager * bonusMult * topMult;

  return (
    <View style={styles.bonusBody}>
      <Text style={styles.bonusTitle}>COIN FLIP</Text>
      <Text style={styles.bonusSub}>{phase === "flipping" ? "Flipping…" : "The coin has landed!"}</Text>

      <View style={styles.coinStage}>
        <Animated.View style={[styles.coin, flipStyle]}>
          <View style={[styles.coinFace, { backgroundColor: "#E53935", transform: [{ rotateY: "0deg" }] }]}>
            <MaterialCommunityIcons name="alpha-x-circle" size={36} color="#FFF" />
            <Text style={styles.coinMult}>{redMult}×</Text>
          </View>
          <View style={[styles.coinFace, styles.coinBack, { backgroundColor: "#1E88E5" }]}>
            <MaterialCommunityIcons name="circle" size={36} color="#FFF" />
            <Text style={styles.coinMult}>{blueMult}×</Text>
          </View>
        </Animated.View>
      </View>

      {phase === "revealed" && (
        <>
          <Text style={styles.bonusResult}>
            {landsRed ? "RED" : "BLUE"} side up — <Text style={{ color: colors.brandTertiary }}>{bonusMult}×</Text>
          </Text>
          <Text style={styles.bonusPayout}>+{payout} gems</Text>
          <BonusCloseBtn onDone={onDone} />
        </>
      )}
    </View>
  );
}

// ============================================================
// 2. Cash Hunt — 5x4 grid of icons. Player taps one to reveal.
// ============================================================
const CASH_HUNT_COLS = 5;
const CASH_HUNT_ROWS = 4;
const CASH_HUNT_COUNT = CASH_HUNT_COLS * CASH_HUNT_ROWS;
function CashHunt({ bonusMult, wager, topMult, onDone }: InnerProps) {
  // Pre-generate cell multipliers. ONE cell is forced to bonusMult so the
  // payout always matches whichever cell ends up picked: when the player
  // taps a cell, we overwrite its value with bonusMult right before reveal
  // (so the picked cell visually agrees with the gem payout). 5-second
  // timer; if the player hesitates, we auto-pick a random cell for them.
  const cells = useRef<number[]>(makeCashHuntCells(bonusMult)).current;
  const [picked, setPicked] = useState<number | null>(null);
  const [revealAll, setRevealAll] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(5);

  const lockIn = (idx: number) => {
    if (picked !== null) return;
    haptic("medium");
    // Whatever cell the user picks (or we auto-pick), guarantee it shows
    // the actual winning multiplier so the displayed value matches payout.
    cells[idx] = bonusMult;
    setPicked(idx);
    setTimeout(() => {
      setRevealAll(true);
      haptic("success");
    }, 600);
  };

  // 5-second pick timer with auto-pick fallback.
  useEffect(() => {
    if (picked !== null) return;
    if (secondsLeft <= 0) {
      const idx = Math.floor(Math.random() * cells.length);
      lockIn(idx);
      return;
    }
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, picked]);

  const payout = wager * bonusMult * topMult;

  return (
    <View style={styles.bonusBody}>
      <Text style={styles.bonusTitle}>CASH HUNT</Text>
      <Text style={styles.bonusSub}>
        {picked === null
          ? `Pick a target — auto-picks in ${secondsLeft}s`
          : revealAll
          ? "All multipliers revealed"
          : "Locking on…"}
      </Text>

      <View style={[styles.cashGrid, { aspectRatio: CASH_HUNT_COLS / CASH_HUNT_ROWS }]}>
        {cells.map((mult, idx) => {
          const isPicked = picked === idx;
          const show = isPicked || revealAll;
          return (
            <Pressable
              key={idx}
              testID={`cash-hunt-cell-${idx}`}
              onPress={() => lockIn(idx)}
              disabled={picked !== null}
              style={[
                styles.cashCell,
                { width: `${100 / CASH_HUNT_COLS}%`, height: `${100 / CASH_HUNT_ROWS}%` },
                isPicked && styles.cashCellPicked,
              ]}
            >
              {show ? (
                <Text style={[styles.cashCellMult, isPicked && { color: colors.brandTertiary, fontSize: 18 }]}>
                  {mult}×
                </Text>
              ) : (
                <MaterialCommunityIcons name="target" size={22} color={colors.onSurfaceTertiary} />
              )}
            </Pressable>
          );
        })}
      </View>

      {revealAll && (
        <>
          <Text style={styles.bonusResult}>
            You hit <Text style={{ color: colors.brandTertiary }}>{bonusMult}×</Text>
          </Text>
          <Text style={styles.bonusPayout}>+{payout} gems</Text>
          <BonusCloseBtn onDone={onDone} />
        </>
      )}
    </View>
  );
}

function makeCashHuntCells(winningMult: number): number[] {
  // Generate 20 plausible multipliers; force one cell to be the winning mult.
  const pool = [3, 5, 7, 10, 15, 20, 35, 50, 75, 100];
  const cells: number[] = [];
  for (let i = 0; i < CASH_HUNT_COUNT; i++) cells.push(pool[Math.floor(Math.random() * pool.length)]);
  const targetIdx = Math.floor(Math.random() * CASH_HUNT_COUNT);
  cells[targetIdx] = winningMult;
  return cells;
}

// ============================================================
// 3. Pachinko — ball drops through pegs, lands in a slot.
// ============================================================
const PACH_SLOTS = [5, 10, 25, 10, 50, 10, 25, 10, 5]; // 9 slots
const PACH_WIDTH = 280;
const PACH_HEIGHT = 320;
function Pachinko({ bonusMult, wager, topMult, onDone }: InnerProps) {
  // Slot index whose value matches the server's bonusMult; if none match, use random.
  const slotIdx = useRef<number>(pickPachSlot(bonusMult)).current;
  const slotX = (slotIdx + 0.5) * (PACH_WIDTH / PACH_SLOTS.length);
  const startX = PACH_WIDTH / 2;

  const x = useSharedValue(startX);
  const y = useSharedValue(0);
  const [phase, setPhase] = useState<"intro" | "dropping" | "revealed">("intro");

  const ballStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - 12 }, { translateY: y.value - 12 }],
  }));

  const start = () => {
    haptic("medium");
    setPhase("dropping");
    // Animate ball through 6 row "bounces", drifting toward target X.
    const ROWS = 7;
    const rowHeight = (PACH_HEIGHT - 60) / ROWS;
    const bounce = (i: number) => {
      const targetY = rowHeight * (i + 1);
      const remainingX = slotX - x.value;
      const remainingRows = ROWS - i;
      const nextX = x.value + remainingX / remainingRows + (Math.random() - 0.5) * 18;
      x.value = withTiming(nextX, { duration: 220, easing: Easing.out(Easing.quad) });
      y.value = withTiming(targetY, { duration: 220, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) {
          if (i + 1 < ROWS) {
            runOnJS(bounce)(i + 1);
          } else {
            // Final lock-in into the slot.
            x.value = withTiming(slotX, { duration: 250 });
            y.value = withSequence(
              withTiming(PACH_HEIGHT - 40, { duration: 250 }),
              withTiming(PACH_HEIGHT - 30, { duration: 120 }, (done) => {
                if (done) runOnJS(reveal)();
              }),
            );
          }
        }
      });
    };
    bounce(0);
  };

  const reveal = () => {
    haptic("success");
    setPhase("revealed");
  };

  const payout = wager * bonusMult * topMult;

  // Static peg grid pattern (alternating offset rows).
  const pegs: { cx: number; cy: number }[] = [];
  const PEG_ROWS = 7;
  const PEG_COLS = 9;
  for (let r = 0; r < PEG_ROWS; r++) {
    const offset = r % 2 === 0 ? 0 : PACH_WIDTH / PEG_COLS / 2;
    for (let c = 0; c < PEG_COLS; c++) {
      pegs.push({
        cx: offset + c * (PACH_WIDTH / PEG_COLS) + (PACH_WIDTH / PEG_COLS) / 2,
        cy: 30 + r * ((PACH_HEIGHT - 60) / PEG_ROWS),
      });
    }
  }

  return (
    <View style={styles.bonusBody}>
      <Text style={styles.bonusTitle}>PACHINKO</Text>
      <Text style={styles.bonusSub}>Drop the ball. Higher slots pay more.</Text>

      <View style={[styles.pachBoard, { width: PACH_WIDTH, height: PACH_HEIGHT }]}>
        <Svg width={PACH_WIDTH} height={PACH_HEIGHT}>
          {pegs.map((p, i) => (
            <Circle key={i} cx={p.cx} cy={p.cy} r={3} fill="#FFD200" />
          ))}
          {/* Slots */}
          {PACH_SLOTS.map((m, i) => {
            const w = PACH_WIDTH / PACH_SLOTS.length;
            const x0 = i * w;
            const isTarget = i === slotIdx;
            return (
              <G key={`s-${i}`}>
                <Rect x={x0 + 2} y={PACH_HEIGHT - 36} width={w - 4} height={32} rx={4} fill={isTarget && phase === "revealed" ? "#FFD200" : "#23262C"} stroke="#0B0B0B" />
                <SvgText x={x0 + w / 2} y={PACH_HEIGHT - 14} fill={isTarget && phase === "revealed" ? "#000" : "#FFF"} fontSize={12} fontWeight="900" textAnchor="middle">
                  {m}×
                </SvgText>
              </G>
            );
          })}
        </Svg>
        <Animated.View style={[styles.pachBall, ballStyle]} />
      </View>

      {phase === "intro" && (
        <Pressable testID="pachinko-drop" onPress={start} style={styles.bonusBtn}>
          <Text style={styles.bonusBtnText}>DROP BALL</Text>
        </Pressable>
      )}
      {phase === "dropping" && <Text style={styles.flipping}>Dropping…</Text>}
      {phase === "revealed" && (
        <>
          <Text style={styles.bonusResult}>
            Slot <Text style={{ color: colors.brandTertiary }}>{PACH_SLOTS[slotIdx]}×</Text>
          </Text>
          <Text style={styles.bonusPayout}>+{payout} gems</Text>
          <BonusCloseBtn onDone={onDone} />
        </>
      )}
    </View>
  );
}

function pickPachSlot(targetMult: number): number {
  const matches: number[] = [];
  for (let i = 0; i < PACH_SLOTS.length; i++) if (PACH_SLOTS[i] === targetMult) matches.push(i);
  if (matches.length) return matches[Math.floor(Math.random() * matches.length)];
  // bonusMult not in slots — pick the slot closest to it.
  let best = 0, bestDiff = Infinity;
  PACH_SLOTS.forEach((m, i) => {
    const d = Math.abs(m - targetMult);
    if (d < bestDiff) { bestDiff = d; best = i; }
  });
  return best;
}

// ============================================================
// 4. Crazy Time — auto-spin big wheel, every player sees same multiplier.
// ============================================================
const CRAZY_SEGS = 16; // smaller than real CT's 64 but readable on mobile
const CRAZY_SIZE = 260;
const CRAZY_RADIUS = CRAZY_SIZE / 2;

function CrazyWheel({ bonusMult, wager, topMult, onDone }: InnerProps) {
  // No flapper picking — every player sees the same outcome. The wheel
  // auto-spins on mount and lands on the segment whose multiplier equals
  // the server's `bonusMult`. The segment layout is fixed and seeded with
  // every Crazy Time pool value (25 / 75 / 200 / 500) so the pointer can
  // always find a matching wedge.
  const [phase, setPhase] = useState<"spinning" | "revealed">("spinning");
  const rot = useSharedValue(0);
  const rotRef = useRef(0);

  // Fixed 16-segment layout — every Crazy Time pool value appears multiple
  // times so each possible bonusMult has at least one matching wedge.
  const CRAZY_LAYOUT = useRef<number[]>([
    25, 75, 25, 200, 25, 75, 25, 500,
    25, 75, 25, 200, 25, 75, 25, 200,
  ]).current;

  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotateZ: `${rot.value}deg` }] }));

  useEffect(() => {
    haptic("medium");
    // Find an index in CRAZY_LAYOUT whose value equals bonusMult; pick the
    // one closest to a random offset so different rounds don't always land
    // on the same wedge for the same multiplier.
    const matches: number[] = [];
    CRAZY_LAYOUT.forEach((v, i) => { if (v === bonusMult) matches.push(i); });
    // Fallback for unexpected multipliers: pick a random segment whose
    // value is the closest non-zero number (shouldn't normally hit this).
    const targetIdx = matches.length > 0
      ? matches[Math.floor(Math.random() * matches.length)]
      : 0;

    // Compute the wheel rotation that puts segment `targetIdx` under the
    // pointer (which sits at the top, i.e. angle = -90°).
    // The wheel's segment i centre sits at angle (i + 0.5) * (360/N) - 90
    // BEFORE any rotation. After rotating by R degrees, the centre is at
    // (i + 0.5) * (360/N) - 90 + R. We want that = -90 (mod 360), so
    // R = -((i + 0.5) * (360/N))   (mod 360).
    const segCenter = (targetIdx + 0.5) * (360 / CRAZY_SEGS);
    const targetRot = (360 - segCenter) % 360;
    // 6 full extra spins for drama, plus the precise alignment.
    const fullSpins = 6;
    const finalRot = rotRef.current + fullSpins * 360 + (targetRot - (rotRef.current % 360));
    rotRef.current = finalRot;
    rot.value = withTiming(finalRot, { duration: 4500, easing: Easing.bezier(0.05, 0.85, 0.1, 1) }, (finished) => {
      if (finished) runOnJS(reveal)();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reveal = () => {
    haptic("success");
    setPhase("revealed");
  };

  const payout = wager * bonusMult * topMult;

  return (
    <View style={styles.bonusBody}>
      <Text style={styles.bonusTitle}>CRAZY TIME</Text>
      <Text style={styles.bonusSub}>{phase === "spinning" ? "Spinning the big wheel…" : "Reveal!"}</Text>

      <View style={[styles.crazyBox, { width: CRAZY_SIZE, height: CRAZY_SIZE }]}>
        <Animated.View style={[styles.crazyWheel, wheelStyle]}>
          <Svg width={CRAZY_SIZE} height={CRAZY_SIZE} viewBox={`0 0 ${CRAZY_SIZE} ${CRAZY_SIZE}`}>
            {Array.from({ length: CRAZY_SEGS }).map((_, i) => {
              const start = (i * (360 / CRAZY_SEGS) - 90) * (Math.PI / 180);
              const end = ((i + 1) * (360 / CRAZY_SEGS) - 90) * (Math.PI / 180);
              const x1 = CRAZY_RADIUS + CRAZY_RADIUS * Math.cos(start);
              const y1 = CRAZY_RADIUS + CRAZY_RADIUS * Math.sin(start);
              const x2 = CRAZY_RADIUS + CRAZY_RADIUS * Math.cos(end);
              const y2 = CRAZY_RADIUS + CRAZY_RADIUS * Math.sin(end);
              // Color depends on the multiplier so wedges of the same value
              // share a color (visual consistency under the pointer).
              const colorByMult: Record<number, string> = {
                25: "#FFB300", 75: "#1E88E5", 200: "#7B1FA2", 500: "#E53935",
              };
              const fill = colorByMult[CRAZY_LAYOUT[i]] ?? "#43A047";
              const mid = (i + 0.5) * (360 / CRAZY_SEGS) - 90;
              const labelRad = (mid * Math.PI) / 180;
              const lr = CRAZY_RADIUS * 0.7;
              const lx = CRAZY_RADIUS + lr * Math.cos(labelRad);
              const ly = CRAZY_RADIUS + lr * Math.sin(labelRad);
              return (
                <G key={i}>
                  <Path d={`M ${CRAZY_RADIUS} ${CRAZY_RADIUS} L ${x1} ${y1} A ${CRAZY_RADIUS} ${CRAZY_RADIUS} 0 0 1 ${x2} ${y2} Z`} fill={fill} stroke="#0B0B0B" strokeWidth={1} />
                  <SvgText x={lx} y={ly} fill="#FFF" fontSize={11} fontWeight="900" textAnchor="middle" alignmentBaseline="middle" transform={`rotate(${mid + 90} ${lx} ${ly})`}>
                    {CRAZY_LAYOUT[i]}×
                  </SvgText>
                </G>
              );
            })}
            <Circle cx={CRAZY_RADIUS} cy={CRAZY_RADIUS} r={18} fill="#0B0B0B" stroke="#FFD200" strokeWidth={2} />
          </Svg>
        </Animated.View>
        {/* Single arrow pointer at the top — same outcome for every player. */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -10,
            alignSelf: "center",
            width: 0,
            height: 0,
            borderLeftWidth: 12,
            borderRightWidth: 12,
            borderTopWidth: 22,
            borderLeftColor: "transparent",
            borderRightColor: "transparent",
            borderTopColor: "#FFD200",
          }}
        />
      </View>

      {phase === "revealed" && (
        <>
          <Text style={styles.bonusResult}>
            Crazy Time landed on <Text style={{ color: colors.brandTertiary }}>{bonusMult}×</Text>
          </Text>
          <Text style={styles.bonusPayout}>+{payout} gems</Text>
          <BonusCloseBtn onDone={onDone} />
        </>
      )}
    </View>
  );
}

// (Old Flapper component, flapHex, FlapColor, and randomCrazyMult removed —
// Crazy Time now auto-spins and reveals a single shared multiplier.)

// ============================================================
function BonusCloseBtn({ onDone }: { onDone: () => void }) {
  return (
    <Pressable testID="tt-bonus-close" onPress={() => { haptic("light"); onDone(); }} style={styles.collectBtn}>
      <LinearGradient colors={[colors.brandPrimary, "#FF8F00"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.collectGrad}>
        <Text style={styles.collectText}>COLLECT WINNINGS</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: spacing.md },
  card: { width: "100%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.brandPrimary, gap: spacing.sm },
  bonusBody: { alignItems: "center", gap: spacing.sm },
  bonusTitle: { color: colors.brandTertiary, fontSize: 22, fontWeight: "900", letterSpacing: 2 },
  bonusSub: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", textAlign: "center" },
  bonusResult: { color: colors.onSurface, fontSize: 18, fontWeight: "900", marginTop: spacing.sm, textAlign: "center" },
  bonusPayout: { color: colors.brandSecondary, fontSize: 22, fontWeight: "900" },
  bonusBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill, marginTop: spacing.sm },
  bonusBtnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900", letterSpacing: 1 },
  flipping: { color: colors.onSurface, fontSize: 14, fontWeight: "800", marginTop: spacing.sm },

  // Coin Flip
  coinStage: { width: 130, height: 130, alignItems: "center", justifyContent: "center", marginVertical: spacing.md },
  coin: { width: 110, height: 110, position: "relative" },
  coinFace: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: 55, alignItems: "center", justifyContent: "center", gap: 2, borderWidth: 3, borderColor: "#FFD200", backfaceVisibility: "hidden" },
  coinBack: { transform: [{ rotateY: "180deg" }] },
  coinMult: { color: "#FFF", fontSize: 22, fontWeight: "900" },

  // Cash Hunt
  cashGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", backgroundColor: "#0B0B0B", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: 2, marginVertical: spacing.sm },
  cashCell: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#23262C", backgroundColor: "#16191E" },
  cashCellPicked: { backgroundColor: colors.brandPrimary, borderColor: colors.brandTertiary },
  cashCellMult: { color: "#FFF", fontSize: 13, fontWeight: "900" },

  // Pachinko
  pachBoard: { backgroundColor: "#0B0B0B", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginVertical: spacing.sm, position: "relative" },
  pachBall: { position: "absolute", width: 24, height: 24, borderRadius: 12, backgroundColor: "#FFD200", borderWidth: 2, borderColor: "#FFF" },

  // Crazy Time
  crazyBox: { alignItems: "center", justifyContent: "center", marginVertical: spacing.sm, alignSelf: "center" },
  crazyWheel: { width: CRAZY_SIZE, height: CRAZY_SIZE },
  flapRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  flapBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, borderWidth: 2, borderColor: "#FFF" },
  flapBtnText: { color: "#FFF", fontSize: 14, fontWeight: "900", letterSpacing: 1 },

  collectBtn: { width: "100%", borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.lg },
  collectGrad: { paddingVertical: spacing.md, alignItems: "center" },
  collectText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900", letterSpacing: 1 },
});
