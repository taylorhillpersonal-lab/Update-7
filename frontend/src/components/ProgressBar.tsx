import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { colors, radius } from "@/src/game/theme";

type Props = {
  progress: number; // 0..1
  color: string;
  height?: number;
};

export default function ProgressBar({ progress, color, height = 10 }: Props) {
  const w = useSharedValue(progress);
  const prev = useRef(progress);

  useEffect(() => {
    const p = Math.max(0, Math.min(1, progress));
    if (p < prev.current) {
      // Cycle reset — snap to 0 instantly (no backwards animation).
      w.value = p;
    } else {
      // Animate the fill forward smoothly, matching the game tick.
      w.value = withTiming(p, { duration: 220, easing: Easing.linear });
    }
    prev.current = p;
  }, [progress, w]);

  const style = useAnimatedStyle(() => ({
    width: `${w.value * 100}%`,
  }));

  return (
    <View style={[styles.track, { height }]}>
      <Animated.View
        style={[styles.fill, { backgroundColor: color, height }, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  fill: {
    borderRadius: radius.pill,
  },
});
