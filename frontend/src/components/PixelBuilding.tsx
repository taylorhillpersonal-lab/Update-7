import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { Skin } from "@/src/game/cosmetics";
import { colors } from "@/src/game/theme";

const OUTLINE = "#1B1410";

function shade(hex: string, amt: number) {
  // darken/lighten a #rrggbb by amt (-1..1)
  const n = hex.replace("#", "");
  const r = Math.max(0, Math.min(255, parseInt(n.slice(0, 2), 16) + Math.round(255 * amt)));
  const g = Math.max(0, Math.min(255, parseInt(n.slice(2, 4), 16) + Math.round(255 * amt)));
  const b = Math.max(0, Math.min(255, parseInt(n.slice(4, 6), 16) + Math.round(255 * amt)));
  return `rgb(${r},${g},${b})`;
}

// A detailed blocky, 16-bit Stardew-style shop. Pure visual.
export default function PixelBuilding({
  skin,
  level,
  name,
  icon,
}: {
  skin: Skin;
  level: number;
  name: string;
  icon: string;
}) {
  const tier = Math.min(3, 1 + Math.floor(level / 50));
  const wallH = 58 + tier * 14;
  const windows = tier + 1;
  const roofDark = shade(skin.roof, -0.12);
  const wallShadow = shade(skin.wall, -0.14);

  return (
    <View style={styles.col}>
      {/* Pixel drop shadow */}
      <View style={styles.shadow} />

      {/* Roof */}
      <View style={styles.roofWrap}>
        <View style={[styles.roof, { borderBottomColor: skin.roof }]} />
        <View style={[styles.ridge, { backgroundColor: roofDark }]} />
        <View style={[styles.chimney, { backgroundColor: skin.door }]}>
          <View style={styles.smoke} />
        </View>
      </View>
      <View style={[styles.eave, { backgroundColor: roofDark }]} />

      {/* Wall */}
      <View style={[styles.wall, { height: wallH, backgroundColor: skin.wall }]}>
        {/* right-side shading for depth */}
        <View style={[styles.wallShade, { backgroundColor: wallShadow }]} />

        {skin.awning && (
          <View style={[styles.awning, { backgroundColor: skin.awning }]}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={[styles.awningStripe, { backgroundColor: i % 2 ? skin.roof : skin.awning }]} />
            ))}
          </View>
        )}

        <View style={styles.windowRow}>
          {Array.from({ length: windows }).map((_, i) => (
            <View key={i} style={styles.windowFrame}>
              <View style={[styles.window, { backgroundColor: skin.accent }]}>
                <View style={styles.mullionV} />
                <View style={styles.mullionH} />
              </View>
              <View style={styles.sill} />
            </View>
          ))}
        </View>

        <View style={[styles.door, { backgroundColor: skin.door }]}>
          <MaterialCommunityIcons name={icon as any} size={15} color={skin.accent} />
          <View style={styles.knob} />
        </View>

        {/* stone foundation */}
        <View style={styles.foundation}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.brick} />
          ))}
        </View>
      </View>

      {/* Hanging sign */}
      <View style={[styles.sign, { borderColor: skin.roof }]}>
        <Text style={styles.signName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.signLvl}>Lv {level}</Text>
      </View>
    </View>
  );
}

const W = 122;

const styles = StyleSheet.create({
  col: { width: W, alignItems: "center" },
  shadow: {
    position: "absolute",
    bottom: 30,
    width: W - 24,
    height: 10,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  roofWrap: { alignItems: "center", justifyContent: "flex-end" },
  roof: {
    width: 0,
    height: 0,
    borderLeftWidth: W / 2,
    borderRightWidth: W / 2,
    borderBottomWidth: 30,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  ridge: { position: "absolute", top: 0, width: 6, height: 30 },
  chimney: {
    position: "absolute",
    right: 16,
    top: -8,
    width: 11,
    height: 20,
    borderWidth: 2,
    borderColor: OUTLINE,
  },
  smoke: {
    position: "absolute",
    top: -10,
    left: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  eave: { width: W - 6, height: 6, borderWidth: 2, borderColor: OUTLINE },
  wall: {
    width: W - 14,
    borderWidth: 3,
    borderColor: OUTLINE,
    borderTopWidth: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  wallShade: { position: "absolute", right: 0, top: 0, bottom: 0, width: 26 },
  awning: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 13,
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: OUTLINE,
  },
  awningStripe: { flex: 1, height: "100%" },
  windowRow: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 8 },
  windowFrame: { alignItems: "center" },
  window: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: OUTLINE,
    alignItems: "center",
    justifyContent: "center",
  },
  mullionV: { position: "absolute", width: 2, height: "100%", backgroundColor: OUTLINE },
  mullionH: { position: "absolute", height: 2, width: "100%", backgroundColor: OUTLINE },
  sill: { width: 24, height: 3, backgroundColor: OUTLINE },
  door: {
    width: 28,
    height: 30,
    borderWidth: 3,
    borderColor: OUTLINE,
    borderBottomWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  knob: { position: "absolute", right: 4, width: 4, height: 4, backgroundColor: "#FFD27F" },
  foundation: { position: "absolute", bottom: 0, left: 0, right: 0, height: 8, flexDirection: "row", backgroundColor: "#7A6A57" },
  brick: { flex: 1, height: "100%", borderRightWidth: 1, borderColor: "rgba(0,0,0,0.3)" },
  sign: {
    marginTop: 6,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    width: W - 8,
    alignItems: "center",
  },
  signName: { color: colors.onSurface, fontSize: 11, fontWeight: "900" },
  signLvl: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: "800" },
});
