import { describe, expect, it } from "vite-plus/test";

import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";

describe("mergeProviderInstanceEnvironment", () => {
  it("overrides inherited environment values and preserves empty strings", () => {
    expect(
      mergeProviderInstanceEnvironment(
        [
          { name: "OPENROUTER_API_KEY", value: "sk-or-test", sensitive: true },
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
        ],
        { ANTHROPIC_API_KEY: "inherited", PATH: "/bin" },
      ),
    ).toMatchObject({
      OPENROUTER_API_KEY: "sk-or-test",
      ANTHROPIC_API_KEY: "",
      PATH: "/bin",
    });
  });

  it("derives the headers an endpoint fingerprints on from its base URL", () => {
    const merged = mergeProviderInstanceEnvironment(
      [
        { name: "AGENT_ROUTER_BASE_URL", value: "https://agentrouter.org/v1", sensitive: false },
        { name: "AGENT_ROUTER_API_KEY", value: "agent-token", sensitive: true },
      ],
      {},
    );

    expect(merged.AGENT_ROUTER_HEADERS).toBe('{"user-agent":"codex_cli_rs/0.47.0"}');
  });

  it("leaves an unknown endpoint and a user-set header variable alone", () => {
    const merged = mergeProviderInstanceEnvironment(
      [
        { name: "LOCAL_BASE_URL", value: "http://127.0.0.1:1234/v1", sensitive: false },
        { name: "AGENT_ROUTER_BASE_URL", value: "https://agentrouter.org/v1", sensitive: false },
        { name: "AGENT_ROUTER_HEADERS", value: '{"user-agent":"mine"}', sensitive: false },
      ],
      {},
    );

    expect(merged.LOCAL_HEADERS).toBeUndefined();
    expect(merged.AGENT_ROUTER_HEADERS).toBe('{"user-agent":"mine"}');
  });

  it("returns the inherited environment untouched when nothing needs a header", () => {
    const baseEnv = { PATH: "/bin" };
    expect(mergeProviderInstanceEnvironment(undefined, baseEnv)).toBe(baseEnv);
    expect(
      mergeProviderInstanceEnvironment(
        [
          {
            name: "NVIDIA_NIM_BASE_URL",
            value: "https://integrate.api.nvidia.com/v1",
            sensitive: false,
          },
        ],
        baseEnv,
      ).NVIDIA_NIM_HEADERS,
    ).toBeUndefined();
  });
});
