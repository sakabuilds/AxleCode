import type { CloudEntitlements } from "@axle/contracts";
import { CloudJobsClient } from "@axle/client-runtime/cloud/jobs";

import { readClerkAccountToken } from "../account/clerkRuntime";
import { resolveCloudPublicConfig } from "../cloud/publicConfig";

/**
 * Client-side view of the server-resolved plan.
 *
 * The account API owns the entitlement decision; this store only mirrors it so
 * client surfaces can show locks and upgrade prompts. `unavailable` covers
 * unconfigured deployments, signed-out sessions, and failed refreshes — in
 * every one of those cases nothing is locked client-side, because only a
 * positively resolved plan may gate a feature.
 */
export type EntitlementsSnapshot =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly entitlements: CloudEntitlements | null }
  | { readonly status: "unavailable" };

let snapshot: EntitlementsSnapshot = { status: "idle" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: EntitlementsSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

export function readEntitlementsSnapshot(): EntitlementsSnapshot {
  return snapshot;
}

export function subscribeEntitlements(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function entitlementsConfigured(): boolean {
  return resolveCloudPublicConfig().accountApiUrl !== null;
}

/** Resolves the signed-in plan once per session; `force` refreshes it. */
export function loadEntitlements(force = false): void {
  const baseUrl = resolveCloudPublicConfig().accountApiUrl;
  if (baseUrl === null) {
    publish({ status: "unavailable" });
    return;
  }
  if (inflight !== null) return;
  if (!force && snapshot.status === "ready") return;
  if (snapshot.status !== "ready") publish({ status: "loading" });
  const client = new CloudJobsClient({ baseUrl, getToken: readClerkAccountToken });
  inflight = client
    .getBilling()
    .then((billing) => {
      publish({ status: "ready", entitlements: billing.account.entitlements });
    })
    .catch(() => {
      // A failed lookup must never lock a paying account out of local features.
      publish({ status: "unavailable" });
    })
    .finally(() => {
      inflight = null;
    });
}

/** Signed-out sessions carry no plan, so nothing is gated. */
export function resetEntitlements(): void {
  if (snapshot.status === "idle") return;
  publish({ status: "idle" });
}
