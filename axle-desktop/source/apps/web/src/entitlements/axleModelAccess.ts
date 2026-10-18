/**
 * Which Axle gateway models the signed-in plan may reach.
 *
 * Enforcement lives in the gateway, which refuses paid models on a free plan;
 * this module only mirrors the catalog's `plan` flags so the picker can show
 * paid models as disabled instead of advertising them as selectable. Only a
 * positively resolved Free plan locks anything: signed-out sessions,
 * unconfigured deployments, and failed lookups leave the catalog untouched so
 * no one is ever locked out.
 */

import type { CloudEntitlements } from "@axle/contracts";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { fetchAxleModelRates, type AxleModelRate } from "../account/axleGateway";
import { planTierFromId } from "./planCatalog";
import { resolvedEntitlements, useEntitlements } from "./useEntitlements";

/** The server builds Axle picker slugs as `axle/<gateway model id>`. */
const AXLE_SLUG_PREFIX = "axle/";

const EMPTY_SLUGS: ReadonlySet<string> = new Set();

/**
 * Slugs the picker must disable for this plan. Empty unless the plan
 * positively resolved to Free and the catalog loaded — every other
 * combination fails open.
 */
export function lockedAxleModelSlugs(
  entitlements: CloudEntitlements | null,
  rates: ReadonlyArray<AxleModelRate> | null,
): ReadonlySet<string> {
  if (entitlements === null || rates === null) return EMPTY_SLUGS;
  if (planTierFromId(entitlements.planId) !== "free") return EMPTY_SLUGS;
  const locked = new Set<string>();
  for (const rate of rates) {
    if (rate.plan === "paid") locked.add(`${AXLE_SLUG_PREFIX}${rate.id}`);
  }
  return locked;
}

type AxleRatesSnapshot =
  | { readonly status: "idle" | "loading" | "unavailable" }
  | { readonly status: "ready"; readonly rates: ReadonlyArray<AxleModelRate> };

let ratesSnapshot: AxleRatesSnapshot = { status: "idle" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: AxleRatesSnapshot): void {
  ratesSnapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

export function readAxleRatesSnapshot(): AxleRatesSnapshot {
  return ratesSnapshot;
}

export function subscribeAxleRates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Loads the public model catalog once per session; `force` refetches it. */
export function loadAxleModelRates(force = false): void {
  if (inflight !== null) return;
  if (!force && ratesSnapshot.status === "ready") return;
  if (ratesSnapshot.status !== "ready") publish({ status: "loading" });
  inflight = fetchAxleModelRates()
    .then((rates) => {
      publish({ status: "ready", rates });
    })
    .catch(() => {
      // An unreachable catalog must never hide models; the gateway still
      // enforces the plan server-side.
      publish({ status: "unavailable" });
    })
    .finally(() => {
      inflight = null;
    });
}

/** The live Axle catalog, or null until it loads (or when unreachable). */
export function useAxleModelRates(): ReadonlyArray<AxleModelRate> | null {
  const snapshot = useSyncExternalStore(
    subscribeAxleRates,
    readAxleRatesSnapshot,
    readAxleRatesSnapshot,
  );

  useEffect(() => {
    loadAxleModelRates();
  }, []);

  return snapshot.status === "ready" ? snapshot.rates : null;
}

/**
 * Axle model slugs the current account cannot use. Empty unless the plan
 * positively resolved to Free; callers show matching picker rows disabled.
 */
export function useLockedAxleModelSlugs(): ReadonlySet<string> {
  const entitlements = useEntitlements();
  const rates = useAxleModelRates();
  return useMemo(
    () => lockedAxleModelSlugs(resolvedEntitlements(entitlements), rates),
    [entitlements, rates],
  );
}
