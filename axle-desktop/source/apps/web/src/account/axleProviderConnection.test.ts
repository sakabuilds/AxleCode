import { describe, expect, it } from "vite-plus/test";

import {
  AXLE_API_KEY_VARIABLE,
  AXLE_PROVIDER_DRIVER_KIND,
  AXLE_PROVIDER_INSTANCE_ID,
  isAxleProviderConnected,
  withAxleProviderApiKey,
} from "./axleProviderConnection";

describe("isAxleProviderConnected", () => {
  it("is false without an environment or variable", () => {
    expect(isAxleProviderConnected(undefined)).toBe(false);
    expect(isAxleProviderConnected([])).toBe(false);
    expect(isAxleProviderConnected([{ name: "OTHER", value: "x", sensitive: false }])).toBe(false);
  });

  it("is true while a stored secret is still redacted", () => {
    expect(
      isAxleProviderConnected([
        { name: AXLE_API_KEY_VARIABLE, value: "", sensitive: true, valueRedacted: true },
      ]),
    ).toBe(true);
  });

  it("is true for a freshly written secret", () => {
    expect(
      isAxleProviderConnected([
        { name: AXLE_API_KEY_VARIABLE, value: "axl_abc", sensitive: true, valueRedacted: false },
      ]),
    ).toBe(true);
  });

  it("is false for an empty unredacted value", () => {
    expect(
      isAxleProviderConnected([
        { name: AXLE_API_KEY_VARIABLE, value: "  ", sensitive: false, valueRedacted: false },
      ]),
    ).toBe(false);
  });
});

describe("withAxleProviderApiKey", () => {
  it("writes the secret as a sensitive variable on a fresh instance", () => {
    const instance = withAxleProviderApiKey(undefined, "axl_secret");
    expect(instance.driver).toBe(AXLE_PROVIDER_DRIVER_KIND);
    expect(instance.enabled).toBe(true);
    expect(instance.config).toEqual({ binaryPath: "" });
    expect(instance.environment).toEqual([
      {
        name: AXLE_API_KEY_VARIABLE,
        value: "axl_secret",
        sensitive: true,
        valueRedacted: false,
      },
    ]);
  });

  it("replaces an existing key and keeps the other variables", () => {
    const instance = withAxleProviderApiKey(
      {
        driver: AXLE_PROVIDER_DRIVER_KIND,
        displayName: "Axle Custom",
        enabled: false,
        environment: [
          { name: AXLE_API_KEY_VARIABLE, value: "", sensitive: true, valueRedacted: true },
          { name: "AXLE_BASE_URL", value: "https://example.test/v1", sensitive: false },
        ],
        config: { binaryPath: "/opt/axle" },
      },
      "axl_new",
    );
    expect(instance.displayName).toBe("Axle Custom");
    expect(instance.enabled).toBe(false);
    expect(instance.config).toEqual({ binaryPath: "/opt/axle" });
    expect(instance.environment).toEqual([
      { name: "AXLE_BASE_URL", value: "https://example.test/v1", sensitive: false },
      {
        name: AXLE_API_KEY_VARIABLE,
        value: "axl_new",
        sensitive: true,
        valueRedacted: false,
      },
    ]);
  });

  it("targets the default axle instance id", () => {
    expect(AXLE_PROVIDER_INSTANCE_ID).toBe("axle");
  });
});
