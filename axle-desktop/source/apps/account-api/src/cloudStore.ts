// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import { neon } from "@neondatabase/serverless";

import type {
  CloudJob, CloudJobCreateInput, CloudJobEvent, CloudJobLease, CloudJobResponseInput,
  CloudWorkerLeaseInput, CloudWorkerUpdateInput,
} from "@axle/contracts";
import type { CloudConfig, CloudEnvironment } from "./cloudConfig.ts";

export class CloudJobError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "CloudJobError";
    this.code = code;
  }
}

export type CloudQuery = (operation: string, args: Record<string, unknown>) => Promise<unknown>;

export function createCloudDatabase(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return {
    migrate: async () => {
      await sql.unsafe(NodeFS.readFileSync(new URL("../migrations/003_cloud_jobs.sql", import.meta.url), "utf8"));
    },
    query: async (operation: string, args: Record<string, unknown>): Promise<unknown> => {
      try {
        const rows = await sql`SELECT axle_cloud_command(${operation}, ${JSON.stringify(args)}::JSONB) AS result`;
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
  return NodeCrypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function createCloudJobStore(query: CloudQuery, config: CloudConfig) {
  const environment = (id: string): CloudEnvironment => {
    const value = config.environments.find((item) => item.environmentId === id);
    if (!value) throw new CloudJobError("environment_unavailable");
    return value;
  };
  return {
    async create(userId: string, input: CloudJobCreateInput): Promise<{ job: CloudJob; created: boolean }> {
      const selected = environment(input.environmentId);
      let repository: URL;
      try { repository = new URL(input.repositoryUrl); } catch { throw new CloudJobError("invalid_repository"); }
      if (repository.protocol !== "https:" || repository.username || repository.password ||
        repository.toString() !== input.repositoryUrl ||
        repository.port || repository.search || repository.hash || !selected.repositoryHosts.includes(repository.hostname) ||
        !/^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/u.test(repository.pathname) ||
        repository.pathname.split("/").some((part) => part === "." || part === "..")) {
        throw new CloudJobError("invalid_repository");
      }
      if (!selected.providerModels.some((item) => item.providerInstanceId === input.providerInstanceId && item.model === input.model)) {
        throw new CloudJobError("model_unavailable");
      }
      return await query("create", { userId, jobId: NodeCrypto.randomUUID(), input,
        inputHash: cloudInputHash(input), limits: selected.limits, maxActiveJobsPerUser: config.maxActiveJobsPerUser,
      }) as { job: CloudJob; created: boolean };
    },
    async list(userId: string): Promise<{ jobs: ReadonlyArray<CloudJob> }> {
      return await query("list", { userId }) as { jobs: ReadonlyArray<CloudJob> };
    },
    async get(userId: string, jobId: string): Promise<CloudJob> {
      return await query("get", { userId, jobId }) as CloudJob;
    },
    async events(userId: string, jobId: string, after: number, limit: number): Promise<{ events: ReadonlyArray<CloudJobEvent>; lastSequence: number }> {
      return await query("events", { userId, jobId, after, limit }) as { events: ReadonlyArray<CloudJobEvent>; lastSequence: number };
    },
    async cancel(userId: string, jobId: string): Promise<CloudJob> {
      return await query("cancel", { userId, jobId }) as CloudJob;
    },
    async respond(userId: string, jobId: string, input: CloudJobResponseInput): Promise<CloudJob> {
      return await query("respond", { userId, jobId, ...input, commandId: `user-${input.commandId}`, inputHash: cloudInputHash(input) }) as CloudJob;
    },
    async claim(workerId: string, environmentId: string): Promise<CloudJobLease | null> {
      const selected = environment(environmentId);
      return await query("claim", { workerId, environmentId, leaseToken: NodeCrypto.randomBytes(32).toString("hex"),
        leaseSeconds: config.leaseSeconds, maxConcurrentJobs: selected.maxConcurrentJobs }) as CloudJobLease | null;
    },
    async recover(environmentId: string): Promise<void> {
      environment(environmentId);
      await query("recover", { environmentId });
    },
    async heartbeat(jobId: string, environmentId: string, input: CloudWorkerLeaseInput): Promise<CloudJobLease> {
      environment(environmentId);
      return await query("heartbeat", { jobId, environmentId, ...input, leaseSeconds: config.leaseSeconds }) as CloudJobLease;
    },
    async update(jobId: string, environmentId: string, input: CloudWorkerUpdateInput): Promise<CloudJob> {
      environment(environmentId);
      if (input.state === undefined && input.event === undefined) throw new CloudJobError("invalid_operation");
      if (input.result?.artifacts.some((artifact) => !artifact.storageKey.startsWith(`jobs/${jobId}/`) ||
        artifact.storageKey.split("/").some((part) => part === ".." || part === "." || !part) ||
        /[\\\x00-\x1f]/u.test(artifact.storageKey))) throw new CloudJobError("invalid_result");
      return await query("update", { jobId, environmentId, ...input, commandId: `worker-${input.commandId}`, inputHash: cloudInputHash(input) }) as CloudJob;
    },
  };
}
export type CloudJobStore = ReturnType<typeof createCloudJobStore>;
