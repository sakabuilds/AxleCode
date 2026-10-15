import { Component, type ReactNode, useEffect, useState } from "react";
import { Text, View } from "react-native";

type Listener = (message: string | null) => void;

let currentMessage: string | null = null;
const listeners = new Set<Listener>();

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.name + ": " + error.message + "\n\n" + (error.stack ?? "");
  }
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function publish(message: string | null): void {
  currentMessage = message;
  for (const listener of listeners) {
    listener(message);
  }
}

/** Surfaces a startup failure on screen instead of letting release builds exit silently. */
export function installStartupErrorReporting(): void {
  const errorUtils = (globalThis as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) {
    return;
  }
  const previous = errorUtils.getGlobalHandler?.();
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  errorUtils.setGlobalHandler((error, isFatal) => {
    publish(formatError(error));
    // In development keep the redbox behaviour. In release a fatal error
    // would otherwise take the process down before anything can be shown, so
    // it is swallowed and surfaced through the error screen / overlay instead.
    if (!isFatal || isDev) {
      previous?.(error, isFatal);
    }
  });
}

export function StartupErrorScreen(props: { readonly message: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#1a1a1a", padding: 24, justifyContent: "center" }}>
      <Text style={{ color: "#ff6b6b", fontSize: 16, fontWeight: "700", marginBottom: 12 }}>
        Axle hit a startup error
      </Text>
      <Text style={{ color: "#f5f5f5", fontSize: 12 }} selectable>
        {props.message}
      </Text>
    </View>
  );
}

export class StartupErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly message: string | null }
> {
  override state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: formatError(error) };
  }

  override render() {
    if (this.state.message) {
      return <StartupErrorScreen message={this.state.message} />;
    }
    return this.props.children;
  }
}

export function StartupErrorOverlay() {
  const [message, setMessage] = useState<string | null>(currentMessage);
  useEffect(() => {
    listeners.add(setMessage);
    return () => {
      listeners.delete(setMessage);
    };
  }, []);
  if (!message) {
    return null;
  }
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "60%",
        backgroundColor: "#1a1a1a",
        padding: 12,
        borderTopWidth: 1,
        borderTopColor: "#ff6b6b",
      }}
    >
      <Text style={{ color: "#ff6b6b", fontSize: 13, fontWeight: "700", marginBottom: 6 }}>
        Startup error
      </Text>
      <Text style={{ color: "#f5f5f5", fontSize: 11 }} selectable>
        {message}
      </Text>
    </View>
  );
}
