import React from "react";
import { StyleSheet, View } from "react-native";

import { Decor } from "@/src/game/cosmetics";

const OUTLINE = "#1B1410";

// Tiny blocky pixel-art decorations for the neighborhood scene.
export default function PixelDecor({ decor }: { decor: Decor }) {
  switch (decor.kind) {
    case "tree":
      return (
        <View style={styles.box}>
          <View style={[styles.canopy, { backgroundColor: decor.color }]} />
          <View style={[styles.canopy2, { backgroundColor: "#3C7740" }]} />
          <View style={styles.trunk} />
        </View>
      );
    case "fountain":
      return (
        <View style={styles.box}>
          <View style={[styles.water, { backgroundColor: decor.color }]} />
          <View style={styles.fountainBase} />
        </View>
      );
    case "lamp":
      return (
        <View style={styles.box}>
          <View style={[styles.lampHead, { backgroundColor: decor.color }]} />
          <View style={styles.pole} />
          <View style={styles.poleBase} />
        </View>
      );
    case "flowers":
      return (
        <View style={styles.box}>
          <View style={styles.flowerRow}>
            <View style={[styles.flower, { backgroundColor: decor.color }]} />
            <View style={[styles.flower, { backgroundColor: "#F2C14E" }]} />
            <View style={[styles.flower, { backgroundColor: "#6FB1FC" }]} />
          </View>
          <View style={styles.soil} />
        </View>
      );
    case "bench":
      return (
        <View style={styles.box}>
          <View style={[styles.benchSeat, { backgroundColor: decor.color }]} />
          <View style={styles.benchLegs}>
            <View style={styles.benchLeg} />
            <View style={styles.benchLeg} />
          </View>
        </View>
      );
    case "pond":
      return (
        <View style={styles.box}>
          <View style={[styles.pond, { backgroundColor: decor.color }]}>
            <View style={styles.koi} />
          </View>
        </View>
      );
    case "gnome":
      return (
        <View style={styles.box}>
          <View style={[styles.gnomeHat, { borderBottomColor: decor.color }]} />
          <View style={styles.gnomeFace} />
          <View style={styles.gnomeBody} />
        </View>
      );
    case "mailbox":
    default:
      return (
        <View style={styles.box}>
          <View style={[styles.mailbox, { backgroundColor: decor.color }]} />
          <View style={styles.mailPost} />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  box: { width: 48, height: 56, alignItems: "center", justifyContent: "flex-end" },
  // tree
  canopy: { position: "absolute", top: 2, width: 34, height: 26, borderWidth: 2, borderColor: OUTLINE },
  canopy2: { position: "absolute", top: 10, width: 44, height: 20, borderWidth: 2, borderColor: OUTLINE },
  trunk: { width: 10, height: 16, backgroundColor: "#6B4A2B", borderWidth: 2, borderColor: OUTLINE },
  // fountain
  water: { width: 30, height: 14, borderWidth: 2, borderColor: OUTLINE },
  fountainBase: { width: 40, height: 12, backgroundColor: "#9AA0A6", borderWidth: 2, borderColor: OUTLINE },
  // lamp
  lampHead: { width: 16, height: 14, borderWidth: 2, borderColor: OUTLINE },
  pole: { width: 6, height: 30, backgroundColor: "#3A3F3A", borderWidth: 2, borderColor: OUTLINE },
  poleBase: { width: 18, height: 6, backgroundColor: "#3A3F3A", borderWidth: 2, borderColor: OUTLINE },
  // flowers
  flowerRow: { flexDirection: "row", gap: 4, marginBottom: 2 },
  flower: { width: 10, height: 10, borderWidth: 2, borderColor: OUTLINE },
  soil: { width: 42, height: 10, backgroundColor: "#6B4A2B", borderWidth: 2, borderColor: OUTLINE },
  // bench
  benchSeat: { width: 42, height: 12, borderWidth: 2, borderColor: OUTLINE },
  benchLegs: { flexDirection: "row", justifyContent: "space-between", width: 34 },
  benchLeg: { width: 6, height: 12, backgroundColor: "#5C3A1E", borderWidth: 2, borderColor: OUTLINE },
  // pond
  pond: { width: 46, height: 26, borderWidth: 2, borderColor: OUTLINE, alignItems: "center", justifyContent: "center" },
  koi: { width: 8, height: 6, backgroundColor: "#FF7043" },
  // gnome
  gnomeHat: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 16,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  gnomeFace: { width: 14, height: 8, backgroundColor: "#F2C9A0", borderWidth: 2, borderColor: OUTLINE },
  gnomeBody: { width: 18, height: 14, backgroundColor: "#3E7AD8", borderWidth: 2, borderColor: OUTLINE },
  // mailbox
  mailbox: { width: 20, height: 14, borderWidth: 2, borderColor: OUTLINE },
  mailPost: { width: 6, height: 22, backgroundColor: "#5C3A1E", borderWidth: 2, borderColor: OUTLINE },
});
