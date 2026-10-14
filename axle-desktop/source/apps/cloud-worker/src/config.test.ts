import { describe, expect, it } from "vite-plus/test";
import { readWorkerConfig, WorkerConfigError } from "./config.ts";

const baseConfig = {
  controlPlaneUrl: "https://accounts.example.com/",
  workerId: "worker-1",
  workerToken: "t".repeat(48),
  environmentIds: ["linux-standard"],
  workspaceRoot: "C:/tmp/axle-cloud/work",
  artifactRoot: "C:/tmp/axle-cloud/artifacts",
  providers: [{ providerInstanceId: "anthropic-default", provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
};

describe("worker configuration", () => {
  it("reads the inline JSON configuration and applies defaults", () => {
    const config = readWorkerConfig({ AXLE_CLOUD_WORKER_CONFIG: JSON.stringify(baseConfig) });
    expect(config.controlPlaneUrl).toBe("https://accounts.example.com");
    expect(config.agentBinary).toBe("axle");
    expect(config.pollIntervalMs).toBe(3_000);
    expect(config.heartbeatIntervalMs).toBe(10_000);
    expect(config.maxConcurrentJobs).toBe(4);
    expect(config.keepWorkspaces).toBe(true);
    expect(config.providers[0]?.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
  });

  it("falls back to a configuration file and normalizes optional fields", () => {
    const config = readWorkerConfig(
      { AXLE_CLOUD_WORKER_CONFIG_FILE: "worker.json" },
      (path) => {
        expect(path).toBe("worker.json");
        return JSON.stringify({
          ...baseConfig,
          pollIntervalMs: 500,
          maxConcurrentJobs: 1,
          keepWorkspaces: false,
          providers: [{ providerInstanceId: "local", provider: "ollama", baseUrl: "http://127.0.0.1:11434/" }],
        });
      },
    );
    expect(config.pollIntervalMs).toBe(500);
    expect(config.maxConcurrentJobs).toBe(1);
    expect(config.keepWorkspaces).toBe(false);
    expect(config.providers[0]?.apiKeyEnv).toBeNull();
  });

  it("rejects missing, malformed, or duplicated configuration without echoing it", () => {
    const cases: Array<Record<string, string | undefined>> = [
      {},
      { AXLE_CLOUD_WORKER_CONFIG: "" },
      { AXLE_CLOUD_WORKER_CONFIG: "not json" },
      { AXLE_CLOUD_WORKER_CONFIG: "{}" },
      { AXLE_CLOUD_WORKER_CONFIG: JSON.stringify({ ...baseConfig, workerToken: "short" }) },
      { AXLE_CLOUD_WORKER_CONFIG: JSON.stringify({ ...baseConfig, environmentIds: [] }) },
      { AXLE_CLOUD_WORKER_CONFIG: JSON.stringify({ ...baseConfig, environmentIds: ["a", "a"] }) },
      { AXLE_CLOUD_WORKER_CONFIG: JSON.stringify({ ...baseConfig, controlPlaneUrl: "https://user:pass@host" }) },
      { AXLE_CLOUD_WORKER_CONFIG: JSON.stringify({ ...baseConfig, controlPlaneUrl: "ftp://host" }) },
      {
        AXLE_CLOUD_WORKER_CONFIG: JSON.stringify({
          ...baseConfig,
          providers: [{ providerInstanceId: "a", provider: "openai" }],
        }),
      },
      {
        AXLE_CLOUD_WORKER_CONFIG: JSON.stringify({
          ...baseConfig,
          providers: [
            { providerInstanceId: "a", provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
            { providerInstanceId: "a", provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
          ],
        }),
      },
    ];
    for (const env of cases) {
      expect(() => readWorkerConfig(env)).toThrow(WorkerConfigError);
      try {
        readWorkerConfig(env);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        expect(message).toContain("docs/cloud-execution.md");
        expect(message).not.toContain("worker-1");
        expect(message).not.toContain("t".repeat(48));
      }
    }
  });

  it("reports a missing configuration file as invalid configuration", () => {
    expect(() =>
      readWorkerConfig({ AXLE_CLOUD_WORKER_CONFIG_FILE: "missing.json" }, () => {
        throw new Error("ENOENT");
      }),
    ).toThrow(WorkerConfigError);
  });
});
