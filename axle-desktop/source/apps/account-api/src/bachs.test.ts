// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  BachsApiError,
  createBachsCheckoutSession,
  readBachsWebhookEvent,
  verifyBachsWebhookSignature,
} from "./bachs.ts";
import type { BachsConfig } from "./bachsConfig.ts";

const secret = "whsec_testsecret123";
const nowSeconds = 1_760_000_000;

function sign(rawBody: string, timestamp = nowSeconds, signingSecret = secret): string {
  return NodeCrypto.createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

const config: BachsConfig = {
  apiKey: "sk_sandbox_test123",
  apiUrl: "https://sandbox-api.bachs.io",
  products: { pro: "prod_pro123", "pro-plus": "prod_proplus123", credits: "prod_credits123" },
  webhookSecret: secret,
  successUrl: null,
  cancelUrl: null,
  paymentMethodTypes: null,
};

describe("Bachs webhook signatures", () => {
  const rawBody = JSON.stringify({ id: "evt_1", type: "collection.succeeded" });
  it("accepts a fresh V2 signature and the legacy header pair", () => {
    expect(
      verifyBachsWebhookSignature({
        rawBody,
        secret,
        timestampHeader: null,
        signatureHeader: null,
        signatureV2Header: `t=${nowSeconds},v1=${sign(rawBody)}`,
        nowSeconds,
      }),
    ).toBe(true);
    expect(
      verifyBachsWebhookSignature({
        rawBody,
        secret,
        timestampHeader: String(nowSeconds),
        signatureHeader: sign(rawBody).toUpperCase(),
        signatureV2Header: null,
        nowSeconds,
      }),
    ).toBe(true);
  });
  it("accepts any listed v1 value so rotated secrets verify during overlap", () => {
    const previous = sign(rawBody, nowSeconds, "whsec_previous123");
    expect(
      verifyBachsWebhookSignature({
        rawBody,
        secret,
        timestampHeader: null,
        signatureHeader: null,
        signatureV2Header: `t=${nowSeconds},v1=${previous},v1=${sign(rawBody)}`,
        nowSeconds,
      }),
    ).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets, stale timestamps and malformed headers", () => {
    const cases = [
      { signatureV2Header: `t=${nowSeconds},v1=${sign(`${rawBody} `)}`, now: nowSeconds },
      {
        signatureV2Header: `t=${nowSeconds},v1=${sign(rawBody, nowSeconds, "whsec_other123")}`,
        now: nowSeconds,
      },
      {
        signatureV2Header: `t=${nowSeconds - 301},v1=${sign(rawBody, nowSeconds - 301)}`,
        now: nowSeconds,
      },
      { signatureV2Header: `v1=${sign(rawBody)}`, now: nowSeconds },
      { signatureV2Header: null, now: nowSeconds },
    ];
    for (const entry of cases) {
      expect(
        verifyBachsWebhookSignature({
          rawBody,
          secret,
          timestampHeader: null,
          signatureHeader: null,
          signatureV2Header: entry.signatureV2Header,
          nowSeconds: entry.now,
        }),
      ).toBe(false);
    }
    expect(
      verifyBachsWebhookSignature({
        rawBody,
        secret,
        timestampHeader: "not-a-number",
        signatureHeader: sign(rawBody),
        signatureV2Header: null,
        nowSeconds,
      }),
    ).toBe(false);
  });
});

describe("Bachs webhook payload parsing", () => {
  it("reads the subscription metadata contract and the provider reference", () => {
    expect(
      readBachsWebhookEvent({
        id: "evt_1234567890abcdef",
        type: "collection.succeeded",
        data: {
          charge_id: "chg_1234567890abcdef",
          metadata: { user_id: "user_2abc", plan_id: "pro" },
        },
      }),
    ).toEqual({
      eventId: "evt_1234567890abcdef",
      eventType: "collection.succeeded",
      userId: "user_2abc",
      planId: "pro",
      providerReference: "chg_1234567890abcdef",
      purpose: null,
      usd: null,
      checkoutId: null,
      reference: null,
    });
  });
  it("reads credit-purchase metadata and the checkout identifiers", () => {
    expect(
      readBachsWebhookEvent({
        id: "evt_credits_1",
        type: "collection.succeeded",
        data: {
          charge_id: "chg_credits_1",
          checkout_id: "chk_credits_1",
          reference: "ORD-1",
          metadata: { user_id: "user_2abc", purpose: "credits", usd: "5.00" },
        },
      }),
    ).toMatchObject({
      purpose: "credits",
      usd: 5,
      checkoutId: "chk_credits_1",
      reference: "ORD-1",
    });
  });
  it("falls back to payment_id and tolerates missing metadata", () => {
    expect(
      readBachsWebhookEvent({
        id: "evt_2",
        type: "collection.failed",
        data: { payment_id: "pay_2", metadata: {} },
      }),
    ).toMatchObject({ userId: null, planId: null, providerReference: "pay_2" });
  });
  it("rejects unusable payloads and sanitizes invalid identifiers", () => {
    expect(readBachsWebhookEvent(null)).toBeNull();
    expect(readBachsWebhookEvent([])).toBeNull();
    expect(readBachsWebhookEvent({ id: "bad id", type: "collection.succeeded" })).toBeNull();
    expect(readBachsWebhookEvent({ id: "evt_3", type: "" })).toBeNull();
    expect(
      readBachsWebhookEvent({
        id: "evt_4",
        type: "collection.succeeded",
        data: { metadata: { user_id: "!invalid!", plan_id: "PRO", usd: "1,000.00" } },
      }),
    ).toMatchObject({ userId: null, planId: null, usd: null });
  });
});

describe("Bachs checkout sessions", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("posts the product cart and metadata and returns the hosted URL", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ checkout_id: "chk_1234567890", checkout_url: "https://checkout.bachs.io/c/abc" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const session = await createBachsCheckoutSession(config, {
      productId: "prod_proplus123",
      planId: "pro-plus",
      userId: "user_2abc",
      email: "buyer@example.com",
      seats: 3,
      amount: null,
    });
    expect(session).toEqual({
      checkoutId: "chk_1234567890",
      checkoutUrl: "https://checkout.bachs.io/c/abc",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox-api.bachs.io/v1/checkout-sessions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_sandbox_test123");
    expect(JSON.parse(String(init.body))).toEqual({
      customer: { email: "buyer@example.com" },
      product_cart: [{ product_id: "prod_proplus123", quantity: 3 }],
      metadata: { user_id: "user_2abc", plan_id: "pro-plus" },
    });
  });
  it("prices credit packs ad hoc and lets the hosted checkout collect the email", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ checkout_id: "chk_c", checkout_url: "https://checkout.bachs.io/c/x" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createBachsCheckoutSession(config, {
      productId: "prod_credits123",
      planId: "credits",
      userId: "user_2abc",
      email: null,
      seats: 1,
      amount: "7.50",
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      product_cart: [
        { product_id: "prod_credits123", quantity: 1, pricing: { price_type: "fixed", amount: "7.50" } },
      ],
      metadata: { user_id: "user_2abc", purpose: "credits", usd: "7.50" },
    });
  });
  it("includes optional redirect and corridor fields when configured", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ checkout_id: "chk_1", checkout_url: "https://checkout.bachs.io/c/x" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createBachsCheckoutSession(
      {
        ...config,
        successUrl: "https://axle.invalid/payment/success",
        cancelUrl: "https://axle.invalid/payment/cancelled",
        paymentMethodTypes: ["USD_CARD"],
      },
      { productId: "prod_pro123", planId: "pro", userId: "user_2abc", email: "buyer@example.com", seats: 1, amount: null },
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      success_url: "https://axle.invalid/payment/success",
      cancel_url: "https://axle.invalid/payment/cancelled",
      payment_method_types: ["USD_CARD"],
    });
  });
  it("maps provider failures to typed errors without leaking bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(
      createBachsCheckoutSession(config, {
        productId: "prod_pro123",
        planId: "pro",
        userId: "user_2abc",
        email: "buyer@example.com",
        seats: 1,
        amount: null,
      }),
    ).rejects.toMatchObject({ name: "BachsApiError", status: 500 });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ checkout_id: "chk_1" }), { status: 200 })),
    );
    await expect(
      createBachsCheckoutSession(config, {
        productId: "prod_pro123",
        planId: "pro",
        userId: "user_2abc",
        email: "buyer@example.com",
        seats: 1,
        amount: null,
      }),
    ).rejects.toBeInstanceOf(BachsApiError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(
      createBachsCheckoutSession(config, {
        productId: "prod_pro123",
        planId: "pro",
        userId: "user_2abc",
        email: "buyer@example.com",
        seats: 1,
        amount: null,
      }),
    ).rejects.toMatchObject({ status: 0 });
  });
});
