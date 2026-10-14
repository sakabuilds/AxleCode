import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import type { RemoteClientConnectionState } from "../../lib/connection";
import { useThemeColor } from "../../lib/useThemeColor";

export type ConnectionStatusDotState = RemoteClientConnectionState;

function statusDotToken(state: ConnectionStatusDotState): `--color-${string}` {
  switch (state) {
    case "connected":
      return "--color-success";
    case "connecting":
    case "reconnecting":
      return "--color-warning";
    case "available":
      return "--color-foreground-tertiary";
    case "offline":
    case "error":
      return "--color-danger-foreground";
  }
}

function usePulseAnimation(pulse: boolean) {
  const pulseProgress = useSharedValue(0);

  useEffect(() => {
    if (pulse) {
      pulseProgress.value = withRepeat(
        withTiming(1, {
          duration: 1100,
          easing: Easing.out(Easing.cubic),
        }),
        -1,
        false,
      );
      return;
    }

    cancelAnimation(pulseProgress);
    pulseProgress.value = withTiming(0, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
  }, [pulse, pulseProgress]);

  return pulseProgress;
}

export function ConnectionStatusDot(props: {
  readonly state: ConnectionStatusDotState;
  readonly pulse: boolean;
  readonly size?: number;
}) {
  const pulseProgress = usePulseAnimation(props.pulse);
  const dotColor = String(useThemeColor(statusDotToken(props.state)));
  const dotSize = props.size ?? 10;
  const haloSize = dotSize + 4;
  const containerSize = haloSize + 4;

  const haloStyle = useAnimatedStyle(() => ({
    opacity: props.pulse ? 0.14 + (1 - pulseProgress.value) * 0.3 : 0,
    transform: [{ scale: 0.78 + pulseProgress.value * 1.16 }],
  }));

  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          haloStyle,
          {
            position: "absolute",
            width: haloSize,
            height: haloSize,
            borderRadius: haloSize / 2,
            backgroundColor: dotColor,
          },
        ]}
      />
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: dotColor,
        }}
      />
    </View>
  );
}
