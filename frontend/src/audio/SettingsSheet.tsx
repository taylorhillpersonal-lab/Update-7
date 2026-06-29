import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, radius, spacing } from "@/src/game/theme";
import { haptic } from "@/src/game/haptics";
import { useAudio } from "@/src/audio/AudioProvider";

export default function SettingsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const {
    musicOn,
    sfxOn,
    setMusicOn,
    setSfxOn,
    setMuteAll,
  } = useAudio();

  const allMuted = !musicOn && !sfxOn;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        testID="settings-backdrop"
        style={styles.backdrop}
        onPress={onClose}
      >
        <Pressable
          testID="settings-sheet"
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.headerRow}>
            <MaterialCommunityIcons
              name="cog"
              size={22}
              color={colors.brandPrimary}
            />
            <Text style={styles.headerText}>Audio Settings</Text>
            <Pressable
              testID="settings-close"
              onPress={onClose}
              style={styles.closeBtn}
            >
              <MaterialCommunityIcons
                name="close"
                size={20}
                color={colors.onSurfaceTertiary}
              />
            </Pressable>
          </View>

          <Row
            testID="setting-music"
            icon="music"
            label="Music"
            sub="Background tycoon loop"
            value={musicOn}
            onChange={(v) => {
              haptic("light");
              setMusicOn(v);
            }}
          />
          <Row
            testID="setting-sfx"
            icon="volume-high"
            label="Sound Effects"
            sub="Taps, purchases, wins"
            value={sfxOn}
            onChange={(v) => {
              haptic("light");
              setSfxOn(v);
            }}
          />

          <Pressable
            testID="setting-mute-all"
            onPress={() => {
              haptic("light");
              setMuteAll(!allMuted);
            }}
            style={[
              styles.muteAllBtn,
              { backgroundColor: allMuted ? colors.brandPrimary : colors.surfaceTertiary },
            ]}
          >
            <MaterialCommunityIcons
              name={allMuted ? "volume-off" : "volume-mute"}
              size={18}
              color={allMuted ? colors.onBrandPrimary : colors.onSurface}
            />
            <Text
              style={[
                styles.muteAllText,
                { color: allMuted ? colors.onBrandPrimary : colors.onSurface },
              ]}
            >
              {allMuted ? "All audio muted — tap to unmute" : "Mute everything"}
            </Text>
          </Pressable>

          <Text style={styles.creditText}>
            Music: &quot;Fluffing a Duck&quot; by Kevin MacLeod (incompetech.com),
            licensed CC-BY 4.0.{"\n"}
            Sound effects: original synthesised tones — fully license-free.
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  testID,
  icon,
  label,
  sub,
  value,
  onChange,
}: {
  testID: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.brandSecondary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Switch
        testID={`${testID}-switch`}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.brandSecondary, false: colors.surfaceTertiary }}
        thumbColor={value ? colors.onBrandSecondary : "#888"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 17,
    fontWeight: "900",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary + "22",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  rowSub: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  muteAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  muteAllText: { fontSize: 14, fontWeight: "900" },
  creditText: {
    color: colors.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 16,
  },
});
