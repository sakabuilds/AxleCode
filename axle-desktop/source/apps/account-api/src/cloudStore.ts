// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off
import * as NodeCrypto from "node:crypto";
import type { Db } from "mongodb";

import type {
  CloudJob,
  CloudJobCreateInput,
  CloudJobEvent,
  CloudJobLease,
  CloudJobResponseInput,
  CloudWorkerLeaseInput,
  CloudWorkerUpdateInput,
} from "@axle/contracts";
import type { CloudConfig, CloudEnvironment } from "./cloudConfig.ts";
import type { BillingConfig, CloudJobEntitlement } from "./billingConfig.ts";
import { resolveCloudJobEntitlement, resolvePlanEntitlement } from "./billingConfig.ts";
import { CloudJobError } from "./cloudErrors.ts";
import { createCloudQuery } from "./cloudMongo.ts";
import {
  resolveCloudEnvironment,
  validateCloudModel,
  validateCloudRepository,
} from "./cloudTargets.ts";
import { ensureMongoIndexes } from "./mongo.ts";

export { CloudJobError };

export type CloudQuery = (operation: string, args: Record<string, unknown>) => Promise<unknown>;

export interface CreditAccountView {
  readonly planId: string;
  readonly balance: number;
  readonly updatedAt: string;
  /**
   * Resolved server-side from the billing configuration. `null` means the
   * deployment is unmetered (no billing configuration), which clients treat as
   * every feature unlocked.
   */
  readonly entitlements: CloudJobEntitlement | null;
}
export interface CreditLedgerEntryView {
  readonly entryId: number;
  readonly kind: "monthly_grant" | "reservation" | "settlement" | "adjustment";
  readonly amount: number;
  readonly jobId: string | null;
  readonly note: unknown;
  readonly createdAt: string;
}
export interface CreditBillingView {
  readonly account: CreditAccountView;
  readonly entries: ReadonlyArray<CreditLedgerEntryView>;
}

export function createCloudDatabase(db: Db) {
  return {
    // The Mongo binding is stateless schema-on-use: indexes are the only
    // bootstrap step, and creating them is idempotent.
    migrate: async (): Promise<void> => {
      await ensureMongoIndexes(db);
    },
    query: createCloudQuery(db),
  };
}

