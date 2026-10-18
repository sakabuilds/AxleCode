// @effect-diagnostics nodeBuiltinImport:off globalFetch:off

/**
 * Client for the hosted-provider gateway's internal credit route.
 *
 * Purchases and plan grants are applied here after Bachs confirms a payment:
 * the gateway owns the balance, so the account API forwards the payment event
 * id as the `reference` and the gateway makes the application idempotent.
 * When this call fails the webhook answers 5xx so Bachs redelivers the event
 * instead of losing a paid top-up.
 */

export interface GatewayCreditsConfig {
  readonly url: string;
  readonly token: string;
  /**
   * Service-binding fetcher (`env.AXLE_GATEWAY_SERVICE.fetch`) when the
   * worker is deployed on Cloudflare. Worker-to-worker global `fetch()` to
   * the same zone fails with error 1042, so the deployed worker must route
   * through the binding. Node deployments leave this unset and use global
   * fetch.
   */
  readonly fetcher?: BindingFetch;
}

/** Shape shared by service-binding `Fetcher.fetch` and global fetch. */
export type BindingFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** 100 credits == $0.50 on the hosted provider, so $1 == 200 credits. */
export const CREDITS_PER_USD = 200;

export class GatewayCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayCreditsError";
  }
}

export function readGatewayCreditsConfig(
  env: Readonly<Record<string, string | undefined>>,
  fetcher?: BindingFetch,
): GatewayCreditsConfig | null {
  const url = env.AXLE_GATEWAY_INTERNAL_URL?.trim().replace(/\/$/u, "");
  const token = env.AXLE_INTERNAL_TOKEN?.trim();
  if (!url || !token) return null;
  if (!/^https:\/\/[^\s]+$/u.test(url)) {
    throw new Error("AXLE_GATEWAY_INTERNAL_URL must be an https URL.");
  }
  if (token.length < 16 || token.length > 256) {
    throw new Error("AXLE_INTERNAL_TOKEN must be 16-256 characters.");
  }
  return { url, token, ...(fetcher === undefined ? {} : { fetcher }) };
}

export async function applyGatewayCredits(
  config: GatewayCreditsConfig,
  input: {
    readonly userId: string;
    readonly amount: number;
    readonly bucket: "paid" | "plan";
    readonly reference: string;
  },
): Promise<{ applied: boolean; balance: number }> {
  let response: Response;
  const request = config.fetcher ?? fetch;
  try {
    response = await request(`${config.url}/v1/internal/credits`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user_id: input.userId,
        amount: input.amount,
        bucket: input.bucket,
        reference: input.reference,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new GatewayCreditsError(
      `The gateway could not be reached: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    applied?: unknown;
    balance?: unknown;
  } | null;
  if (!response.ok) {
    throw new GatewayCreditsError(`The gateway refused the credit (HTTP ${response.status}).`);
  }
  if (typeof payload?.applied !== "boolean" || typeof payload?.balance !== "number") {
    throw new GatewayCreditsError("The gateway returned an unusable credit response.");
  }
  return { applied: payload.applied, balance: payload.balance };
}
