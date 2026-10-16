import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState, type ComponentType } from "react";
import { Text, View } from "react-native";

import { StartupErrorBoundary, StartupErrorScreen } from "./startupErrorReporting";

type AppComponent = ComponentType;

const bootStartedAt = Date.now();
const bootLog: string[] = [];

function stamp(message: string): void {
  bootLog.push(`[+${Date.now() - bootStartedAt}ms] ${message}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n\n${error.stack ?? ""}`;
  }
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatBootReport(error: unknown): string {
  return `${describeError(error)}\n\nBoot log:\n${bootLog.join("\n")}`;
}

/**
 * Renders immediately, then loads the real app lazily so that a module-eval
 * failure anywhere in the app graph is caught and shown on screen. Release
 * builds swallow fatal errors, so without this a startup failure leaves the
 * native splash visible forever with no explanation.
 */
export function BootGate() {
  const [app, setApp] = useState<AppComponent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    stamp("boot gate mounted");
    // Hide the native splash as soon as the gate renders: from here on any
    // failure must be visible on screen instead of a stuck splash.
    void SplashScreen.hideAsync().catch(() => {});
    stamp("splash hide requested");

    try {
      // Loaded via synchronous require instead of a dynamic import: the entry
      // module must not statically pull in the app graph (a module-eval crash
      // there would kill the process before anything renders), but Metro's
      // async-chunk handling for import() does not survive static exports.
      const appModule = require("../App") as { default?: AppComponent };
      const loaded = appModule?.default ?? (appModule as unknown as AppComponent);
      if (typeof loaded !== "function") {
        throw new Error("App module did not export a component");
      }
      stamp("app module loaded");
      if (!cancelled) {
        setApp(() => loaded);
      }
    } catch (reason) {
      stamp("app module failed to evaluate");
      if (!cancelled) {
        setError(formatBootReport(reason));
      }
    }

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <StartupErrorScreen message={error} />;
  }

  if (app) {
    const LoadedApp = app;
    return (
      <StartupErrorBoundary>
        <LoadedApp />
      </StartupErrorBoundary>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#1a1a1a",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#f5f5f5", fontSize: 14 }}>Starting Axle...</Text>
    </View>
  );
}
