// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeCrypto from "node:crypto";

import { AccountAuthenticationError, type AccountPrincipal } from "./auth.ts";
import {
  BachsApiError,
  createBachsCheckoutSession,
  readBachsWebhookEvent,
  verifyBachsWebhookSignature,
} from "./bachs.ts";
import type { BachsConfig } from "./bachsConfig.ts";
import type { BillingConfig } from "./billingConfig.ts";
import { CloudJobError, type CloudJobStore } from "./cloudStore.ts";
import { AccountSessionAccessError } from "./errors.ts";
import { applyGatewayCredits, CREDITS_PER_USD, type GatewayCreditsConfig } from "./gateway.ts";

const PURCHASABLE_PLANS = ["pro", "pro-plus", "ultra"] as const;
type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];
const PAID_PLAN_IDS: ReadonlySet<string> = new Set(PURCHASABLE_PLANS);
/** Credit packs start at $5 and are capped far above anything a browser should send. */
const MIN_TOPUP_USD = 5;
const MAX_TOPUP_USD = 500;

/**
 * Billing routes: authenticated checkout creation against Bachs (subscription
 * plans and one-time credit packs), the public Bachs webhook that applies
 * purchases, and the internal plan lookup the hosted-provider gateway uses to
 * gate paid models. The webhook and plan routes are the only routes on this
 * server that are not session-authenticated: the webhook is authenticated by
 * Bachs's HMAC signature, the plan route by the shared internal token.
 */
export function createBillingRequestHandler(options: {
  bachs: BachsConfig | null;
  billing: BillingConfig | null;
  store: CloudJobStore | null;
  gateway: GatewayCreditsConfig | null;
  internalToken: string | null;
  authenticate: (request: Request) => Promise<AccountPrincipal>;
  touchSession: (principal: AccountPrincipal) => Promise<void>;
  corsOrigin: string;
}) {
  const headers = {
    "access-control-allow-origin": options.corsOrigin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  const json = (status: number, payload: unknown) =>
    new Response(payload === null ? null : JSON.stringify(payload), { status, headers });
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/billing/")) return null;
    if (request.method === "OPTIONS") return json(204, null);

    try {
      if (url.pathname === "/v1/billing/webhook") {
        if (request.method !== "POST") return json(404, { error: "not_found" });
        // `await` matters: returning the promise without it would let a
        // fulfilment failure escape this try and surface as a transport error.
        return await webhook(request, options);
      }

      if (url.pathname === "/v1/billing/checkout") {
        if (request.method !== "POST") return json(404, { error: "not_found" });
        const { bachs, billing, store, gateway } = options;
        if (!bachs) return json(503, { error: "billing_not_configured" });
        const principal = await options.authenticate(request);
        await options.touchSession(principal);
        const input = parseCheckout(await readJson(request));
        if (input.plan === "credits") {
          // One-time credit pack: priced ad hoc at the buyer's chosen amount,
          // fulfilled by the webhook crediting the gateway balance.
          const productId = bachs.products.credits;
          if (productId === undefined || gateway === null) {
            return json(503, { error: "billing_not_configured" });
          }
          const session = await createBachsCheckoutSession(bachs, {
            productId,
            planId: "credits",
            userId: principal.userId,
            email: input.email,
            seats: 1,
            amount: input.usd.toFixed(2),
          });
          return json(200, session);
        }
        if (!billing || !store) return json(503, { error: "billing_not_configured" });
        // Selling a plan the entitlement catalog cannot resolve would take the
        // money and grant nothing, so it is refused up front.
        if (!billing.plans.some((plan) => plan.planId === input.plan)) {
          return json(503, { error: "billing_not_configured" });
        }
        const productId = bachs.products[input.plan];
        if (productId === undefined) return json(503, { error: "billing_not_configured" });
        const session = await createBachsCheckoutSession(bachs, {
          productId,
          planId: input.plan,
          userId: principal.userId,
          email: input.email,
          seats: input.seats,
          amount: null,
        });
        return json(200, session);
      }

      if (url.pathname === "/v1/billing/plan") {
        if (request.method !== "GET") return json(404, { error: "not_found" });
        const { store, internalToken } = options;
        if (!internalToken || !store) return json(503, { error: "billing_not_configured" });
        if (!(await matchesInternalToken(request, internalToken))) {
          return json(401, { error: "invalid_internal_token" });
        }
        const userId = url.searchParams.get("user_id")?.trim() ?? "";
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(userId)) {
          return json(400, { error: "invalid_user_id" });
        }
        const view = await store.billing(userId);
        const planId = view.account.planId;
        return json(200, {
          planId,
          paid: PAID_PLAN_IDS.has(planId),
          entitlements: view.account.entitlements,
        });
      }

      return json(404, { error: "not_found" });
    } catch (error) {
      if (error instanceof AccountAuthenticationError || error instanceof AccountSessionAccessError) {
        return json(401, { error: "unauthorized" });
      }
      if (error instanceof BachsApiError) {
        console.error("Bachs checkout failed", { status: error.status });
        return json(502, { error: "billing_provider_error" });
      }
      if (error instanceof CloudJobError) {
        return json(error.code.startsWith("invalid_") ? 400 : 409, { error: error.code });
      }
      console.error("Billing request failed", { method: request.method, path: url.pathname });
      return json(500, { error: "internal_error" });
    }
  };
}

