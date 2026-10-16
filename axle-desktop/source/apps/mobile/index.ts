import "./src/lib/installStartupErrorReporting";
import "./src/lib/installNativeCrypto";
import { registerRootComponent } from "expo";
import * as SplashScreen from "expo-splash-screen";
import "react-native-gesture-handler";
import { LogBox } from "react-native";
import { featureFlags } from "react-native-screens";

import App from "./src/App";

// Required for react-native-screens' iOS FormSheet sizing fix when a nested
// native stack is rendered inside a non-fitToContents formSheet.
featureFlags.experiment.synchronousScreenUpdatesEnabled = true;

if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  LogBox.ignoreAllLogs();
}

// Keep the native splash visible until the JS tree has mounted (App hides it
// from its mount effect). If startup throws before that, the splash stays up
// instead of the window going blank.
void SplashScreen.preventAutoHideAsync().catch(() => {});

registerRootComponent(App);
