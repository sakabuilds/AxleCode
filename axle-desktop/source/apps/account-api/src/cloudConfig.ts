import * as Schema from "effect/Schema";

import { CloudEnvironmentId, CloudJobLimits, CloudWorkerClaimInput } from "@axle/contracts";

const Environment = Schema.Struct({
  environmentId: CloudEnvironmentId,
  repositoryHosts: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  providerModels: Schema.Array(Schema.Struct({ providerInstanceId: Schema.String, model: Schema.String }))
    .check(Schema.isMinLength(1)),
  maxConcurrentJobs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  limits: CloudJobLimits,
});
const Worker = Schema.Struct({
  workerId: CloudWorkerClaimInput.fields.workerId,
  token: Schema.String.check(Schema.isMinLength(32), Schema.isMaxLength(256)),
  environmentIds: Schema.Array(CloudEnvironmentId).check(Schema.isMinLength(1)),
});
const Config = Schema.Struct({
  environments: Schema.Array(Environment).check(Schema.isMinLength(1)),
  workers: Schema.Array(Worker).check(Schema.isMinLength(1)),
  allowedUserIds: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isMinLength(1)),
  maxActiveJobsPerUser: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  leaseSeconds: Schema.Int.check(Schema.isBetween({ minimum: 15, maximum: 300 })),
});
const decode = Schema.decodeUnknownSync(Config);
export type CloudConfig = typeof Config.Type;
export type CloudEnvironment = typeof Environment.Type;

/** Explicit operator configuration; no default runner, credentials, paid entitlement, or availability claim. */
export function readCloudConfig(env: Readonly<Record<string, string | undefined>>): CloudConfig | null {
  const raw = env.AXLE_CLOUD_CONFIG;
  if (!raw?.trim()) return null;
  try {
    const config = decode(JSON.parse(raw));
    const environments = new Set(config.environments.map((item) => item.environmentId));
    if (environments.size !== config.environments.length ||
      new Set(config.workers.map((item) => item.workerId)).size !== config.workers.length ||
      new Set(config.workers.map((item) => item.token)).size !== config.workers.length) throw new Error();
    for (const worker of config.workers) {
      if (worker.environmentIds.some((id) => !environments.has(id))) throw new Error();
    }
    for (const environment of config.environments) {
      const limits = environment.limits;
      if (limits.maxDurationSeconds > 86_400 || limits.maxEvents < 10 || limits.maxEvents > 10_000 ||
        limits.cpuMillis > 32_000 || limits.memoryMb > 65_536 || limits.diskMb > 1_048_576 ||
        limits.maxDurationSeconds < config.leaseSeconds) throw new Error();
      if (environment.repositoryHosts.some((host) =>
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(host) || host.endsWith(".localhost"))) throw new Error();
    }
    return config;
  } catch {
    // Never include the invalid configuration: it contains worker credentials.
    throw new Error("AXLE_CLOUD_CONFIG is invalid. See docs/cloud-execution.md.");
  }
}
