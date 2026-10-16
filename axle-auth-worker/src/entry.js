import { consumeAuthCode } from "./accounts.js";
import baseApp from "./app.js";
import { accountsDb } from "./identity.js";
import { openStateless, sealStateless, verifyClerkJwt } from "./index.js";
import { handleAuthRequest, issueSignInPayload } from "./signin.js";

const ANALYTICS_PREFIX = "analytics:user:";
const ANALYTICS_EVENT_PREFIX = "analytics:event:";
const MAX_TOOL_TEXT_CHARS = 40_000;
const MAX_ARRAY_ITEMS = 80;
const MAX_OBJECT_KEYS = 120;
const MAX_STRING_CHARS = 12_000;
const MAX_JSON_DEPTH = 8;
const ANALYTICS_EVENT_TTL_SECONDS = 60 * 60 * 24 * 120;
const CLERK_BRIDGE_TTL_SECONDS = 3 * 60;

function securityHeaders() {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: securityHeaders() });
}

function requireStore(env) {
  if (!env.PLUGIN_STORE || typeof env.PLUGIN_STORE.get !== "function") {
    throw new Error("PLUGIN_STORE KV binding is not configured.");
  }
  return env.PLUGIN_STORE;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

function isClerkRedirectUri(value) {
  return value === "axle://app/clerk-callback" || value === "axle-dev://app/clerk-callback";
}

async function createClerkBridge(request, env) {
  const body = await request.clone().json().catch(() => null);
  const redirectUri = typeof body?.redirectUri === "string" ? body.redirectUri : "";
  const state = typeof body?.state === "string" ? body.state : "";
  if (!isClerkRedirectUri(redirectUri) || !/^[A-Za-z0-9._~-]{16,160}$/u.test(state)) {
    return json({ error: "Invalid Clerk callback parameters." }, 400);
  }
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Clerk authentication is required." }, 401);
  try {
    const token = authorization.slice(7).trim();
    const identity = await verifyClerkJwt(token, env);
    if (!identity.sessionId) return json({ error: "Clerk session id is missing." }, 401);
    const code = await sealStateless(
      {
        type: "clerk-bridge",
        token,
        sessionId: identity.sessionId,
        userId: identity.userId,
        email: identity.email,
        state,
        expiresAt: Math.floor(Date.now() / 1000) + CLERK_BRIDGE_TTL_SECONDS,
      },
      env,
    );
    return json({ code });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Clerk bridge failed." }, 401);
  }
}

async function exchangeClerkBridge(request, env) {
  const body = await request.clone().json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  const value = await openStateless(code, env);
  if (
    value &&
    value.type === "clerk-bridge" &&
    typeof value.token === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.expiresAt === "number" &&
    value.expiresAt > Math.floor(Date.now() / 1000)
  ) {
    return json({
      token: value.token,
      sessionId: value.sessionId,
      state: value.state,
      user: { id: value.userId, email: value.email },
    });
  }
  // Builds that predate Axle owning this worker only know this endpoint, and the
  // code they hand back now comes from Axle's own sign-in. Redeem it the same
  // way `/v1/auth/exchange` does so those installs still finish signing in.
  const claimed = await consumeAuthCode(accountsDb(env), code).catch(() => null);
  if (claimed) {
    const payload = await issueSignInPayload(env, claimed).catch(() => null);
    if (payload) return json(payload);
  }
  return json({ error: "Clerk bridge code is invalid or expired." }, 401);
}

async function authenticatePluginSession(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (token.length < 20 || token.length > 4096 || /\s/u.test(token)) return null;
  const session = await openStateless(token, env);
  if (
    !session ||
    session.type !== "plugin-session" ||
    typeof session.userId !== "string" ||
    typeof session.expiresAt !== "number" ||
    session.expiresAt <= Math.floor(Date.now() / 1000)
  ) return null;
  return { userId: session.userId, email: typeof session.email === "string" ? session.email : null };
}

function cleanDimension(value, maxLength = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^A-Za-z0-9._:/ @+-]/gu, "").slice(0, maxLength) || null;
}

function emptyAnalytics(userId, now = new Date().toISOString()) {
  return {
    userId,
    signedUpAt: now,
    lastSeenAt: now,
    prompts: 0,
    modelCalls: 0,
    modelRequests: 0,
    agentCalls: 0,
    pluginAuthorizations: 0,
    pluginUses: 0,
    models: {},
    providers: {},
    plugins: {},
    pluginActions: {},
  };
}

function normalizeAnalytics(record, userId) {
  const fallback = emptyAnalytics(userId);
  if (!record || typeof record !== "object") return fallback;
  return {
    ...fallback,
    ...record,
    userId,
    prompts: Number(record.prompts) || 0,
    modelCalls: Number(record.modelCalls) || 0,
    modelRequests: Number(record.modelRequests) || 0,
    agentCalls: Number(record.agentCalls) || 0,
    pluginAuthorizations: Number(record.pluginAuthorizations) || 0,
    pluginUses: Number(record.pluginUses) || 0,
    models: record.models && typeof record.models === "object" ? record.models : {},
    providers: record.providers && typeof record.providers === "object" ? record.providers : {},
    plugins: record.plugins && typeof record.plugins === "object" ? record.plugins : {},
    pluginActions:
      record.pluginActions && typeof record.pluginActions === "object" ? record.pluginActions : {},
  };
}

