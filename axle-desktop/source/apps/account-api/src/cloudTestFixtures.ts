import type { CloudJobCreateInput } from "@axle/contracts";
import type { CloudConfig } from "./cloudConfig.ts";

export const cloudConfigFixture: CloudConfig = {
  environments: [{
    environmentId: "linux-test", repositoryHosts: ["github.com"],
    providerModels: [{ providerInstanceId: "axle", model: "configured-model" }],
    maxConcurrentJobs: 2,
    limits: { maxDurationSeconds: 3600, maxEvents: 100, cpuMillis: 2000, memoryMb: 4096, diskMb: 10240, networkPolicy: "restricted" },
  }],
  workers: [{ workerId: "worker-test", token: "test-only-worker-credential-123456789", environmentIds: ["linux-test"] }],
  allowedUserIds: ["user-a"], maxActiveJobsPerUser: 2, leaseSeconds: 60,
};
export const cloudInputFixture = {
  commandId: "create-1", environmentId: "linux-test", repositoryUrl: "https://github.com/example/project.git",
  sourceRevision: "a".repeat(40), prompt: "Run the tests", providerInstanceId: "axle",
  model: "configured-model", runtimeMode: "approval-required", interactionMode: "default",
} as CloudJobCreateInput;
