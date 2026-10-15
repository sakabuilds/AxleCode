// Axle credits: the unit users spend on the hosted provider.
//
// 100 credits == $0.50, so one credit is worth half a cent. Every user gets
// 100 credits ($0.50) per UTC day for free; top-ups add more. Models are
// priced by "smartness": the larger the model, the more credits each token
// costs, so a Max turn drains a day's free credits far faster than a Nano
// turn.

export const CREDIT_USD = 0.005;
export const DAILY_FREE_CREDITS = 100;

/**
 * The five models Axle ships on its hosted provider. `upstream` is the model
 * id sent to the upstream OpenAI-compatible endpoint; it is deliberately
 * data, not code, so the catalog can be re-pointed without touching the
 * gateway logic.
 *
 * `creditsPerMillion*` prices are per 1,000,000 tokens and rise with the
 * model tier.
 */
export const AXLE_MODELS = Object.freeze([
  {
    id: "axle-nano",
    label: "Axle Nano",
    tier: 1,
    upstream: "openai/gpt-4o-mini",
    creditsPerMillionInput: 40,
    creditsPerMillionOutput: 160,
    contextWindow: 128_000,
  },
  {
    id: "axle-flash",
    label: "Axle Flash",
    tier: 2,
    upstream: "google/gemini-2.0-flash-001",
    creditsPerMillionInput: 60,
    creditsPerMillionOutput: 240,
    contextWindow: 1_000_000,
  },
  {
    id: "axle-core",
    label: "Axle Core",
    tier: 3,
    upstream: "openai/gpt-4o",
    creditsPerMillionInput: 150,
    creditsPerMillionOutput: 600,
    contextWindow: 128_000,
  },
  {
    id: "axle-pro",
    label: "Axle Pro",
    tier: 4,
    upstream: "anthropic/claude-sonnet-4",
    creditsPerMillionInput: 300,
    creditsPerMillionOutput: 1_200,
    contextWindow: 200_000,
  },
  {
    id: "axle-max",
    label: "Axle Max",
    tier: 5,
    upstream: "anthropic/claude-opus-4",
    creditsPerMillionInput: 600,
    creditsPerMillionOutput: 2_400,
    contextWindow: 200_000,
  },
]);

const MODELS_BY_ID = new Map(AXLE_MODELS.map((model) => [model.id, model]));
const MODELS_BY_UPSTREAM = new Map(AXLE_MODELS.map((model) => [model.upstream, model]));

/**
 * Resolve a model the caller named, accepting either the Axle id
 * (`axle-pro`) or the upstream id (`anthropic/claude-sonnet-4`).
 */
export function findModel(id) {
  if (typeof id !== "string") return undefined;
  const trimmed = id.trim();
  return MODELS_BY_ID.get(trimmed) ?? MODELS_BY_UPSTREAM.get(trimmed);
}

function tokenCount(usage, ...keys) {
  for (const key of keys) {
    const value = usage?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/**
 * Credits owed for one upstream `usage` object. Accepts the OpenAI
 * (`prompt_tokens`/`completion_tokens`) and Anthropic (`input_tokens`/
 * `output_tokens`) spellings.
 *
 * Returns `undefined` for an unknown model so the caller can respond 400
 * instead of silently billing the wrong rate.
 */
export function creditsForUsage(modelId, usage) {
  const input = tokenCount(usage, "prompt_tokens", "input_tokens");
  const output = tokenCount(usage, "completion_tokens", "output_tokens");
  return creditsForTokens(modelId, input, output);
}

/**
 * The pricing primitive every path shares: credits owed for a given token
 * count. Returns `undefined` for a model outside the catalog so callers can
 * fail closed rather than bill an unknown rate.
 */
export function creditsForTokens(modelId, inputTokens, outputTokens) {
  const model = findModel(modelId);
  if (!model) return undefined;
  const input = Math.max(0, Math.trunc(Number(inputTokens) || 0));
  const output = Math.max(0, Math.trunc(Number(outputTokens) || 0));
  // tokens * (credits per million tokens) is already a whole number of
  // micro-credits, so the whole calculation stays in exact integer arithmetic
  // and the single division at the end cannot accumulate float noise.
  const microCredits =
    input * model.creditsPerMillionInput + output * model.creditsPerMillionOutput;
  return microCredits / 1_000_000;
}

/** The OpenAI `/v1/models` payload users see in the desktop picker. */
export function publicModelList() {
  return {
    object: "list",
    data: AXLE_MODELS.map((model) => ({
      id: model.id,
      object: "model",
      owned_by: "axle",
      axle: {
        label: model.label,
        tier: model.tier,
        context_window: model.contextWindow,
        credits_per_million_input: model.creditsPerMillionInput,
        credits_per_million_output: model.creditsPerMillionOutput,
      },
    })),
  };
}
