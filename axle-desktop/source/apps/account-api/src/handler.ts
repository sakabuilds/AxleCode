// @effect-diagnostics globalConsole:off
import { AccountAuthenticationError, type AccountPrincipal } from "./auth.ts";
import type { createAccountDatabase } from "./database.ts";
import type { AccountDeviceInput, UsageEventInput } from "./database.ts";
import { AccountDeviceConflictError, AccountSessionAccessError } from "./errors.ts";

type AccountDatabase = ReturnType<typeof createAccountDatabase>;

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

/** HTTP routing is independent of process startup so authorization can be verified without a live service. */
export function createAccountRequestHandler({
  database,
  authenticate,
  corsOrigin,
}: {
  database: AccountDatabase;
  authenticate: (request: Request) => Promise<AccountPrincipal>;
  corsOrigin: string;
}) {
  const corsHeaders = {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, PATCH, POST, OPTIONS",
    "cache-control": "no-store",
  };
  const json = (status: number, value: unknown) =>
    new Response(value === null ? null : JSON.stringify(value), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
    });

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json(204, null);
    if (request.method === "GET" && url.pathname === "/healthz") return json(200, { ok: true });

    try {
      const principal = await authenticate(request);
      // This atomic database check must precede every account read or mutation.
      await database.touchSession(principal);
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > 256 * 1024) {
        throw new RequestValidationError("Request body is too large.");
      }
      if (request.method === "GET" && url.pathname === "/v1/account") {
        return json(200, await database.getAccount(principal.userId));
      }
      if (request.method === "PATCH" && url.pathname === "/v1/account/profile") {
        await database.updateProfile(principal.userId, parseProfileInput(body));
        return json(200, await database.getAccount(principal.userId));
      }
      if (request.method === "POST" && url.pathname === "/v1/account/devices") {
        await database.upsertDevice(principal.userId, parseDeviceInput(body));
        return json(200, await database.getAccount(principal.userId));
      }
      if (request.method === "POST" && url.pathname === "/v1/account/usage-events") {
        const inserted = await database.recordUsageEvent(
          principal.userId,
          parseUsageEventInput(body),
        );
        return json(inserted ? 201 : 200, { accepted: inserted });
      }
      return json(404, { error: "not_found" });
    } catch (error) {
      if (
        error instanceof AccountAuthenticationError ||
        error instanceof AccountSessionAccessError
      ) {
        return json(401, { error: "unauthorized" });
      }
      if (error instanceof AccountDeviceConflictError) {
        return json(409, { error: "device_registration_conflict", message: error.message });
      }
      if (error instanceof RequestValidationError) return json(400, { error: error.message });
      // Database failures can contain credentials. Log only request metadata.
      console.error("Account API request failed", { method: request.method, path: url.pathname });
      return json(500, { error: "internal_error" });
    }
  };
}

function parseJson(body: string): Record<string, unknown> {
  if (!body.trim()) return {};
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    return value as Record<string, unknown>;
  } catch {
    throw new RequestValidationError("Request body must be a JSON object.");
  }
}

function parseProfileInput(body: string) {
  const input = parseJson(body);
  const displayName = optionalText(input.displayName, "displayName", 160);
  const avatarUrl = optionalUrl(input.avatarUrl, "avatarUrl");
  return {
    ...(displayName === undefined ? {} : { displayName }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
  };
}

function parseDeviceInput(body: string): AccountDeviceInput {
  const input = parseJson(body);
  const label = optionalText(input.label, "label", 160);
  const deviceType = optionalText(input.deviceType, "deviceType", 32);
  const platform = optionalText(input.platform, "platform", 64);
  const osVersion = optionalText(input.osVersion, "osVersion", 64);
  const appVersion = optionalText(input.appVersion, "appVersion", 64);
  const browser = optionalText(input.browser, "browser", 128);
  return {
    deviceId: requiredText(input.deviceId, "deviceId", 160),
    ...(label === undefined ? {} : { label }),
    ...(deviceType === undefined ? {} : { deviceType }),
    ...(platform === undefined ? {} : { platform }),
    ...(osVersion === undefined ? {} : { osVersion }),
    ...(appVersion === undefined ? {} : { appVersion }),
    ...(browser === undefined ? {} : { browser }),
  };
}

function parseUsageEventInput(body: string): UsageEventInput {
  const input = parseJson(body);
  const numeric = (key: string): number | undefined => {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new RequestValidationError(`${key} must be a non-negative number.`);
    }
    return value;
  };

  const occurredAt = requiredText(input.occurredAt, "occurredAt", 64);
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new RequestValidationError("occurredAt must be an ISO timestamp.");
  }

  const deviceId = optionalText(input.deviceId, "deviceId", 160);
  const environmentId = optionalText(input.environmentId, "environmentId", 200);
  const threadId = optionalText(input.threadId, "threadId", 200);
  const turnId = optionalText(input.turnId, "turnId", 200);
  const provider = optionalText(input.provider, "provider", 100);
  const providerInstanceId = optionalText(input.providerInstanceId, "providerInstanceId", 160);
  const inputTokens = numeric("inputTokens");
  const cachedInputTokens = numeric("cachedInputTokens");
  const outputTokens = numeric("outputTokens");
  const reasoningOutputTokens = numeric("reasoningOutputTokens");
  const totalTokens = numeric("totalTokens");
  const toolUses = numeric("toolUses");
  const costUsd = numeric("costUsd");

  return {
    eventId: requiredText(input.eventId, "eventId", 200),
    model: requiredText(input.model, "model", 200),
    occurredAt,
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(turnId === undefined ? {} : { turnId }),
    ...(provider === undefined ? {} : { provider }),
    ...(providerInstanceId === undefined ? {} : { providerInstanceId }),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(toolUses === undefined ? {} : { toolUses }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

function requiredText(value: unknown, key: string, maxLength: number): string {
  const text = optionalText(value, key, maxLength);
  if (!text) throw new RequestValidationError(`${key} is required.`);
  return text;
}

function optionalText(value: unknown, key: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new RequestValidationError(`${key} must be text.`);
  const text = value.trim();
  if (text.length > maxLength) throw new RequestValidationError(`${key} is too long.`);
  return text || undefined;
}

function optionalUrl(value: unknown, key: string): string | undefined {
  const text = optionalText(value, key, 2_000);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new RequestValidationError(`${key} must be an HTTPS URL.`);
  }
}
