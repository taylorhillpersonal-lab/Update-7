import React, { useCallback, useEffect, useState } from "react";
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
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";

import { colors, radius, spacing } from "@/src/game/theme";
import { money } from "@/src/game/format";
import { BUSINESSES, PRESTIGE_BONUS_PER_POINT } from "@/src/game/businesses";
import { ACHIEVEMENTS } from "@/src/game/achievements";
import { LEVEL_MAX, xpToNext, levelIncomeMult } from "@/src/game/levels";
import { useGame } from "@/src/game/GameContext";
import { useAuth } from "@/src/auth/AuthContext";
import { adminReportsCount } from "@/src/game/api";
import { haptic } from "@/src/game/haptics";
import { resetTutorial, openTutorial } from "@/src/components/TutorialGate";
import { openBoostSection } from "@/app/(tabs)/boost";
import AffiliatePanel from "@/src/components/AffiliatePanel";
import PurchaseHistoryPanel from "@/src/components/PurchaseHistoryPanel";

export default function ProfileScreen() {
  const { state, setPlayerName, syncNow, resetGame, verifyAge, showToast } = useGame();
  const [ageInput, setAgeInput] = useState("");
  const { user, token, loading: authLoading, googleAuthEnabled, loginWithGoogle, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [name, setName] = useState(state?.playerName ?? "");

  // The local input is initialised once from a possibly-null game state
  // (it streams in from storage). Sync the field on every change so the
  // saved tycoon name shows up after a hard reload instead of an empty
  // input that fronts the "Anonymous Tycoon" placeholder.
  useEffect(() => {
    setName((prev) => (prev ? prev : state?.playerName ?? ""));
  }, [state?.playerName]);
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [openReports, setOpenReports] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (user?.is_admin && token) {
        adminReportsCount(token)
          .then((c) => active && setOpenReports(c.open))
          .catch(() => {});
      }
      return () => {
        active = false;
      };
    }, [user?.is_admin, token])
  );

  if (!state) return <View style={styles.container} />;

  const ownedCount = BUSINESSES.filter((d) => (state.businesses[d.id]?.level ?? 0) > 0).length;
  const managersCount = BUSINESSES.filter((d) => state.businesses[d.id]?.hasManager).length;
  const bonusPct = Math.round(state.prestigePoints * PRESTIGE_BONUS_PER_POINT * 100);
  const achievementsDone = ACHIEVEMENTS.filter((a) => state.claimedAchievements.includes(a.id)).length;
  const playerLevel = state.level ?? 1;
  const playerXp = state.xp ?? 0;
  const xpNeeded = xpToNext(playerLevel);
  const xpProgress = playerLevel >= LEVEL_MAX ? 1 : Math.min(1, playerXp / xpNeeded);
  const levelPctBonus = Math.round((levelIncomeMult(playerLevel) - 1) * 100);

  const onSave = () => {
    haptic("medium");
    setPlayerName(name.trim());
    syncNow();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const onReset = () => {
    haptic("heavy");
    resetGame();
    setName("");
    setResetOpen(false);
  };

  const stats = [
    { icon: "cash", label: "Net Worth", value: money(state.lifetimeEarnings), color: colors.brandSecondary },
    { icon: "wallet", label: "Cash", value: money(state.cash), color: colors.brandPrimary },
    { icon: "store", label: "Businesses", value: `${ownedCount}/${BUSINESSES.length}`, color: colors.brandPrimary },
    { icon: "account-tie", label: "Managers", value: `${managersCount}`, color: colors.brandSecondary },
    { icon: "diamond-stone", label: "Investors", value: `${state.prestigePoints}`, color: colors.brandTertiary },
    { icon: "restart", label: "Prestiges", value: `${state.prestigeCount}`, color: colors.brandTertiary },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="profile-screen"
      >
        <View style={styles.avatar}>
          <MaterialCommunityIcons name="crown" size={44} color={colors.brandPrimary} />
        </View>
        {state.prestigePoints > 0 && (
          <View style={styles.bonusBadge}>
            <Text style={styles.bonusText}>+{bonusPct}% income bonus</Text>
          </View>
        )}

        {/* Account / Auth */}
        {user ? (
          <View style={styles.accountCard} testID="account-signed-in">
            <View style={styles.accountRow}>
              <View style={styles.accountAvatar}>
                <MaterialCommunityIcons name="account-check" size={22} color={colors.brandSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountName} numberOfLines={1}>{user.name}</Text>
                <Text style={styles.accountEmail} numberOfLines={1}>{user.email}</Text>
              </View>
              <Pressable testID="logout-button" onPress={logout} style={styles.logoutBtn}>
                <Text style={styles.logoutText}>Sign out</Text>
              </Pressable>
            </View>
            {user.is_admin && (
              <Pressable testID="open-admin-button" onPress={() => router.push("/admin" as any)} style={styles.adminBtn}>
                <MaterialCommunityIcons name="shield-crown" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.adminText}>Open Admin Panel</Text>
                {openReports > 0 && (
                  <View testID="admin-reports-badge" style={styles.adminBadge}>
                    <Text style={styles.adminBadgeText}>{openReports > 99 ? "99+" : openReports}</Text>
                  </View>
                )}
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.connectCard} testID="account-signed-out">
            <MaterialCommunityIcons name="cloud-alert" size={26} color={colors.brandPrimary} />
            <Text style={styles.connectTitle}>Save your empire</Text>
            <Text style={styles.connectSub}>
              Connect an account to back up your progress — without it you could lose everything if you clear the app.
            </Text>
            <Pressable
              testID="login-google-button"
              onPress={() => { haptic("medium"); loginWithGoogle(); }}
              disabled={authLoading || !googleAuthEnabled}
              style={[styles.googleBtn, !googleAuthEnabled && { display: "none" }]}
            >
              <MaterialCommunityIcons name="google" size={18} color="#fff" />
              <Text style={styles.googleText}>Continue with Google</Text>
            </Pressable>
            <View style={styles.soonRow}>
              <Pressable testID="login-facebook-button" onPress={() => { haptic("light"); }} style={[styles.soonBtn, { borderColor: "#1877F2" }]}>
                <MaterialCommunityIcons name="facebook" size={16} color="#1877F2" />
                <Text style={[styles.soonText, { color: "#1877F2" }]}>Facebook</Text>
                <Text style={styles.soonTag}>Soon</Text>
              </Pressable>
              <Pressable testID="login-steam-button" onPress={() => { haptic("light"); }} style={[styles.soonBtn, { borderColor: colors.onSurfaceTertiary }]}>
                <MaterialCommunityIcons name="steam" size={16} color={colors.onSurface} />
                <Text style={[styles.soonText, { color: colors.onSurface }]}>Steam</Text>
                <Text style={styles.soonTag}>Soon</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Affiliate / referral panel — works for all auth states. */}
        <AffiliatePanel />

        <PurchaseHistoryPanel deviceId={state?.deviceId} />

        <Text style={styles.label}>Tycoon Name</Text>
        <View style={styles.inputRow}>
          <TextInput
            testID="profile-name-input"
            value={name}
            onChangeText={setName}
            placeholder="Anonymous Tycoon"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            maxLength={24}
          />
          <Pressable testID="profile-save-button" onPress={onSave} style={styles.saveBtn}>
            <Text style={styles.saveText}>{saved ? "Saved!" : "Save"}</Text>
          </Pressable>
        </View>

        <View style={styles.levelCard} testID="profile-level-card">
          <View style={styles.levelTop}>
            <View style={styles.levelBadge}>
              <MaterialCommunityIcons name="star-four-points" size={16} color={colors.brandTertiary} />
              <Text style={styles.levelBadgeText}>LV {playerLevel}</Text>
            </View>
            <Text style={styles.levelPerks}>+{levelPctBonus}% income & speed</Text>
          </View>
          <View style={styles.xpBarTrack}>
            <View style={[styles.xpBarFill, { width: `${Math.round(xpProgress * 100)}%` }]} />
          </View>
          <Text style={styles.xpText}>
            {playerLevel >= LEVEL_MAX ? "MAX LEVEL" : `${Math.floor(playerXp)} / ${xpNeeded} XP to Level ${playerLevel + 1}`}
          </Text>
        </View>

        <View style={styles.statsGrid}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <MaterialCommunityIcons name={s.icon as any} size={22} color={s.color} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <Pressable
          testID="global-chat-button"
          onPress={() => router.push("/chat" as any)}
          style={styles.leaderboardBtn}
        >
          <MaterialCommunityIcons name="chat" size={20} color={colors.brandSecondary} />
          <Text style={styles.leaderboardText}>Global Chat</Text>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable
          testID="view-leaderboard-button"
          onPress={() => router.push("/leaderboard")}
          style={styles.leaderboardBtn}
        >
          <MaterialCommunityIcons name="trophy" size={20} color={colors.brandPrimary} />
          <Text style={styles.leaderboardText}>View Leaderboard</Text>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable
          testID="view-lootbox-button"
          onPress={() => router.push("/lootbox" as any)}
          style={styles.leaderboardBtn}
        >
          <MaterialCommunityIcons name="treasure-chest" size={20} color={colors.brandPrimary} />
          <Text style={styles.leaderboardText}>Loot Boxes</Text>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable
          testID="view-character-button"
          onPress={() => { haptic("light"); router.push("/character" as any); }}
          style={styles.leaderboardBtn}
        >
          <MaterialCommunityIcons name="account-tie-hat" size={20} color={colors.brandTertiary} />
          <Text style={styles.leaderboardText}>Character & Gear</Text>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable
          testID="view-inventory-button"
          onPress={() => {
            haptic("light");
            openBoostSection("inventory");
            router.push("/boost" as any);
          }}
          style={styles.leaderboardBtn}
        >
          <MaterialCommunityIcons name="bag-personal" size={20} color={colors.brandSecondary} />
          <Text style={styles.leaderboardText}>Inventory</Text>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable
          testID="replay-tutorial-button"
          onPress={async () => {
            haptic("light");
            await resetTutorial();
            openTutorial();
          }}
          style={styles.leaderboardBtn}
        >
          <MaterialCommunityIcons name="school-outline" size={20} color={colors.brandSecondary} />
          <Text style={styles.leaderboardText}>Replay Tutorial</Text>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <View style={styles.cloudBox}>
          <MaterialCommunityIcons name="cloud-check" size={18} color={colors.brandSecondary} />
          <Text style={styles.cloudText}>
            Progress auto-saves locally & syncs to the cloud leaderboard.
          </Text>
        </View>

        {/* Age verification (gate for gambling minigames) */}
        {state?.ageVerified ? (
          <View style={styles.ageVerifiedBox} testID="age-verified-box">
            <MaterialCommunityIcons name="shield-check" size={20} color={colors.brandSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.ageVerifiedTitle}>Age verified (18+)</Text>
              <Text style={styles.ageVerifiedSub}>Gambling minigames unlocked</Text>
            </View>
          </View>
        ) : (
          <View style={styles.ageBox} testID="age-verification-box">
            <View style={styles.ageHeader}>
              <MaterialCommunityIcons name="shield-alert" size={20} color="#FFB300" />
              <Text style={styles.ageTitle}>Age Verification Required</Text>
            </View>
            <Text style={styles.ageSub}>
              Tycoon Time and other gem-wager minigames are restricted to ages 18+.
              Enter your age to unlock them.
            </Text>
            <View style={styles.ageInputRow}>
              <TextInput
                testID="age-input"
                value={ageInput}
                onChangeText={(t) => setAgeInput(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="Age"
                placeholderTextColor={colors.onSurfaceTertiary}
                maxLength={3}
                style={styles.ageInput}
              />
              <Pressable
                testID="age-verify-button"
                onPress={() => {
                  const n = parseInt(ageInput, 10);
                  if (!Number.isFinite(n)) { showToast("Enter your age"); return; }
                  haptic("medium");
                  const ok = verifyAge(n);
                  if (!ok) {
                    showToast(n > 0 && n < 18 ? "You must be 18 or older" : "Enter a valid age");
                    haptic("error");
                  } else {
                    showToast("Age verified — gambling unlocked");
                    haptic("success");
                    setAgeInput("");
                  }
                }}
                style={styles.ageBtn}
              >
                <Text style={styles.ageBtnText}>VERIFY</Text>
              </Pressable>
            </View>
            <Text style={styles.ageDisclaimer}>
              By verifying, you confirm that you are at least 18 years old and that
              gambling-style features are legal in your jurisdiction.
            </Text>
          </View>
        )}

        <Pressable
          testID="hypnofusions-link-button"
          onPress={() => {
            haptic("light");
            WebBrowser.openBrowserAsync("https://HypnoFusions.com").catch(() => {});
          }}
          style={styles.hypnoBtn}
        >
          <MaterialCommunityIcons name="web" size={20} color="#FFF" />
          <View style={{ flex: 1 }}>
            <Text style={styles.hypnoTitle}>Visit HypnoFusions.com</Text>
            <Text style={styles.hypnoSub}>The maker behind this game</Text>
          </View>
          <MaterialCommunityIcons name="open-in-new" size={18} color="#FFFFFFCC" />
        </Pressable>

        {/* Achievements */}
        <View style={styles.achHeader}>
          <Text style={styles.achLabel}>Achievements</Text>
          <Text style={styles.achCount}>{achievementsDone}/{ACHIEVEMENTS.length}</Text>
        </View>
        <View style={styles.achList} testID="profile-achievements">
          {ACHIEVEMENTS.map((a) => {
            const done = state.claimedAchievements.includes(a.id);
            return (
              <View key={a.id} testID={`achievement-${a.id}`} style={styles.achRow}>
                <View style={[styles.achIcon, { backgroundColor: done ? colors.brandSecondary + "22" : colors.surfaceTertiary }]}>
                  <MaterialCommunityIcons
                    name={(done ? "check-bold" : a.icon) as any}
                    size={20}
                    color={done ? colors.brandSecondary : colors.onSurfaceTertiary}
                  />
                </View>
                <View style={styles.achMid}>
                  <Text style={styles.achTitle}>{a.title}</Text>
                  <Text style={styles.achDesc}>{a.desc}</Text>
                </View>
                <View style={styles.achReward}>
                  <MaterialCommunityIcons name="diamond-stone" size={13} color={colors.brandTertiary} />
                  <Text style={[styles.achGems, done && { color: colors.brandSecondary }]}>
                    {done ? "Earned" : `+${a.gems}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <Pressable testID="reset-game-button" onPress={() => setResetOpen(true)} style={styles.resetBtn}>
          <MaterialCommunityIcons name="delete-outline" size={18} color={colors.error} />
          <Text style={styles.resetText}>Reset Game</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={resetOpen} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Reset Everything?</Text>
            <Text style={styles.sheetText}>
              This wipes all progress including investors. This cannot be undone.
            </Text>
            <View style={styles.sheetRow}>
              <Pressable
                onPress={() => setResetOpen(false)}
                style={[styles.sheetBtn, { backgroundColor: colors.surfaceTertiary }]}
              >
                <Text style={[styles.sheetBtnText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="reset-confirm-button"
                onPress={onReset}
                style={[styles.sheetBtn, { backgroundColor: colors.error }]}
              >
                <Text style={[styles.sheetBtnText, { color: "#fff" }]}>Reset</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, alignItems: "center" },
  avatar: {
    width: 92,
    height: 92,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary + "1A",
    alignItems: "center",
    justifyContent: "center",
  },
  bonusBadge: {
    marginTop: spacing.md,
    backgroundColor: colors.brandTertiary + "22",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  bonusText: { color: colors.brandTertiary, fontSize: 13, fontWeight: "800" },
  accountCard: {
    width: "100%",
    marginTop: spacing.xl,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
    gap: spacing.sm,
  },
  accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  accountAvatar: {
    width: 40, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary + "22",
    alignItems: "center", justifyContent: "center",
  },
  accountName: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  accountEmail: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  logoutBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
  },
  logoutText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "800" },
  adminBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.pill,
  },
  adminText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "900" },
  adminBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  adminBadgeText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  connectCard: {
    width: "100%", marginTop: spacing.xl,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.brandPrimary,
    alignItems: "center", gap: spacing.xs,
  },
  connectTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "900", marginTop: spacing.xs },
  connectSub: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", textAlign: "center", lineHeight: 19, marginBottom: spacing.sm },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: "#4285F4", paddingVertical: spacing.md, borderRadius: radius.pill, width: "100%",
  },
  googleText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  soonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, width: "100%" },
  soonBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, opacity: 0.8,
  },
  soonText: { fontSize: 13, fontWeight: "800" },
  soonTag: {
    color: colors.onSurfaceTertiary, fontSize: 9, fontWeight: "900",
    backgroundColor: colors.surfaceTertiary, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
  },
  label: {
    alignSelf: "flex-start",
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  inputRow: { flexDirection: "row", gap: spacing.sm, width: "100%" },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "700",
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 15 },
  levelCard: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  levelTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  levelBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  levelBadgeText: { color: colors.brandTertiary, fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  levelPerks: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  xpBarTrack: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  xpBarFill: { height: "100%", borderRadius: 5, backgroundColor: colors.brandTertiary },
  xpText: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", marginTop: 6 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.xl,
    width: "100%",
  },
  statCard: {
    width: "47%",
    flexGrow: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { color: colors.onSurface, fontSize: 22, fontWeight: "900" },
  statLabel: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  cloudBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xl,
    width: "100%",
  },
  leaderboardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.xl,
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  leaderboardText: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "800",
  },
  cloudText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", flex: 1 },
  hypnoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#6A1B9A",
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    width: "100%",
    borderWidth: 1,
    borderColor: "#9C27B0",
  },
  hypnoTitle: { color: "#FFF", fontSize: 15, fontWeight: "900" },
  hypnoSub: { color: "#FFFFFFCC", fontSize: 12, fontWeight: "600", marginTop: 2 },
  ageBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: "#FFB300",
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  ageHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  ageTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  ageSub: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  ageInputRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  ageInput: { flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: "900", paddingVertical: 8 },
  ageBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  ageBtnText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  ageDisclaimer: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: "600", lineHeight: 14, marginTop: 4 },
  ageVerifiedBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.brandSecondary + "1A",
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1, borderColor: colors.brandSecondary,
  },
  ageVerifiedTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "900" },
  ageVerifiedSub: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", marginTop: 2 },
  achHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  achLabel: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  achCount: { color: colors.brandTertiary, fontSize: 13, fontWeight: "900" },
  achList: { width: "100%", gap: spacing.sm },
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
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
  },
  resetText: { color: colors.error, fontSize: 15, fontWeight: "800" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  sheet: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetTitle: { color: colors.onSurface, fontSize: 22, fontWeight: "900", textAlign: "center" },
  sheetText: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginVertical: spacing.md,
    lineHeight: 20,
  },
  sheetRow: { flexDirection: "row", gap: spacing.md },
  sheetBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  sheetBtnText: { fontSize: 15, fontWeight: "900" },
});
