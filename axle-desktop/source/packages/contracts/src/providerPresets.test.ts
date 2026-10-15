import { describe, expect, it } from "vite-plus/test";

import {
  PROVIDER_PRESETS,
  parseProviderHeaders,
  providerBaseUrlHost,
  providerHeadersVariable,
  providerPresetHeaders,
  resolveProviderPreset,
  serializeProviderHeaders,
} from "./providerPresets.ts";

describe("resolveProviderPreset", () => {
  it("matches a base URL on hostname, ignoring the scheme, port and path", () => {
    expect(resolveProviderPreset("https://agentrouter.org/v1")?.id).toBe("agent-router");
    expect(resolveProviderPreset("http://AgentRouter.org:8080/v1")?.id).toBe("agent-router");
    expect(resolveProviderPreset("https://integrate.api.nvidia.com/v1")?.id).toBe("nvidia-nim");
  });

  it("returns nothing for an unknown host or a value that is not a URL", () => {
    expect(resolveProviderPreset("https://example.invalid/v1")).toBeUndefined();
    expect(resolveProviderPreset("integrate.api.nvidia.com/v1")).toBeUndefined();
    expect(resolveProviderPreset("")).toBeUndefined();
  });

  it("only presets that fingerprint their clients carry headers", () => {
    expect(providerPresetHeaders(resolveProviderPreset("https://agentrouter.org/v1"))).toEqual([
      ["user-agent", "codex_cli_rs/0.47.0"],
    ]);
    expect(providerPresetHeaders(resolveProviderPreset("https://api.deepseek.com/v1"))).toEqual([]);
    expect(providerPresetHeaders(undefined)).toEqual([]);
  });

  it("keeps every host unique so a base URL resolves to one provider", () => {
    const hosts = PROVIDER_PRESETS.flatMap((preset) => preset.hosts);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});

describe("providerBaseUrlHost", () => {
  it("lower-cases the host and drops a leading www", () => {
    expect(providerBaseUrlHost("https://www.example.com/v1")).toBe("example.com");
    expect(providerBaseUrlHost("HTTPS://EXAMPLE.com")).toBe("example.com");
  });
});

describe("provider header variables", () => {
  it("names the variable after the provider prefix", () => {
    expect(providerHeadersVariable("AGENT_ROUTER")).toBe("AGENT_ROUTER_HEADERS");
  });

  it("round-trips through serialize and parse", () => {
    const headers = [["user-agent", "codex_cli_rs/0.47.0"]] as const;
    expect(parseProviderHeaders(serializeProviderHeaders(headers))).toEqual(headers);
  });

  it("ignores a missing, malformed or non-object value", () => {
    expect(parseProviderHeaders(undefined)).toEqual([]);
    expect(parseProviderHeaders("   ")).toEqual([]);
    expect(parseProviderHeaders("codex_cli_rs/0.47.0")).toEqual([]);
    expect(parseProviderHeaders("{not json")).toEqual([]);
    expect(parseProviderHeaders('["user-agent"]')).toEqual([]);
    expect(parseProviderHeaders("null")).toEqual([]);
  });

  it("drops entries whose value is not a string", () => {
    expect(parseProviderHeaders('{"user-agent":"x","retries":3,"  ":"y"}')).toEqual([
      ["user-agent", "x"],
    ]);
  });
});
