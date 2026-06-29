import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { AffiliateMe, fetchAffiliateMe, postAffiliateRedeem } from "@/src/game/api";
import { haptic } from "@/src/game/haptics";

/**
 * Profile-screen module exposing the player's invite code, share/redeem
 * controls, and lifetime affiliate stats. The actual gem/cash rewards land
 * in the player's wallet via the existing /grants/claim poll in
 * GameContext, so this component never mutates game state directly.
 */
export default function AffiliatePanel() {
  const { state, showToast, claimPendingGrantsNow } = useGame();
  const [me, setMe] = useState<AffiliateMe | null>(null);
  const [busy, setBusy] = useState(true);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const deviceId = state?.deviceId ?? "";

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const data = await fetchAffiliateMe(deviceId);
      setMe(data);
    } catch {
      // Network hiccup is non-fatal; UI shows a retry state.
    } finally {
      setBusy(false);
    }
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (!deviceId) return;
        try {
          const data = await fetchAffiliateMe(deviceId);
          if (active) setMe(data);
        } catch {
          // Network hiccup is non-fatal; UI shows a retry state.
        } finally {
          if (active) setBusy(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [deviceId]),
  );

  if (!state || !deviceId) return null;

  const buildShareUrl = (): string => {
    if (!me) return "";
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return window.location.origin + me.share_url_path;
    }
    return `https://newbie-buffer.preview.emergentagent.com${me.share_url_path}`;
  };

  const onCopy = async () => {
    if (!me) return;
    haptic("light");
    const url = buildShareUrl();
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // Clipboard refusal is fine — Share fallback below.
    }
    showToast("Invite link copied!");
  };

  const onShare = async () => {
    if (!me) return;
    haptic("light");
    const url = buildShareUrl();
    try {
      await Share.share({
        message: `Join me on Tycoon Empire! Use my invite code ${me.code} for 25 gems + $10k starter cash. ${url}`,
      });
    } catch {
      // User dismissed.
    }
  };

  const onRedeem = async () => {
    setErr(null);
    const c = code.trim().toUpperCase();
    if (c.length < 4) {
      setErr("Enter a valid invite code.");
      return;
    }
    setRedeeming(true);
    try {
      const result = await postAffiliateRedeem({
        code: c,
        device_id: deviceId,
        player_name: state.playerName,
      });
      const bits: string[] = [];
      if (result.referee_gems_awarded) bits.push(`${result.referee_gems_awarded} gems`);
      if (result.referee_cash_awarded) bits.push(`$${result.referee_cash_awarded.toLocaleString()}`);
      showToast(bits.length ? `Code redeemed! You got ${bits.join(" + ")}.` : "Code redeemed!");
      setCode("");
      // Pull the grant down immediately instead of waiting for the 30s poll.
      await claimPendingGrantsNow();
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Couldn't redeem that code.");
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <View style={styles.card} testID="affiliate-panel">
      <View style={styles.headerRow}>
        <MaterialCommunityIcons name="gift" size={22} color={colors.brandPrimary} />
        <Text style={styles.title}>Invite friends, earn gems</Text>
      </View>

      {busy ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} />
      ) : !me ? (
        <Pressable onPress={load} style={styles.retryBtn} testID="affiliate-retry">
          <Text style={styles.retryText}>Couldn't load — tap to retry</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.subtitle}>
            You get {me.gems_per_referral} gems per friend (up to {me.cap}). They get 25 gems + $10k starter cash.
          </Text>

          <View style={styles.codeBox} testID="affiliate-code-box">
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>Your invite code</Text>
              <Text testID="affiliate-code" style={styles.codeValue}>{me.code}</Text>
            </View>
            <Pressable testID="affiliate-copy-link" onPress={onCopy} style={styles.iconBtn}>
              <MaterialCommunityIcons name="content-copy" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="affiliate-share-link" onPress={onShare} style={styles.iconBtn}>
              <MaterialCommunityIcons name="share-variant" size={18} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat} testID="affiliate-stat-count">
              <Text style={styles.statValue}>{me.referrals_count}</Text>
              <Text style={styles.statLabel}>Friends invited</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat} testID="affiliate-stat-gems">
              <Text style={styles.statValue}>{me.gems_earned.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Gems earned</Text>
            </View>
          </View>

          {me.redeemed_code ? (
            <View style={styles.redeemedBox} testID="affiliate-redeemed">
              <MaterialCommunityIcons name="check-circle" size={16} color={colors.brandSecondary} />
              <Text style={styles.redeemedText}>You redeemed code {me.redeemed_code}.</Text>
            </View>
          ) : (
            <View style={styles.redeemRow}>
              <TextInput
                testID="affiliate-redeem-input"
                value={code}
                onChangeText={(v) => setCode(v.toUpperCase())}
                placeholder="Have a code? Paste it"
                placeholderTextColor={colors.onSurfaceTertiary}
                autoCapitalize="characters"
                maxLength={16}
                style={styles.redeemInput}
              />
              <Pressable
                testID="affiliate-redeem-button"
                onPress={onRedeem}
                disabled={redeeming || code.trim().length < 4}
                style={[styles.redeemBtn, (redeeming || code.trim().length < 4) && styles.disabled]}
              >
                {redeeming ? (
                  <ActivityIndicator size="small" color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.redeemBtnText}>Redeem</Text>
                )}
              </Pressable>
            </View>
          )}

          {!!err && <Text testID="affiliate-error" style={styles.error}>{err}</Text>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "900" },
  subtitle: {
    color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600",
    marginTop: spacing.xs, lineHeight: 18,
  },
  codeBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  codeLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700" },
  codeValue: { color: colors.brandPrimary, fontSize: 22, fontWeight: "900", letterSpacing: 2 },
  iconBtn: {
    width: 36, height: 36, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  statsRow: {
    flexDirection: "row", alignItems: "center",
    marginTop: spacing.md, paddingVertical: spacing.sm,
  },
  stat: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, height: 30, backgroundColor: colors.border },
  statValue: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  statLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", marginTop: 2 },
  redeemRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  redeemInput: {
    flex: 1, backgroundColor: colors.surface, color: colors.onSurface,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: 14, fontWeight: "800", borderWidth: 1, borderColor: colors.border,
  },
  redeemBtn: {
    paddingHorizontal: spacing.lg, justifyContent: "center", alignItems: "center",
    backgroundColor: colors.brandPrimary, borderRadius: radius.md,
  },
  redeemBtnText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.5 },
  redeemedBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.sm,
  },
  redeemedText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  retryBtn: { padding: spacing.md, alignItems: "center" },
  retryText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "700" },
  error: { color: "#ff6b6b", fontSize: 12, fontWeight: "700", marginTop: spacing.sm, textAlign: "center" },
});
