// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeCrypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AccountAuthenticationError, type AccountPrincipal } from "./auth.ts";
import type { BachsConfig } from "./bachsConfig.ts";
import { createBillingRequestHandler } from "./billingHandler.ts";
import type { CloudJobStore } from "./cloudStore.ts";
import { billingConfigFixture } from "./cloudTestFixtures.ts";
import type { GatewayCreditsConfig } from "./gateway.ts";

const secret = "whsec_testsecret123";

const bachsFixture: BachsConfig = {
  apiKey: "sk_sandbox_test123",
  apiUrl: "https://sandbox-api.bachs.io",
  products: { pro: "prod_pro123", "pro-plus": "prod_proplus123", credits: "prod_credits123" },
  webhookSecret: secret,
  successUrl: null,
  cancelUrl: null,
  paymentMethodTypes: null,
};

const gatewayFixture: GatewayCreditsConfig = {
  url: "https://gateway.example.test",
  token: "internal-secret",
};

function signedRequest(
  path: string,
  body: string,
  options?: { readonly timestamp?: number; readonly signingSecret?: string },
): Request {
  const timestamp = options?.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = NodeCrypto.createHmac("sha256", options?.signingSecret ?? secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return new Request(`https://account.invalid${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bachs-signature-v2": `t=${timestamp},v1=${signature}`,
    },
    body,
  });
}

const subscriptionPayload = {
  id: "evt_1234567890abcdef",
  type: "collection.succeeded",
  data: {
    charge_id: "chg_1234567890abcdef",
    metadata: { user_id: "user-b", plan_id: "pro" },
  },
};

const creditsPayload = {
  id: "evt_credits_0001",
  type: "collection.succeeded",
  data: {
    charge_id: "chg_credits_0001",
    checkout_id: "chk_credits_0001",
    metadata: { user_id: "user-b", purpose: "credits", usd: "5.00" },
  },
};

function storeMock(options?: { readonly planFor?: (userId: string) => string }) {
  const applyWebhookEvent = vi.fn(async () => ({ applied: true, granted: true }));
  const billing = vi.fn(async (userId: string) => ({
    account: {
      planId: options?.planFor?.(userId) ?? "free",
      balance: 0,
      updatedAt: "2026-10-17T10:00:00.000Z",
      entitlements: null,
    },
    entries: [],
  }));
  return { applyWebhookEvent, billing, store: { applyWebhookEvent, billing } as unknown as CloudJobStore };
}

describe("billing HTTP routes", () => {
  const touchSession = vi.fn(async () => {});
  let authenticate: ReturnType<typeof vi.fn<(request: Request) => Promise<AccountPrincipal>>>;
  let handle: ReturnType<typeof createBillingRequestHandler>;
  let gatewayCalls: Array<{ readonly url: string; readonly init: RequestInit | undefined }>;
  let bachsCalls: Array<{ readonly url: string; readonly init: RequestInit | undefined }>;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    gatewayCalls = [];
    bachsCalls = [];
    authenticate = vi.fn(async () => ({ userId: "user-a", sessionId: "session-a" }));
    handle = createBillingRequestHandler({
      bachs: bachsFixture,
      billing: billingConfigFixture,
      store: storeMock().store,
      gateway: gatewayFixture,
      internalToken: "internal-secret",
      authenticate,
      touchSession,
      corsOrigin: "https://app.invalid",
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (
    bachs: (call: { url: string; init: RequestInit | undefined }) => Response,
    gateway: (call: { url: string; init: RequestInit | undefined }) => Response = () =>
      Response.json({ applied: true, balance: 0 }),
  ) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = { url: String(input), init };
        if (call.url.startsWith(gatewayFixture.url)) {
          gatewayCalls.push(call);
          return gateway(call);
        }
        bachsCalls.push(call);
        return bachs(call);
      }),
    );
  };

  it("preserves unrelated routing and answers preflight", async () => {
    expect(await handle(new Request("https://account.invalid/v1/account"))).toBeNull();
    const preflight = await handle(
      new Request("https://account.invalid/v1/billing/checkout", { method: "OPTIONS" }),
    );
    expect(preflight?.status).toBe(204);
  });
  it("reports billing_not_configured while Bachs or the store is missing", async () => {
    handle = createBillingRequestHandler({
      bachs: null,
      billing: billingConfigFixture,
      store: storeMock().store,
      gateway: gatewayFixture,
      internalToken: "internal-secret",
      authenticate,
      touchSession,
      corsOrigin: "*",
    });
    const checkout = await handle(
      new Request("https://account.invalid/v1/billing/checkout", { method: "POST", body: "{}" }),
    );
    expect(checkout?.status).toBe(503);
    expect(authenticate).not.toHaveBeenCalled();
    const webhook = await handle(signedRequest("/v1/billing/webhook", "{}"));
    expect(webhook?.status).toBe(503);
  });
  it("refuses webhook deliveries without a configured signing secret", async () => {
    handle = createBillingRequestHandler({
      bachs: { ...bachsFixture, webhookSecret: null },
      billing: billingConfigFixture,
      store: storeMock().store,
      gateway: gatewayFixture,
      internalToken: "internal-secret",
      authenticate,
      touchSession,
      corsOrigin: "*",
    });
    const response = await handle(signedRequest("/v1/billing/webhook", "{}"));
    expect(response?.status).toBe(503);
  });
  it("rejects webhook deliveries with invalid signatures before touching anything", async () => {
    const wrongSecret = await handle(
      signedRequest("/v1/billing/webhook", JSON.stringify(subscriptionPayload), {
        signingSecret: "whsec_attacker123",
      }),
    );
    expect(wrongSecret?.status).toBe(401);
    const original = JSON.stringify(subscriptionPayload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = NodeCrypto.createHmac("sha256", secret)
      .update(`${timestamp}.${original}`)
      .digest("hex");
    const forged = new Request("https://account.invalid/v1/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bachs-signature-v2": `t=${timestamp},v1=${signature}`,
      },
      body: `${original} `,
    });
    expect((await handle(forged))?.status).toBe(401);
    expect(gatewayCalls).toHaveLength(0);
  });
  it("applies a signed subscription payment and grants the plan's gateway credits first", async () => {
    const { store, applyWebhookEvent } = storeMock();
    handle = createBillingRequestHandler({
      bachs: bachsFixture,
      billing: billingConfigFixture,
      store,
      gateway: gatewayFixture,
      internalToken: "internal-secret",
      authenticate,
      touchSession,
      corsOrigin: "*",
    });
    stubFetch(() => Response.json({ received: true }));
    const response = await handle(signedRequest("/v1/billing/webhook", JSON.stringify(subscriptionPayload)));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ received: true });
    expect(gatewayCalls).toHaveLength(1);
    expect(JSON.parse(String(gatewayCalls[0]?.init?.body))).toEqual({
      user_id: "user-b",
      amount: 2_000,
      bucket: "plan",
      reference: "evt_1234567890abcdef",
    });
    expect(applyWebhookEvent).toHaveBeenCalledWith({
      eventId: "evt_1234567890abcdef",
      eventType: "collection.succeeded",
      userId: "user-b",
      planId: "pro",
      providerReference: "chg_1234567890abcdef",
    });
  });
  it("answers 5xx when the gateway cannot be reached so Bachs redelivers", async () => {
    stubFetch(() => Response.json({ received: true }), () => new Response("boom", { status: 500 }));
    const response = await handle(signedRequest("/v1/billing/webhook", JSON.stringify(subscriptionPayload)));
    expect(response?.status).toBe(500);
  });
  it("applies credit purchases from the echoed USD amount", async () => {
    const { store, applyWebhookEvent } = storeMock();
    handle = createBillingRequestHandler({
      bachs: bachsFixture,
      billing: billingConfigFixture,
      store,
      gateway: gatewayFixture,
      internalToken: "internal-secret",
      authenticate,
      touchSession,
      corsOrigin: "*",
    });
    stubFetch(() => Response.json({ received: true }));
    const response = await handle(signedRequest("/v1/billing/webhook", JSON.stringify(creditsPayload)));
    expect(response?.status).toBe(200);
    expect(gatewayCalls).toHaveLength(1);
    expect(JSON.parse(String(gatewayCalls[0]?.init?.body))).toEqual({
      user_id: "user-b",
      amount: 1_000,
      bucket: "paid",
      reference: "evt_credits_0001",
    });
    // The audit receipt carries no plan, so it can never touch subscriptions.
    expect(applyWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, planId: null, eventId: "evt_credits_0001" }),
    );

    // A redelivery of the same event is a safe no-op everywhere.
    stubFetch(
      () => Response.json({ received: true }),
      () => Response.json({ applied: false, balance: 1_000 }),
    );
    const retry = await handle(signedRequest("/v1/billing/webhook", JSON.stringify(creditsPayload)));
    expect(retry?.status).toBe(200);
  });
  it("rejects signed but unusable webhook payloads and wrong methods", async () => {
    const unusable = await handle(
      signedRequest("/v1/billing/webhook", JSON.stringify({ type: "collection.succeeded" })),
    );
    expect(unusable?.status).toBe(400);
    const notJson = await handle(signedRequest("/v1/billing/webhook", "not-json"));
    expect(notJson?.status).toBe(400);
    const wrongMethod = await handle(
      new Request("https://account.invalid/v1/billing/webhook", { method: "GET" }),
    );
    expect(wrongMethod?.status).toBe(404);
    expect(gatewayCalls).toHaveLength(0);
  });
  it("requires an authenticated session for checkout", async () => {
    authenticate.mockRejectedValue(new AccountAuthenticationError());
    const response = await handle(
      new Request("https://account.invalid/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "pro" }),
      }),
    );
    expect(response?.status).toBe(401);
  });
  it("validates the plan, email, seats, and top-up amount before contacting Bachs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cases = [
      { plan: "enterprise" },
      { plan: "team" },
      { plan: "pro", email: "not-an-email" },
      { plan: "pro", seats: 0 },
      { plan: "pro", seats: 101 },
      { plan: "pro", seats: 1.5 },
      { plan: "credits", usd: 4.99 },
      { plan: "credits", usd: 501 },
      { plan: "credits", usd: "5" },
      { plan: "credits" },
    ];
    for (const body of cases) {
      const response = await handle(
        new Request("https://account.invalid/v1/billing/checkout", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      expect(response?.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses to sell plans without a Bachs product or catalog entry", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // ultra exists in the billing catalog but has no Bachs product configured.
    const ultra = await handle(
      new Request("https://account.invalid/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "ultra" }),
      }),
    );
    expect(ultra?.status).toBe(503);
    // credits needs the gateway to be able to deliver the purchase.
    handle = createBillingRequestHandler({
      bachs: bachsFixture,
      billing: billingConfigFixture,
      store: storeMock().store,
      gateway: null,
      internalToken: "internal-secret",
      authenticate,
      touchSession,
      corsOrigin: "*",
    });
    const credits = await handle(
      new Request("https://account.invalid/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "credits", usd: 5 }),
      }),
    );
    expect(credits?.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("creates a subscription checkout bound to the session user", async () => {
    stubFetch(() =>
      Response.json({
        checkout_id: "chk_1234567890",
        checkout_url: "https://checkout.bachs.io/c/abc",
      }),
    );
    const response = await handle(
      new Request("https://account.invalid/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "pro-plus", email: "buyer@example.com" }),
      }),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      checkoutId: "chk_1234567890",
      checkoutUrl: "https://checkout.bachs.io/c/abc",
    });
    expect(bachsCalls[0]?.url).toBe("https://sandbox-api.bachs.io/v1/checkout-sessions");
    expect(JSON.parse(String(bachsCalls[0]?.init?.body))).toMatchObject({
      customer: { email: "buyer@example.com" },
      product_cart: [{ product_id: "prod_proplus123", quantity: 1 }],
      metadata: { user_id: "user-a", plan_id: "pro-plus" },
    });
  });
  it("creates a credit-pack checkout priced ad hoc at the chosen amount", async () => {
    stubFetch(() =>
      Response.json({
        checkout_id: "chk_credits_1",
        checkout_url: "https://checkout.bachs.io/c/credits",
      }),
    );
    const response = await handle(
      new Request("https://account.invalid/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "credits", usd: 7.5 }),
      }),
    );
    expect(response?.status).toBe(200);
    const body = JSON.parse(String(bachsCalls[0]?.init?.body));
    expect(body).toMatchObject({
      product_cart: [
        { product_id: "prod_credits123", quantity: 1, pricing: { price_type: "fixed", amount: "7.50" } },
      ],
      metadata: { user_id: "user-a", purpose: "credits", usd: "7.50" },
    });
    expect(body.customer).toBeUndefined();
  });
  it("maps provider failures to a generic billing error", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    const response = await handle(
      new Request("https://account.invalid/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "pro" }),
      }),
    );
    expect(response?.status).toBe(502);
    expect(await response?.json()).toEqual({ error: "billing_provider_error" });
  });
  it("serves the internal plan lookup for the gateway", async () => {
    const { store } = storeMock({ planFor: (userId) => (userId === "user-a" ? "pro" : "free") });
    handle = createBillingRequestHandler({
      bachs: bachsFixture,
      billing: billingConfigFixture,
      store,
      gateway: gatewayFixture,
      internalToken: "internal-secret",
      authenticate,
      touchSession,
      corsOrigin: "*",
    });
    const ok = await handle(
      new Request("https://account.invalid/v1/billing/plan?user_id=user-a", {
        headers: { authorization: "Bearer internal-secret" },
      }),
    );
    expect(ok?.status).toBe(200);
    expect(await ok?.json()).toMatchObject({ planId: "pro", paid: true });

    const free = await handle(
      new Request("https://account.invalid/v1/billing/plan?user_id=user-b", {
        headers: { authorization: "Bearer internal-secret" },
      }),
    );
    expect(await free?.json()).toMatchObject({ planId: "free", paid: false });

    const wrongToken = await handle(
      new Request("https://account.invalid/v1/billing/plan?user_id=user-a", {
        headers: { authorization: "Bearer attacker" },
      }),
    );
    expect(wrongToken?.status).toBe(401);
    const badId = await handle(
      new Request("https://account.invalid/v1/billing/plan?user_id=%20", {
        headers: { authorization: "Bearer internal-secret" },
      }),
    );
    expect(badId?.status).toBe(400);
  });
  it("refuses the internal plan lookup while the store or token is missing", async () => {
    handle = createBillingRequestHandler({
      bachs: bachsFixture,
      billing: billingConfigFixture,
      store: null,
      gateway: gatewayFixture,
      internalToken: null,
      authenticate,
      touchSession,
      corsOrigin: "*",
    });
    const response = await handle(
      new Request("https://account.invalid/v1/billing/plan?user_id=user-a", {
        headers: { authorization: "Bearer internal-secret" },
      }),
    );
    expect(response?.status).toBe(503);
  });
});
