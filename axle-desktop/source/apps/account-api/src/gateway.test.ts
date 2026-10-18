// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { applyGatewayCredits, GatewayCreditsError, readGatewayCreditsConfig } from "./gateway.ts";

describe("gateway credits configuration", () => {
  it("is null until both the URL and the shared token are set", () => {
    expect(readGatewayCreditsConfig({})).toBeNull();
    expect(
      readGatewayCreditsConfig({
        AXLE_GATEWAY_INTERNAL_URL: "https://gateway.example.test",
      }),
    ).toBeNull();
  });
  it("rejects non-https URLs and weak tokens", () => {
    expect(() =>
      readGatewayCreditsConfig({
        AXLE_GATEWAY_INTERNAL_URL: "http://gateway.example.test",
        AXLE_INTERNAL_TOKEN: "a-token-of-at-least-16",
      }),
    ).toThrow(/https/u);
    expect(() =>
      readGatewayCreditsConfig({
        AXLE_GATEWAY_INTERNAL_URL: "https://gateway.example.test",
        AXLE_INTERNAL_TOKEN: "short",
      }),
    ).toThrow(/AXLE_INTERNAL_TOKEN/u);
  });
});

describe("gateway credit application", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = readGatewayCreditsConfig({
    AXLE_GATEWAY_INTERNAL_URL: "https://gateway.example.test/",
    AXLE_INTERNAL_TOKEN: "internal-secret-token-16+",
  })!;

  it("posts the purchase to the gateway's internal route", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ applied: true, balance: 1_000 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await applyGatewayCredits(config, {
      userId: "usr_2abc",
      amount: 1_000,
      bucket: "paid",
      reference: "evt_credits_1",
    });
    expect(result).toEqual({ applied: true, balance: 1_000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gateway.example.test/v1/internal/credits");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${config.token}`);
    expect(JSON.parse(String(init.body))).toEqual({
      user_id: "usr_2abc",
      amount: 1_000,
      bucket: "paid",
      reference: "evt_credits_1",
    });
  });
  it("routes the purchase through a provided service-binding fetcher", async () => {
    const bindingFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ applied: true, balance: 42 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const globalFetch = vi.fn(async () => {
      throw new Error("global fetch must not be used when a binding fetcher is provided");
    });
    vi.stubGlobal("fetch", globalFetch);
    const boundConfig = readGatewayCreditsConfig(
      {
        AXLE_GATEWAY_INTERNAL_URL: "https://gateway.example.test/",
        AXLE_INTERNAL_TOKEN: "internal-secret-token-16+",
      },
      bindingFetch,
    )!;
    const result = await applyGatewayCredits(boundConfig, {
      userId: "usr_2abc",
      amount: 1_000,
      bucket: "paid",
      reference: "evt_credits_1",
    });
    expect(result).toEqual({ applied: true, balance: 42 });
    expect(bindingFetch).toHaveBeenCalledTimes(1);
    const [url] = bindingFetch.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://gateway.example.test/v1/internal/credits");
    expect(globalFetch).not.toHaveBeenCalled();
  });
  it("surfaces gateway refusals and outages as typed errors for webhook retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(
      applyGatewayCredits(config, {
        userId: "usr_2abc",
        amount: 1_000,
        bucket: "paid",
        reference: "evt_credits_1",
      }),
    ).rejects.toBeInstanceOf(GatewayCreditsError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(
      applyGatewayCredits(config, {
        userId: "usr_2abc",
        amount: 1_000,
        bucket: "paid",
        reference: "evt_credits_1",
      }),
    ).rejects.toBeInstanceOf(GatewayCreditsError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ applied: true }))),
    );
    await expect(
      applyGatewayCredits(config, {
        userId: "usr_2abc",
        amount: 1_000,
        bucket: "paid",
        reference: "evt_credits_1",
      }),
    ).rejects.toBeInstanceOf(GatewayCreditsError);
  });
});
