import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { colors, radius, spacing } from "@/src/game/theme";
import { money, abbreviate } from "@/src/game/format";
import { haptic } from "@/src/game/haptics";
import { useGame } from "@/src/game/GameContext";
import { useReport } from "@/src/game/ReportProvider";
import { fetchPublicProfile, PublicProfile, transferGems } from "@/src/game/api";

type ProfileContextValue = {
  openProfile: (deviceId: string) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { state, adjustGems, showToast } = useGame();
  const { report } = useReport();

  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Send-gems sub-state
  const [sendMode, setSendMode] = useState(false);
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);

  const myGems = state?.gems ?? 0;
  const isSelf = !!profile && profile.device_id === state?.deviceId;

  const openProfile = useCallback(async (deviceId: string) => {
    haptic("light");
    setOpen(true);
    setProfile(null);
    setLoading(true);
    setSendMode(false);
    setAmount("");
    try {
      setProfile(await fetchPublicProfile(deviceId));
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    if (sending) return;
    setOpen(false);
    setSendMode(false);
    setAmount("");
  }, [sending]);

  const copyUuid = useCallback(async (uuid: string) => {
    await Clipboard.setStringAsync(uuid);
    haptic("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const onSend = useCallback(async () => {
    if (!profile) return;
    const amt = Math.floor(Number(amount));
    if (!amt || amt <= 0) {
      showToast("Enter a gem amount greater than zero");
      return;
    }
    if (amt > myGems) {
      showToast("You don't have that many gems");
      return;
    }
    setSending(true);
    try {
      const res = await transferGems(state?.deviceId ?? "", profile.device_id, amt);
      adjustGems(-amt);
      haptic("success");
      setOpen(false);
      setSendMode(false);
      setAmount("");
      showToast(`Sent ${amt.toLocaleString()} gems to ${res.recipient_name || profile.name}!`);
    } catch (e: any) {
      showToast(e?.message || "Couldn't send gems");
    } finally {
      setSending(false);
    }
  }, [profile, amount, myGems, state?.deviceId, adjustGems, showToast]);

  return (
    <ProfileContext.Provider value={{ openProfile }}>
      {children}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.backdrop} onPress={close}>
            <Pressable style={styles.card} testID="profile-modal" onPress={() => {}}>
              {loading ? (
                <ActivityIndicator size="large" color={colors.brandPrimary} style={{ paddingVertical: spacing.xl }} />
              ) : profile ? (
                <>
                  <View style={styles.avatar}>
                    <MaterialCommunityIcons name="account-tie" size={40} color={colors.brandPrimary} />
                  </View>
                  <Text style={styles.name}>{profile.name}</Text>
                  {profile.city_name && (
                    <View style={styles.cityPill}>
                      <MaterialCommunityIcons name="city-variant" size={13} color={colors.brandPrimary} />
                      <Text style={styles.cityText}>
                        {profile.city_tag ? `[${profile.city_tag}] ` : ""}
                        {profile.city_name}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    testID="profile-copy-uuid"
                    onPress={() => copyUuid(profile.device_id)}
                    style={styles.uuidRow}
                  >
                    <Text style={styles.uuidLabel}>UUID</Text>
                    <Text style={styles.uuidValue} numberOfLines={1}>{profile.device_id}</Text>
                    <MaterialCommunityIcons
                      name={copied ? "check" : "content-copy"}
                      size={15}
                      color={copied ? colors.brandSecondary : colors.brandPrimary}
                    />
                  </Pressable>

                  <View style={styles.statGrid}>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Net Worth</Text>
                      <Text style={styles.statValue}>{money(profile.net_worth)}</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Investors</Text>
                      <Text style={styles.statValue}>{profile.prestige_points}</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Gems</Text>
                      <Text style={styles.statValue}>{abbreviate(profile.gems)}</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Total Levels</Text>
                      <Text style={styles.statValue}>{profile.total_levels}</Text>
                    </View>
                  </View>

                  {!isSelf && sendMode && (
                    <View style={styles.sendBox} testID="profile-send-gems-box">
                      <Text style={styles.sendTitle}>Send gems to {profile.name}</Text>
                      <Text style={styles.sendBalance}>Your balance: {myGems.toLocaleString()} gems</Text>
                      <View style={styles.sendRow}>
                        <View style={styles.amountWrap}>
                          <MaterialCommunityIcons name="diamond-stone" size={16} color={colors.brandTertiary} />
                          <TextInput
                            testID="profile-gem-amount-input"
                            value={amount}
                            onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
                            placeholder="0"
                            placeholderTextColor={colors.onSurfaceTertiary}
                            keyboardType="number-pad"
                            style={styles.amountInput}
                            maxLength={9}
                          />
                        </View>
                        <Pressable
                          testID="profile-confirm-send-button"
                          onPress={onSend}
                          disabled={sending}
                          style={[styles.confirmSend, sending && { opacity: 0.6 }]}
                        >
                          {sending ? (
                            <ActivityIndicator color={colors.onBrandSecondary} />
                          ) : (
                            <Text style={styles.confirmSendText}>Send</Text>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {!isSelf && !sendMode && (
                    <Pressable
                      testID="profile-send-gems-button"
                      onPress={() => { haptic("light"); setSendMode(true); }}
                      style={styles.sendGemsBtn}
                    >
                      <MaterialCommunityIcons name="gift-outline" size={16} color={colors.onBrandTertiary} />
                      <Text style={styles.sendGemsText}>Send Gems</Text>
                    </Pressable>
                  )}

                  {!isSelf && (
                    <Pressable
                      testID="profile-report-button"
                      onPress={() => {
                        setOpen(false);
                        report(profile.device_id, profile.name);
                      }}
                      style={styles.reportBtn}
                    >
                      <MaterialCommunityIcons name="flag-outline" size={15} color={colors.error} />
                      <Text style={styles.reportText}>Report Player</Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <Text style={styles.unavailable}>Profile unavailable</Text>
              )}
              <Pressable testID="profile-close-button" onPress={close} style={styles.closeBtn}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
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
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary + "22",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  name: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  cityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    backgroundColor: colors.brandPrimary + "1A",
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  cityText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  uuidRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "100%",
  },
  uuidLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "900" },
  uuidValue: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg, width: "100%" },
  statBox: {
    flexGrow: 1,
    width: "45%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  statLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700" },
  statValue: { color: colors.onSurface, fontSize: 17, fontWeight: "900", marginTop: 2 },
  sendGemsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    width: "100%",
  },
  sendGemsText: { color: colors.onBrandTertiary, fontSize: 15, fontWeight: "900" },
  sendBox: {
    width: "100%",
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
    gap: spacing.sm,
  },
  sendTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "900" },
  sendBalance: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  sendRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  amountWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  amountInput: { flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: "800", paddingVertical: spacing.md },
  confirmSend: {
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
  },
  confirmSendText: { color: colors.onBrandSecondary, fontSize: 15, fontWeight: "900" },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
  },
  reportText: { color: colors.error, fontSize: 14, fontWeight: "900" },
  unavailable: { color: colors.onSurfaceTertiary, fontSize: 15, fontWeight: "700", paddingVertical: spacing.lg },
  closeBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
  },
  closeText: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
});
