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

const DEFAULT_UPSTREAM_BASE_URL = "https://openrouter.ai/api/v1";
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

/**
 * Identity for a request. The bearer token is hashed so raw keys never touch
 * storage. When Axle issues signed account tokens, verification slots in here
 * and everything downstream keeps working off the resulting user id.
 */
export async function resolveUserId(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function upstreamConfig(env) {
  return {
    baseUrl: (env?.UPSTREAM_BASE_URL || DEFAULT_UPSTREAM_BASE_URL).replace(/\/+$/u, ""),
    apiKey: env?.UPSTREAM_API_KEY || env?.OPENROUTER_API_KEY || "",
  };
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
  const { balance } = await ledger.ensureDailyGrant(userId);
  return json({
    object: "axle.credits",
    credits: balance,
    credit_usd: CREDIT_USD,
    daily_free_credits: DAILY_FREE_CREDITS,
    balance_usd: Number((balance * CREDIT_USD).toFixed(4)),
  });
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
    const userId = await resolveUserId(request);
    if (!userId) return json({ error: { message: "Missing Axle API key." } }, 401);
    return creditsResponse(ledgerFor(env), userId);
  }

  if (path === "/chat/completions") {
    if (request.method !== "POST") {
      return json({ error: { message: "Use POST for /v1/chat/completions." } }, 405);
    }
    const userId = await resolveUserId(request);
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
