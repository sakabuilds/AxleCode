/**
 * Client for the Axle hosted provider's gateway.
 *
 * The gateway is the `--provider axle` endpoint: it holds Axle's own upstream
 * key, so a user reaches every Axle model with an Axle API key and no vendor
 * account of their own. Credits are the unit it meters in — 100 credits is
 * $0.50, and every account gets 100 credits each UTC day for free.
 */

const DEFAULT_GATEWAY_URL = "https://axle-gateway.axle-download-worker.workers.dev/v1";

/** USD value of one Axle credit, mirrored from the gateway's `credit_usd`. */
export const CREDIT_USD = 0.005;

export function axleGatewayBaseUrl(): string {
  const configured = import.meta.env.VITE_AXLE_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL;
  try {
    return new URL(configured).toString().replace(/\/$/u, "");
  } catch {
    return DEFAULT_GATEWAY_URL;
  }
}

export interface AxleCredits {
  readonly credits: number;
  readonly creditUsd: number;
  readonly dailyFreeCredits: number;
  readonly balanceUsd: number;
}

export interface AxleUsageEntry {
  readonly kind: string;
  readonly credits: number;
  readonly balanceAfter: number;
  readonly model: string | null;
  readonly createdAt: number;
}

export interface AxleModelRate {
  readonly id: string;
  readonly label: string;
  readonly tier: number;
  readonly contextWindow: number;
  readonly creditsPerMillionInput: number;
  readonly creditsPerMillionOutput: number;
}

export class AxleGatewayError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AxleGatewayError";
    this.status = status;
  }
}

function messageFrom(value: unknown, fallback: string): string {
  if (typeof value !== "object" || value === null) return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

async function gatewayGet(path: string, secret: string | null): Promise<unknown> {
  const response = await fetch(`${axleGatewayBaseUrl()}${path}`, {
    headers: {
      Accept: "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    credentials: "omit",
  });
  const value = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new AxleGatewayError(
      messageFrom(value, `The Axle gateway refused the request (${response.status}).`),
      response.status,
    );
  }
  return value;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** The account's balance, applying today's free grant on the way through. */
export async function fetchAxleCredits(secret: string): Promise<AxleCredits> {
  const value = (await gatewayGet("/credits", secret)) as Record<string, unknown> | null;
  const credits = asNumber(value?.credits);
  return {
    credits,
    creditUsd: asNumber(value?.credit_usd, CREDIT_USD),
    dailyFreeCredits: asNumber(value?.daily_free_credits),
    balanceUsd: asNumber(value?.balance_usd, credits * CREDIT_USD),
  };
}

/** Recent grants and spends, newest first. */
export async function fetchAxleUsage(
  secret: string,
  limit = 25,
): Promise<ReadonlyArray<AxleUsageEntry>> {
  const value = (await gatewayGet(`/usage?limit=${encodeURIComponent(String(limit))}`, secret)) as {
    entries?: unknown;
  } | null;
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  return entries.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      kind: typeof row.kind === "string" ? row.kind : "unknown",
      credits: asNumber(row.credits),
      balanceAfter: asNumber(row.balance_after),
      model: typeof row.model === "string" ? row.model : null,
      createdAt: asNumber(row.created_at),
    };
  });
}

/** The Axle model catalog and its credit rates. Public: no key required. */
export async function fetchAxleModelRates(): Promise<ReadonlyArray<AxleModelRate>> {
  const value = (await gatewayGet("/models", null)) as { data?: unknown } | null;
  const data = Array.isArray(value?.data) ? value.data : [];
  return data.map((entry) => {
    const row = entry as Record<string, unknown>;
    const axle = (row.axle ?? {}) as Record<string, unknown>;
    return {
      id: typeof row.id === "string" ? row.id : "",
      label: typeof axle.label === "string" ? axle.label : String(row.id ?? ""),
      tier: asNumber(axle.tier),
      contextWindow: asNumber(axle.context_window),
      creditsPerMillionInput: asNumber(axle.credits_per_million_input),
      creditsPerMillionOutput: asNumber(axle.credits_per_million_output),
    };
  });
}

/** Credits formatted the way the gateway stores them: at most six decimals. */
export function formatCredits(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}
