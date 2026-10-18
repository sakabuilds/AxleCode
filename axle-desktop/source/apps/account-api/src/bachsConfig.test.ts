import { describe, expect, it } from "vite-plus/test";
import { readBachsConfig } from "./bachsConfig.ts";

const baseEnv = {
  AXLE_BACHS_API_KEY: "sk_sandbox_test123",
  AXLE_PRO_BACHS_PRODUCT_ID: "prod_pro123",
  AXLE_PRO_PLUS_BACHS_PRODUCT_ID: "prod_proplus123",
};

describe("Bachs configuration", () => {
  it("returns null until the key and the core plan products are present", () => {
    expect(readBachsConfig({})).toBeNull();
    expect(readBachsConfig({ AXLE_BACHS_API_KEY: baseEnv.AXLE_BACHS_API_KEY })).toBeNull();
    expect(readBachsConfig({ ...baseEnv, AXLE_PRO_PLUS_BACHS_PRODUCT_ID: "  " })).toBeNull();
  });
  it("falls back to the legacy Team product id for Pro+", () => {
    const config = readBachsConfig({
      AXLE_BACHS_API_KEY: baseEnv.AXLE_BACHS_API_KEY,
      AXLE_PRO_BACHS_PRODUCT_ID: "prod_pro123",
      AXLE_TEAM_BACHS_PRODUCT_ID: "prod_oldteam123",
    });
    expect(config?.products).toEqual({ pro: "prod_pro123", "pro-plus": "prod_oldteam123" });
  });
  it("derives the API base URL from the key environment", () => {
    expect(readBachsConfig(baseEnv)?.apiUrl).toBe("https://sandbox-api.bachs.io");
    expect(
      readBachsConfig({ ...baseEnv, AXLE_BACHS_API_KEY: "sk_live_abc123" })?.apiUrl,
    ).toBe("https://api.bachs.io");
  });
  it("accepts separator characters that real Bachs keys and secrets use", () => {
    const config = readBachsConfig({
      ...baseEnv,
      AXLE_BACHS_API_KEY: "sk_live_abc-123_def",
      AXLE_BACHS_WEBHOOK_SECRET: "whsec_abc-123_def",
    });
    expect(config?.apiUrl).toBe("https://api.bachs.io");
    expect(config?.webhookSecret).toBe("whsec_abc-123_def");
  });
  it("honours an explicit API URL override and strips trailing slashes", () => {
    expect(
      readBachsConfig({ ...baseEnv, AXLE_BACHS_API_URL: "https://proxy.invalid/bachs/" })?.apiUrl,
    ).toBe("https://proxy.invalid/bachs");
  });
  it("rejects malformed keys, product ids, secrets and non-https URLs", () => {
    expect(() => readBachsConfig({ ...baseEnv, AXLE_BACHS_API_KEY: "pk_test_1" })).toThrow(
      /AXLE_BACHS_API_KEY/u,
    );
    expect(() =>
      readBachsConfig({ ...baseEnv, AXLE_PRO_BACHS_PRODUCT_ID: "price_1" }),
    ).toThrow(/PRODUCT_ID/u);
    expect(() =>
      readBachsConfig({ ...baseEnv, AXLE_ULTRA_BACHS_PRODUCT_ID: "product_1" }),
    ).toThrow(/prod_/u);
    expect(() =>
      readBachsConfig({ ...baseEnv, AXLE_BACHS_WEBHOOK_SECRET: "secret" }),
    ).toThrow(/WEBHOOK_SECRET/u);
    expect(() =>
      readBachsConfig({ ...baseEnv, AXLE_BACHS_SUCCESS_URL: "http://axle.invalid/success" }),
    ).toThrow(/https/u);
  });
  it("carries optional Ultra and credits products only when configured", () => {
    const base = readBachsConfig(baseEnv);
    expect(base?.products).toEqual({ pro: "prod_pro123", "pro-plus": "prod_proplus123" });
    const full = readBachsConfig({
      ...baseEnv,
      AXLE_ULTRA_BACHS_PRODUCT_ID: "prod_ultra123",
      AXLE_CREDITS_BACHS_PRODUCT_ID: "prod_credits123",
    });
    expect(full?.products).toEqual({
      pro: "prod_pro123",
      "pro-plus": "prod_proplus123",
      ultra: "prod_ultra123",
      credits: "prod_credits123",
    });
  });
  it("parses optional redirect and corridor settings", () => {
    const config = readBachsConfig({
      ...baseEnv,
      AXLE_BACHS_WEBHOOK_SECRET: "whsec_abc123",
      AXLE_BACHS_SUCCESS_URL: "https://axle.invalid/payment/success",
      AXLE_BACHS_CANCEL_URL: "https://axle.invalid/payment/cancelled",
      AXLE_BACHS_PAYMENT_METHOD_TYPES: "USD_CARD, NGN_BANK_TRANSFER",
    });
    expect(config).toMatchObject({
      webhookSecret: "whsec_abc123",
      successUrl: "https://axle.invalid/payment/success",
      cancelUrl: "https://axle.invalid/payment/cancelled",
      paymentMethodTypes: ["USD_CARD", "NGN_BANK_TRANSFER"],
    });
    expect(readBachsConfig(baseEnv)?.paymentMethodTypes).toBeNull();
  });
});
