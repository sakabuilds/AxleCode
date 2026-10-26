import type { ReactNode } from "react";

// The desktop app gates the router behind AccountGate before it mounts. Hosted
// static mode uses Neon auth and its own pairing flow, so it does not need a
// second provider-specific account gate; keeping one would duplicate auth flows.
export function HostedAccountGate({ appShell }: { readonly appShell: ReactNode }) {
  return appShell;
}