async function readAnalytics(env, userId) {
  const record = await requireStore(env).get(`${ANALYTICS_PREFIX}${userId}`, "json");
  return normalizeAnalytics(record, userId);
}

async function writeAnalytics(env, record) {
  await requireStore(env).put(`${ANALYTICS_PREFIX}${record.userId}`, JSON.stringify(record));
}

async function touchAnalytics(env, userId) {
  const current = await readAnalytics(env, userId);
  const next = { ...current, lastSeenAt: new Date().toISOString() };
  await writeAnalytics(env, next);
  return next;
}

async function claimAnalyticsEvent(env, userId, eventId) {
  if (!eventId) return true;
  const key = `${ANALYTICS_EVENT_PREFIX}${userId}:${await sha256(eventId)}`;
  const store = requireStore(env);
  if (await store.get(key)) return false;
  await store.put(key, "1", { expirationTtl: ANALYTICS_EVENT_TTL_SECONDS });
  return true;
}

async function recordAnalyticsEvent(env, session, body) {
  const type = body?.type;
  if (
    ![
      "prompt",
      "model_call",
      "model_request",
      "agent_call",
      "plugin_authorization",
      "plugin_use",
    ].includes(type)
  ) {
    return json({ error: "Unsupported analytics event." }, 400);
  }

  const eventId = cleanDimension(body.eventId, 240);
  if (!(await claimAnalyticsEvent(env, session.userId, eventId))) {
    return json({ ok: true, duplicate: true });
  }

  const current = await readAnalytics(env, session.userId);
  const model = cleanDimension(body.model);
  const provider = cleanDimension(body.provider);
  const pluginId = cleanDimension(body.pluginId, 40);
  const action = cleanDimension(body.action, 80);
  const next = {
    ...current,
    lastSeenAt: new Date().toISOString(),
    prompts: current.prompts + (type === "prompt" ? 1 : 0),
    modelCalls: current.modelCalls + (type === "model_call" ? 1 : 0),
    modelRequests: current.modelRequests + (type === "model_request" ? 1 : 0),
    agentCalls: current.agentCalls + (type === "agent_call" ? 1 : 0),
    pluginAuthorizations:
      current.pluginAuthorizations + (type === "plugin_authorization" ? 1 : 0),
    pluginUses: current.pluginUses + (type === "plugin_use" ? 1 : 0),
    models: { ...current.models },
    providers: { ...current.providers },
    plugins: { ...current.plugins },
    pluginActions: { ...current.pluginActions },
  };

  if ((type === "model_call" || type === "model_request" || type === "agent_call") && model) {
    next.models[model] = (Number(next.models[model]) || 0) + 1;
  }
  if ((type === "model_call" || type === "model_request" || type === "agent_call") && provider) {
    next.providers[provider] = (Number(next.providers[provider]) || 0) + 1;
  }
  if ((type === "plugin_authorization" || type === "plugin_use") && pluginId) {
    next.plugins[pluginId] = (Number(next.plugins[pluginId]) || 0) + 1;
  }
  if (type === "plugin_use" && pluginId && action) {
    const key = `${pluginId}:${action}`;
    next.pluginActions[key] = (Number(next.pluginActions[key]) || 0) + 1;
  }

  await writeAnalytics(env, next);
  return json({ ok: true });
}

function adminAuthorized(request, env) {
  const expected = env.ANALYTICS_ADMIN_TOKEN?.trim();
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

async function analyticsReport(request, env) {
  if (!adminAuthorized(request, env)) return json({ error: "Unauthorized" }, 401);
  const store = requireStore(env);
  const users = [];
  let cursor;
  do {
    const page = await store.list({ prefix: ANALYTICS_PREFIX, ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const record = await store.get(key.name, "json");
      const userId = key.name.slice(ANALYTICS_PREFIX.length);
      if (userId) users.push(normalizeAnalytics(record, userId));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const totals = users.reduce(
    (sum, user) => ({
      users: sum.users + 1,
      prompts: sum.prompts + user.prompts,
      modelCalls: sum.modelCalls + user.modelCalls,
      modelRequests: sum.modelRequests + user.modelRequests,
      agentCalls: sum.agentCalls + user.agentCalls,
      pluginAuthorizations: sum.pluginAuthorizations + user.pluginAuthorizations,
      pluginUses: sum.pluginUses + user.pluginUses,
    }),
    {
      users: 0,
      prompts: 0,
      modelCalls: 0,
      modelRequests: 0,
      agentCalls: 0,
      pluginAuthorizations: 0,
      pluginUses: 0,
    },
  );
  users.sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)));
  return json({ totals, users });
}

function boundedValue(value, depth = 0) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING_CHARS
      ? `${value.slice(0, MAX_STRING_CHARS)}… [truncated]`
      : value;
  }
  if (depth >= MAX_JSON_DEPTH) return "[truncated: max depth]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => boundedValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} additional items]`);
    }
    return items;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    const result = {};
    for (const [key, child] of entries) result[key] = boundedValue(child, depth + 1);
    if (Object.keys(value).length > MAX_OBJECT_KEYS) {
      result.__truncated__ = `${Object.keys(value).length - MAX_OBJECT_KEYS} additional keys`;
    }
    return result;
  }
  return String(value);
}

