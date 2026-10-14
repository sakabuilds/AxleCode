import { describe, expect, it, vi } from "vite-plus/test";

import { hasTracingPublicConfig, resolveCloudPublicConfig } from "./publicConfig";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe("resolveCloudPublicConfig", () => {
  it("returns no cloud configuration for an unconfigured build", () => {
    expect(resolveCloudPublicConfig({})).toEqual({
      neonAuth: {
        url: null,
      },
      relay: {
        url: null,
      },
      accountApi: {
        url: null,
      },
      observability: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
  });

  it("normalizes statically injected cloud configuration", () => {
    expect(
      resolveCloudPublicConfig({
        neonAuth: { url: " https://auth.example.test/ " },
        relay: { url: " https://relay.example.test/// " },
        accountApi: { url: " https://accounts.example.test/ " },
        observability: {
          tracesUrl: " https://api.axiom.co/v1/traces ",
          tracesDataset: " mobile-traces ",
          tracesToken: " public-ingest-token ",
        },
      }),
    ).toEqual({
      neonAuth: {
        url: "https://auth.example.test/",
      },
      relay: {
        url: "https://relay.example.test",
      },
      accountApi: {
        url: "https://accounts.example.test/",
      },
      observability: {
        tracesUrl: "https://api.axiom.co/v1/traces",
        tracesDataset: "mobile-traces",
        tracesToken: "public-ingest-token",
      },
    });
  });

  it("rejects an insecure relay URL", () => {
    expect(
      resolveCloudPublicConfig({
        neonAuth: { url: "https://auth.example.test" },
        relay: { url: "http://relay.example.test" },
      }),
    ).toEqual({
      neonAuth: {
        url: "https://auth.example.test/",
      },
      relay: {
        url: null,
      },
      accountApi: {
        url: null,
      },
      observability: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
  });

  it("rejects an insecure traces URL", () => {
    expect(
      resolveCloudPublicConfig({
        observability: {
          tracesUrl: "http://api.axiom.co/v1/traces",
          tracesDataset: "mobile-traces",
          tracesToken: "public-ingest-token",
        },
      }).observability,
    ).toEqual({
      tracesUrl: null,
      tracesDataset: "mobile-traces",
      tracesToken: "public-ingest-token",
    });
  });

  it("keeps tracing disabled unless every public tracing value is configured", () => {
    expect(hasTracingPublicConfig(resolveCloudPublicConfig({}))).toBe(false);
    expect(
      hasTracingPublicConfig(
        resolveCloudPublicConfig({
          observability: {
            tracesUrl: "https://api.axiom.co/v1/traces",
            tracesDataset: "mobile-traces",
          },
        }),
      ),
    ).toBe(false);
    expect(
      hasTracingPublicConfig(
        resolveCloudPublicConfig({
          observability: {
            tracesUrl: "https://api.axiom.co/v1/traces",
            tracesDataset: "mobile-traces",
            tracesToken: "public-ingest-token",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects an insecure account API URL", () => {
    const config = resolveCloudPublicConfig({
      neonAuth: { url: "https://auth.example.test" },
      relay: { url: "https://relay.example.test" },
      accountApi: { url: "http://accounts.example.test" },
    });
    expect(config.accountApi.url).toBeNull();
    expect(config.neonAuth.url).toBe("https://auth.example.test/");
    expect(config.relay.url).toBe("https://relay.example.test");
  });
});
