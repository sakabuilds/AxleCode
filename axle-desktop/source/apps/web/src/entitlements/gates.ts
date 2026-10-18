import type { CloudEntitlements } from "@axle/contracts";

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
