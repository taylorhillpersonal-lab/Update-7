import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { haptic } from "@/src/game/haptics";
import { storage } from "@/src/utils/storage";

// 5-letter solution pool (curated, common English).
const WORDS = [
  "MONEY","TYCOO" /* sentinel removed below */,"BANKS","CROWN","GOLDS",
  "STOCK","TRADE","BOSSY","SUITS","STORE","HOTEL","DEALS","WORTH","CRANE",
  "POWER","WAGER","SHARE","CHIPS","TOWER","VAULT","SAVED","EARNS","LEVEL",
  "SPEND","BUILD","GAINS","HOUSE","BRAND","CASHY","HEIST","ASSET","WALES",
  "BREAD","CHEAP","COINS","LOANS","RICHT","STAKE","BLING","PRIME","NOBLE",
  "CARGO","EAGLE","SHARK","CLOUT","FAVOR","MEDAL","TRUMP","ELITE","HONOR",
].filter((w) => w.length === 5 && /^[A-Z]+$/.test(w) && !["TYCOO","CASHY","RICHT","WALES","TRUMP"].includes(w))
  // Backup pool of safer 5-letter words.
  .concat(["MONEY","BANKS","CROWN","STOCK","TRADE","SUITS","STORE","HOTEL","DEALS","WORTH",
           "CRANE","POWER","WAGER","SHARE","CHIPS","TOWER","VAULT","SAVED","EARNS","LEVEL",
           "SPEND","BUILD","GAINS","HOUSE","BRAND","HEIST","ASSET","BREAD","CHEAP","COINS",
           "LOANS","STAKE","BLING","PRIME","NOBLE","CARGO","EAGLE","SHARK","CLOUT","FAVOR",
           "MEDAL","ELITE","HONOR","PEARL","ROYAL","RICHE","BANKS","KARMA","LUXOR","HEAVY"]);

const UNIQUE_WORDS = Array.from(new Set(WORDS));

const STATE_KEY = "tycoon_wordle_state_v1";
const COOLDOWN_KEY = "tycoon_wordle_next_at";
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_GUESSES = 6;
const WORD_LEN = 5;

const REWARD_BY_ATTEMPT: Record<number, number> = {
  1: 500,
  2: 300,
  3: 200,
  4: 150,
  5: 100,
  6: 50,
};

type LetterState = "correct" | "present" | "absent" | "empty";

type GameSave = {
  solution: string;
  guesses: string[];
  current: string;
  finished: boolean;
  won: boolean;
};

function scoreGuess(guess: string, solution: string): LetterState[] {
  const result: LetterState[] = Array(WORD_LEN).fill("absent");
  const counts: Record<string, number> = {};
  for (const c of solution) counts[c] = (counts[c] ?? 0) + 1;
  // First pass: greens.
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === solution[i]) {
      result[i] = "correct";
      counts[guess[i]] -= 1;
    }
  }
  // Second pass: yellows.
  for (let i = 0; i < WORD_LEN; i++) {
    if (result[i] === "correct") continue;
    const c = guess[i];
    if ((counts[c] ?? 0) > 0) {
      result[i] = "present";
      counts[c] -= 1;
    }
  }
  return result;
}

const KEYBOARD_ROWS = [
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L"],
  ["ENTER","Z","X","C","V","B","N","M","BACK"],
];

