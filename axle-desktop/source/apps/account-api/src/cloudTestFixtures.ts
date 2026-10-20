import type { CloudJobCreateInput, CloudScheduleInput } from "@axle/contracts";
import type { BillingConfig } from "./billingConfig.ts";
import type { CloudConfig } from "./cloudConfig.ts";

export const cloudConfigFixture: CloudConfig = {
  environments: [
    {
      environmentId: "linux-test",
      repositoryHosts: ["github.com"],
      providerModels: [{ providerInstanceId: "axle", model: "configured-model" }],
      maxConcurrentJobs: 2,
      limits: {
        maxDurationSeconds: 3600,
        maxEvents: 100,
        cpuMillis: 2000,
        memoryMb: 4096,
        diskMb: 10240,
        networkPolicy: "restricted",
      },
    },
  ],
  workers: [
    {
      workerId: "worker-test",
      token: "test-only-worker-credential-123456789",
      environmentIds: ["linux-test"],
    },
  ],
  allowedUserIds: ["user-a"],
  maxActiveJobsPerUser: 2,
  leaseSeconds: 60,
};
export const billingConfigFixture: BillingConfig = {
  plans: [
    { planId: "free", cloudJobsEnabled: false, monthlyCredits: 0, maxConcurrentJobs: 1 },
    {
      planId: "pro",
      cloudJobsEnabled: true,
      monthlyCredits: 120,
      maxConcurrentJobs: 4,
      gatewayCredits: 2_000,
    },
    {
      planId: "pro-plus",
      cloudJobsEnabled: true,
      monthlyCredits: 300,
      maxConcurrentJobs: 6,
      gatewayCredits: 4_000,
    },
    {
      planId: "ultra",
      cloudJobsEnabled: true,
      monthlyCredits: 1_000,
      maxConcurrentJobs: 8,
      gatewayCredits: 10_000,
    },
  ],
  defaultPlanId: "free",
  userPlans: { "user-a": "pro" },
  creditsPerMinute: 3,
  adminToken: "test-only-admin-credential-1234567890123456",
};
export const cloudInputFixture = {
  commandId: "create-1",
  environmentId: "linux-test",
  repositoryUrl: "https://github.com/example/project.git",
  sourceRevision: "a".repeat(40),
  prompt: "Run the tests",
  providerInstanceId: "axle",
  model: "configured-model",
  runtimeMode: "approval-required",
  interactionMode: "default",
} as CloudJobCreateInput;
export const cloudScheduleFixture = {
  scheduleId: "schedule-1",
  title: "Nightly dependency hygiene",
  prompt: "Bump dependencies and run the tests.",
  environmentId: "linux-test",
  repositoryUrl: "https://github.com/example/project.git",
  sourceRef: "main",
  providerInstanceId: "axle",
  model: "configured-model",
  frequency: "daily",
  intervalHours: 1,
  time: "09:00",
  dayOfWeek: "monday",
  date: "2026-10-11",
  timeZone: "Africa/Lagos",
  active: true,
} as CloudScheduleInput;
