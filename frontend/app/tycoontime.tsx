import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
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
import Svg, { G, Path, Polygon, Text as SvgText, Circle } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";
import { abbreviate } from "@/src/game/format";
import { TycoonTimeBonus, BonusType } from "@/src/game/TycoonTimeBonus";

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

type Seg = { bet: string; label: string; color: string; mult: number; bonus: string | null };
type Win = { round_id: number; name: string; bet: string; wager: number; payout: number; seg_label: string; seg_color: string; ts: number };
type SpinHistory = {
  round_id: number;
  seg_idx: number;
  seg_label: string;
  seg_color: string;
  seg_bet: string;
  bonus: string | null;
  bonus_mult: number;
  top_mult: number;
  top_bet: string;
};
type TTState = {
  round_id: number;
  phase: "betting" | "spinning" | "result";
  phase_ms: number;
  round_ms: number;
  betting_ms_total: number;
  spinning_ms_total: number;
  outcome: { seg_idx: number; seg: Seg; top_mult: number; top_bet: string; bonus_mult: number };
  wins: Win[];
  history?: SpinHistory[];
};

const BET_OPTIONS: { key: string; label: string; color: string; icon: string }[] = [
  { key: "1",        label: "1",         color: "#FFB300", icon: "numeric-1-box" },
  { key: "2",        label: "2",         color: "#1E88E5", icon: "numeric-2-box" },
  { key: "5",        label: "5",         color: "#7B1FA2", icon: "numeric-5-box" },
  { key: "10",       label: "10",        color: "#E53935", icon: "numeric-10-box" },
  // Canonical icons per bonus mode — kept in sync with the SVG glyphs on
  // the main wheel (BonusGlyph below) and the last-20-spins history strip
  // so the same symbol represents the same game mode everywhere in the UI.
  { key: "coinflip", label: "Coin Flip", color: "#00897B", icon: "circle-double" },
  { key: "cashhunt", label: "Cash Hunt", color: "#43A047", icon: "target" },
  { key: "pachinko", label: "Pachinko",  color: "#D81B60", icon: "ball" },
  { key: "crazy",    label: "Crazy",     color: "#FF1744", icon: "star-four-points" },
];

const WHEEL_SIZE = 280;
const WHEEL_RADIUS = WHEEL_SIZE / 2;
const SEGMENT_COUNT = 30;
const SEG_ANGLE = 360 / SEGMENT_COUNT;

function segmentPath(index: number): string {
  const start = (index * SEG_ANGLE - 90) * (Math.PI / 180);
  const end = ((index + 1) * SEG_ANGLE - 90) * (Math.PI / 180);
  const x1 = WHEEL_RADIUS + WHEEL_RADIUS * Math.cos(start);
  const y1 = WHEEL_RADIUS + WHEEL_RADIUS * Math.sin(start);
  const x2 = WHEEL_RADIUS + WHEEL_RADIUS * Math.cos(end);
  const y2 = WHEEL_RADIUS + WHEEL_RADIUS * Math.sin(end);
  return `M ${WHEEL_RADIUS} ${WHEEL_RADIUS} L ${x1} ${y1} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${x2} ${y2} Z`;
}

function labelPos(index: number) {
  const mid = (index + 0.5) * SEG_ANGLE - 90;
  const rad = (mid * Math.PI) / 180;
  const r = WHEEL_RADIUS * 0.72;
  return { x: WHEEL_RADIUS + r * Math.cos(rad), y: WHEEL_RADIUS + r * Math.sin(rad), angle: mid + 90 };
}

// Canonical client-side wheel tables (MUST match TT_SEGMENTS on backend).
// 30 segments: 14× 1, 6× 2, 2× 5, 1× 10, 3× coinflip, 2× cashhunt,
// 1× pachinko, 1× crazy.
const WHEEL_COLORS = [
  "#FFB300","#1E88E5","#FFB300","#00897B","#FFB300",
  "#7B1FA2","#FFB300","#1E88E5","#43A047","#FFB300",
  "#1E88E5","#FFB300","#00897B","#FFB300","#E53935",
  "#FFB300","#1E88E5","#D81B60","#FFB300","#1E88E5",
  "#FFB300","#43A047","#FFB300","#7B1FA2","#FFB300",
  "#00897B","#FFB300","#1E88E5","#FF1744","#FFB300",
];
const WHEEL_LABELS = [
  "1","2","1","FLIP","1",
  "5","1","2","HUNT","1",
  "2","1","FLIP","1","10",
  "1","2","PACH","1","2",
  "1","HUNT","1","5","1",
  "FLIP","1","2","CRAZY","1",
];
const WHEEL_TEXT_COLORS = [
  "#1A1A1A","#FFFFFF","#1A1A1A","#FFFFFF","#1A1A1A",
  "#FFFFFF","#1A1A1A","#FFFFFF","#FFFFFF","#1A1A1A",
  "#FFFFFF","#1A1A1A","#FFFFFF","#1A1A1A","#FFFFFF",
  "#1A1A1A","#FFFFFF","#FFFFFF","#1A1A1A","#FFFFFF",
  "#1A1A1A","#FFFFFF","#1A1A1A","#FFFFFF","#1A1A1A",
  "#FFFFFF","#1A1A1A","#FFFFFF","#FFFFFF","#1A1A1A",
];
// Which bet key each wedge resolves to (matches TT_SEGMENTS on the server).
const WHEEL_BETS: string[] = [
  "1","2","1","coinflip","1",
  "5","1","2","cashhunt","1",
  "2","1","coinflip","1","10",
  "1","2","pachinko","1","2",
  "1","cashhunt","1","5","1",
  "coinflip","1","2","crazy","1",
];

