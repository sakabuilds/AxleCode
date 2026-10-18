/**
 * Bachs payment configuration for self-serve checkout.
 *
 * Keys are environment-scoped: `sk_sandbox_...` only works against the sandbox
 * deployment and `sk_live_...` only against production, so the API base URL is
 * derived from the key prefix rather than configured separately.
 *
 * Products: the three subscription plans (Pro, Pro+, Ultra) and the one-time
 * credit top-up product. Pro and Pro+ must exist; Ultra and credits stay
 * optional until their products are created, and checkout for a plan without a
 * product reports `billing_not_configured`.
 */

export interface BachsConfig {
  readonly apiKey: string;
  readonly apiUrl: string;
  /** Bachs product ids, keyed by purchasable plan id ("credits" for top-ups). */
  readonly products: Readonly<Record<string, string>>;
  readonly webhookSecret: string | null;
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
  readonly paymentMethodTypes: ReadonlyArray<string> | null;
}

const SANDBOX_API_URL = "https://sandbox-api.bachs.io";
const LIVE_API_URL = "https://api.bachs.io";

/**
 * Null when checkout is not configured; the billing routes then report
 * `billing_not_configured` instead of failing requests unpredictably.
 */
export function readBachsConfig(
  env: Readonly<Record<string, string | undefined>>,
): BachsConfig | null {
  const apiKey = env.AXLE_BACHS_API_KEY?.trim();
  const proProduct = env.AXLE_PRO_BACHS_PRODUCT_ID?.trim();
  // Pro+ reuses the product originally created as Team until it is renamed.
  const proPlusProduct =
    env.AXLE_PRO_PLUS_BACHS_PRODUCT_ID?.trim() ?? env.AXLE_TEAM_BACHS_PRODUCT_ID?.trim();
  if (!apiKey || !proProduct || !proPlusProduct) return null;
  if (!/^sk_(sandbox|live)_[A-Za-z0-9_-]+$/u.test(apiKey)) {
    throw new Error("AXLE_BACHS_API_KEY must be a Bachs secret key (sk_sandbox_... or sk_live_...).");
  }
  if (!/^prod_[A-Za-z0-9]+$/u.test(proProduct) || !/^prod_[A-Za-z0-9]+$/u.test(proPlusProduct)) {
    throw new Error("AXLE_PRO_BACHS_PRODUCT_ID and AXLE_PRO_PLUS_BACHS_PRODUCT_ID must be Bachs product ids.");
  }

  const optionalProduct = (value: string | undefined): string | null => {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    if (!/^prod_[A-Za-z0-9]+$/u.test(trimmed)) {
      throw new Error("Bachs product ids must look like prod_...");
    }
    return trimmed;
  };
  const products: Record<string, string> = { pro: proProduct, "pro-plus": proPlusProduct };
  const ultraProduct = optionalProduct(env.AXLE_ULTRA_BACHS_PRODUCT_ID);
  if (ultraProduct !== null) products.ultra = ultraProduct;
  const creditsProduct = optionalProduct(env.AXLE_CREDITS_BACHS_PRODUCT_ID);
  if (creditsProduct !== null) products.credits = creditsProduct;

  const webhookSecret = env.AXLE_BACHS_WEBHOOK_SECRET?.trim() || null;
  if (webhookSecret !== null && !/^whsec_[A-Za-z0-9_-]+$/u.test(webhookSecret)) {
    throw new Error("AXLE_BACHS_WEBHOOK_SECRET must be a Bachs signing secret (whsec_...).");
  }

  const configuredApiUrl = env.AXLE_BACHS_API_URL?.trim();
  const apiUrl = configuredApiUrl
    ? secureUrl(configuredApiUrl)
    : apiKey.startsWith("sk_sandbox_")
      ? SANDBOX_API_URL
      : LIVE_API_URL;

  const paymentMethods = env.AXLE_BACHS_PAYMENT_METHOD_TYPES?.trim();
  return {
    apiKey,
    apiUrl,
    products,
    webhookSecret,
    successUrl: env.AXLE_BACHS_SUCCESS_URL?.trim() ? secureUrl(env.AXLE_BACHS_SUCCESS_URL.trim()) : null,
    cancelUrl: env.AXLE_BACHS_CANCEL_URL?.trim() ? secureUrl(env.AXLE_BACHS_CANCEL_URL.trim()) : null,
    paymentMethodTypes:
      paymentMethods === undefined || paymentMethods === ""
        ? null
        : paymentMethods.split(",").map((value) => value.trim()).filter(Boolean),
  };
}

function secureUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Bachs URLs must use https.");
  return url.toString().replace(/\/$/u, "");
}