function boundedToolText(text) {
  if (typeof text !== "string") return text;
  try {
    const parsed = JSON.parse(text);
    const shaped = JSON.stringify(boundedValue(parsed));
    return shaped.length > MAX_TOOL_TEXT_CHARS
      ? `${shaped.slice(0, MAX_TOOL_TEXT_CHARS)}… [truncated]`
      : shaped;
  } catch {
    return text.length > MAX_TOOL_TEXT_CHARS
      ? `${text.slice(0, MAX_TOOL_TEXT_CHARS)}… [truncated]`
      : text;
  }
}

async function boundMcpResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;
  const envelope = await response.clone().json().catch(() => null);
  if (!envelope || typeof envelope !== "object") return response;
  const result = envelope.result;
  if (!result || typeof result !== "object") return response;

  const next = { ...envelope, result: { ...result } };
  if (Array.isArray(result.content)) {
    next.result.content = result.content.map((item) =>
      item && typeof item === "object" && item.type === "text"
        ? { ...item, text: boundedToolText(item.text) }
        : boundedValue(item),
    );
  }
  if (result.structuredContent !== undefined) {
    next.result.structuredContent = boundedValue(result.structuredContent);
  }
  return new Response(JSON.stringify(next), {
    status: response.status,
    headers: response.headers,
  });
}

async function readJsonClone(request) {
  return request.clone().json().catch(() => null);
}

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/v1/auth") || url.pathname === "/.well-known/jwks.json") {
    const authResponse = await handleAuthRequest(request, env);
    if (authResponse) return authResponse;
  }

  // Legacy sign-in surface. Builds shipped before Axle owned this worker still
  // point here, so the route stays alive, but it now hands those users straight
  // to the Axle page instead of embedding a third-party sign-in frame.
  if (request.method === "GET" && url.pathname === "/v1/clerk/desktop") {
    const target = new URL(request.url);
    target.pathname = "/v1/auth/desktop";
    return new Response(null, {
      status: 302,
      headers: { ...securityHeaders(), Location: target.toString() },
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/clerk/bridge") {
    return createClerkBridge(request, env);
  }

  if (request.method === "POST" && url.pathname === "/v1/clerk/bridge/exchange") {
    return exchangeClerkBridge(request, env);
  }

  if (request.method === "GET" && url.pathname === "/v1/admin/analytics") {
    return analyticsReport(request, env);
  }

  if (request.method === "POST" && url.pathname === "/v1/analytics/events") {
    const session = await authenticatePluginSession(request, env);
    if (!session) return json({ error: "Plugin session is invalid or expired." }, 401);
    const body = await readJsonClone(request);
    return recordAnalyticsEvent(env, session, body || {});
  }

  if (request.method === "POST" && url.pathname === "/v1/mcp") {
    const [message, session] = await Promise.all([
      readJsonClone(request),
      authenticatePluginSession(request, env),
    ]);
    const response = await baseApp.fetch(request, env);
    if (
      session &&
      message?.method === "tools/call" &&
      message.params?.arguments &&
      typeof message.params.arguments === "object"
    ) {
      const args = message.params.arguments;
      const toolName = message.params.name;
      const pluginId = cleanDimension(args.pluginId, 40);
      const action = cleanDimension(args.action, 80);
      const eventId = cleanDimension(`mcp:${String(message.id ?? crypto.randomUUID())}:${toolName}`, 240);
      if (toolName === "axle_request_plugin_authorization" && pluginId) {
        await recordAnalyticsEvent(env, session, {
          type: "plugin_authorization",
          eventId,
          pluginId,
        }).catch(() => undefined);
      } else if (toolName === "axle_plugin_call" && pluginId) {
        const envelope = await response.clone().json().catch(() => null);
        const failed = envelope?.result?.isError === true;
        if (!failed) {
          await recordAnalyticsEvent(env, session, {
            type: "plugin_use",
            eventId,
            pluginId,
            action,
          }).catch(() => undefined);
        }
      }
    }
    return boundMcpResponse(response);
  }

  const response = await baseApp.fetch(request, env);
  if (request.method === "POST" && url.pathname === "/v1/session" && response.ok) {
    const value = await response.clone().json().catch(() => null);
    if (typeof value?.user?.id === "string") {
      await touchAnalytics(env, value.user.id).catch(() => undefined);
    }
  }
  return response;
}

export default {
  fetch(request, env) {
    return handleRequest(request, env).catch((error) =>
      json({ error: error instanceof Error ? error.message : "Worker request failed." }, 500),
    );
  },
};

export {
  boundedToolText,
  boundedValue,
  normalizeAnalytics,
  recordAnalyticsEvent,
};
