import { CreditsLedger } from "./ledger.js";
import {
  AXLE_MODELS,
  CREDIT_USD,
  DAILY_FREE_CREDITS,
  creditsForTokens,
  creditsForUsage,
  findModel,
  publicModelList,
} from "./pricing.js";
import { D1CreditsStore } from "./stores/d1.js";
import { MemoryCreditsStore } from "./stores/memory.js";

// Axle's hosted upstream: NVIDIA NIM, reached with the shared key Axle
// installs as the `UPSTREAM_API_KEY` secret.
const DEFAULT_UPSTREAM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const RESERVE_MIN_OUTPUT_TOKENS = 256;
const RESERVE_DEFAULT_OUTPUT_TOKENS = 4096;
const CHARS_PER_TOKEN = 4;

function corsHeaders() {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(value, status = 200, extra = {}) {
  return Response.json(value, { status, headers: { ...corsHeaders(), ...extra } });
}

let devMemoryStore;

/**
 * Pick the credits store: an injected `ledgerStore` (tests), the D1 binding
 * (`CREDITS_DB`), or a module-level in-memory store for local `wrangler dev`
 * where no database is configured.
 */
export function storeFor(env) {
  if (env?.ledgerStore) return env.ledgerStore;
  if (env?.CREDITS_DB) return new D1CreditsStore(env.CREDITS_DB);
  devMemoryStore ??= new MemoryCreditsStore();
  return devMemoryStore;
}

/** `env.now` is a test seam for the daily-grant boundary; production uses the clock. */
function ledgerFor(env) {
  const now = typeof env?.now === "function" ? env.now : () => Date.now();
  return new CreditsLedger(storeFor(env), { now });
}

const AXLE_KEY_PATTERN = /^axl_[0-9a-f]{12}_[A-Za-z0-9_-]+$/u;

/** Both encodings of the token's SHA-256: what the auth worker stores, and the legacy id. */
async function tokenDigests(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = new Uint8Array(digest);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64url = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return { base64url, hex };
}

/**
 * Identity for a request.
 *
 * An Axle-issued key (`axl_...`) is resolved against the account database, so
 * its balance follows the user's account and a revocation takes effect on the
 * very next request. Any other bearer token is hashed into a stable id, which
 * is what self-hosted deployments and older clients still use — the raw token
 * never touches storage either way.
 */
export async function resolveUserId(request, env, ctx) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) return undefined;
  const digests = await tokenDigests(token);
  if (AXLE_KEY_PATTERN.test(token) && env?.ACCOUNTS_DB?.prepare) {
    const owner = await env.ACCOUNTS_DB.prepare(
      "SELECT key_id, user_id, revoked_at FROM axle_api_keys WHERE token_hash = ?1",
    )
      .bind(digests.base64url)
      .first();
    // A revoked or unknown Axle key must fail closed rather than fall through
    // to the hash, or revoking a key would not actually stop it being used.
    if (!owner || owner.revoked_at) return undefined;
    ctx?.waitUntil?.(
      env.ACCOUNTS_DB.prepare("UPDATE axle_api_keys SET last_used_at = ?1 WHERE key_id = ?2")
        .bind(new Date().toISOString(), owner.key_id)
        .run()
        .catch(() => undefined),
    );
    return owner.user_id;
  }
  return digests.hex.slice(0, 32);
}

function upstreamConfig(env) {
  return {
    baseUrl: (env?.UPSTREAM_BASE_URL || DEFAULT_UPSTREAM_BASE_URL).replace(/\/+$/u, ""),
    apiKey: env?.UPSTREAM_API_KEY || env?.OPENROUTER_API_KEY || "",
  };
}

/**
 * Plan access for paid models. The account API is the source of truth for
 * subscriptions; the gateway caches its answer briefly and fails open on
 * every kind of outage, so a billing-backend problem can never lock a paying
 * user out of the models they pay for.
 */
