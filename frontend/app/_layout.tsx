import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { GameProvider } from "@/src/game/GameContext";
import { AuthProvider } from "@/src/auth/AuthContext";
import { AdsProvider } from "@/src/ads/AdsProvider";
import { AudioProvider } from "@/src/audio/AudioProvider";
import { OffersProvider } from "@/src/game/OffersProvider";
import { EventsProvider } from "@/src/game/EventsProvider";
import { ReportProvider } from "@/src/game/ReportProvider";
import { ProfileProvider } from "@/src/game/ProfileProvider";
import UsernameGate from "@/src/game/UsernameGate";
import GemToast from "@/src/components/GemToast";
import TutorialGate from "@/src/components/TutorialGate";

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // If the CDN is unreachable we fall through on error rather than wedging
  // the app — icons will tofu, but the app still boots.
  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <GameProvider>
          <AuthProvider>
            <AdsProvider>
              <AudioProvider>
                <OffersProvider>
                  <EventsProvider>
                    <ReportProvider>
                      <ProfileProvider>
                        <StatusBar style="light" />
                        <Stack screenOptions={{ headerShown: false }} />
                        <GemToast />
                        <UsernameGate />
                        <TutorialGate />
                      </ProfileProvider>
                    </ReportProvider>
                  </EventsProvider>
                </OffersProvider>
              </AudioProvider>
            </AdsProvider>
          </AuthProvider>
        </GameProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
