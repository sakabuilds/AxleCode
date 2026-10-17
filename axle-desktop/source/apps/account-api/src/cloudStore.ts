// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import { neon } from "@neondatabase/serverless";

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
import { resolveCloudJobEntitlement } from "./billingConfig.ts";

export class CloudJobError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "CloudJobError";
    this.code = code;
  }
}

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

export function createCloudDatabase(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return {
    migrate: async () => {
      await sql.unsafe(
        NodeFS.readFileSync(new URL("../migrations/003_cloud_jobs.sql", import.meta.url), "utf8"),
      );
      await sql.unsafe(
        NodeFS.readFileSync(new URL("../migrations/004_credits.sql", import.meta.url), "utf8"),
      );
    },
    query: async (operation: string, args: Record<string, unknown>): Promise<unknown> => {
      try {
        const rows =
          await sql`SELECT axle_cloud_command_atomic(${operation}, ${JSON.stringify(args)}::JSONB) AS result`;
        return rows[0]?.result;
      } catch (error) {
        if (error instanceof Error && /^AXLE_CLOUD:[a-z_]+$/u.test(error.message)) {
          throw new CloudJobError(error.message.slice("AXLE_CLOUD:".length));
        }
        throw error;
      }
    },
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

export function createCloudJobStore(
  query: CloudQuery,
  config: CloudConfig,
  billing: BillingConfig | null = null,
) {
  const entitlementFor = (userId: string): CloudJobEntitlement | null =>
    billing === null ? null : resolveCloudJobEntitlement(billing, userId);
  const environment = (id: string): CloudEnvironment => {
    const value = config.environments.find((item) => item.environmentId === id);
    if (!value) throw new CloudJobError("environment_unavailable");
    return value;
  };
  return {
    async create(
      userId: string,
      input: CloudJobCreateInput,
    ): Promise<{ job: CloudJob; created: boolean }> {
      const selected = environment(input.environmentId);
      let repository: URL;
      try {
        repository = new URL(input.repositoryUrl);
      } catch {
        throw new CloudJobError("invalid_repository");
      }
      if (
        repository.protocol !== "https:" ||
        repository.username ||
        repository.password ||
        repository.toString() !== input.repositoryUrl ||
        repository.port ||
        repository.search ||
        repository.hash ||
        !selected.repositoryHosts.includes(repository.hostname) ||
        !/^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/u.test(repository.pathname) ||
        repository.pathname.split("/").some((part) => part === "." || part === "..")
      ) {
        throw new CloudJobError("invalid_repository");
      }
      if (
        !selected.providerModels.some(
          (item) =>
            item.providerInstanceId === input.providerInstanceId && item.model === input.model,
        )
      ) {
        throw new CloudJobError("model_unavailable");
      }
      // Plan entitlement and the spend gate are resolved server-side; the client
      // never supplies its plan, balance, or limits.
      const entitlement = entitlementFor(userId);
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
      })) as { job: CloudJob; created: boolean };
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
      const entitlement = entitlementFor(userId);
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
      const entitlement = entitlementFor(userId);
      return (await query("grant", {
        userId,
        entryId: input.entryId,
        amount: input.amount,
        note: input.note ?? null,
        planId: entitlement?.planId ?? "operator",
        monthlyCredits: entitlement?.monthlyCredits ?? 0,
      })) as { planId: string; balance: number };
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
