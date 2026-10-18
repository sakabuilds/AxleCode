// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off globalDate:off
import * as NodeCrypto from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import type { MongoMemoryReplSet } from "mongodb-memory-server";
import { startMongoMemoryReplSet } from "./mongoTestServer.ts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import type { CloudJobLease, CloudJobLimits } from "@axle/contracts";
import { createCloudDatabase, createCloudJobStore } from "./cloudStore.ts";
import {
  billingConfigFixture,
  cloudConfigFixture,
  cloudInputFixture,
} from "./cloudTestFixtures.ts";

// Runs against a real in-memory replica set so multi-document transactions,
// unique-index races, and advisory-style locks are exercised for real.
describe("cloud Mongo transactions (in-memory replica set)", () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let database: ReturnType<typeof createCloudDatabase>;
  let userId: string;

  beforeAll(async () => {
    replSet = await startMongoMemoryReplSet();
    client = new MongoClient(replSet.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  beforeEach(async () => {
    db = client.db("axle");
    await db.dropDatabase();
    database = createCloudDatabase(db);
    await database.migrate();
    userId = `cloud-test-${NodeCrypto.randomUUID()}`;
  });

  const store = () => createCloudJobStore(database.query, cloudConfigFixture);
  const billedStore = (limitOverrides: Partial<CloudJobLimits> = {}) => {
    const base = cloudConfigFixture.environments[0]!;
    const config = {
      ...cloudConfigFixture,
      environments: [
        { ...base, limits: { ...base.limits, maxDurationSeconds: 300, ...limitOverrides } },
      ],
    };
    return createCloudJobStore(database.query, config, billingConfigFixture);
  };
  const credentials = (lease: CloudJobLease) => ({
    workerId: "worker-test",
    leaseToken: lease.leaseToken,
    generation: lease.job.generation,
  });
  const create = (commandId = "create-1", instance = store()) =>
    instance.create(userId, { ...cloudInputFixture, commandId });
  const claim = async (instance = store()) => {
    const lease = await instance.claim("worker-test", "linux-test");
    expect(lease).not.toBeNull();
    return lease!;
  };
  const finish = async (instance: ReturnType<typeof store>, lease: CloudJobLease) => {
    const jobId = lease.job.jobId;
    const auth = credentials(lease);
    await instance.update(jobId, "linux-test", { ...auth, commandId: "run", state: "running" });
    await instance.update(jobId, "linux-test", {
      ...auth,
      commandId: "finalize",
      state: "finalizing",
    });
    return instance.update(jobId, "linux-test", {
      ...auth,
      commandId: "complete",
      state: "completed",
      result: {
        sourceRevision: cloudInputFixture.sourceRevision,
        headRevision: "b".repeat(40),
        artifacts: [],
      },
    });
  };

  it("persists idempotent creation, ownership and replay across fresh store instances", async () => {
    const first = await create();
    expect(first.created).toBe(true);
    const restarted = createCloudJobStore(database.query, cloudConfigFixture);
    expect(await restarted.create(userId, cloudInputFixture)).toEqual({
      job: first.job,
      created: false,
    });
    await expect(
      restarted.create(userId, { ...cloudInputFixture, prompt: "Different work" }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(restarted.get("other-user", first.job.jobId)).rejects.toMatchObject({
      code: "not_found",
    });
    const events = await restarted.events(userId, first.job.jobId, 0, 100);
    expect(events.events.map((event) => event.sequence)).toEqual([1]);
    expect((await restarted.events(userId, first.job.jobId, 1, 100)).events).toEqual([]);
    expect(JSON.stringify(first.job)).not.toContain("leaseToken");
  });

  it("atomically enforces owner admission and environment concurrency limits", async () => {
    const admitted = await Promise.allSettled([create("one"), create("two"), create("three")]);
    expect(admitted.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const rejected = admitted.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "capacity_exceeded" } });
    const leases = await Promise.all([
      store().claim("worker-test", "linux-test"),
      store().claim("worker-test", "linux-test"),
      store().claim("worker-test", "linux-test"),
    ]);
    expect(leases.filter(Boolean)).toHaveLength(2);
    expect(
      new Set(leases.filter((lease) => lease !== null).map((lease) => lease.job.jobId)).size,
    ).toBe(2);
  });

  it("round-trips a durable approval and accepts a lost-response completion retry exactly once", async () => {
    await create();
    const lease = await claim();
    const jobId = lease.job.jobId;
    const auth = credentials(lease);
    await store().update(jobId, "linux-test", { ...auth, commandId: "running", state: "running" });
    await store().update(jobId, "linux-test", {
      ...auth,
      commandId: "ask",
      state: "waiting_for_approval",
      pendingRequest: { requestId: "approval-1", kind: "approval", payload: { tool: "shell" } },
    });
    await expect(
      store().update(jobId, "linux-test", { ...auth, commandId: "early-resume", state: "running" }),
    ).rejects.toMatchObject({ code: "request_not_answered" });
    const response = {
      commandId: "approve",
      requestId: "approval-1",
      payload: { decision: "accept" },
    };
    await store().respond(userId, jobId, response);
    await store().respond(userId, jobId, response);
    expect((await store().heartbeat(jobId, "linux-test", auth)).response).toEqual({
      requestId: "approval-1",
      payload: response.payload,
    });
    await store().update(jobId, "linux-test", { ...auth, commandId: "resume", state: "running" });
    await store().update(jobId, "linux-test", {
      ...auth,
      commandId: "finalize",
      state: "finalizing",
    });
    const completion = {
      ...auth,
      commandId: "complete",
      state: "completed" as const,
      result: {
        sourceRevision: cloudInputFixture.sourceRevision,
        headRevision: "b".repeat(40),
        artifacts: [],
      },
    };
    const completed = await store().update(jobId, "linux-test", completion);
    expect(await store().update(jobId, "linux-test", completion)).toEqual(completed);
    await expect(
      store().update(jobId, "linux-test", { ...completion, commandId: "new-completion" }),
    ).rejects.toMatchObject({ code: "lease_lost" });
    expect(
      (await store().events(userId, jobId, 0, 100)).events.filter(
        (event) => event.kind === "response",
      ),
    ).toHaveLength(1);
    expect(completed.state).toBe("completed");
  });

  it("cancels queued work immediately and prevents finalization after running cancellation", async () => {
    const queued = await create();
    expect((await store().cancel(userId, queued.job.jobId)).state).toBe("cancelled");
    await create("running-job");
    const lease = await claim();
    const jobId = lease.job.jobId;
    const auth = credentials(lease);
    await store().update(jobId, "linux-test", { ...auth, commandId: "run", state: "running" });
    await store().update(jobId, "linux-test", {
      ...auth,
      commandId: "finalize",
      state: "finalizing",
    });
    expect((await store().cancel(userId, jobId)).state).toBe("finalizing");
    expect(
      (await store().heartbeat(jobId, "linux-test", auth)).job.cancelRequestedAt,
    ).not.toBeNull();
    await expect(
      store().update(jobId, "linux-test", {
        ...auth,
        commandId: "complete",
        state: "completed",
        result: {
          sourceRevision: cloudInputFixture.sourceRevision,
          headRevision: "b".repeat(40),
          artifacts: [],
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    expect(
      (
        await store().update(jobId, "linux-test", {
          ...auth,
          commandId: "stop",
          state: "cancelled",
        })
      ).state,
    ).toBe("cancelled");
  });

  it("fences expired workers and does not replay commands after a crash", async () => {
    await create();
    const lease = await claim();
    const jobId = lease.job.jobId;
    const auth = credentials(lease);
    await store().update(jobId, "linux-test", { ...auth, commandId: "run", state: "running" });
    await db
      .collection<{ _id: string }>("axle_cloud_jobs")
      .updateOne({ _id: jobId }, { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    await expect(store().heartbeat(jobId, "linux-test", auth)).rejects.toMatchObject({
      code: "lease_lost",
    });
    await store().recover("linux-test");
    expect((await store().get(userId, jobId)).state).toBe("interrupted");
    expect(await store().claim("worker-test", "linux-test")).toBeNull();
    await expect(
      store().update(jobId, "linux-test", { ...auth, commandId: "late", event: { text: "late" } }),
    ).rejects.toMatchObject({ code: "lease_lost" });
  });

  it("caps every event while reserving room for cancellation and terminal cleanup", async () => {
    const base = cloudConfigFixture.environments[0]!;
    const bounded = createCloudJobStore(database.query, {
      ...cloudConfigFixture,
      environments: [{ ...base, limits: { ...base.limits, maxEvents: 10 } }],
    });
    await bounded.create(userId, cloudInputFixture);
    const lease = await claim(bounded);
    const jobId = lease.job.jobId;
    const auth = credentials(lease);
    await bounded.update(jobId, "linux-test", { ...auth, commandId: "run", state: "running" });
    for (let sequence = 0; sequence < 7; sequence++) {
      await bounded.update(jobId, "linux-test", {
        ...auth,
        commandId: `event-${sequence}`,
        event: { sequence },
      });
    }
    await expect(
      bounded.update(jobId, "linux-test", { ...auth, commandId: "overflow", event: {} }),
    ).rejects.toMatchObject({ code: "event_limit_exceeded" });
    await bounded.update(jobId, "linux-test", {
      ...auth,
      commandId: "finalize",
      state: "finalizing",
    });
    await bounded.cancel(userId, jobId);
    expect(
      (
        await bounded.update(jobId, "linux-test", {
          ...auth,
          commandId: "stop",
          state: "cancelled",
        })
      ).lastSequence,
    ).toBe(13);
  });

  it("reserves credits on creation, charges metered minutes at settlement, and refunds the rest", async () => {
    userId = "user-a";
    const billed = billedStore();
    expect((await billed.billing(userId)).account.balance).toBe(120);
    const created = await billed.create(userId, cloudInputFixture);
    expect(created.created).toBe(true);
    expect((await billed.billing(userId)).account.balance).toBe(105);
    const lease = await claim(billed);
    const completed = await finish(billed, lease);
    expect(completed.state).toBe("completed");
    const settled = await billed.billing(userId);
    expect(settled.account.balance).toBe(117);
    expect(settled.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "monthly_grant", amount: 120 }),
        expect.objectContaining({ kind: "reservation", amount: -15 }),
        expect.objectContaining({ kind: "settlement", amount: 12 }),
      ]),
    );
    expect(
      await db.collection<{ _id: string }>("axle_cloud_jobs").findOne({ _id: lease.job.jobId }),
    ).toMatchObject({
      reservedCredits: 15,
      settledCredits: 3,
    });
  });

  it("releases the full reservation when a queued job is cancelled before any claim", async () => {
    userId = "user-a";
    const billed = billedStore();
    await billed.billing(userId);
    const created = await billed.create(userId, cloudInputFixture);
    await billed.cancel(userId, created.job.jobId);
    const view = await billed.billing(userId);
    expect(view.account.balance).toBe(120);
    expect(view.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "settlement", amount: 15, jobId: created.job.jobId }),
      ]),
    );
  });

  it("denies creation before it can overdraw an unreservable balance", async () => {
    userId = "user-a";
    const billed = billedStore({ maxDurationSeconds: 18_000 });
    await billed.billing(userId);
    await expect(billed.create(userId, cloudInputFixture)).rejects.toMatchObject({
      code: "insufficient_credits",
    });
    expect((await billed.list(userId)).jobs).toEqual([]);
    expect((await billed.billing(userId)).account.balance).toBe(120);
  });

  it("applies payment webhooks idempotently and grants plan credits once per month", async () => {
    const billed = billedStore();
    const first = await billed.applyWebhookEvent({
      eventId: "evt-1",
      eventType: "collection.succeeded",
      userId: "user-web",
      planId: "pro-plus",
      providerReference: "ref-1",
    });
    expect(first).toEqual({ applied: true, granted: true });
    const duplicate = await billed.applyWebhookEvent({
      eventId: "evt-1",
      eventType: "collection.succeeded",
      userId: "user-web",
      planId: "pro-plus",
      providerReference: "ref-1",
    });
    expect(duplicate).toEqual({ applied: false, granted: false });
    const view = await billed.billing("user-web");
    expect(view.account.planId).toBe("pro-plus");
    expect(view.account.balance).toBe(300);
    expect((await billed.billing("user-web")).account.balance).toBe(300);
    expect(view.entries.filter((entry) => entry.kind === "monthly_grant")).toHaveLength(1);
    expect(view.account.entitlements?.monthlyCredits).toBe(300);
    expect((await billed.grant("user-web", { entryId: "topup-1", amount: 50 })).balance).toBe(350);
    expect((await billed.grant("user-web", { entryId: "topup-1", amount: 50 })).balance).toBe(350);
  });
});
