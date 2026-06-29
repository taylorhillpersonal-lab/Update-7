import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, radius, spacing } from "@/src/game/theme";
import { fetchAnnouncement } from "@/src/game/api";

export default function AnnouncementBanner() {
  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const a = await fetchAnnouncement();
      if (active) {
        setMessage(a?.message ?? null);
        setDismissed(false);
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!message || dismissed) return null;

  return (
    <View style={styles.banner} testID="announcement-banner">
      <MaterialCommunityIcons name="bullhorn" size={18} color={colors.onBrandPrimary} />
      <Text style={styles.text} numberOfLines={3}>
        {message}
      </Text>
      <Pressable testID="announcement-dismiss" onPress={() => setDismissed(true)} hitSlop={10}>
        <MaterialCommunityIcons name="close" size={18} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandPrimary,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  text: { flex: 1, color: colors.onBrandPrimary, fontSize: 13, fontWeight: "800" },
});
