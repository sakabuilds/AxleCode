import { describe, expect, it, vi } from "vite-plus/test";
import { CloudControlPlane, CloudControlPlaneError } from "./controlPlane.ts";
import { cloudJobLeaseFixture } from "./testFixtures.ts";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function createClient(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof CloudControlPlane>[0]> = {}) {
  return new CloudControlPlane({
    baseUrl: "https://accounts.example.com/",
    workerId: "worker-1",
    token: "t".repeat(48),
    fetchImpl,
    retryDelayMs: 1,
    sleep: async () => {},
    randomUUID: () => "cmd-1",
    ...overrides,
  });
}

describe("worker control-plane client", () => {
  it("returns null for an empty claim queue (204)", async () => {
    const captured: Array<{ url: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url, init });
      return new Response(null, { status: 204 });
    });
    const client = createClient(fetchImpl as unknown as typeof fetch);
    expect(await client.claim("linux-standard")).toBeNull();
    const { url, init } = captured[0]!;
    expect(String(url)).toBe("https://accounts.example.com/v1/cloud-workers/linux-standard/claim");
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${"t".repeat(48)}`);
    expect(JSON.parse(String(init?.body))).toEqual({ workerId: "worker-1", environmentId: "linux-standard" });
  });

  it("decodes a lease and reuses one command id across transport retries", async () => {
    const lease = cloudJobLeaseFixture();
    let attempts = 0;
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (attempts === 1) return new Response("{\"error\":\"internal_error\"}", { status: 500 });
      return jsonResponse({ ...lease.job, state: "running" });
    });
    const client = createClient(fetchImpl as unknown as typeof fetch);
    const job = await client.update("linux-standard", lease.job.jobId, { leaseToken: lease.leaseToken, generation: lease.job.generation }, { state: "running" });
    expect(attempts).toBe(2);
    expect(job.state).toBe("running");

    expect(bodies[0]!.commandId).toBe(bodies[1]!.commandId);
  });

  it("honors Retry-After seconds before reopening the request", async () => {
    const lease = cloudJobLeaseFixture();
    const sleeps: number[] = [];
    let attempts = 0;
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (attempts === 1) return new Response("{}", { status: 429, headers: { "retry-after": "5" } });
      return jsonResponse(lease);
    });
    const client = createClient(fetchImpl as unknown as typeof fetch, {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await client.heartbeat("linux-standard", lease.job.jobId, { leaseToken: lease.leaseToken, generation: lease.job.generation });
    expect(sleeps).toEqual([5_000]);
  });

  it("surfaces control-plane error codes instead of raw payloads", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "lease_lost" }, 409));
    const client = createClient(fetchImpl as unknown as typeof fetch);
    const failure = client
      .update("linux-standard", "job-1", { leaseToken: "lease-1", generation: 1 }, { state: "running" })
      .catch((error: unknown) => error);
    const error = await failure;
    expect(error).toBeInstanceOf(CloudControlPlaneError);
    expect((error as CloudControlPlaneError).code).toBe("lease_lost");
    expect((error as CloudControlPlaneError).status).toBe(409);
    expect((error as Error).message).toContain("(lease_lost)");
  });

  it("does not retry terminal 4xx responses and reports network failures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "forbidden" }, 403));
    const client = createClient(fetchImpl as unknown as typeof fetch);
    const error = await client.claim("linux-standard").catch((failure: unknown) => failure);
    expect((error as CloudControlPlaneError).code).toBe("forbidden");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const offline = createClient((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    const networkError = await offline.claim("linux-standard").catch((failure: unknown) => failure);
    expect(networkError).toBeInstanceOf(CloudControlPlaneError);
    expect((networkError as CloudControlPlaneError).code).toBe("network_error");
  });

  it("decodes malformed success payloads as an invalid response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nonsense: true }));
    const client = createClient(fetchImpl as unknown as typeof fetch);
    const error = await client.claim("linux-standard").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CloudControlPlaneError);
    expect((error as CloudControlPlaneError).code).toBe("invalid_response");
  });
});

