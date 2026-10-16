import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  AxleGatewayError,
  CREDIT_USD,
  axleGatewayBaseUrl,
  fetchAxleCredits,
  fetchAxleModelRates,
  fetchAxleUsage,
  formatCredits,
  formatUsd,
} from "./axleGateway";

const originalFetch = globalThis.fetch;

function respondWith(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

describe("gateway base URL", () => {
  it("defaults to the deployed gateway and has no trailing slash", () => {
    expect(axleGatewayBaseUrl()).toMatch(/^https:\/\/.+\/v1$/u);
  });
});

describe("credits", () => {
  it("maps the gateway payload onto the account view", async () => {
    respondWith({
      object: "axle.credits",
      credits: 91.5,
      credit_usd: 0.005,
      daily_free_credits: 100,
      balance_usd: 0.4575,
    });
    expect(await fetchAxleCredits("axl_test")).toEqual({
      credits: 91.5,
      creditUsd: 0.005,
      dailyFreeCredits: 100,
      balanceUsd: 0.4575,
    });
  });

  it("sends the key as a bearer token", async () => {
    const fetchMock = respondWith({ credits: 1 });
    await fetchAxleCredits("axl_secret");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/v1/credits");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer axl_secret");
  });

  it("falls back to zeroes rather than NaN when fields are missing", async () => {
    respondWith({});
    const credits = await fetchAxleCredits("axl_test");
    expect(credits.credits).toBe(0);
    expect(credits.balanceUsd).toBe(0);
    expect(Number.isNaN(credits.balanceUsd)).toBe(false);
  });

  it("surfaces the gateway's own error message on a 401", async () => {
    respondWith({ error: { message: "Missing Axle API key." } }, 401);
    await expect(fetchAxleCredits("axl_test")).rejects.toThrow("Missing Axle API key.");
  });

  it("accepts a plain string error body too", async () => {
    respondWith({ error: "Revoked." }, 401);
    const error = await fetchAxleCredits("axl_test").catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AxleGatewayError);
    expect((error as AxleGatewayError).message).toBe("Revoked.");
    expect((error as AxleGatewayError).status).toBe(401);
  });
});

describe("usage", () => {
  it("maps ledger rows and drops nothing it can explain", async () => {
    respondWith({
      object: "axle.usage",
      entries: [
        { kind: "daily_grant", credits: 100, balance_after: 100, model: null, created_at: 1 },
        { kind: "spend", credits: -12.5, balance_after: 87.5, model: "axle-nano", created_at: 2 },
      ],
    });
    expect(await fetchAxleUsage("axl_test")).toEqual([
      { kind: "daily_grant", credits: 100, balanceAfter: 100, model: null, createdAt: 1 },
      { kind: "spend", credits: -12.5, balanceAfter: 87.5, model: "axle-nano", createdAt: 2 },
    ]);
  });

  it("returns an empty list when the payload has no entries array", async () => {
    respondWith({ object: "axle.usage" });
    expect(await fetchAxleUsage("axl_test")).toEqual([]);
  });

  it("keeps a row whose optional fields are the wrong type", async () => {
    respondWith({ entries: [{ kind: "spend", credits: "12", balance_after: null, model: 7 }] });
    expect(await fetchAxleUsage("axl_test")).toEqual([
      { kind: "spend", credits: 0, balanceAfter: 0, model: null, createdAt: 0 },
    ]);
  });
});

describe("model rates", () => {
  it("flattens the OpenAI-shaped catalog", async () => {
    respondWith({
      object: "list",
      data: [
        {
          id: "axle-nano",
          axle: {
            label: "Axle Nano",
            tier: 1,
            context_window: 128000,
            credits_per_million_input: 40,
            credits_per_million_output: 160,
          },
        },
      ],
    });
    expect(await fetchAxleModelRates()).toEqual([
      {
        id: "axle-nano",
        label: "Axle Nano",
        tier: 1,
        contextWindow: 128000,
        creditsPerMillionInput: 40,
        creditsPerMillionOutput: 160,
      },
    ]);
  });

  it("does not need a key", async () => {
    const fetchMock = respondWith({ data: [] });
    await fetchAxleModelRates();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Authorization");
  });
});

describe("credit formatting", () => {
  it("keeps whole numbers whole", () => {
    expect(formatCredits(100)).toBe("100");
    expect(formatCredits(0)).toBe("0");
  });

  it("trims trailing zeros from fractional credits", () => {
    expect(formatCredits(12.5)).toBe("12.5");
    expect(formatCredits(91.5)).toBe("91.5");
    expect(formatCredits(0.5)).toBe("0.5");
  });

  it("formats USD to cents", () => {
    expect(formatUsd(0.5)).toBe("$0.50");
    expect(formatUsd(CREDIT_USD)).toBe("$0.01");
  });
});
