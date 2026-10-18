import type { CloudEntitlements } from "@axle/contracts";

import { planTierFromId } from "./planCatalog";

/**
 * Client-side gates derived from a resolved plan. `null` means the deployment
 * is unmetered or the plan could not be resolved — nothing is locked, because
 * only a positively resolved plan may gate a feature. Cloud-job creation is
 * additionally enforced by the account API regardless of these helpers.
 */

export function cloudJobsLocked(entitlements: CloudEntitlements | null): boolean {
  return entitlements !== null && !entitlements.cloudJobsEnabled;
}

export function pullRequestReviewsLocked(entitlements: CloudEntitlements | null): boolean {
  return entitlements !== null && !entitlements.features.pullRequestReviews;
}

/** Maximum saved scheduled tasks, or null when unlimited/unknown. */
export function scheduledTasksLimit(entitlements: CloudEntitlements | null): number | null {
  return entitlements === null ? null : entitlements.features.scheduledTasksMax;
}

/** Plugins that stay available on the Free plan; the rest need a paid plan. */
export const FREE_PLAN_PLUGIN_IDS: ReadonlySet<string> = new Set(["github"]);

/**
 * True when the plan positively resolved to Free and the plugin is not one of
 * the free-tier plugins (GitHub). Unknown plans and signed-out sessions fail
 * open; the auth worker still enforces whatever it is told server-side.
 */
export function pluginLockedForPlan(
  entitlements: CloudEntitlements | null,
  pluginId: string,
): boolean {
  return (
    entitlements !== null &&
    planTierFromId(entitlements.planId) === "free" &&
    !FREE_PLAN_PLUGIN_IDS.has(pluginId)
  );
}
