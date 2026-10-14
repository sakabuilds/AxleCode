import { CloudJobsClient } from "@axle/client-runtime/cloud/jobs";
import { useMemo } from "react";

import { useAccountAuth } from "./AccountAuthProvider";
import { resolveCloudPublicConfig } from "./publicConfig";

/**
 * The account API base URL the cloud-jobs surface talks to. Returns null when
 * the build was compiled without `accountApi.url`, in which case the surface
 * is unavailable (the route bails out instead of presenting an empty shell).
 */
export function resolveAccountApiUrl(): string | null {
  return resolveCloudPublicConfig().accountApi.url;
}

/**
 * Builds the shared cloud-jobs client on top of the account session token.
 * Entitlements, credits, and job state are decided by the account API; this
 * client is a transport, never an authority.
 */
export function useCloudJobsClient(): CloudJobsClient | null {
  const { getToken } = useAccountAuth();
  const baseUrl = resolveAccountApiUrl();

  return useMemo(
    () => (baseUrl === null ? null : new CloudJobsClient({ baseUrl, getToken })),
    [baseUrl, getToken],
  );
}

/**
 * Human-readable message for a cloud-jobs failure. Keeps transport codes in
 * developer-visible surfaces (a codes list) while giving users a fixable
 * sentence first.
 */
export function describeCloudJobsError(error: unknown): string {
  if (error instanceof Error && error.name === "CloudJobsApiError") {
    const code = (error as { code?: unknown }).code;
    if (code === "unauthorized") return "Sign in to Axle Cloud to continue.";
    if (code === "cloud_not_configured") return "Cloud execution is not configured for this account.";
    if (code === "cloud_access_denied" || code === "forbidden")
      return "This account does not have cloud access yet.";
    if (code === "not_found") return "That job no longer exists.";
    if (code === "capacity_exceeded") return "Too many cloud jobs are already running.";
    if (code === "event_limit_exceeded") return "This job has too many events to stream here.";
    if (code === "network_error") return "Could not reach Axle Cloud. Check your connection.";
    if (typeof code === "string" && code.length > 0) return "Cloud request failed (" + code + ").";
    return "Cloud request failed.";
  }
  return "Cloud request failed.";
}