// Recognisable SVG glyphs for each bonus mode — drawn inside the wheel so
// they rotate with the wedge and don't look like cramped letters. Centred
// on the (0,0) of the parent <G transform="translate(x y) rotate(angle)" />.
function BonusGlyph({ bet, color }: { bet: string; color: string }) {
  if (bet === "coinflip") {
    // Two overlapping circles = a coin showing both faces
    return (
      <G>
        <Circle cx={-3} cy={0} r={5} fill="none" stroke={color} strokeWidth={1.8} />
        <Circle cx={3}  cy={0} r={5} fill={color}  opacity={0.55} />
      </G>
    );
  }
  if (bet === "cashhunt") {
    // Concentric circles = target / crosshair
    return (
      <G>
        <Circle cx={0} cy={0} r={7} fill="none" stroke={color} strokeWidth={1.5} />
        <Circle cx={0} cy={0} r={4} fill="none" stroke={color} strokeWidth={1.5} />
        <Circle cx={0} cy={0} r={1.5} fill={color} />
      </G>
    );
  }
  if (bet === "pachinko") {
    // Filled circle with a highlight = a ball/peg
    return (
      <G>
        <Circle cx={0} cy={0} r={6.5} fill={color} />
        <Circle cx={-2} cy={-2} r={1.8} fill="#FFFFFF" opacity={0.85} />
      </G>
    );
  }
  if (bet === "crazy") {
    // Four-pointed star (Crazy Time signature)
    return (
      <Path
        d="M 0 -8 L 2 -2 L 8 0 L 2 2 L 0 8 L -2 2 L -8 0 L -2 -2 Z"
        fill={color}
      />
    );
  }
  return null;
}

// Position of the little gem marker that shows "you've bet on this wedge".
// Sits between the label and the outer edge so it doesn't collide with text.
function gemPos(index: number) {
  const mid = (index + 0.5) * SEG_ANGLE - 90;
  const rad = (mid * Math.PI) / 180;
  const r = WHEEL_RADIUS * 0.92;
  return { x: WHEEL_RADIUS + r * Math.cos(rad), y: WHEEL_RADIUS + r * Math.sin(rad) };
}

// =====================================================================
// Top Slot — two vertical reels (multiplier + bet key). Both spin during the
// betting phase, then lock when the wheel transitions to spinning.
// =====================================================================
const TOP_MULT_DISPLAY = [2, 3, 5, 10];  // values shown on the multiplier reel
const TOP_TILE_HEIGHT = 36;
const TOP_REEL_LENGTH = 20;
const TOP_WINNER_INDEX = 16;

