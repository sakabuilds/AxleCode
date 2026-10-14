import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AccountSessionAccessError } from "./errors.ts";
import { createCloudRequestHandler } from "./cloudHandler.ts";
import { CloudJobError, createCloudJobStore } from "./cloudStore.ts";
import { cloudConfigFixture, cloudInputFixture } from "./cloudTestFixtures.ts";

describe("cloud HTTP authorization and routing", () => {
  const query = vi.fn(async (_operation: string, _args: Record<string, unknown>): Promise<unknown> => null);
  const touchSession = vi.fn(async () => {});
  let userId: string;
  let handle: ReturnType<typeof createCloudRequestHandler>;
  beforeEach(() => {
    vi.resetAllMocks(); userId = "user-a";
    handle = createCloudRequestHandler({ config: cloudConfigFixture, store: createCloudJobStore(query, cloudConfigFixture),
      authenticate: async () => ({ userId, sessionId: "session-a" }), touchSession, corsOrigin: "https://app.invalid" });
  });
  const request = (path: string, method = "GET", body?: unknown, token?: string) => handle(new Request(`https://account.invalid${path}`, {
    method, headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  it("returns an explicit disabled response without touching account or worker state", async () => {
    handle = createCloudRequestHandler({ config: null, store: null, authenticate: vi.fn(), touchSession, corsOrigin: "*" });
    expect((await request("/v1/cloud/jobs", "POST", cloudInputFixture))?.status).toBe(503);
    expect(touchSession).not.toHaveBeenCalled();
  });
  it("preserves unrelated account routing", async () => expect(await request("/v1/account")).toBeNull());
  it("rejects revoked sessions before any job read or mutation", async () => {
    touchSession.mockRejectedValue(new AccountSessionAccessError());
    for (const path of ["/v1/cloud/jobs", "/v1/cloud/jobs/job-a/events", "/v1/cloud/jobs/job-a/cancel"]) {
      expect((await request(path, path.endsWith("cancel") ? "POST" : "GET"))?.status).toBe(401);
    }
    expect(query).not.toHaveBeenCalled();
  });
  it("denies new work without an operator grant, while permitting owner cancellation", async () => {
    userId = "not-entitled";
    expect((await request("/v1/cloud/jobs", "POST", cloudInputFixture))?.status).toBe(403);
    await request("/v1/cloud/jobs/job-a/cancel", "POST");
    expect(query).toHaveBeenCalledExactlyOnceWith("cancel", { userId, jobId: "job-a" });
  });
  it("passes only verified ownership to reads and cursor replay", async () => {
    await request("/v1/cloud/jobs/job-a/events?after=12&limit=50");
    expect(query).toHaveBeenCalledWith("events", { userId: "user-a", jobId: "job-a", after: 12, limit: 50 });
    expect((await request("/v1/cloud/jobs/job-a/events?after=-1"))?.status).toBe(400);
  });
  it("does not disclose whether another account owns a job", async () => {
    query.mockRejectedValue(new CloudJobError("not_found"));
    const response = await request("/v1/cloud/jobs/job-b");
    expect(response?.status).toBe(404);
    expect(await response?.json()).toEqual({ error: "not_found" });
  });
  it("rejects user tokens and workers outside their environment grant", async () => {
    expect((await request("/v1/cloud-workers/linux-test/claim", "POST", { workerId: "worker-test" }, "user-jwt"))?.status).toBe(401);
    expect((await request("/v1/cloud-workers/another/claim", "POST", { workerId: "worker-test" }, cloudConfigFixture.workers[0]!.token))?.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
  it("uses trusted worker identity and returns no lease for an empty queue", async () => {
    query.mockResolvedValue(null);
    expect((await request("/v1/cloud-workers/linux-test/claim", "POST", { workerId: "worker-test" }, cloudConfigFixture.workers[0]!.token))?.status).toBe(204);
    expect(query).toHaveBeenCalledWith("claim", expect.objectContaining({ workerId: "worker-test", environmentId: "linux-test" }));
    expect(touchSession).not.toHaveBeenCalled();
  });
  it("maps lease loss to conflict and rejects missing fencing fields", async () => {
    const body = { workerId: "worker-test", leaseToken: "private-capability", generation: 1 };
    query.mockRejectedValue(new CloudJobError("lease_lost"));
    expect((await request("/v1/cloud-workers/linux-test/jobs/job-a/heartbeat", "POST", body, cloudConfigFixture.workers[0]!.token))?.status).toBe(409);
    query.mockClear();
    expect((await request("/v1/cloud-workers/linux-test/jobs/job-a/heartbeat", "POST", { workerId: "worker-test" }, cloudConfigFixture.workers[0]!.token))?.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("requires a full commit and keeps SQL errors and secrets out of responses", async () => {
    expect((await request("/v1/cloud/jobs", "POST", { ...cloudInputFixture, sourceRevision: "main" }))?.status).toBe(400);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockRejectedValue(new Error("postgresql://secret:password@private-host"));
    const response = await request("/v1/cloud/jobs");
    expect(response?.status).toBe(500);
    expect(await response?.json()).toEqual({ error: "internal_error" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("password");
    log.mockRestore();
  });
});
