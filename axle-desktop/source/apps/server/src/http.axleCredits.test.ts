import { describe, expect, it } from "vite-plus/test";

import {
  axleBaseUrlFromSettings,
  axleCredentialFromSettings,
  axleUsageLimit,
  messageFromAxleGatewayBody,
} from "./http.ts";

describe("axleCredentialFromSettings", () => {
  const withVariable = (name: string, value: string) => ({
    providerInstances: {
      axle: { environment: [{ name, value }] },
    },
  });

  it("is null without a configured Axle instance", () => {
    expect(axleCredentialFromSettings({ providerInstances: {} })).toBeNull();
    expect(axleCredentialFromSettings({ providerInstances: { axle: {} } })).toBeNull();
    expect(
      axleCredentialFromSettings({ providerInstances: { axle: { environment: [] } } }),
    ).toBeNull();
  });

  it("is null when the key is missing or blank", () => {
    expect(
      axleCredentialFromSettings(withVariable("AXLE_BASE_URL", "https://example.test/v1")),
    ).toBeNull();
    expect(axleCredentialFromSettings(withVariable("AXLE_API_KEY", "   "))).toBeNull();
  });

  it("returns the trimmed account key when one is configured", () => {
    expect(axleCredentialFromSettings(withVariable("AXLE_API_KEY", " axl_abc "))).toBe("axl_abc");
  });
});

describe("axleBaseUrlFromSettings", () => {
  it("is null without an instance-level override", () => {
    expect(axleBaseUrlFromSettings({ providerInstances: {} })).toBeNull();
    expect(
      axleBaseUrlFromSettings({
        providerInstances: { axle: { environment: [{ name: "AXLE_API_KEY", value: "axl_x" }] } },
      }),
    ).toBeNull();
  });

  it("returns the override without a trailing slash", () => {
    expect(
      axleBaseUrlFromSettings({
        providerInstances: {
          axle: {
            environment: [{ name: "AXLE_BASE_URL", value: " http://127.0.0.1:8787/v1/ " }],
          },
        },
      }),
    ).toBe("http://127.0.0.1:8787/v1");
  });
});

describe("axleUsageLimit", () => {
  it("defaults when nothing usable was requested", () => {
    expect(axleUsageLimit(null)).toBe(25);
    expect(axleUsageLimit("")).toBe(25);
    expect(axleUsageLimit("lots")).toBe(25);
  });

  it("clamps into the allowed range", () => {
    expect(axleUsageLimit("0")).toBe(1);
    expect(axleUsageLimit("-5")).toBe(1);
    expect(axleUsageLimit("1000")).toBe(100);
    expect(axleUsageLimit("10")).toBe(10);
    expect(axleUsageLimit("25.7")).toBe(25);
  });
});

describe("messageFromAxleGatewayBody", () => {
  it("prefers the gateway's own error text", () => {
    expect(messageFromAxleGatewayBody({ error: "Revoked." }, "fallback")).toBe("Revoked.");
    expect(messageFromAxleGatewayBody({ error: { message: "Missing key." } }, "fallback")).toBe(
      "Missing key.",
    );
  });

  it("falls back for unusable bodies", () => {
    expect(messageFromAxleGatewayBody(null, "fallback")).toBe("fallback");
    expect(messageFromAxleGatewayBody({}, "fallback")).toBe("fallback");
    expect(messageFromAxleGatewayBody({ error: { message: "  " } }, "fallback")).toBe("fallback");
  });
});
