import React, { useEffect, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/game/theme";
import { useGame } from "@/src/game/GameContext";
import { useAuth } from "@/src/auth/AuthContext";
import { detectHubOnBoot, readInviteFromEntryUrl } from "@/src/auth/hubLink";
import { haptic } from "@/src/game/haptics";

// First-run flow:
//   1. "auth"  → pick a sign-in path. Local-only is ONLY offered when the
//                app is connected to a Gaming Hub account (deep-link source).
//   2. "email" → sign in / sign up with email + password (with optional
//                invite code on sign-up, prefilled from URL).
//   3. "name"  → choose the display name shown on leaderboards/chat.
//
// The gate disappears once the player has a name, so returning players
// don't see it at all.
export default function UsernameGate() {
  const { state, setPlayerName, syncNow } = useGame();
  const { user, loading: authLoading, googleAuthEnabled, loginWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState("");
  const [hubConnected, setHubConnected] = useState<boolean | null>(null);
  const [step, setStep] = useState<"auth" | "email" | "name">("auth");
  const [emailMode, setEmailMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [referral, setReferral] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Resolve hub state + prefill invite once on mount.
  useEffect(() => {
    (async () => {
      const hub = await detectHubOnBoot();
      setHubConnected(hub.connected);
      const invite = await readInviteFromEntryUrl();
      if (invite) setReferral(invite);
    })();
  }, []);

  const hasName = !!(state?.playerName ?? "").trim();
  if (!state || hubConnected === null) return null;
  if (hasName) return null;

  const signedIn = !!user;
  // The signed-in user moves to the name step automatically.
  const effectiveStep: "auth" | "email" | "name" = signedIn ? "name" : step;

  const goLocalOnly = async () => {
    // Local-only is only available via Gaming Hub link. We don't persist any
    // extra flag — the absence of a Google/email session combined with a
    // valid hub link is enough; the player just types their name next.
    haptic("light");
    setStep("name");
  };

  const onSubmitName = () => {
    const n = name.trim();
    if (n.length < 2) return;
    haptic("success");
    setPlayerName(n);
    syncNow();
  };

  const onSubmitEmail = async () => {
    setErr(null);
    if (!email.trim() || password.length < 8) {
      setErr("Enter your email and a password of 8+ characters.");
      return;
    }
    if (emailMode === "signup" && signupName.trim().length < 2) {
      setErr("Pick a display name (2+ characters).");
      return;
    }
    setBusy(true);
    try {
      if (emailMode === "signin") {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password, signupName.trim(), referral.trim() || undefined);
      }
      // Auth state will update; step transitions to "name" via signedIn.
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.backdrop,
            { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {effectiveStep === "auth" && (
            <View style={styles.card} testID="login-menu">
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="crown" size={40} color={colors.brandPrimary} />
              </View>
              <Text style={styles.title}>Tycoon Empire</Text>
              <Text style={styles.subtitle}>
                {hubConnected
                  ? "Sign in to save your empire across devices — or play locally via Gaming Hub."
                  : "Sign in or create an account to save your empire and earn invite rewards."}
              </Text>

              {googleAuthEnabled && (
                <Pressable
                  testID="login-google-button"
                  onPress={() => { haptic("medium"); loginWithGoogle(); }}
                  disabled={authLoading}
                  style={[styles.googleBtn, authLoading && styles.btnDisabled]}
                >
                  <MaterialCommunityIcons name="google" size={18} color="#fff" />
                  <Text style={styles.googleText}>Continue with Google</Text>
                </Pressable>
              )}

              <Pressable
                testID="login-email-button"
                onPress={() => { haptic("light"); setStep("email"); setErr(null); }}
                style={styles.emailBtn}
              >
                <MaterialCommunityIcons name="email" size={18} color={colors.onSurface} />
                <Text style={styles.emailText}>Continue with Email</Text>
              </Pressable>

              {hubConnected && (
                <>
                  <Pressable
                    testID="login-local-only-button"
                    onPress={goLocalOnly}
                    style={styles.localBtn}
                  >
                    <MaterialCommunityIcons name="cellphone" size={18} color={colors.onSurface} />
                    <Text style={styles.localText}>Local-only (via Gaming Hub)</Text>
                  </Pressable>
                  <Text style={styles.hint}>
                    You're playing via Samsung Gaming Hub — you can keep your progress on this device only.
                  </Text>
                </>
              )}
              {!hubConnected && (
                <Text style={styles.hint}>
                  Local-only play is available when launching through Samsung Gaming Hub.
                </Text>
              )}
            </View>
          )}

          {effectiveStep === "email" && (
            <View style={styles.card} testID="email-auth-form">
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="email" size={40} color={colors.brandPrimary} />
              </View>
              <Text style={styles.title}>{emailMode === "signin" ? "Welcome back" : "Create account"}</Text>
              <Text style={styles.subtitle}>
                {emailMode === "signin" ? "Sign in with your email and password." : "Pick an email and password (8+ chars)."}
              </Text>

              {emailMode === "signup" && (
                <TextInput
                  testID="email-signup-name"
                  value={signupName}
                  onChangeText={setSignupName}
                  placeholder="Display name"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                  maxLength={24}
                />
              )}
              <TextInput
                testID="email-input"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <TextInput
                testID="email-password"
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
                secureTextEntry
                autoComplete={emailMode === "signin" ? "current-password" : "new-password"}
              />
              {emailMode === "signup" && (
                <TextInput
                  testID="email-referral"
                  value={referral}
                  onChangeText={(v) => setReferral(v.toUpperCase())}
                  placeholder="Invite code (optional)"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                  autoCapitalize="characters"
                  maxLength={16}
                />
              )}

              {!!err && <Text testID="email-auth-error" style={styles.error}>{err}</Text>}

              <Pressable
                testID="email-auth-submit"
                onPress={onSubmitEmail}
                disabled={busy}
                style={[styles.btn, busy && styles.btnDisabled]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <>
                    <Text style={styles.btnText}>{emailMode === "signin" ? "Sign in" : "Create account"}</Text>
                    <MaterialCommunityIcons name="arrow-right" size={18} color={colors.onBrandPrimary} />
                  </>
                )}
              </Pressable>

              <Pressable
                testID="email-mode-toggle"
                onPress={() => { setErr(null); setEmailMode(emailMode === "signin" ? "signup" : "signin"); }}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>
                  {emailMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
                </Text>
              </Pressable>

              <Pressable
                testID="email-back-button"
                onPress={() => { setErr(null); setStep("auth"); }}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>← Back</Text>
              </Pressable>
            </View>
          )}

          {effectiveStep === "name" && (
            <View style={styles.card} testID="username-gate">
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="account-tie" size={40} color={colors.brandPrimary} />
              </View>
              <Text style={styles.title}>Name your Tycoon</Text>
              <Text style={styles.subtitle}>
                Pick a name other players will see on the leaderboard, in chat and in Cities.
              </Text>
              <TextInput
                testID="username-gate-input"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Money Mogul"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
                maxLength={24}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={onSubmitName}
              />
              <Pressable
                testID="username-gate-continue"
                onPress={onSubmitName}
                disabled={name.trim().length < 2}
                style={[styles.btn, name.trim().length < 2 && styles.btnDisabled]}
              >
                <Text style={styles.btnText}>Start Building</Text>
                <MaterialCommunityIcons name="arrow-right" size={18} color={colors.onBrandPrimary} />
              </Pressable>
              <Text style={styles.hint}>You can change this later in your Profile.</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary + "1A",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "900" },
  subtitle: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: "#4285F4", paddingVertical: spacing.lg, borderRadius: radius.pill, width: "100%",
  },
  googleText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  emailBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.pill,
    width: "100%", marginTop: spacing.sm,
  },
  emailText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900" },
  localBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary, paddingVertical: spacing.lg, borderRadius: radius.pill,
    width: "100%", marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  localText: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  input: {
    width: "100%", backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface,
    fontSize: 16, fontWeight: "700", borderWidth: 1, borderColor: colors.border,
    marginTop: spacing.sm,
  },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: spacing.lg,
    width: "100%", marginTop: spacing.lg,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "900" },
  linkBtn: { paddingVertical: spacing.sm, marginTop: spacing.xs },
  linkText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "800" },
  hint: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "600", marginTop: spacing.md, textAlign: "center" },
  error: { color: "#ff6b6b", fontSize: 13, fontWeight: "700", marginTop: spacing.sm, textAlign: "center" },
});
