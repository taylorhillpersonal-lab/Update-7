import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

type Kind = "light" | "medium" | "heavy" | "success" | "error";

// SFX is wired in lazily by AudioProvider — keeps this module dependency-free.
type SfxName =
  | "tap"
  | "business_tap"
  | "purchase"
  | "hire"
  | "level_up"
  | "win"
  | "error"
  | "coin"
  | "prestige"
  | "spin";
let sfxBinding: ((name: SfxName) => void) | null = null;
export function bindSfx(fn: ((name: SfxName) => void) | null): void {
  sfxBinding = fn;
}

// Imperative escape-hatch for components that want a SPECIFIC sound
// (business tap = machine clunk, prestige = gong, etc.) without going
// through the haptic mapping.
export function playSfx(name: SfxName): void {
  if (sfxBinding) {
    try {
      sfxBinding(name);
    } catch {
      // ignore
    }
  }
}

const HAPTIC_TO_SFX: Record<Kind, SfxName | null> = {
  light: "tap",
  medium: "purchase",
  heavy: "hire",
  success: "level_up",
  error: "error",
};

export function haptic(kind: Kind) {
  // Always fire the matching SFX (gated inside AudioProvider by user settings).
  const sfx = HAPTIC_TO_SFX[kind];
  if (sfx && sfxBinding) {
    try {
      sfxBinding(sfx);
    } catch {
      // ignore
    }
  }
  if (Platform.OS === "web") return;
  try {
    switch (kind) {
      case "light":
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case "medium":
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case "heavy":
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case "success":
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case "error":
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch {
    // no-op
  }
}