export default function WordleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { adjustGems, showToast } = useGame();
  const [save, setSave] = useState<GameSave | null>(null);
  const [nextAt, setNextAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const [resultOpen, setResultOpen] = useState<{ won: boolean; reward: number; solution: string } | null>(null);

  // Restore prior game state (if any) on mount.
  useEffect(() => {
    (async () => {
      const next = (await storage.getItem(COOLDOWN_KEY, 0)) as number;
      setNextAt(typeof next === "number" ? next : 0);
      const raw = (await storage.getItem(STATE_KEY, "")) as string;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as GameSave;
          if (parsed && parsed.solution?.length === WORD_LEN) {
            // If the previously saved game was finished and the cooldown is still
            // running, keep showing it so the user sees their last result.
            setSave(parsed);
            return;
          }
        } catch {}
      }
      // Start a fresh game.
      startNew();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startNew = async () => {
    const word = UNIQUE_WORDS[Math.floor(Math.random() * UNIQUE_WORDS.length)];
    const fresh: GameSave = { solution: word, guesses: [], current: "", finished: false, won: false };
    setSave(fresh);
    await storage.setItem(STATE_KEY, JSON.stringify(fresh));
  };

  const persist = async (s: GameSave) => {
    setSave(s);
    await storage.setItem(STATE_KEY, JSON.stringify(s));
  };

  const onKey = async (key: string) => {
    if (!save || save.finished) return;
    if (now < nextAt && save.finished) return;
    haptic("light");
    if (key === "BACK") {
      await persist({ ...save, current: save.current.slice(0, -1) });
      return;
    }
    if (key === "ENTER") {
      if (save.current.length < WORD_LEN) {
        showToast("Word must be 5 letters");
        return;
      }
      const guess = save.current;
      const newGuesses = [...save.guesses, guess];
      const won = guess === save.solution;
      const finished = won || newGuesses.length >= MAX_GUESSES;
      const next: GameSave = {
        ...save,
        guesses: newGuesses,
        current: "",
        won,
        finished,
      };
      await persist(next);
      if (finished) {
        const reward = won ? REWARD_BY_ATTEMPT[newGuesses.length] ?? 50 : 0;
        if (reward > 0) {
          adjustGems(reward);
          haptic("success");
        } else {
          haptic("error");
        }
        const cooldownEnd = Date.now() + COOLDOWN_MS;
        await storage.setItem(COOLDOWN_KEY, cooldownEnd);
        setNextAt(cooldownEnd);
        setResultOpen({ won, reward, solution: save.solution });
      }
      return;
    }
    // Letter
    if (save.current.length >= WORD_LEN) return;
    await persist({ ...save, current: save.current + key });
  };

  // Compute per-letter status for the on-screen keyboard.
  const keyStatus = useMemo(() => {
    const out: Record<string, LetterState> = {};
    if (!save) return out;
    const rank: Record<LetterState, number> = { empty: 0, absent: 1, present: 2, correct: 3 };
    for (const g of save.guesses) {
      const score = scoreGuess(g, save.solution);
      for (let i = 0; i < WORD_LEN; i++) {
        const c = g[i];
        const cur = out[c] ?? "empty";
        if (rank[score[i]] > rank[cur]) out[c] = score[i];
      }
    }
    return out;
  }, [save]);

  const fmtCountdown = () => {
    const s = Math.max(0, Math.ceil((nextAt - now) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  };

  const canPlayAgain = save?.finished && now >= nextAt;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} testID="wordle-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="wordle-back" onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Wordle</Text>
          <Text style={styles.subtitle}>Solve the 5-letter word for gems</Text>
        </View>
        <View style={styles.rewardPill}>
          <MaterialCommunityIcons name="diamond-stone" size={14} color={colors.brandTertiary} />
          <Text style={styles.rewardText}>up to 500</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Grid */}
        <View style={styles.grid} testID="wordle-grid">
          {Array.from({ length: MAX_GUESSES }).map((_, row) => {
            const guess = save?.guesses[row] ?? (row === (save?.guesses.length ?? 0) ? save?.current ?? "" : "");
            const isPast = !!save?.guesses[row];
            const score = isPast && save ? scoreGuess(save.guesses[row], save.solution) : null;
            return (
              <View key={row} style={styles.row}>
                {Array.from({ length: WORD_LEN }).map((_, col) => {
                  const letter = guess[col] ?? "";
                  const status: LetterState = score ? score[col] : "empty";
                  const bg = status === "correct" ? "#4CAF50" : status === "present" ? "#FFB300" : status === "absent" ? "#3A3F3A" : "transparent";
                  const border = status === "empty" ? colors.border : bg;
                  const color = status === "empty" ? colors.onSurface : "#FFF";
                  return (
                    <View
                      key={col}
                      style={[styles.cell, { backgroundColor: bg, borderColor: border }]}
                      testID={`wordle-cell-${row}-${col}`}
                    >
                      <Text style={[styles.cellText, { color }]}>{letter}</Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* Status / cooldown */}
        {save?.finished ? (
          <View style={styles.statusBox}>
            <Text style={[styles.statusTitle, { color: save.won ? colors.brandSecondary : colors.error }]}>
              {save.won ? "Solved!" : "Out of guesses"}
            </Text>
            <Text style={styles.statusSub}>The word was <Text style={styles.statusWord}>{save.solution}</Text></Text>
            {canPlayAgain ? (
              <Pressable testID="wordle-play-again" onPress={startNew} style={styles.playAgainBtn}>
                <Text style={styles.playAgainText}>Play Again</Text>
              </Pressable>
            ) : (
              <Text style={styles.cooldown}>Next puzzle in {fmtCountdown()}</Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* Keyboard */}
      <View style={[styles.keyboard, { paddingBottom: insets.bottom + 6 }]} testID="wordle-keyboard">
        {KEYBOARD_ROWS.map((r, ri) => (
          <View key={ri} style={styles.kbRow}>
            {r.map((k) => {
              const wide = k === "ENTER" || k === "BACK";
              const status = keyStatus[k] ?? "empty";
              const bg =
                status === "correct" ? "#4CAF50" :
                status === "present" ? "#FFB300" :
                status === "absent" ? "#1A1C1A" :
                colors.surfaceTertiary;
              return (
                <Pressable
                  key={k}
                  testID={`wordle-key-${k}`}
                  onPress={() => onKey(k)}
                  disabled={save?.finished}
                  style={[styles.key, wide && styles.keyWide, { backgroundColor: bg, opacity: save?.finished ? 0.6 : 1 }]}
                >
                  {k === "BACK" ? (
                    <MaterialCommunityIcons name="backspace" size={18} color={colors.onSurface} />
                  ) : (
                    <Text style={[styles.keyText, wide && styles.keyTextWide]}>{k}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <Modal visible={!!resultOpen} transparent animationType="fade" onRequestClose={() => setResultOpen(null)}>
        <View style={styles.backdrop}>
          <View style={styles.resultCard} testID="wordle-result">
            <MaterialCommunityIcons
              name={resultOpen?.won ? "trophy" : "emoticon-sad-outline"}
              size={56}
              color={resultOpen?.won ? colors.brandTertiary : colors.error}
            />
            <Text style={styles.resultTitle}>{resultOpen?.won ? "You won!" : "Better luck tomorrow"}</Text>
            <Text style={styles.resultSub}>The word was <Text style={styles.statusWord}>{resultOpen?.solution}</Text></Text>
            {resultOpen?.won && (
              <View style={styles.rewardRow}>
                <MaterialCommunityIcons name="diamond-stone" size={22} color={colors.brandTertiary} />
                <Text style={styles.rewardBig}>+{resultOpen.reward} gems</Text>
              </View>
            )}
            <Pressable
              testID="wordle-result-close"
              onPress={() => setResultOpen(null)}
              style={styles.resultBtn}
            >
              <Text style={styles.resultBtnText}>Collect</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

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
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "900" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", marginTop: 2 },
  rewardPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandTertiary + "22",
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  rewardText: { color: colors.brandTertiary, fontSize: 12, fontWeight: "900" },
  body: { padding: spacing.lg, gap: spacing.lg },
  grid: { gap: 6, alignItems: "center" },
  row: { flexDirection: "row", gap: 6 },
  cell: {
    width: 54, height: 54,
    borderWidth: 2,
    borderRadius: radius.sm,
    alignItems: "center", justifyContent: "center",
  },
  cellText: { fontSize: 24, fontWeight: "900" },
  statusBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  statusTitle: { fontSize: 18, fontWeight: "900" },
  statusSub: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
  statusWord: { color: colors.brandTertiary, fontWeight: "900", letterSpacing: 2 },
  cooldown: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", marginTop: 4 },
  playAgainBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  playAgainText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "900" },
  keyboard: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: 6,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  kbRow: { flexDirection: "row", justifyContent: "center", gap: 5 },
  key: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  keyWide: { flex: 1.6 },
  keyText: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  keyTextWide: { fontSize: 12, letterSpacing: 0.5 },
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
    gap: spacing.sm,
  },
  resultTitle: { color: colors.onSurface, fontSize: 22, fontWeight: "900", marginTop: spacing.sm },
  resultSub: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  rewardBig: { color: colors.brandTertiary, fontSize: 20, fontWeight: "900" },
  resultBtn: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  resultBtnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900" },
});