function TopSlot({ phase, topMult, topBet }: { phase: "betting" | "spinning" | "result"; topMult: number; topBet: string }) {
  // Pre-build a reel strip per round. Re-randomise when round changes (the
  // landing index always sits at TOP_WINNER_INDEX so the lock-in feels right).
  const multReel = useRef<(number | "MISS")[]>([]).current;
  const betReel  = useRef<string[]>([]).current;
  if (multReel.length === 0) {
    for (let i = 0; i < TOP_REEL_LENGTH; i++) {
      multReel.push(i === TOP_WINNER_INDEX ? (topMult === 1 ? "MISS" : topMult) : (Math.random() < 0.7 ? "MISS" : TOP_MULT_DISPLAY[Math.floor(Math.random() * TOP_MULT_DISPLAY.length)]));
      betReel.push(i === TOP_WINNER_INDEX ? topBet : TT_TOP_BET_KEY_DISPLAY[Math.floor(Math.random() * TT_TOP_BET_KEY_DISPLAY.length)]);
    }
  }

  // When the round changes (we infer this by checking the snapshot index),
  // refresh the strip with the new outcome at the winner index.
  const lastTopKey = useRef<string>("");
  const curKey = `${topMult}:${topBet}`;
  if (lastTopKey.current !== curKey) {
    lastTopKey.current = curKey;
    multReel.length = 0;
    betReel.length = 0;
    for (let i = 0; i < TOP_REEL_LENGTH; i++) {
      multReel.push(i === TOP_WINNER_INDEX ? (topMult === 1 ? "MISS" : topMult) : (Math.random() < 0.7 ? "MISS" : TOP_MULT_DISPLAY[Math.floor(Math.random() * TOP_MULT_DISPLAY.length)]));
      betReel.push(i === TOP_WINNER_INDEX ? topBet : TT_TOP_BET_KEY_DISPLAY[Math.floor(Math.random() * TT_TOP_BET_KEY_DISPLAY.length)]);
    }
  }

  const multOffset = useSharedValue(0);
  const betOffset  = useSharedValue(0);
  const multStyle  = useAnimatedStyle(() => ({ transform: [{ translateY: multOffset.value }] }));
  const betStyle   = useAnimatedStyle(() => ({ transform: [{ translateY: betOffset.value }] }));

  // When the round shifts to "spinning", animate both reels to lock in.
  useEffect(() => {
    const lockY = -(TOP_WINNER_INDEX * TOP_TILE_HEIGHT);
    if (phase === "betting") {
      // Idle slow scroll while bets are being taken.
      multOffset.value = 0;
      betOffset.value  = 0;
      multOffset.value = withTiming(lockY * 0.4, { duration: 4000, easing: Easing.linear });
      betOffset.value  = withTiming(lockY * 0.4, { duration: 4000, easing: Easing.linear });
    } else if (phase === "spinning") {
      // Final lock-in.
      multOffset.value = withTiming(lockY, { duration: 1400, easing: Easing.bezier(0.1, 0.7, 0.2, 1) });
      betOffset.value  = withTiming(lockY, { duration: 1600, easing: Easing.bezier(0.1, 0.7, 0.2, 1) });
    }
    // Result phase: leave it locked in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, topMult, topBet]);

  const labelFor = (k: string) => BET_OPTIONS.find((o) => o.key === k)?.label ?? k;
  const colorFor = (k: string) => BET_OPTIONS.find((o) => o.key === k)?.color ?? colors.onSurface;

  return (
    <View style={styles.topSlotWrap} testID="tycoontime-top-slot">
      <Text style={styles.topSlotLabel}>TOP SLOT</Text>
      <View style={styles.topSlotRow}>
        <View style={[styles.topSlotWindow, { width: 100 }]}>
          <Animated.View style={multStyle}>
            {multReel.map((m, i) => (
              <View key={i} style={styles.topSlotTile}>
                <Text style={[styles.topSlotMult, m === "MISS" && styles.topSlotMiss]}>
                  {m === "MISS" ? "—" : `${m}×`}
                </Text>
              </View>
            ))}
          </Animated.View>
          <View pointerEvents="none" style={styles.topSlotTicker} />
        </View>
        <MaterialCommunityIcons name="close" size={14} color={colors.onSurfaceTertiary} />
        <View style={[styles.topSlotWindow, { width: 130 }]}>
          <Animated.View style={betStyle}>
            {betReel.map((b, i) => (
              <View key={i} style={styles.topSlotTile}>
                <Text style={[styles.topSlotBet, { color: colorFor(b) }]} numberOfLines={1}>
                  {labelFor(b)}
                </Text>
              </View>
            ))}
          </Animated.View>
          <View pointerEvents="none" style={styles.topSlotTicker} />
        </View>
      </View>
      <Text style={styles.topSlotHint}>
        {phase === "result" && topMult > 1 ? `${topMult}× on ${labelFor(topBet)} this round` : phase === "result" ? "No top-slot bonus" : "Hits a single bet — or misses entirely"}
      </Text>
    </View>
  );
}

const TT_TOP_BET_KEY_DISPLAY = ["1", "2", "5", "10", "coinflip", "cashhunt", "pachinko", "crazy"];

export default function TycoonTimeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, adjustGems, showToast, claimPendingGrantsNow } = useGame();
  const [ttState, setTTState] = useState<TTState | null>(null);
  const [bet, setBet] = useState<string>("1");
  const [wagerText, setWagerText] = useState<string>("10");
  const [myBets, setMyBets] = useState<Record<string, number>>({});
  const [myRound, setMyRound] = useState<number>(-1);
  const [lastBets, setLastBets] = useState<Record<string, number> | null>(null);
  const [result, setResult] = useState<{ won: boolean; payout: number; seg: Seg; topMult: number; bonusMult: number; totalWager: number } | null>(null);
  const [bonus, setBonus] = useState<{ type: BonusType; bonusMult: number; wager: number; topMult: number; pendingResult: { won: boolean; payout: number; seg: Seg; topMult: number; bonusMult: number; totalWager: number } } | null>(null);
  const lastSpunRound = useRef<number>(-1);
  const wheelRotation = useSharedValue(0);
  const rotationRef = useRef<number>(0);
  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotateZ: `${wheelRotation.value}deg` }] }));

  // Poll server state every 1s
  useEffect(() => {
    let stop = false;
    const fetchState = async () => {
      try {
        const r = await fetch(`${API}/api/tycoontime/state`);
        const j: TTState = await r.json();
        if (!stop) setTTState(j);
      } catch {}
    };
    fetchState();
    const id = setInterval(fetchState, 1000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  // Trigger wheel animation whenever a new round transitions into spinning.
  useEffect(() => {
    if (!ttState) return;
    if (ttState.phase === "spinning" && lastSpunRound.current !== ttState.round_id) {
      lastSpunRound.current = ttState.round_id;
      const segIdx = ttState.outcome.seg_idx;
      const segCenter = (segIdx + 0.5) * SEG_ANGLE;
      const baseAngle = -segCenter;
      const fullSpins = 7;
      const jitter = (Math.random() - 0.5) * (SEG_ANGLE * 0.55);
      const final = rotationRef.current + fullSpins * 360 + ((baseAngle - rotationRef.current) % 360 + 360) % 360 + jitter;
      rotationRef.current = final;
      wheelRotation.value = withTiming(final, {
        duration: ttState.spinning_ms_total,
        easing: Easing.bezier(0.05, 0.85, 0.1, 1),
      }, (finished) => {
        if (finished) runOnJS(handleSettle)();
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttState?.round_id, ttState?.phase]);

  // Apply payout to local balance when settling a round we bet on.
  // NOTE: gem crediting is server-authoritative — the bet endpoint queues
  // the payout into pending_grants the moment the wager is placed. Here we
  // just trigger an immediate claim so the gem counter bumps up at the same
  // time the result modal appears. If the player navigates away mid-spin,
  // the GameContext's 30s grant poller will credit them anyway.
  const handleSettle = () => {
    if (!ttState) return;
    const seg = ttState.outcome.seg;
    const winningBet = seg.bet;
    const placed = myRound === ttState.round_id ? myBets : {};
    const totalWager = Object.values(placed).reduce((a, b) => a + b, 0);
    const winWager = placed[winningBet] ?? 0;
    let payout = 0;
    if (winWager > 0) {
      const baseMult = seg.bonus ? ttState.outcome.bonus_mult : seg.mult;
      const applied = winningBet === ttState.outcome.top_bet ? ttState.outcome.top_mult : 1;
      payout = Math.round(winWager * baseMult * applied);
    }
    const pendingResult = {
      won: payout > 0,
      payout,
      seg,
      topMult: winningBet === ttState.outcome.top_bet ? ttState.outcome.top_mult : 1,
      bonusMult: ttState.outcome.bonus_mult,
      totalWager,
    };
    // ★ Bonus mini-games are GROUP events — every player watching the wheel
    //   sees the cinematic reveal regardless of whether they bet on it.
    //   The deterministic bonus_mult means whoever DID bet on this segment
    //   gets the SAME multiplier server-side; spectators just enjoy the show.
    if (seg.bonus) {
      haptic(winWager > 0 ? "success" : "light");
      setBonus({
        type: seg.bonus as BonusType,
        bonusMult: ttState.outcome.bonus_mult,
        wager: winWager,        // 0 for spectators — bonus UI handles that
        topMult: ttState.outcome.top_mult,
        pendingResult,
      });
      return;
    }
    if (payout > 0) {
      haptic("success");
      void claimPendingGrantsNow();
    } else if (totalWager > 0) {
      haptic("error");
    }
    // Only show the result modal to players who actually bet this round.
    if (totalWager > 0) setResult(pendingResult);
  };

  // Called when a bonus mini-game's reveal modal is dismissed.
  const finalizeBonus = () => {
    if (!bonus) return;
    if (bonus.pendingResult.payout > 0) {
      void claimPendingGrantsNow();
    }
    // Only show the result modal to bettors (spectators just see the bonus).
    if (bonus.pendingResult.totalWager > 0) {
      setResult(bonus.pendingResult);
    }
    setBonus(null);
  };

  // Reset placed bets whenever we transition into a new round's BETTING phase.
  // Stash the last round's bets so the "Repeat Last Bet" button has something
  // to replay.
  useEffect(() => {
    if (!ttState) return;
    if (ttState.phase === "betting" && myRound !== ttState.round_id && myRound !== -1) {
      if (Object.keys(myBets).length > 0) {
        setLastBets(myBets);
      }
      setMyBets({});
      setMyRound(-1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttState?.round_id, ttState?.phase, myRound]);

  if (!state || !ttState) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: colors.onSurfaceTertiary }}>Loading wheel…</Text>
      </View>
    );
  }

  // Age verification gate — required before any gem wagering.
  if (!state.ageVerified) {
    return (
      <View style={[styles.container, styles.center, { padding: spacing.xl, gap: spacing.md }]} testID="tycoontime-age-gate">
        <MaterialCommunityIcons name="shield-lock" size={56} color="#FFB300" />
        <Text style={[styles.title, { color: colors.onSurface, textAlign: "center" }]}>Age Verification Required</Text>
        <Text style={[styles.howToText, { fontSize: 13, textAlign: "center" }]}>
          Tycoon Time is a gem-wagering minigame restricted to ages 18+.{"\n\n"}
          Open your Profile tab and verify your age to unlock it.
        </Text>
        <Pressable
          testID="tycoontime-go-verify"
          onPress={() => { haptic("light"); router.replace("/(tabs)/profile" as any); }}
          style={[styles.spinBtn, { marginTop: spacing.lg, width: "100%" }]}
        >
          <LinearGradient colors={["#FFB300", "#FF5722"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.spinGrad}>
            <MaterialCommunityIcons name="account-cog" size={20} color="#000" />
            <Text style={styles.spinText}>GO TO PROFILE</Text>
          </LinearGradient>
        </Pressable>
        <Pressable testID="tycoontime-back-from-gate" onPress={() => router.back()}>
          <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800", marginTop: spacing.md }}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  const gems = state.gems ?? 0;
  const phaseSec = Math.ceil(ttState.phase_ms / 1000);
  const wagerNum = Math.max(0, parseInt(wagerText, 10) || 0);
  const totalWagered = Object.values(myBets).reduce((a, b) => a + b, 0);
  const canBet = ttState.phase === "betting" && wagerNum > 0 && wagerNum <= gems;

  const placeBet = async () => {
    if (!canBet) {
      if (wagerNum <= 0) showToast("Enter a wager");
      else if (wagerNum > gems) showToast("Not enough gems");
      else if (ttState.phase !== "betting") showToast("Betting closed");
      return;
    }
    haptic("medium");
    adjustGems(-wagerNum);
    // Stack onto existing bet for this segment.
    const targetBet = bet;
    const targetWager = wagerNum;
    setMyBets((prev) => ({ ...prev, [targetBet]: (prev[targetBet] ?? 0) + targetWager }));
    setMyRound(ttState.round_id);
    try {
      const resp = await fetch(`${API}/api/tycoontime/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: state.deviceId,
          name: state.playerName || "Tycoon",
          round_id: ttState.round_id,
          bet: targetBet,
          wager: targetWager,
        }),
      });
      if (!resp.ok) throw new Error(`status ${resp.status}`);
    } catch {
      // Roll back local optimistic update on failure.
      adjustGems(targetWager);
      setMyBets((prev) => {
        const next = { ...prev };
        const cur = (next[targetBet] ?? 0) - targetWager;
        if (cur <= 0) delete next[targetBet]; else next[targetBet] = cur;
        return next;
      });
      showToast("Couldn't reach server");
      haptic("error");
    }
  };

  const clearBets = () => {
    // Local-only "clear" — we can't recall bets already sent to the server, so
    // this only resets the visual chips so the player can review which segments
    // they've staked.
    haptic("light");
    setMyBets({});
  };

  // Replay the previous round's bets onto the current round (one tap, one
  // shot — saves rebuilding stack-of-segments setups every spin).
  const repeatLastBet = async () => {
    if (!lastBets || ttState.phase !== "betting") return;
    const total = Object.values(lastBets).reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    if (total > gems) {
      showToast("Not enough gems to repeat that bet");
      haptic("error");
      return;
    }
    haptic("medium");
    adjustGems(-total);
    setMyBets((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(lastBets)) {
        next[k] = (next[k] ?? 0) + (v as number);
      }
      return next;
    });
    setMyRound(ttState.round_id);
    // Fire off each bet to the server (parallel).
    try {
      await Promise.all(
        Object.entries(lastBets).map(([k, v]) =>
          fetch(`${API}/api/tycoontime/bet`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              device_id: state.deviceId,
              name: state.playerName || "Tycoon",
              round_id: ttState.round_id,
              bet: k,
              wager: v as number,
            }),
          }),
        ),
      );
    } catch {
      showToast("Couldn't reach server");
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} testID="tycoontime-screen">
      <LinearGradient colors={["#1A0033", "#3A0066"]} style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Pressable testID="tycoontime-back" onPress={() => router.back()} style={styles.backBtn}>
            <MaterialCommunityIcons name="chevron-left" size={28} color="#FFF" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Tycoon Time</Text>
            <Text style={styles.subtitle}>Round #{ttState.round_id} · {ttState.phase.toUpperCase()} {phaseSec}s</Text>
          </View>
          <View style={styles.gemPill}>
            <MaterialCommunityIcons name="diamond-stone" size={14} color={colors.brandTertiary} />
            <Text style={styles.gemText}>{abbreviate(gems)}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* ====== Live wins ticker — at the top ====== */}
      <View style={styles.winsTop} testID="tycoontime-wins-feed">
        <Text style={styles.winsTopLabel}>LIVE WINS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.winsTopRow}>
          {ttState.wins.length === 0 ? (
            <Text style={styles.winsTopEmpty}>No wins yet — be the first!</Text>
          ) : (
            ttState.wins.map((w, i) => (
              <View key={`${w.round_id}-${w.ts}-${i}`} style={[styles.winsTopChip, { borderColor: w.seg_color }]}>
                <Text style={styles.winsTopName} numberOfLines={1}>{w.name}</Text>
                <View style={styles.winsTopMid}>
                  <View style={[styles.winsTopSeg, { backgroundColor: w.seg_color }]}>
                    <Text style={styles.winsTopSegText}>{w.seg_label}</Text>
                  </View>
                  <MaterialCommunityIcons name="diamond-stone" size={11} color={colors.brandTertiary} />
                  <Text style={styles.winsTopPayout}>+{abbreviate(w.payout)}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ====== Top Slot ====== */}
        <TopSlot
          phase={ttState.phase}
          topMult={ttState.outcome.top_mult}
          topBet={ttState.outcome.top_bet}
        />

        {/* ====== Wheel ====== */}
        <View style={styles.wheelBox}>
            <View pointerEvents="none" style={styles.pointer} />
            <Animated.View style={[styles.wheelRotator, wheelStyle]}>
              <Svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}>
                <G>
                  {/* segments are drawn from the canonical client-side table to keep it visual-only */}
                  {Array.from({ length: SEGMENT_COUNT }).map((_, i) => (
                    <Path key={i} d={segmentPath(i)} fill={WHEEL_COLORS[i]} stroke="#0B0B0B" strokeWidth={1.5} />
                  ))}
                  {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
                    const label = WHEEL_LABELS[i] ?? "";
                    const pos = labelPos(i);
                    const bet = WHEEL_BETS[i];
                    const isBonus = bet === "coinflip" || bet === "cashhunt" || bet === "pachinko" || bet === "crazy";
                    if (isBonus) {
                      // Bonus segments get a recognisable icon glyph instead
                      // of cramped text, rotated to match the wedge.
                      return (
                        <G key={`l-${i}`} transform={`translate(${pos.x} ${pos.y}) rotate(${pos.angle})`}>
                          <BonusGlyph bet={bet} color={WHEEL_TEXT_COLORS[i]} />
                        </G>
                      );
                    }
                    // Number wedges (1 / 2 / 5 / 10) keep the digit.
                    return (
                      <SvgText
                        key={`l-${i}`}
                        x={pos.x}
                        y={pos.y}
                        fill={WHEEL_TEXT_COLORS[i]}
                        fontSize={13}
                        fontWeight="900"
                        textAnchor="middle"
                        alignmentBaseline="middle"
                        transform={`rotate(${pos.angle} ${pos.x} ${pos.y})`}
                      >
                        {label}
                      </SvgText>
                    );
                  })}

                  {/* Gem markers on wedges the player has bet on this round. */}
                  {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
                    const wagered = myBets[WHEEL_BETS[i]] ?? 0;
                    if (wagered <= 0) return null;
                    const p = gemPos(i);
                    const d = 6; // diamond radius
                    const points = `${p.x},${p.y - d} ${p.x + d},${p.y} ${p.x},${p.y + d} ${p.x - d},${p.y}`;
                    return (
                      <G key={`g-${i}`}>
                        <Polygon
                          points={points}
                          fill="#00E5FF"
                          stroke="#FFFFFF"
                          strokeWidth={1.5}
                        />
                      </G>
                    );
                  })}
                  <Circle cx={WHEEL_RADIUS} cy={WHEEL_RADIUS} r={22} fill="#0B0B0B" stroke="#FFD200" strokeWidth={3} />
                </G>
              </Svg>
            </Animated.View>
          </View>

          {/* Phase indicator + countdown bar */}
          <View style={styles.phaseBox}>
            <Text style={styles.phaseText}>
              {ttState.phase === "betting" ? `Bets close in ${phaseSec}s` : ttState.phase === "spinning" ? "Spinning…" : `Round ends in ${phaseSec}s`}
            </Text>
            <View style={styles.phaseTrack}>
              <View style={[styles.phaseFill, { width: `${100 - Math.round((ttState.phase_ms / (ttState.phase === "betting" ? ttState.betting_ms_total : ttState.spinning_ms_total)) * 100)}%` }]} />
            </View>
          </View>

          {/* Bet picker */}
          <Text style={styles.sectionTitle}>Pick a segment (you can stack on multiple)</Text>
          <View style={styles.betGrid}>
            {BET_OPTIONS.map((opt) => {
              const active = bet === opt.key;
              const placed = myBets[opt.key] ?? 0;
              return (
                <Pressable
                  key={opt.key}
                  testID={`bet-${opt.key}`}
                  onPress={() => { haptic("light"); setBet(opt.key); }}
                  style={[styles.betChip, active && { borderColor: opt.color, backgroundColor: opt.color + "22" }]}
                >
                  <MaterialCommunityIcons name={opt.icon as any} size={18} color={opt.color} />
                  <Text style={[styles.betChipLabel, active && { color: opt.color }]} numberOfLines={1}>{opt.label}</Text>
                  {placed > 0 && (
                    <View style={[styles.betBadge, { backgroundColor: opt.color }]} testID={`bet-badge-${opt.key}`}>
                      <Text style={styles.betBadgeText}>{placed}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Total wagered summary */}
          {totalWagered > 0 && (
            <View style={styles.wagerSummary} testID="tycoontime-bets-summary">
              <MaterialCommunityIcons name="diamond-stone" size={14} color={colors.brandTertiary} />
              <Text style={styles.wagerSummaryText}>
                {Object.keys(myBets).length} bet{Object.keys(myBets).length === 1 ? "" : "s"} · {totalWagered} gems on this round
              </Text>
              <Pressable testID="tycoontime-clear-display" onPress={clearBets} hitSlop={8}>
                <Text style={styles.wagerSummaryClear}>HIDE</Text>
              </Pressable>
            </View>
          )}

          {/* Free-form wager input */}
          <Text style={styles.sectionTitle}>Wager (any amount)</Text>
          <View style={styles.wagerInputRow}>
            <MaterialCommunityIcons name="diamond-stone" size={18} color={colors.brandTertiary} />
            <TextInput
              testID="wager-input"
              value={wagerText}
              onChangeText={(t) => setWagerText(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.wagerInput}
              maxLength={9}
            />
            <Pressable testID="wager-all" onPress={() => setWagerText(String(gems))} style={styles.allInBtn}>
              <Text style={styles.allInText}>ALL IN</Text>
            </Pressable>
          </View>

          {/* Place bet button */}
          <Pressable
            testID="tycoontime-place-bet"
            onPress={placeBet}
            disabled={!canBet}
            style={[styles.spinBtn, !canBet && { opacity: 0.5 }]}
          >
            <LinearGradient colors={canBet ? ["#FFB300", "#FF5722"] : ["#555", "#333"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.spinGrad}>
              <MaterialCommunityIcons name="plus-circle" size={20} color="#000" />
              <Text style={styles.spinText}>
                {ttState.phase === "betting"
                  ? `ADD ${wagerNum} ON ${bet.toUpperCase()}`
                  : ttState.phase === "spinning" ? "SPINNING…" : "WAIT FOR NEXT ROUND"}
              </Text>
            </LinearGradient>
          </Pressable>

          {/* Repeat last bet — replays the previous round's full bet stack. */}
          {lastBets && Object.keys(lastBets).length > 0 && ttState.phase === "betting" && (
            <Pressable
              testID="tycoontime-repeat-last"
              onPress={repeatLastBet}
              style={styles.repeatBtn}
            >
              <MaterialCommunityIcons name="restore" size={16} color={colors.brandSecondary} />
              <Text style={styles.repeatText}>
                REPEAT LAST BET · {Object.values(lastBets).reduce((a, b) => a + b, 0)} gems across {Object.keys(lastBets).length} segment{Object.keys(lastBets).length === 1 ? "" : "s"}
              </Text>
            </Pressable>
          )}

          <Text style={styles.howToText}>
            Win = wager × segment multiplier × top-slot (only if it lit up your segment).
          </Text>

          {/* Last 20 spins strip — server-authoritative history. */}
          {ttState.history && ttState.history.length > 0 && (
            <View style={styles.historyWrap} testID="tycoontime-history">
              <Text style={styles.historyLabel}>LAST 20 SPINS</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.historyRow}
              >
                {ttState.history.map((h) => {
                  // Bonus rounds show recognizable game-mode icons.
                  // Number rounds (1/2/5/10) keep their numeric label.
                  const bonusIcon: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
                    coinflip: "circle-double",   // two-sided coin
                    cashhunt: "target",          // crosshair / target board
                    pachinko: "ball",            // bouncing ball
                    crazy:    "star-four-points",// big multiplier star
                  };
                  const iconName = h.bonus ? bonusIcon[h.bonus] : undefined;
                  return (
                    <View
                      key={h.round_id}
                      style={[styles.historyChip, { backgroundColor: h.seg_color }]}
                      testID={`history-${h.round_id}`}
                    >
                      {iconName ? (
                        <MaterialCommunityIcons name={iconName} size={18} color="#FFFFFF" />
                      ) : (
                        <Text style={styles.historyChipText}>{h.seg_label}</Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </ScrollView>

      {bonus && (
        <TycoonTimeBonus
          bonus={bonus.type}
          bonusMult={bonus.bonusMult}
          wager={bonus.wager}
          topMult={bonus.topMult}
          onDone={finalizeBonus}
        />
      )}

      <Modal visible={!!result} transparent animationType="fade" onRequestClose={() => setResult(null)}>
        <View style={styles.backdrop}>
          <View style={styles.resultCard} testID="tycoontime-result">
            <View style={[styles.resultIcon, { backgroundColor: result?.seg.color + "22" }]}>
              <MaterialCommunityIcons
                name={(result?.seg.bonus === "crazy" ? "star-four-points" : result?.seg.bonus === "cashhunt" ? "target" : result?.seg.bonus === "pachinko" ? "ball" : result?.seg.bonus === "coinflip" ? "circle-double" : "star") as any}
                size={48}
                color={result?.seg.color ?? colors.brandPrimary}
              />
            </View>
            <Text style={styles.resultLanded}>Wheel landed on</Text>
            <Text style={[styles.resultSeg, { color: result?.seg.color }]}>{result?.seg.label}</Text>
            {result && result.topMult > 1 && <Text style={styles.resultMult}>Top slot: {result.topMult}×</Text>}
            {result?.seg.bonus && <Text style={styles.resultMult}>
              {result.seg.bonus === "coinflip" ? "Coin Flip" : result.seg.bonus === "cashhunt" ? "Cash Hunt" : result.seg.bonus === "pachinko" ? "Pachinko" : "Crazy Time"} roll: {result.bonusMult}×
            </Text>}
            <Text style={[styles.resultTitle, { color: result?.won ? colors.brandSecondary : colors.error }]}>
              {result?.won ? `YOU WIN +${result.payout} gems!` : "Better luck next round"}
            </Text>
            {result && result.totalWager > 0 && (
              <Text style={styles.resultMult}>
                Net: {result.won ? `+${result.payout - result.totalWager}` : `−${result.totalWager}`} gems
              </Text>
            )}
            <Pressable testID="tycoontime-collect" onPress={() => { haptic("light"); setResult(null); }} style={styles.collectBtn}>
              <LinearGradient colors={[colors.brandPrimary, "#FF8F00"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.collectGrad}>
                <Text style={styles.collectText}>{result?.won ? "COLLECT" : "TRY AGAIN"}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFF", fontSize: 22, fontWeight: "900" },
  subtitle: { color: "#FFFFFFCC", fontSize: 12, fontWeight: "700", marginTop: 2 },
  gemPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#000000AA", borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  gemText: { color: colors.brandTertiary, fontSize: 13, fontWeight: "900" },

  mainSplit: { flex: 1 },
  body: { padding: spacing.md, gap: spacing.sm },

  // Live wins (top horizontal strip)
  winsTop: {
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  winsTopLabel: {
    color: colors.brandTertiary, fontSize: 9, fontWeight: "900", letterSpacing: 1.5,
    paddingHorizontal: spacing.md, marginBottom: 4,
  },
  winsTopRow: { paddingHorizontal: spacing.md, gap: 6, alignItems: "center" },
  winsTopEmpty: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700" },
  winsTopChip: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
    borderLeftWidth: 3,
    flexShrink: 0,
    minWidth: 110,
  },
  winsTopName: { color: colors.onSurface, fontSize: 10, fontWeight: "900" },
  winsTopMid: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  winsTopSeg: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  winsTopSegText: { color: "#FFF", fontSize: 9, fontWeight: "900" },
  winsTopPayout: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900" },

  // Top slot
  topSlotWrap: { alignItems: "center", marginBottom: 4 },
  topSlotLabel: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 2, marginBottom: 4 },
  topSlotRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  topSlotWindow: {
    height: TOP_TILE_HEIGHT, overflow: "hidden",
    backgroundColor: "#0B0B0B",
    borderRadius: 6,
    borderWidth: 2, borderColor: "#FFD200",
  },
  topSlotTile: { height: TOP_TILE_HEIGHT, alignItems: "center", justifyContent: "center" },
  topSlotMult: { color: "#FFD200", fontSize: 18, fontWeight: "900" },
  topSlotMiss: { color: "#666", fontSize: 22 },
  topSlotBet: { fontSize: 12, fontWeight: "900", letterSpacing: 0.5, paddingHorizontal: 6 },
  topSlotTicker: {
    position: "absolute", left: 0, right: 0, top: "50%",
    height: 2, marginTop: -1, backgroundColor: "#FF572266",
  },
  topSlotHint: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: "700", marginTop: 4 },

  wheelBox: { width: WHEEL_SIZE, height: WHEEL_SIZE, alignSelf: "center", alignItems: "center", justifyContent: "center", marginVertical: spacing.sm },
  wheelRotator: { width: WHEEL_SIZE, height: WHEEL_SIZE },
  pointer: {
    position: "absolute", top: -6, left: "50%", marginLeft: -10,
    width: 0, height: 0,
    borderLeftWidth: 10, borderRightWidth: 10, borderTopWidth: 18,
    borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "#FFD200",
    zIndex: 10,
  },

  phaseBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.sm, gap: 6, borderWidth: 1, borderColor: colors.border },
  phaseText: { color: colors.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 0.5, textAlign: "center" },
  phaseTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  phaseFill: { height: "100%", backgroundColor: colors.brandPrimary },

  sectionTitle: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginTop: spacing.xs },
  betGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  betChip: {
    flexGrow: 1, flexBasis: "30%",
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 6,
    borderWidth: 2, borderColor: colors.border,
  },
  betChipLabel: { flex: 1, color: colors.onSurface, fontSize: 11, fontWeight: "900" },
  betChipPayout: { color: colors.onSurfaceTertiary, fontSize: 9, fontWeight: "800" },
  betBadge: {
    position: "absolute", top: -6, right: -6,
    minWidth: 22, height: 22, borderRadius: 11,
    paddingHorizontal: 5,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.surface,
  },
  betBadgeText: { color: "#FFF", fontSize: 10, fontWeight: "900" },
  wagerSummary: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandTertiary + "1F",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    marginTop: 4,
  },
  wagerSummaryText: { flex: 1, color: colors.onSurface, fontSize: 12, fontWeight: "800" },
  wagerSummaryClear: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },

  wagerInputRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  wagerInput: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: "900", paddingVertical: 4 },
  allInBtn: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  allInText: { color: "#FFF", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },

  spinBtn: { borderRadius: radius.pill, overflow: "hidden", marginTop: 6 },
  spinGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.md },
  spinText: { color: "#000", fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },

  howToText: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", marginTop: 4, lineHeight: 16, textAlign: "center" },

  // Live feed column
  feedCol: {
    width: 110,
    backgroundColor: colors.surfaceSecondary,
    borderLeftWidth: 1, borderLeftColor: colors.border,
    paddingHorizontal: 6, paddingVertical: spacing.sm,
  },
  feedTitle: { color: colors.brandTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 1, textAlign: "center", marginBottom: 6 },
  feedEmpty: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: "700", textAlign: "center", marginTop: 20, paddingHorizontal: 4 },
  feedRow: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    padding: 6,
    marginBottom: 5,
    borderLeftWidth: 3,
  },
  feedName: { color: colors.onSurface, fontSize: 10, fontWeight: "900" },
  feedRowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 },
  feedBet: { color: colors.onSurfaceTertiary, fontSize: 9, fontWeight: "800" },
  feedPayout: { flexDirection: "row", alignItems: "center", gap: 2 },
  feedPayoutText: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900" },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  resultCard: { width: "100%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.brandPrimary, gap: spacing.xs },
  resultIcon: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  resultLanded: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  resultSeg: { fontSize: 32, fontWeight: "900", letterSpacing: 2 },
  resultMult: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  resultTitle: { fontSize: 18, fontWeight: "900", marginTop: spacing.sm, textAlign: "center" },
  collectBtn: { width: "100%", borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.lg },
  collectGrad: { paddingVertical: spacing.md, alignItems: "center" },
  collectText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900", letterSpacing: 1 },

  // Repeat-last-bet button
  repeatBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.brandSecondary + "55",
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  repeatText: {
    color: colors.brandSecondary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  // Last 20 spins history strip
  historyWrap: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyLabel: {
    color: colors.brandTertiary,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  historyRow: {
    gap: 4,
    paddingRight: spacing.md,
  },
  historyChip: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#000000",
    flexShrink: 0,
  },
  historyChipText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    textShadowColor: "#000",
    textShadowRadius: 1,
  },
});
