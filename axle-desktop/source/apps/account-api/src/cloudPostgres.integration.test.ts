// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off
import * as NodeCrypto from "node:crypto";
import * as NodeProcess from "node:process";
import { neon } from "@neondatabase/serverless";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import type { CloudJobLease } from "@axle/contracts";
import { createCloudDatabase, createCloudJobStore } from "./cloudStore.ts";
import { cloudConfigFixture, cloudInputFixture } from "./cloudTestFixtures.ts";

// Explicit opt-in only. Never reads DATABASE_URL/NEON_DATABASE_URL or .env.local.
// The target must be an isolated Neon database named axle_cloud_test.
const databaseUrl = NodeProcess.env.AXLE_CLOUD_TEST_DATABASE_URL;
if (databaseUrl && new URL(databaseUrl).pathname !== "/axle_cloud_test") {
  throw new Error("Cloud integration tests require a dedicated database named axle_cloud_test.");
}

describe.skipIf(!databaseUrl)("cloud PostgreSQL transactions (explicit test database)", () => {
  const database = databaseUrl ? createCloudDatabase(databaseUrl) : null;
  const sql = databaseUrl ? neon(databaseUrl) : null;
  const store = database ? createCloudJobStore(database.query, cloudConfigFixture) : null;
  let userId: string;
  beforeAll(async () => { await database!.migrate(); });
  beforeEach(() => { userId = `cloud-test-${NodeCrypto.randomUUID()}`; });
  afterEach(async () => { await sql!`DELETE FROM axle_cloud_jobs WHERE user_id = ${userId}`; });
  const credentials = (lease: CloudJobLease) => ({ workerId: "worker-test", leaseToken: lease.leaseToken, generation: lease.job.generation });
  const create = (commandId = "create-1") => store!.create(userId, { ...cloudInputFixture, commandId });
  const claim = async () => {
    const lease = await store!.claim("worker-test", "linux-test");
    expect(lease).not.toBeNull();
    return lease!;
  };

  it("persists idempotent creation, ownership and replay across fresh store instances", async () => {
    const first = await create();
    expect(first.created).toBe(true);
    const restarted = createCloudJobStore(database!.query, cloudConfigFixture);
    expect(await restarted.create(userId, cloudInputFixture)).toEqual({ job: first.job, created: false });
    await expect(restarted.create(userId, { ...cloudInputFixture, prompt: "Different work" })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(restarted.get("other-user", first.job.jobId)).rejects.toMatchObject({ code: "not_found" });
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
    const leases = await Promise.all([store!.claim("worker-test", "linux-test"), store!.claim("worker-test", "linux-test"), store!.claim("worker-test", "linux-test")]);
    expect(leases.filter(Boolean)).toHaveLength(2);
    expect(new Set(leases.filter((lease) => lease !== null).map((lease) => lease.job.jobId)).size).toBe(2);
  });

  it("round-trips a durable approval and accepts a lost-response completion retry exactly once", async () => {
    await create();
    const lease = await claim();
    const jobId = lease.job.jobId;
    const auth = credentials(lease);
    await store!.update(jobId, "linux-test", { ...auth, commandId: "running", state: "running" });
    await store!.update(jobId, "linux-test", { ...auth, commandId: "ask", state: "waiting_for_approval",
      pendingRequest: { requestId: "approval-1", kind: "approval", payload: { tool: "shell" } } });
    await expect(store!.update(jobId, "linux-test", { ...auth, commandId: "early-resume", state: "running" })).rejects.toMatchObject({ code: "request_not_answered" });
    const response = { commandId: "approve", requestId: "approval-1", payload: { decision: "accept" } };
    await store!.respond(userId, jobId, response);
    await store!.respond(userId, jobId, response);
    expect((await store!.heartbeat(jobId, "linux-test", auth)).response).toEqual({ requestId: "approval-1", payload: response.payload });
    await store!.update(jobId, "linux-test", { ...auth, commandId: "resume", state: "running" });
    await store!.update(jobId, "linux-test", { ...auth, commandId: "finalize", state: "finalizing" });
    const completion = { ...auth, commandId: "complete", state: "completed" as const,
      result: { sourceRevision: cloudInputFixture.sourceRevision, headRevision: "b".repeat(40), artifacts: [] } };
    const completed = await store!.update(jobId, "linux-test", completion);
    expect(await store!.update(jobId, "linux-test", completion)).toEqual(completed);
    await expect(store!.update(jobId, "linux-test", { ...completion, commandId: "new-completion" })).rejects.toMatchObject({ code: "lease_lost" });
    expect((await store!.events(userId, jobId, 0, 100)).events.filter((event) => event.kind === "response")).toHaveLength(1);
    expect(completed.state).toBe("completed");
  });

  it("cancels queued work immediately and prevents finalization after running cancellation", async () => {
    const queued = await create();
    expect((await store!.cancel(userId, queued.job.jobId)).state).toBe("cancelled");
    await create("running-job");
    const lease = await claim();
    const jobId = lease.job.jobId; const auth = credentials(lease);
    await store!.update(jobId, "linux-test", { ...auth, commandId: "run", state: "running" });
    await store!.update(jobId, "linux-test", { ...auth, commandId: "finalize", state: "finalizing" });
    expect((await store!.cancel(userId, jobId)).state).toBe("finalizing");
    expect((await store!.heartbeat(jobId, "linux-test", auth)).job.cancelRequestedAt).not.toBeNull();
    await expect(store!.update(jobId, "linux-test", { ...auth, commandId: "complete", state: "completed",
      result: { sourceRevision: cloudInputFixture.sourceRevision, headRevision: "b".repeat(40), artifacts: [] } })).rejects.toMatchObject({ code: "invalid_transition" });
    expect((await store!.update(jobId, "linux-test", { ...auth, commandId: "stop", state: "cancelled" })).state).toBe("cancelled");
  });

  it("fences expired workers and does not replay commands after a crash", async () => {
    await create(); const lease = await claim(); const jobId = lease.job.jobId; const auth = credentials(lease);
    await store!.update(jobId, "linux-test", { ...auth, commandId: "run", state: "running" });
    await sql!`UPDATE axle_cloud_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = ${jobId}`;
    await expect(store!.heartbeat(jobId, "linux-test", auth)).rejects.toMatchObject({ code: "lease_lost" });
    await store!.recover("linux-test");
    expect((await store!.get(userId, jobId)).state).toBe("interrupted");
    expect(await store!.claim("worker-test", "linux-test")).toBeNull();
    await expect(store!.update(jobId, "linux-test", { ...auth, commandId: "late", event: { text: "late" } })).rejects.toMatchObject({ code: "lease_lost" });
  });

  it("caps every event while reserving room for cancellation and terminal cleanup", async () => {
    const bounded = createCloudJobStore(database!.query, { ...cloudConfigFixture,
      environments: [{ ...cloudConfigFixture.environments[0]!, limits: { ...cloudConfigFixture.environments[0]!.limits, maxEvents: 10 } }] });
    await bounded.create(userId, cloudInputFixture); const lease = await claim(); const jobId = lease.job.jobId; const auth = credentials(lease);
    await bounded.update(jobId, "linux-test", { ...auth, commandId: "run", state: "running" });
    for (let sequence = 0; sequence < 7; sequence++) {
      await bounded.update(jobId, "linux-test", { ...auth, commandId: `event-${sequence}`, event: { sequence } });
    }
    await expect(bounded.update(jobId, "linux-test", { ...auth, commandId: "overflow", event: {} })).rejects.toMatchObject({ code: "event_limit_exceeded" });
    await bounded.update(jobId, "linux-test", { ...auth, commandId: "finalize", state: "finalizing" });
    await bounded.cancel(userId, jobId);
    expect((await bounded.update(jobId, "linux-test", { ...auth, commandId: "stop", state: "cancelled" })).lastSequence).toBe(13);
  });
});
