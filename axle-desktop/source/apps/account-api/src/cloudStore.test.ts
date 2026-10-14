import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cloudInputHash, createCloudJobStore } from "./cloudStore.ts";
import { cloudConfigFixture, cloudInputFixture } from "./cloudTestFixtures.ts";

describe("cloud store request boundaries", () => {
  const query = vi.fn(async () => null);
  const store = createCloudJobStore(query, cloudConfigFixture);
  beforeEach(() => query.mockClear());

  it("binds creation to an authenticated owner, immutable input and operator limits", async () => {
    await store.create("owner-from-auth", cloudInputFixture);
    expect(query).toHaveBeenCalledWith("create", expect.objectContaining({
      userId: "owner-from-auth", input: cloudInputFixture,
      limits: cloudConfigFixture.environments[0]!.limits,
      maxActiveJobsPerUser: 2, inputHash: cloudInputHash(cloudInputFixture),
    }));
  });
  it.each([
    "file:///private/repo", "ssh://git@github.com/example/repo", "https://token@github.com/example/repo",
    "https://github.com:8443/example/repo", "https://127.0.0.1/example/repo", "https://github.com/example/repo?token=secret",
    "https://github.com/example/../other/repo", "https://untrusted.invalid/example/repo",
  ])("rejects unsafe or unconfigured repository %s before touching the queue", async (repositoryUrl) => {
    await expect(store.create("user-a", { ...cloudInputFixture, repositoryUrl })).rejects.toMatchObject({ code: "invalid_repository" });
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects models absent from the worker configuration", async () => {
    await expect(store.create("user-a", { ...cloudInputFixture, model: "unconfigured" })).rejects.toMatchObject({ code: "model_unavailable" });
    expect(query).not.toHaveBeenCalled();
  });
  it("generates an unpredictable capability for each claim and applies the pool cap", async () => {
    await store.claim("worker-test", "linux-test");
    await store.claim("worker-test", "linux-test");
    const calls = query.mock.calls as unknown as ReadonlyArray<readonly [string, Record<string, unknown>]>;
    expect(calls[0]?.[1]).toMatchObject({ maxConcurrentJobs: 2, leaseSeconds: 60, leaseToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(calls[0]?.[1].leaseToken).not.toBe(calls[1]?.[1].leaseToken);
  });
  it("rejects result objects outside the job storage namespace", async () => {
    await expect(store.update("job-a", "linux-test", {
      workerId: "worker-test", leaseToken: "token", generation: 1, commandId: "finish", state: "completed",
      result: { sourceRevision: "a".repeat(40), headRevision: "b".repeat(40), artifacts: [
        { kind: "diff", storageKey: "jobs/job-b/patch.diff", sha256: "c".repeat(64), sizeBytes: 1 },
      ] },
    })).rejects.toMatchObject({ code: "invalid_result" });
    expect(query).not.toHaveBeenCalled();
  });
  it("hashes reordered objects identically and differing payloads distinctly", () => {
    expect(cloudInputHash({ x: 1, y: { b: 2, a: 3 } })).toBe(cloudInputHash({ y: { a: 3, b: 2 }, x: 1 }));
    expect(cloudInputHash({ x: 1 })).not.toBe(cloudInputHash({ x: 2 }));
  });
});
