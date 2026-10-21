// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import { createAccountAuthenticator } from "./auth.ts";
import { readBachsConfig } from "./bachsConfig.ts";
import { createBillingRequestHandler } from "./billingHandler.ts";
import { readAccountApiConfig } from "./config.ts";
import { createAccountDatabase } from "./database.ts";
import { readBillingConfig } from "./billingConfig.ts";
import { readCloudConfig } from "./cloudConfig.ts";
import { createCloudRequestHandler } from "./cloudHandler.ts";
import { createCloudRevisionResolver } from "./cloudRevision.ts";
import { createCloudScheduleRunner, type CloudScheduleRunner } from "./cloudScheduleRunner.ts";
import { createCloudScheduleStore } from "./cloudScheduleStore.ts";
import { createCloudDatabase, createCloudJobStore } from "./cloudStore.ts";
import { readGatewayCreditsConfig, type BindingFetch } from "./gateway.ts";
import { createAccountRequestHandler, RequestValidationError } from "./handler.ts";
import { mongoDatabase } from "./mongo.ts";

/**
 * Cloudflare Worker entry for the account API. Reuses the same request
 * handlers as the Node server; the only difference is bindings-supplied
 * configuration.
 *
 * Secrets to configure on the worker: MONGODB_URI, CLERK_ISSUER (and
 * optionally CLERK_JWKS_URL/CLERK_AUDIENCE), AXLE_CLOUD_CONFIG,
 * AXLE_BILLING_CONFIG, AXLE_BACHS_API_KEY, AXLE_PRO_BACHS_PRODUCT_ID,
 * AXLE_PRO_PLUS_BACHS_PRODUCT_ID (or the legacy AXLE_TEAM_BACHS_PRODUCT_ID),
 * AXLE_ULTRA_BACHS_PRODUCT_ID, AXLE_CREDITS_BACHS_PRODUCT_ID,
 * AXLE_BACHS_WEBHOOK_SECRET, AXLE_GATEWAY_INTERNAL_URL, AXLE_INTERNAL_TOKEN.
 * Vars: AXLE_ACCOUNT_CORS_ORIGIN and the optional Bachs URL/corridor settings.
 * Service bindings: AXLE_GATEWAY_SERVICE (axle-gateway) and AXLE_AUTH_SERVICE
 * (axle-auth) — required in production because same-zone worker-to-worker
 * global fetch fails with Cloudflare error 1042.
 */
export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    try {
      const { handle } = await (ready ??= initialize(environmentRecord(env), serviceFetchers(env)));
      return await handle(request);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return json(400, { error: error.message });
      }
      console.error("Account API worker failed", {
        method: request.method,
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : String(error),
      });
      return json(500, { error: "internal_error" });
    }
  },
  /** Cloudflare cron trigger; dispatches cloud schedules while users are offline. */
  async scheduled(
    _controller: unknown,
    env: Record<string, unknown>,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    try {
      const { runner } = await (ready ??= initialize(environmentRecord(env), serviceFetchers(env)));
      if (runner) {
        ctx.waitUntil(
          runner.runDue().catch((error: unknown) => {
            console.error("Cloud schedule runner failed", {
              message: error instanceof Error ? error.message : "unknown",
            });
          }),
        );
      }
    } catch (error) {
      console.error("Cloud schedule trigger failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  },
};

interface WorkerApplication {
  readonly handle: (request: Request) => Promise<Response>;
  readonly runner: CloudScheduleRunner | null;
}

let ready: Promise<WorkerApplication> | null = null;

async function initialize(
  env: Readonly<Record<string, string | undefined>>,
  fetchers: { readonly gateway: BindingFetch | undefined; readonly auth: BindingFetch | undefined },
): Promise<WorkerApplication> {
  const config = readAccountApiConfig(env);
  const database = createAccountDatabase(config);
  const authenticate = createAccountAuthenticator(config, fetchers.auth);
  const cloudConfig = readCloudConfig(env);
  const billingConfig = readBillingConfig(env);
  const bachsConfig = readBachsConfig(env);
  const cloudDatabase = cloudConfig ? createCloudDatabase(mongoDatabase(config.mongodbUri)) : null;
  const cloudStore =
    cloudConfig && cloudDatabase
      ? createCloudJobStore(cloudDatabase.query, cloudConfig, billingConfig)
      : null;
  const cloudScheduleStore =
    cloudConfig && cloudDatabase
      ? createCloudScheduleStore(cloudDatabase.query, cloudConfig, billingConfig)
      : null;
  const cloudRevisions = createCloudRevisionResolver({
    githubToken: env.AXLE_GITHUB_TOKEN ?? null,
  });
  const scheduleRunner =
    cloudStore && cloudScheduleStore
      ? createCloudScheduleRunner({
          schedules: cloudScheduleStore,
          jobs: cloudStore,
          revisions: cloudRevisions,
          log: (message, detail) => console.error(message, detail),
        })
      : null;
  const handleCloudRequest = createCloudRequestHandler({
    config: cloudConfig,
    billing: billingConfig,
    store: cloudStore,
    schedules: cloudScheduleStore,
    revisions: cloudRevisions,
    runSchedule: scheduleRunner
      ? (userId, scheduleId) => scheduleRunner.runNow(userId, scheduleId)
      : null,
    authenticate,
    touchSession: database.touchSession,
    corsOrigin: config.corsOrigin,
  });
  const handleBillingRequest = createBillingRequestHandler({
    bachs: bachsConfig,
    billing: billingConfig,
    store: cloudStore,
    gateway: readGatewayCreditsConfig(env, fetchers.gateway),
    internalToken: env.AXLE_INTERNAL_TOKEN?.trim() || null,
    authenticate,
    touchSession: database.touchSession,
    corsOrigin: config.corsOrigin,
  });
  const handleRequest = createAccountRequestHandler({
    database,
    authenticate,
    corsOrigin: config.corsOrigin,
  });

  await database.migrate();
  await cloudDatabase?.migrate();

  return {
    handle: async (request) =>
      (await handleCloudRequest(request)) ??
      (await handleBillingRequest(request)) ??
      (await handleRequest(request)),
    runner: scheduleRunner,
  };
}

function environmentRecord(
  env: Record<string, unknown>,
): Readonly<Record<string, string | undefined>> {
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}

/**
 * Service bindings arrive on `env` as Fetcher objects, not strings, so they
 * are extracted before `environmentRecord` flattens the string values.
 */
function serviceFetchers(env: Record<string, unknown>): {
  gateway: BindingFetch | undefined;
  auth: BindingFetch | undefined;
} {
  return {
    gateway: fetcherOf(env.AXLE_GATEWAY_SERVICE),
    auth: fetcherOf(env.AXLE_AUTH_SERVICE),
  };
}

function fetcherOf(value: unknown): BindingFetch | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as { fetch?: unknown };
  if (typeof candidate.fetch !== "function") return undefined;
  return (input, init) =>
    (candidate.fetch as (i: string | URL, n?: RequestInit) => Promise<Response>).call(
      value,
      input,
      init,
    );
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
