import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cloudInputHash, createCloudJobStore } from "./cloudStore.ts";
import {
  billingConfigFixture,
  cloudConfigFixture,
  cloudInputFixture,
} from "./cloudTestFixtures.ts";

describe("cloud store request boundaries", () => {
  const query = vi.fn(async () => null);
  const store = createCloudJobStore(query, cloudConfigFixture);
  beforeEach(() => query.mockClear());

  it("binds creation to an authenticated owner, immutable input and operator limits", async () => {
    await store.create("owner-from-auth", cloudInputFixture);
    expect(query).toHaveBeenCalledWith(
      "create",
      expect.objectContaining({
        userId: "owner-from-auth",
        input: cloudInputFixture,
        limits: cloudConfigFixture.environments[0]!.limits,
        maxActiveJobsPerUser: 2,
        inputHash: cloudInputHash(cloudInputFixture),
      }),
    );
  });
  it("keeps manual jobs approval-required and untagged", async () => {
    await store.create("user-a", cloudInputFixture);
    expect(query).toHaveBeenCalledWith(
      "create",
      expect.objectContaining({ runtimeMode: "approval-required", scheduleId: null }),
    );
  });
  it("dispatches scheduled jobs full-access and tagged with the schedule", async () => {
    await store.dispatchScheduled("user-a", cloudInputFixture, "schedule-1");
    expect(query).toHaveBeenCalledWith(
      "create",
      expect.objectContaining({ runtimeMode: "full-access", scheduleId: "schedule-1" }),
    );
  });
  it("lists runs for a schedule under the verified owner", async () => {
    await store.listBySchedule("user-a", "schedule-1");
    expect(query).toHaveBeenCalledWith("list-by-schedule", {
      userId: "user-a",
      scheduleId: "schedule-1",
    });
  });
  it.each([
    "file:///private/repo",
    "ssh://git@github.com/example/repo",
    "https://token@github.com/example/repo",
    "https://github.com:8443/example/repo",
    "https://127.0.0.1/example/repo",
    "https://github.com/example/repo?token=secret",
    "https://github.com/example/../other/repo",
    "https://untrusted.invalid/example/repo",
  ])(
    "rejects unsafe or unconfigured repository %s before touching the queue",
    async (repositoryUrl) => {
      await expect(
        store.create("user-a", { ...cloudInputFixture, repositoryUrl }),
      ).rejects.toMatchObject({ code: "invalid_repository" });
      expect(query).not.toHaveBeenCalled();
    },
  );
  it("rejects models absent from the worker configuration", async () => {
    await expect(
      store.create("user-a", { ...cloudInputFixture, model: "unconfigured" }),
    ).rejects.toMatchObject({ code: "model_unavailable" });
    expect(query).not.toHaveBeenCalled();
  });
  it("generates an unpredictable capability for each claim and applies the pool cap", async () => {
    await store.claim("worker-test", "linux-test");
    await store.claim("worker-test", "linux-test");
    const calls = query.mock.calls as unknown as ReadonlyArray<
      readonly [string, Record<string, unknown>]
    >;
    expect(calls[0]?.[1]).toMatchObject({
      maxConcurrentJobs: 2,
      leaseSeconds: 60,
      leaseToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(calls[0]?.[1].leaseToken).not.toBe(calls[1]?.[1].leaseToken);
  });
  it("rejects result objects outside the job storage namespace", async () => {
    await expect(
      store.update("job-a", "linux-test", {
        workerId: "worker-test",
        leaseToken: "token",
        generation: 1,
        commandId: "finish",
        state: "completed",
        result: {
          sourceRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          artifacts: [
            {
              kind: "diff",
              storageKey: "jobs/job-b/patch.diff",
              sha256: "c".repeat(64),
              sizeBytes: 1,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_result" });
    expect(query).not.toHaveBeenCalled();
  });
  it("hashes reordered objects identically and differing payloads distinctly", () => {
    expect(cloudInputHash({ x: 1, y: { b: 2, a: 3 } })).toBe(
      cloudInputHash({ y: { a: 3, b: 2 }, x: 1 }),
    );
    expect(cloudInputHash({ x: 1 })).not.toBe(cloudInputHash({ x: 2 }));
  });
  it("rejects plans without cloud entitlement before the queue is touched", async () => {
    const gated = createCloudJobStore(query, cloudConfigFixture, {
      plans: [{ planId: "off", cloudJobsEnabled: false, monthlyCredits: 0, maxConcurrentJobs: 1 }],
      defaultPlanId: "off",
      creditsPerMinute: 3,
    });
    await expect(gated.create("user-a", cloudInputFixture)).rejects.toMatchObject({
      code: "cloud_not_entitled",
    });
    expect(query).not.toHaveBeenCalledWith("create", expect.anything());
  });
  it("lets an active paid subscription outrank the default plan", async () => {
    const subscriptionQuery = vi.fn(async (operation: string) =>
      operation === "subscription-get" ? { planId: "pro", status: "active" } : null,
    );
    const gated = createCloudJobStore(subscriptionQuery, cloudConfigFixture, {
      plans: [
        { planId: "free", cloudJobsEnabled: false, monthlyCredits: 0, maxConcurrentJobs: 1 },
        { planId: "pro", cloudJobsEnabled: true, monthlyCredits: 300, maxConcurrentJobs: 2 },
      ],
      defaultPlanId: "free",
      creditsPerMinute: 3,
    });
    await gated.create("user-b", cloudInputFixture);
    expect(subscriptionQuery).toHaveBeenCalledWith("subscription-get", { userId: "user-b" });
    expect(subscriptionQuery).toHaveBeenCalledWith(
      "create",
      expect.objectContaining({
        planId: "pro",
        monthlyCredits: 300,
        maxActiveJobsPerUser: 2,
      }),
    );
  });
  it("ignores stale subscriptions and unknown plan ids", async () => {
    const cases = [
      { planId: "pro", status: "canceled" },
      { planId: "enterprise", status: "active" },
      { planId: 42, status: "active" },
    ];
    for (const subscription of cases) {
      const subscriptionQuery = vi.fn(async (operation: string) =>
        operation === "subscription-get" ? subscription : null,
      );
      const gated = createCloudJobStore(subscriptionQuery, cloudConfigFixture, {
        plans: [
          { planId: "free", cloudJobsEnabled: false, monthlyCredits: 0, maxConcurrentJobs: 1 },
          { planId: "pro", cloudJobsEnabled: true, monthlyCredits: 300, maxConcurrentJobs: 2 },
        ],
        defaultPlanId: "free",
        creditsPerMinute: 3,
      });
      await expect(gated.create("user-b", cloudInputFixture)).rejects.toMatchObject({
        code: "cloud_not_entitled",
      });
      expect(subscriptionQuery).not.toHaveBeenCalledWith("create", expect.anything());
    }
  });
  it("prefers operator plan assignments over recorded subscriptions", async () => {
    const subscriptionQuery = vi.fn(async () => ({ planId: "free", status: "active" }));
    const gated = createCloudJobStore(subscriptionQuery, cloudConfigFixture, {
      plans: [
        { planId: "free", cloudJobsEnabled: false, monthlyCredits: 0, maxConcurrentJobs: 1 },
        { planId: "pro", cloudJobsEnabled: true, monthlyCredits: 300, maxConcurrentJobs: 2 },
      ],
      defaultPlanId: "free",
      userPlans: { "user-a": "pro" },
      creditsPerMinute: 3,
    });
    await gated.create("user-a", cloudInputFixture);
    expect(subscriptionQuery).not.toHaveBeenCalledWith("subscription-get", expect.anything());
    expect(subscriptionQuery).toHaveBeenCalledWith(
      "create",
      expect.objectContaining({ planId: "pro" }),
    );
  });
  it("forwards webhook events to the billing command and reports application", async () => {
    const subscriptionQuery = vi.fn(async (operation: string) =>
      operation === "webhook-apply" ? { applied: true, granted: true } : null,
    );
    const gated = createCloudJobStore(subscriptionQuery, cloudConfigFixture, billingConfigFixture);
    const outcome = await gated.applyWebhookEvent({
      eventId: "evt_1234567890abcdef",
      eventType: "collection.succeeded",
      userId: "user-b",
      planId: "pro",
      providerReference: "chg_1234567890abcdef",
    });
    expect(subscriptionQuery).toHaveBeenCalledWith("webhook-apply", {
      eventId: "evt_1234567890abcdef",
      eventType: "collection.succeeded",
      userId: "user-b",
      planId: "pro",
      providerReference: "chg_1234567890abcdef",
    });
    expect(outcome).toEqual({ applied: true, granted: true });
  });
  it("resolves plan limits server-side and forwards the reservation rate", async () => {
    const gated = createCloudJobStore(query, cloudConfigFixture, {
      plans: [{ planId: "pro", cloudJobsEnabled: true, monthlyCredits: 300, maxConcurrentJobs: 1 }],
      defaultPlanId: "pro",
      creditsPerMinute: 3,
    });
    await gated.create("user-a", cloudInputFixture);
    expect(query).toHaveBeenCalledWith(
      "create",
      expect.objectContaining({
        maxActiveJobsPerUser: 1,
        planId: "pro",
        monthlyCredits: 300,
        creditsPerMinute: 3,
      }),
    );
  });
  it("validates operator grants before any ledger write", async () => {
    await expect(store.grant("user-a", { entryId: "bad id", amount: 5 })).rejects.toMatchObject({
      code: "invalid_entry_id",
    });
    await expect(store.grant("user-a", { entryId: "top-up-1", amount: 0 })).rejects.toMatchObject({
      code: "invalid_amount",
    });
    await expect(store.grant("user-a", { entryId: "top-up-1", amount: 5.5 })).rejects.toMatchObject(
      { code: "invalid_amount" },
    );
    expect(query).not.toHaveBeenCalled();
    await store.grant("user-a", { entryId: "top-up-1", amount: 25, note: "support" });
    expect(query).toHaveBeenCalledWith("grant", {
      userId: "user-a",
      entryId: "top-up-1",
      amount: 25,
      note: "support",
      planId: "operator",
      monthlyCredits: 0,
    });
  });
});