const PLAN_CACHE_TTL_MS = 5 * 60_000;
const planCache = new Map();

export async function hasPaidPlan(userId, env) {
  const baseUrl = env?.ACCOUNT_API_URL;
  const token = env?.INTERNAL_API_TOKEN;
  if (typeof baseUrl !== "string" || baseUrl.length === 0 || typeof token !== "string" || token.length === 0) {
    return true; // deployments without billing stay open
  }
  const now = Date.now();
  const cached = planCache.get(userId);
  if (cached !== undefined && cached.expiresAt > now) return cached.paid;
  // Same-zone worker-to-worker global fetch fails with error 1042, so the
  // deployed gateway routes through the ACCOUNT_API_SERVICE binding when it
  // is bound; self-hosted deployments fall back to global fetch.
  const accountFetch =
    typeof env?.ACCOUNT_API_SERVICE?.fetch === "function"
      ? (url, init) => env.ACCOUNT_API_SERVICE.fetch(url, init)
      : fetch;
  try {
    const response = await accountFetch(
      `${baseUrl.replace(/\/+$/u, "")}/v1/billing/plan?user_id=${encodeURIComponent(userId)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!response.ok) return true;
    const payload = await response.json();
    const paid = payload?.paid === true;
    if (planCache.size > 4_096) planCache.clear();
    planCache.set(userId, { paid, expiresAt: now + PLAN_CACHE_TTL_MS });
    return paid;
  } catch {
    return true;
  }
}

/** Constant-time bearer-token comparison for the internal credit route. */
async function tokensMatch(presented, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

/**
 * The account API applies purchases and plan grants here after Bachs confirms
 * a payment. `reference` is the payment event id, so a redelivered webhook
 * can never double-credit an account.
 */
async function internalCreditsResponse(request, env) {
  const expected = env?.INTERNAL_API_TOKEN;
  const presented = request.headers.get("authorization") ?? "";
  if (
    typeof expected !== "string" ||
    expected.length === 0 ||
    !(await tokensMatch(presented, `Bearer ${expected}`))
  ) {
    return json({ error: { message: "A valid internal token is required." } }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: "Request body must be JSON." } }, 400);
  }
  const userId = typeof body?.user_id === "string" && body.user_id.length > 0 ? body.user_id : null;
  const amount = Number(body?.amount);
  const bucket = body?.bucket;
  const reference =
    typeof body?.reference === "string" && body.reference.length > 0 && body.reference.length <= 256
      ? body.reference
      : null;
  if (!userId || !Number.isFinite(amount) || amount <= 0 || !bucket || !reference) {
    return json(
      {
        error: {
          message: "user_id, a positive amount, bucket ('paid'|'plan'), and reference are required.",
        },
      },
      400,
    );
  }
  if (bucket !== "paid" && bucket !== "plan") {
    return json({ error: { message: "bucket must be 'paid' or 'plan'." } }, 400);
  }
  const ledger = ledgerFor(env);
  const result =
    bucket === "plan"
      ? await ledger.planCredit(userId, amount, reference)
      : await ledger.credit(userId, amount, { kind: "purchase" }, reference);
  return json({
    object: "axle.internal_credit",
    applied: result.applied,
    balance: result.balance,
  });
}

function messageText(body) {
  let characters = 0;
  for (const message of body?.messages ?? []) {
    if (typeof message?.content === "string") characters += message.content.length;
  }
  return characters;
}

/**
 * Upper bound on what a request could cost, charged before the upstream call
 * so a streamed response can never be free. The difference between this and
 * the real usage is refunded once the upstream reports it.
 */
export function reserveCredits(modelId, body) {
  const model = findModel(modelId);
  if (!model) return undefined;
  const inputTokens = Math.ceil(messageText(body) / CHARS_PER_TOKEN) + 64;
  const requested = Number(body?.max_tokens ?? body?.max_completion_tokens);
  const outputTokens = Number.isFinite(requested) && requested > 0
    ? requested
    : RESERVE_DEFAULT_OUTPUT_TOKENS;
  return creditsForTokens(
    model.id,
    inputTokens,
    Math.max(outputTokens, RESERVE_MIN_OUTPUT_TOKENS),
  );
}

/** Reconcile a reservation against the usage the upstream actually reported. */
async function settle(ledger, userId, model, reserved, usage, meta) {
  const reported = creditsForUsage(model.id, usage);
  const owed = typeof reported === "number" ? reported : reserved;
  const delta = owed - reserved;
  if (delta < 0) {
    await ledger.credit(userId, -delta, { ...meta, kind: "refund" });
    return { actual: owed, refunded: -delta, balance: await ledger.balance(userId) };
  }
  if (delta > 0) {
    await ledger.charge(userId, delta, { ...meta, kind: "settle" });
  }
  return { actual: owed, refunded: 0, balance: await ledger.balance(userId) };
}

/**
 * Scan an SSE body for the trailing `usage` object the upstream emits when
 * `stream_options.include_usage` is set, without buffering the response.
 */
export function usageScanner(onUsage, onEnd = () => {}) {
  const decoder = new TextDecoder();
  let buffer = "";
  const inspect = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.usage) onUsage(parsed.usage);
    } catch {
      // A partial or non-JSON data line is not our concern.
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) inspect(line);
    },
    flush() {
      inspect(buffer);
      onEnd();
    },
  });
}

function schedule(work, ctx) {
  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(work);
  else void work.catch(() => undefined);
}

async function modelsResponse() {
  return json(publicModelList());
}

async function creditsResponse(ledger, userId) {
  const { balance, freeBalance, planBalance, paidBalance } = await ledger.ensureDailyGrant(userId);
  return json({
    object: "axle.credits",
    credits: balance,
    free_credits: freeBalance,
    plan_credits: planBalance,
    paid_credits: paidBalance,
    credit_usd: CREDIT_USD,
    daily_free_credits: DAILY_FREE_CREDITS,
    balance_usd: Number((balance * CREDIT_USD).toFixed(4)),
  });
}

/**
 * The account's recent ledger, newest first. Powers the desktop usage view, so
 * it reports the same numbers the balance does rather than re-deriving them.
 */
async function usageResponse(ledger, userId, limit) {
  const entries = await ledger.history(userId, limit);
  return json({
    object: "axle.usage",
    credit_usd: CREDIT_USD,
    entries: entries.map((entry) => ({
      kind: entry.kind,
      credits: round6(entry.amount),
      balance_after: round6(entry.balanceAfter),
      model: typeof entry.meta?.model === "string" ? entry.meta.model : null,
      created_at: entry.createdAt,
    })),
  });
}

function round6(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

async function chatCompletions(request, env, ctx, ledger, userId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: "Request body must be JSON.", type: "invalid_request_error" } }, 400);
  }

  const model = findModel(body?.model);
  if (!model) {
    return json(
      {
        error: {
          message: `Unknown model '${body?.model}'. Available: ${AXLE_MODELS.map((entry) => entry.id).join(", ")}.`,
          type: "invalid_request_error",
        },
      },
      400,
    );
  }

  if (model.plan === "paid" && !(await hasPaidPlan(userId, env))) {
    return json(
      {
        error: {
          message: `${model.label} requires a paid Axle plan. Upgrade to Pro, Pro+, or Ultra to use it.`,
          type: "plan_required",
          code: "axle_plan_required",
          model: model.id,
        },
      },
      403,
    );
  }

  const { balance } = await ledger.ensureDailyGrant(userId);
  const reserve = reserveCredits(model.id, body);
  if (balance < reserve) {
    return json(
      {
        error: {
          message: `Not enough Axle credits: this request reserves ${reserve} and your balance is ${balance}. Top up to continue.`,
          type: "insufficient_credits",
          code: "axle_insufficient_credits",
          required: reserve,
          balance,
        },
      },
      402,
      { "x-axle-credits-remaining": String(balance) },
    );
  }

  const charged = await ledger.charge(userId, reserve, { model: model.id, reserved: true });
  if (!charged.charged) {
    return json(
      {
        error: {
          message: "Not enough Axle credits for this request.",
          type: "insufficient_credits",
          code: "axle_insufficient_credits",
          required: reserve,
          balance: charged.balance,
        },
      },
      402,
      { "x-axle-credits-remaining": String(charged.balance) },
    );
  }

  const upstream = upstreamConfig(env);
  const streaming = body?.stream === true;
  const upstreamBody = { ...body, model: model.upstream };
  if (streaming) {
    upstreamBody.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
  }

  let response;
  try {
    response = await fetch(`${upstream.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(upstream.apiKey ? { Authorization: `Bearer ${upstream.apiKey}` } : {}),
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (error) {
    await settle(ledger, userId, model, reserve, undefined, { model: model.id });
    return json(
      {
        error: {
          message: `Axle could not reach the upstream provider: ${error instanceof Error ? error.message : String(error)}`,
          type: "upstream_error",
        },
      },
      502,
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    await settle(ledger, userId, model, reserve, undefined, { model: model.id });
    return new Response(detail, {
      status: response.status,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  if (!streaming) {
    const payload = await response.json();
    const outcome = await settle(ledger, userId, model, reserve, payload?.usage, {
      model: model.id,
    });
    return json(payload, 200, {
      "x-axle-model": model.id,
      "x-axle-credits-charged": String(outcome.actual),
      "x-axle-credits-remaining": String(outcome.balance),
    });
  }

  let captured;
  let endStream;
  const ended = new Promise((resolve) => {
    endStream = resolve;
  });
  const stream = response.body.pipeThrough(usageScanner((usage) => {
    captured = usage;
  }, endStream));
  schedule(
    ended.then(() => settle(ledger, userId, model, reserve, captured, { model: model.id })),
    ctx,
  );
  return new Response(stream, {
    status: response.status,
    headers: {
      ...corsHeaders(),
      "Content-Type": response.headers.get("content-type") ?? "text/event-stream",
      "x-axle-model": model.id,
      "x-axle-credits-reserved": String(reserve),
    },
  });
}

export async function handleRequest(request, env = {}, ctx = {}) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/v1(?=\/|$)/u, "") || "/";

  if (path === "/healthz") {
    return json({ status: "ok", models: AXLE_MODELS.length });
  }

  if (path === "/models" && request.method === "GET") {
    return modelsResponse();
  }

  if (path === "/credits" && request.method === "GET") {
    const userId = await resolveUserId(request, env, ctx);
    if (!userId) return json({ error: { message: "Missing Axle API key." } }, 401);
    return creditsResponse(ledgerFor(env), userId);
  }

  if (path === "/usage" && request.method === "GET") {
    const userId = await resolveUserId(request, env, ctx);
    if (!userId) return json({ error: { message: "Missing Axle API key." } }, 401);
    return usageResponse(ledgerFor(env), userId, url.searchParams.get("limit"));
  }

  if (path === "/internal/credits" && request.method === "POST") {
    return internalCreditsResponse(request, env);
  }

  if (path === "/chat/completions") {
    if (request.method !== "POST") {
      return json({ error: { message: "Use POST for /v1/chat/completions." } }, 405);
    }
    const userId = await resolveUserId(request, env, ctx);
    if (!userId) {
      return json(
        { error: { message: "Provide your Axle API key as `Authorization: Bearer <key>`.", type: "invalid_request_error" } },
        401,
      );
    }
    return chatCompletions(request, env, ctx, ledgerFor(env), userId);
  }

  return json({ error: { message: `No route for ${request.method} ${url.pathname}.` } }, 404);
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
