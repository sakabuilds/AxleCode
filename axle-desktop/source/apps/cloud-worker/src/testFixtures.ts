// @effect-diagnostics globalDate:off - Contract fixtures stamp wall-clock timestamps for control-plane payloads.
import type { CloudJob, CloudJobCreateInput, CloudJobLease } from "@axle/contracts";

export const TEST_REVISION = "a".repeat(40);

export function cloudJobFixture(overrides: Partial<CloudJob> = {}): CloudJob {
  return {
    jobId: "11111111-2222-4333-8444-555555555555",
    state: "provisioning",
    input: {
      commandId: "create-1",
      environmentId: "linux-standard",
      repositoryUrl: "https://github.com/example/project.git",
      sourceRevision: TEST_REVISION,
      prompt: "Run the tests",
      providerInstanceId: "anthropic-default",
      model: "claude-test-model",
      runtimeMode: "approval-required",
      interactionMode: "default",
    } as CloudJobCreateInput,
    limits: {
      maxDurationSeconds: 3_600,
      maxEvents: 100,
      cpuMillis: 2_000,
      memoryMb: 4_096,
      diskMb: 10_240,
      networkPolicy: "restricted",
    },
    generation: 1,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 1_000).toISOString(),
    deadlineAt: new Date(Date.now() + 3_600_000).toISOString(),
    cancelRequestedAt: null,
    pendingRequest: null,
    result: null,
    failureCode: null,
    lastSequence: 1,
    ...overrides,
  };
}

export function cloudJobLeaseFixture(job: CloudJob = cloudJobFixture()): CloudJobLease {
  return {
    job,
    leaseToken: "lease-".padEnd(40, "0"),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    response: null,
  };
}