/** Canonical, order-independent hash also binds command ids to the exact decoded payload. */
export function cloudInputHash(value: unknown): string {
  return NodeCrypto.createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

/**
 * Plan precedence: explicit operator assignment in the billing config, then
 * an active paid subscription recorded from the payment webhook, then the
 * configured default plan. Only a plan id present in the billing config can
 * grant entitlements, so a stale subscription cannot widen access.
 */
export function createCloudEntitlementResolver(
  query: CloudQuery,
  billing: BillingConfig | null,
): (userId: string) => Promise<CloudJobEntitlement | null> {
  if (billing === null) return async () => null;
  return async (userId: string) => {
    if (billing.userPlans?.[userId] !== undefined) {
      return resolveCloudJobEntitlement(billing, userId);
    }
    const subscription = (await query("subscription-get", { userId })) as {
      planId?: unknown;
      status?: unknown;
    } | null;
    if (
      subscription !== null &&
      subscription.status === "active" &&
      typeof subscription.planId === "string" &&
      billing.plans.some((plan) => plan.planId === subscription.planId)
    ) {
      return resolvePlanEntitlement(billing, subscription.planId);
    }
    return resolveCloudJobEntitlement(billing, userId);
  };
}

export function createCloudJobStore(
  query: CloudQuery,
  config: CloudConfig,
  billing: BillingConfig | null = null,
) {
  const entitlementFor = createCloudEntitlementResolver(query, billing);
  const environment = (id: string): CloudEnvironment => resolveCloudEnvironment(config, id);
  /**
   * Plan entitlement and the spend gate are resolved server-side; the client
   * never supplies its plan, balance, or limits.
   */
  const createJob = async (
    userId: string,
    input: CloudJobCreateInput,
    runtimeMode: "approval-required" | "full-access",
    scheduleId: string | null,
  ): Promise<{ job: CloudJob; created: boolean }> => {
    const selected = resolveCloudEnvironment(config, input.environmentId);
    validateCloudRepository(selected, input.repositoryUrl);
    validateCloudModel(selected, input.providerInstanceId, input.model);
    const entitlement = await entitlementFor(userId);
    if (entitlement !== null && !entitlement.cloudJobsEnabled)
      throw new CloudJobError("cloud_not_entitled");
    return (await query("create", {
      userId,
      jobId: NodeCrypto.randomUUID(),
      input,
      inputHash: cloudInputHash(input),
      limits: selected.limits,
      maxActiveJobsPerUser:
        entitlement === null
          ? config.maxActiveJobsPerUser
          : Math.min(config.maxActiveJobsPerUser, entitlement.maxConcurrentJobs),
      planId: entitlement?.planId ?? "operator",
      monthlyCredits: entitlement?.monthlyCredits ?? 0,
      creditsPerMinute: billing?.creditsPerMinute ?? 0,
      runtimeMode,
      scheduleId,
    })) as { job: CloudJob; created: boolean };
  };
  return {
    async create(
      userId: string,
      input: CloudJobCreateInput,
    ): Promise<{ job: CloudJob; created: boolean }> {
      return createJob(userId, input, "approval-required", null);
    },
    /**
     * Dispatches a schedule's run. Scheduled jobs execute full-access so they
     * finish while the user is offline; the mode is chosen here, never by a
     * client-supplied input.
     */
    async dispatchScheduled(
      userId: string,
      input: CloudJobCreateInput,
      scheduleId: string,
    ): Promise<{ job: CloudJob; created: boolean }> {
      return createJob(userId, input, "full-access", scheduleId);
    },
    async listBySchedule(
      userId: string,
      scheduleId: string,
    ): Promise<{ jobs: ReadonlyArray<CloudJob> }> {
      return (await query("list-by-schedule", { userId, scheduleId })) as {
        jobs: ReadonlyArray<CloudJob>;
      };
    },
    async list(userId: string): Promise<{ jobs: ReadonlyArray<CloudJob> }> {
      return (await query("list", { userId })) as { jobs: ReadonlyArray<CloudJob> };
    },
    async get(userId: string, jobId: string): Promise<CloudJob> {
      return (await query("get", { userId, jobId })) as CloudJob;
    },
    async events(
      userId: string,
      jobId: string,
      after: number,
      limit: number,
    ): Promise<{ events: ReadonlyArray<CloudJobEvent>; lastSequence: number }> {
      return (await query("events", { userId, jobId, after, limit })) as {
        events: ReadonlyArray<CloudJobEvent>;
        lastSequence: number;
      };
    },
    async cancel(userId: string, jobId: string): Promise<CloudJob> {
      return (await query("cancel", { userId, jobId })) as CloudJob;
    },
    async respond(userId: string, jobId: string, input: CloudJobResponseInput): Promise<CloudJob> {
      return (await query("respond", {
        userId,
        jobId,
        ...input,
        commandId: `user-${input.commandId}`,
        inputHash: cloudInputHash(input),
      })) as CloudJob;
    },
    async billing(userId: string): Promise<CreditBillingView> {
      const entitlement = await entitlementFor(userId);
      const view = (await query("billing", {
        userId,
        planId: entitlement?.planId ?? "operator",
        monthlyCredits: entitlement?.monthlyCredits ?? 0,
      })) as Omit<CreditBillingView, "account"> & {
        account: Omit<CreditAccountView, "entitlements">;
      };
      return { ...view, account: { ...view.account, entitlements: entitlement } };
    },
    /** Operator grant; the entry id makes retries idempotent. */
    async grant(
      userId: string,
      input: { entryId: string; amount: number; note?: unknown },
    ): Promise<{ planId: string; balance: number }> {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(input.entryId))
        throw new CloudJobError("invalid_entry_id");
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
        throw new CloudJobError("invalid_amount");
      const entitlement = await entitlementFor(userId);
      return (await query("grant", {
        userId,
        entryId: input.entryId,
        amount: input.amount,
        note: input.note ?? null,
        planId: entitlement?.planId ?? "operator",
        monthlyCredits: entitlement?.monthlyCredits ?? 0,
      })) as { planId: string; balance: number };
    },
    /**
     * Records a payment-provider webhook idempotently; `collection.succeeded`
     * with a mapped user and plan activates the paid subscription in the same
     * statement. Duplicates and unrelated event types are acknowledged without
     * further effect.
     */
    async applyWebhookEvent(event: {
      eventId: string;
      eventType: string;
      userId: string | null;
      planId: string | null;
      providerReference: string | null;
    }): Promise<{ applied: boolean; granted: boolean }> {
      return (await query("webhook-apply", event)) as { applied: boolean; granted: boolean };
    },
    async claim(workerId: string, environmentId: string): Promise<CloudJobLease | null> {
      const selected = environment(environmentId);
      return (await query("claim", {
        workerId,
        environmentId,
        leaseToken: NodeCrypto.randomBytes(32).toString("hex"),
        leaseSeconds: config.leaseSeconds,
        maxConcurrentJobs: selected.maxConcurrentJobs,
      })) as CloudJobLease | null;
    },
    async recover(environmentId: string): Promise<void> {
      environment(environmentId);
      await query("recover", { environmentId });
    },
    async heartbeat(
      jobId: string,
      environmentId: string,
      input: CloudWorkerLeaseInput,
    ): Promise<CloudJobLease> {
      environment(environmentId);
      return (await query("heartbeat", {
        jobId,
        environmentId,
        ...input,
        leaseSeconds: config.leaseSeconds,
      })) as CloudJobLease;
    },
    async update(
      jobId: string,
      environmentId: string,
      input: CloudWorkerUpdateInput,
    ): Promise<CloudJob> {
      environment(environmentId);
      if (input.state === undefined && input.event === undefined)
        throw new CloudJobError("invalid_operation");
      if (
        input.result?.artifacts.some(
          (artifact) =>
            !artifact.storageKey.startsWith(`jobs/${jobId}/`) ||
            artifact.storageKey.split("/").some((part) => part === ".." || part === "." || !part) ||
            /[\\\x00-\x1f]/u.test(artifact.storageKey),
        )
      )
        throw new CloudJobError("invalid_result");
      return (await query("update", {
        jobId,
        environmentId,
        ...input,
        commandId: `worker-${input.commandId}`,
        inputHash: cloudInputHash(input),
      })) as CloudJob;
    },
  };
}
export type CloudJobStore = ReturnType<typeof createCloudJobStore>;
