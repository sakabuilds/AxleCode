// Axle credits: the unit users spend on the hosted provider.
//
// 100 credits == $0.50, so one credit is worth half a cent ($1 == 200 credits).
// Every user gets 100 free credits per UTC day; top-ups and plan grants add
// more. Credit rates below are each model's real upstream (NVIDIA NIM) rate
// with a ~20% Axle margin on top, converted at 200 credits per dollar.

export const CREDIT_USD = 0.005;
export const CREDITS_PER_DOLLAR = 1 / CREDIT_USD;
export const DAILY_FREE_CREDITS = 100;

/**
 * The models Axle ships on its hosted provider, under their real names.
 * `upstream` is the model id sent to the upstream OpenAI-compatible endpoint
 * (NVIDIA NIM, configured by `UPSTREAM_BASE_URL`); it is deliberately data,
 * not code, so the catalog can be re-pointed without touching the gateway
 * logic.
 *
 * `plan` marks which plans may use the model: `free` models are available to
 * every account, `paid` models require an active paid plan (Pro, Pro+, or
 * Ultra). `tier` is a display/sort hint only.
 *
 * `creditsPerMillion*` prices are per 1,000,000 tokens.
 */
export const AXLE_MODELS = Object.freeze([
  {
    id: "gemma-4",
    label: "Google Gemma 4",
    tier: 1,
    plan: "free",
    upstream: "google/gemma-4-31b-it",
    creditsPerMillionInput: 25,
    creditsPerMillionOutput: 100,
    contextWindow: 128_000,
  },
  {
    id: "muse-glimmer",
    label: "Meta Muse Glimmer",
    tier: 2,
    plan: "free",
    upstream: "meta/muse-glimmer-30b",
    creditsPerMillionInput: 15,
    creditsPerMillionOutput: 60,
    contextWindow: 128_000,
  },
  {
    id: "nemotron-3.5-lightning",
    label: "Nemotron 3.5 Lightning",
    tier: 3,
    plan: "free",
    upstream: "nvidia/nemotron-3.5-lightning-30b-a3b",
    creditsPerMillionInput: 12,
    creditsPerMillionOutput: 50,
    contextWindow: 128_000,
  },
  {
    id: "glm-5.3-flash",
    label: "GLM 5.3 Flash",
    tier: 4,
    plan: "paid",
    upstream: "z-ai/glm-5.3-flash",
    creditsPerMillionInput: 30,
    creditsPerMillionOutput: 120,
    contextWindow: 200_000,
  },
  {
    id: "glm-5.3",
    label: "GLM 5.3",
    tier: 5,
    plan: "paid",
    upstream: "z-ai/glm-5.3",
    creditsPerMillionInput: 150,
    creditsPerMillionOutput: 600,
    contextWindow: 200_000,
  },
  {
    id: "nemotron-3-super",
    label: "Nemotron 3 Super",
    tier: 6,
    plan: "paid",
    upstream: "nvidia/nemotron-3-super-120b-a12b",
    creditsPerMillionInput: 75,
    creditsPerMillionOutput: 300,
    contextWindow: 256_000,
  },
]);

const MODELS_BY_ID = new Map(AXLE_MODELS.map((model) => [model.id, model]));
const MODELS_BY_UPSTREAM = new Map(AXLE_MODELS.map((model) => [model.upstream, model]));

/**
 * Resolve a model the caller named, accepting either the Axle id
 * (`glm-5.3`) or the upstream id (`z-ai/glm-5.3`).
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
      // The desktop picker prefers `name` over a humanized id, so the real
      // model label ("GLM 5.3", not "Glm 5.3") is what the user sees.
      name: model.label,
      object: "model",
      owned_by: "axle",
      axle: {
        label: model.label,
        tier: model.tier,
        plan: model.plan,
        context_window: model.contextWindow,
        credits_per_million_input: model.creditsPerMillionInput,
        credits_per_million_output: model.creditsPerMillionOutput,
      },
    })),
  };
}
