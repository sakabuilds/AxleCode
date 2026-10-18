// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off
import * as NodeCrypto from "node:crypto";

import type { BachsConfig } from "./bachsConfig.ts";

export class BachsApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Bachs request failed (${status}).`);
    this.name = "BachsApiError";
    this.status = status;
  }
}

export interface BachsCheckoutInput {
  readonly productId: string;
  readonly planId: string;
  readonly userId: string;
  /** Optional prefilled buyer email; the hosted checkout collects it when absent. */
  readonly email: string | null;
  readonly seats: number;
  /**
   * Ad-hoc fixed price for this checkout only (a decimal string like "5.00"),
   * used for credit top-ups where the buyer chose the amount in our UI.
   */
  readonly amount: string | null;
}

/** `POST {apiUrl}/v1/checkout-sessions` — a hosted checkout. */
export async function createBachsCheckoutSession(
  config: BachsConfig,
  input: BachsCheckoutInput,
): Promise<{ checkoutId: string; checkoutUrl: string }> {
  const body: Record<string, unknown> = {
    ...(input.email !== null ? { customer: { email: input.email } } : {}),
    product_cart: [
      input.amount !== null
        ? {
            product_id: input.productId,
            quantity: input.seats,
            pricing: { price_type: "fixed", amount: input.amount },
          }
        : { product_id: input.productId, quantity: input.seats },
    ],
    metadata:
      input.amount !== null
        ? { user_id: input.userId, purpose: "credits", usd: input.amount }
        : { user_id: input.userId, plan_id: input.planId },
  };
  if (config.successUrl !== null) body.success_url = config.successUrl;
  if (config.cancelUrl !== null) body.cancel_url = config.cancelUrl;
  if (config.paymentMethodTypes !== null) body.payment_method_types = config.paymentMethodTypes;

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/v1/checkout-sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new BachsApiError(0);
  }
  const payload = (await response.json().catch(() => null)) as {
    checkout_id?: unknown;
    checkout_url?: unknown;
  } | null;
  if (!response.ok) throw new BachsApiError(response.status);
  if (typeof payload?.checkout_id !== "string" || typeof payload?.checkout_url !== "string") {
    throw new BachsApiError(response.status);
  }
  return { checkoutId: payload.checkout_id, checkoutUrl: payload.checkout_url };
}

export interface BachsWebhookEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly userId: string | null;
  readonly planId: string | null;
  readonly providerReference: string | null;
  /** `"credits"` for one-time top-up checkouts; null for subscriptions. */
  readonly purpose: string | null;
  /** The USD amount a credits checkout was created with, from our own metadata. */
  readonly usd: number | null;
  readonly checkoutId: string | null;
  readonly reference: string | null;
}

/** Strictly reads the fields the billing route acts on; null when unusable. */
export function readBachsWebhookEvent(payload: unknown): BachsWebhookEvent | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const eventId = record.id;
  const eventType = record.type;
  if (typeof eventId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/u.test(eventId)) return null;
  if (typeof eventType !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/u.test(eventType)) return null;

  const data =
    record.data !== null && typeof record.data === "object" && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {};
  const metadata =
    data.metadata !== null && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : {};
  const userId =
    typeof metadata.user_id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(metadata.user_id)
      ? metadata.user_id
      : null;
  const planId =
    typeof metadata.plan_id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(metadata.plan_id)
      ? metadata.plan_id
      : null;
  const purpose =
    typeof metadata.purpose === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(metadata.purpose)
      ? metadata.purpose
      : null;
  // The amount is echoed back from what our own checkout set, so the credit
  // grant cannot be inflated by a buyer-side currency or amount change.
  const usd =
    typeof metadata.usd === "string" && /^\d{1,7}(?:\.\d{1,2})?$/u.test(metadata.usd)
      ? Number(metadata.usd)
      : null;
  const reference =
    typeof data.charge_id === "string"
      ? data.charge_id
      : typeof data.payment_id === "string"
        ? data.payment_id
        : null;
  const providerReference =
    reference !== null && reference.length <= 256 ? reference : null;
  const checkoutId =
    typeof data.checkout_id === "string" && data.checkout_id.length <= 256 ? data.checkout_id : null;
  const orderReference =
    typeof data.reference === "string" && data.reference.length <= 256 ? data.reference : null;

  return {
    eventId,
    eventType,
    userId,
    planId,
    providerReference,
    purpose,
    usd,
    checkoutId,
    reference: orderReference,
  };
}

/**
 * Verifies the Bachs delivery signature over `"{timestamp}.{raw_body}"`.
 *
 * Prefers `X-Bachs-Signature-V2` (`t=...,v1=...`), accepting any listed `v1`
 * value so a secret rotation verifies during its overlap window, and falls back
 * to the legacy `X-Bachs-Signature` hex digest. Deliveries older than the
 * tolerance are rejected as replays.
 */
export function verifyBachsWebhookSignature(input: {
  readonly rawBody: string;
  readonly secret: string;
  readonly timestampHeader: string | null;
  readonly signatureHeader: string | null;
  readonly signatureV2Header: string | null;
  readonly nowSeconds?: number;
}): boolean {
  const toleranceSeconds = 300;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  let timestamp: number | null = null;
  const signatures: string[] = [];
  if (input.signatureV2Header !== null) {
    for (const part of input.signatureV2Header.split(",")) {
      const [key, value] = part.split("=", 2);
      if (key?.trim() === "t" && value !== undefined && /^\d+$/u.test(value.trim())) {
        timestamp = Number(value.trim());
      } else if (
        key?.trim() === "v1" &&
        value !== undefined &&
        /^[a-fA-F0-9]+$/u.test(value.trim())
      ) {
        signatures.push(value.trim().toLowerCase());
      }
    }
  }
  if (
    timestamp === null &&
    input.timestampHeader !== null &&
    /^\d+$/u.test(input.timestampHeader)
  ) {
    timestamp = Number(input.timestampHeader);
  }
  if (
    signatures.length === 0 &&
    input.signatureHeader !== null &&
    /^[a-fA-F0-9]+$/u.test(input.signatureHeader)
  ) {
    signatures.push(input.signatureHeader.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = NodeCrypto.createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest("hex");
  return signatures.some(
    (signature) =>
      signature.length === expected.length &&
      NodeCrypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
  );
}