/**
 * The webhook applies purchases after Bachs confirms a payment. Both
 * applications are idempotent on the payment event id, so a failed step can
 * answer 5xx and Bachs will redeliver safely.
 */
async function webhook(
  request: Request,
  options: {
    bachs: BachsConfig | null;
    billing: BillingConfig | null;
    store: CloudJobStore | null;
    gateway: GatewayCreditsConfig | null;
  },
): Promise<Response> {
  const { bachs, billing, store, gateway } = options;
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  if (!bachs || bachs.webhookSecret === null) {
    return json(503, { error: "billing_not_configured" });
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
    return json(400, { error: "invalid_request" });
  }
  const verified = verifyBachsWebhookSignature({
    rawBody,
    secret: bachs.webhookSecret,
    timestampHeader: request.headers.get("x-bachs-timestamp"),
    signatureHeader: request.headers.get("x-bachs-signature"),
    signatureV2Header: request.headers.get("x-bachs-signature-v2"),
  });
  if (!verified) return json(401, { error: "invalid_signature" });
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid_request" });
  }
  const event = readBachsWebhookEvent(payload);
  if (!event) return json(400, { error: "invalid_request" });

  if (event.purpose === "credits" && event.eventType === "collection.succeeded") {
    // A paid credit pack: credit the gateway first (idempotent on the event
    // id); the receipt in the billing tables is best-effort audit.
    if (!event.userId || event.usd === null) return json(400, { error: "invalid_request" });
    if (gateway === null) return json(503, { error: "billing_not_configured" });
    const credits = Math.round(event.usd * CREDITS_PER_USD * 1e6) / 1e6;
    await applyGatewayCredits(gateway, {
      userId: event.userId,
      amount: credits,
      bucket: "paid",
      reference: event.eventId,
    });
    if (store) {
      await store.applyWebhookEvent({
        eventId: event.eventId,
        eventType: event.eventType,
        userId: null,
        planId: null,
        providerReference: event.providerReference,
      });
    }
    return json(200, { received: true });
  }

  if (!store) return json(503, { error: "billing_not_configured" });
  // Subscription payment: set the plan's gateway credit allowance first, then
  // record the subscription — both idempotent, so a redelivery after a partial
  // failure completes what is missing without repeating what already applied.
  if (
    event.eventType === "collection.succeeded" &&
    event.userId !== null &&
    event.planId !== null &&
    gateway !== null
  ) {
    const gatewayCredits =
      billing?.plans.find((plan) => plan.planId === event.planId)?.gatewayCredits ?? 0;
    if (gatewayCredits > 0) {
      await applyGatewayCredits(gateway, {
        userId: event.userId,
        amount: gatewayCredits,
        bucket: "plan",
        reference: event.eventId,
      });
    }
  }
  await store.applyWebhookEvent({
    eventId: event.eventId,
    eventType: event.eventType,
    userId: event.userId,
    planId: event.planId,
    providerReference: event.providerReference,
  });
  // Acknowledged even for duplicates and unhandled types so the provider
  // stops retrying; fulfilment state is authoritative in the database.
  return json(200, { received: true });
}

function parseCheckout(body: Record<string, unknown>):
  | { plan: PurchasablePlan; seats: number; email: string | null; usd: null }
  | { plan: "credits"; seats: 1; email: string | null; usd: number } {
  const { plan, seats, email, usd } = body;
  if (typeof email !== "undefined" && typeof email !== "string") {
    throw new CloudJobError("invalid_email");
  }
  if (typeof email === "string") {
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new CloudJobError("invalid_email");
    }
  }
  if (plan === "credits") {
    if (typeof usd !== "number") throw new CloudJobError("invalid_amount");
    const amount = usd;
    if (
      !Number.isFinite(amount) ||
      Math.round(amount * 100) !== amount * 100 ||
      amount < MIN_TOPUP_USD ||
      amount > MAX_TOPUP_USD
    ) {
      throw new CloudJobError("invalid_amount");
    }
    return { plan: "credits", seats: 1, email: email ?? null, usd: amount };
  }
  if (typeof plan !== "string" || !PURCHASABLE_PLANS.includes(plan as PurchasablePlan)) {
    throw new CloudJobError("invalid_plan");
  }
  if (seats === undefined) return { plan: plan as PurchasablePlan, seats: 1, email: email ?? null, usd: null };
  if (!Number.isSafeInteger(seats) || (seats as number) < 1 || (seats as number) > 100) {
    throw new CloudJobError("invalid_seats");
  }
  return { plan: plan as PurchasablePlan, seats: seats as number, email: email ?? null, usd: null };
}

async function matchesInternalToken(request: Request, expected: string): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const presented = /^Bearer\s+(.+)$/iu.exec(header.trim())?.[1]?.trim() ?? "";
  if (!presented) return false;
  const digest = (value: string) =>
    NodeCrypto.createHash("sha256").update(value).digest("hex");
  const a = Buffer.from(digest(presented), "hex");
  const b = Buffer.from(digest(expected), "hex");
  return a.length === b.length && NodeCrypto.timingSafeEqual(a, b);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
    throw new CloudJobError("invalid_request");
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new CloudJobError("invalid_request");
  }
}
