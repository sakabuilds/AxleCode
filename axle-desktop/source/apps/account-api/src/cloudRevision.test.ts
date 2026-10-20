import { describe, expect, it, vi } from "vite-plus/test";
import { createCloudRevisionResolver } from "./cloudRevision.ts";

const SHA = "a".repeat(40);

describe("cloud revision resolver", () => {
  it("passes pinned commits through and normalizes case", async () => {
    const fetchImpl = vi.fn();
    const resolver = createCloudRevisionResolver({
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(
      await resolver.resolve("https://github.com/example/project.git", SHA.toUpperCase()),
    ).toBe(SHA);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves a github branch through the commits API", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.github.com/repos/example/project/commits/main");
      expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe(
        "Bearer token-1",
      );
      return new Response(JSON.stringify({ sha: SHA }), { status: 200 });
    });
    const resolver = createCloudRevisionResolver({
      fetch: fetchImpl as unknown as typeof fetch,
      githubToken: "token-1",
    });
    expect(await resolver.resolve("https://github.com/example/project.git", "main")).toBe(SHA);
  });

  it("rejects branch refs on hosts without resolution support", async () => {
    const resolver = createCloudRevisionResolver({
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      resolver.resolve("https://gitlab.com/example/project.git", "main"),
    ).rejects.toMatchObject({ code: "invalid_source_ref" });
  });

  it("reports unavailable revisions without leaking provider details", async () => {
    const resolver = createCloudRevisionResolver({
      fetch: (async () => new Response("rate limited", { status: 403 })) as unknown as typeof fetch,
    });
    await expect(
      resolver.resolve("https://github.com/example/project.git", "release"),
    ).rejects.toMatchObject({ code: "source_revision_unavailable" });
  });

  it("rejects malformed commit payloads", async () => {
    const resolver = createCloudRevisionResolver({
      fetch: (async () =>
        new Response(JSON.stringify({ sha: "not-a-commit" }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    await expect(
      resolver.resolve("https://github.com/example/project.git", "main"),
    ).rejects.toMatchObject({ code: "source_revision_unavailable" });
  });
});
