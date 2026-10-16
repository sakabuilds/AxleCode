/**
 * Pure formatting for the account pages, kept out of the components so the
 * awkward cases (missing timestamps, epoch zero, trailing zeros in credits)
 * can be tested without rendering.
 */

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** A readable local timestamp, or "Unknown" for anything unparseable. */
export function formatTimestamp(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Unknown";
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Milliseconds since the epoch as an ISO string. The gateway reports ledger
 * times as epoch milliseconds, and 0 means "no timestamp" rather than 1970.
 */
export function epochToIso(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

export function describeSessionMethod(method: string): string {
  if (method.startsWith("oauth:")) return `Signed in with ${providerLabel(method.slice(6))}`;
  return method;
}
