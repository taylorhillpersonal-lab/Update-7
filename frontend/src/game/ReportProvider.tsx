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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, radius, spacing } from "@/src/game/theme";
import { haptic } from "@/src/game/haptics";
import { useGame } from "@/src/game/GameContext";
import { reportPlayer } from "@/src/game/api";

type ReportContextValue = {
  report: (reportedDeviceId: string, reportedName: string) => void;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children }: { children: React.ReactNode }) {
  const { state, showToast } = useGame();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const report = useCallback((reportedDeviceId: string, reportedName: string) => {
    haptic("light");
    setTarget({ id: reportedDeviceId, name: reportedName });
    setReason("");
    setEmail("");
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    if (submitting) return;
    setOpen(false);
  }, [submitting]);

  const submit = useCallback(async () => {
    if (!target) return;
    if (!reason.trim()) {
      showToast("Please describe what happened");
      return;
    }
    setSubmitting(true);
    try {
      await reportPlayer({
        reporter_device_id: state?.deviceId ?? "",
        reported_device_id: target.id,
        reason: reason.trim(),
        reporter_name: state?.playerName || undefined,
        reported_name: target.name || undefined,
        reporter_email: email.trim() || undefined,
      });
      haptic("success");
      setOpen(false);
      showToast("Report sent to our team. Thank you!");
    } catch (e: any) {
      showToast(e?.message || "Couldn't send report");
    } finally {
      setSubmitting(false);
    }
  }, [target, reason, email, state?.deviceId, state?.playerName, showToast]);

  return (
    <ReportContext.Provider value={{ report }}>
      {children}
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.backdrop} onPress={close}>
            <Pressable style={styles.sheet} onPress={() => {}} testID="report-player-sheet">
              <View style={styles.handle} />
              <View style={styles.headRow}>
                <View style={styles.flagIcon}>
                  <MaterialCommunityIcons name="flag" size={20} color={colors.error} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Report Player</Text>
                  <Text style={styles.subtitle}>Reviewed by our moderation team</Text>
                </View>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: spacing.lg }}
              >
                <Text style={styles.label}>Reported player</Text>
                <View style={styles.lockedField}>
                  <MaterialCommunityIcons name="account" size={16} color={colors.onSurfaceTertiary} />
                  <Text style={styles.lockedText} numberOfLines={1}>
                    {target?.name || "Player"}
                  </Text>
                  <MaterialCommunityIcons name="lock" size={14} color={colors.onSurfaceTertiary} />
                </View>
                <Text testID="report-reported-uuid" style={styles.uuid}>
                  UUID: {target?.id}
                </Text>

                <Text style={[styles.label, { marginTop: spacing.md }]}>Your account</Text>
                <View style={styles.lockedField}>
                  <MaterialCommunityIcons name="account-check" size={16} color={colors.onSurfaceTertiary} />
                  <Text style={styles.lockedText} numberOfLines={1}>
                    {state?.playerName || "You"}
                  </Text>
                  <MaterialCommunityIcons name="lock" size={14} color={colors.onSurfaceTertiary} />
                </View>
                <Text testID="report-reporter-uuid" style={styles.uuid}>
                  UUID: {state?.deviceId}
                </Text>

                <Text style={[styles.label, { marginTop: spacing.md }]}>What happened? *</Text>
                <TextInput
                  testID="report-reason-input"
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Describe the issue — cheating, harassment, spam, inappropriate name..."
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.reasonInput}
                  multiline
                  maxLength={2000}
                  textAlignVertical="top"
                />

                <Text style={[styles.label, { marginTop: spacing.md }]}>Your email (optional)</Text>
                <Text style={styles.hint}>Add it only if you&apos;d like us to follow up with you</Text>
                <TextInput
                  testID="report-email-input"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.emailInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  maxLength={120}
                />

                <Pressable
                  testID="report-submit-button"
                  onPress={submit}
                  disabled={submitting}
                  style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="send" size={16} color="#fff" />
                      <Text style={styles.submitText}>Submit Report</Text>
                    </>
                  )}
                </Pressable>
                <Pressable testID="report-cancel-button" onPress={close} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </ReportContext.Provider>
  );
}

export function useReport(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error("useReport must be used within ReportProvider");
  return ctx;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    maxHeight: "88%",
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  flagIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.error + "22",
  },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600", marginTop: 2 },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "800", marginBottom: spacing.xs },
  hint: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", marginBottom: spacing.xs },
  lockedField: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lockedText: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  uuid: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "600", marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  reasonInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "600",
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emailInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "600",
    borderWidth: 1,
    borderColor: colors.border,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.error,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    marginTop: spacing.xl,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  cancelBtn: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  cancelText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "800" },
});
