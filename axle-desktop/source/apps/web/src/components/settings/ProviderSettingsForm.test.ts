import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@axle/contracts";

import { DRIVER_OPTION_BY_VALUE } from "./providerDriverMeta";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  readProviderConfigBoolean,
  readProviderConfigString,
} from "./ProviderSettingsForm";

describe("ProviderSettingsForm helpers", () => {
  it("exposes only the supported user-facing provider drivers", () => {
    expect(DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("cursor")]).toBeUndefined();
    expect(DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("grok")]).toBeUndefined();
    expect(Object.values(DRIVER_OPTION_BY_VALUE).map((option) => option?.label)).toEqual(["Axle"]);
  });

  it("derives visible provider config fields from the client definition schema", () => {
    const axle = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("axle")];

    expect(axle).toBeDefined();
    expect(deriveProviderSettingsFields(axle!).map((field) => field.key)).toEqual(["binaryPath"]);
  });

  it("sources labels and descriptions from schema annotations", () => {
    const axle = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("axle")];
    expect(axle).toBeDefined();
    expect(deriveProviderSettingsFields(axle!).map((field) => field.label)).toEqual(["Binary Path"]);
  });

  it("preserves unknown config keys while omitting empty configurable fields", () => {
    const axle = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("axle")];
    expect(axle).toBeDefined();

    const binaryPath = deriveProviderSettingsFields(axle!).find(
      (field) => field.key === "binaryPath",
    );
    expect(binaryPath).toBeDefined();

    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, binaryPath: "axle" },
      binaryPath!,
      "",
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("reads non-string config values as blank strings", () => {
    expect(readProviderConfigString({ binaryPath: 123 }, "binaryPath")).toBe("");
  });

  it("omits false boolean fields when clearWhenEmpty is omit", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: true },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: false,
      },
      false,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("omits true boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: false },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      true,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("stores false boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("preserves false boolean fields when clearWhenEmpty is persist", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "persist",
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("reads non-boolean config values as false booleans", () => {
    expect(readProviderConfigBoolean({ experimental: "true" }, "experimental")).toBe(false);
  });

  it("reads missing boolean config values from the supplied default", () => {
    expect(readProviderConfigBoolean({}, "experimental", true)).toBe(true);
  });
});
