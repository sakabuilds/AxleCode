// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as Schema from "effect/Schema";

/**
 * Provider kinds the Axle CLI can drive. `providerInstanceId` values are
 * operator-defined names that the control plane authorizes per environment and
 * that the worker maps onto one of these kinds plus a credential source.
 */
export const AgentProvider = Schema.Literals([
  "openai",
  "anthropic",
  "gemini",
  "fireworks",
  "ollama-cloud",
  "cerebras",
  "groq",
  "openrouter",
  "ollama",
]);
export type AgentProvider = typeof AgentProvider.Type;

const Identifier = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u),
);

const ProviderBindingSchema = Schema.Struct({
  providerInstanceId: Identifier,
  provider: AgentProvider,
  apiKeyEnv: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]*$/u))),
  baseUrl: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
});

export interface ProviderBinding {
  readonly providerInstanceId: string;
  readonly provider: AgentProvider;
  readonly apiKeyEnv: string | null;
  readonly baseUrl: string | null;
}

const WorkerConfigSchema = Schema.Struct({
  controlPlaneUrl: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  workerId: Identifier,
  workerToken: Schema.String.check(Schema.isMinLength(32), Schema.isMaxLength(256)),
  environmentIds: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  workspaceRoot: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  artifactRoot: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  agentBinary: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024))),
  agentEnv: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  providers: Schema.Array(ProviderBindingSchema).check(Schema.isMinLength(1)),
  pollIntervalMs: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 250, maximum: 60_000 }))),
  heartbeatIntervalMs: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 120_000 }))),
  shutdownGraceMs: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 600_000 }))),
  maxConcurrentJobs: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  keepWorkspaces: Schema.optionalKey(Schema.Boolean),
});

export interface WorkerConfig {
  readonly controlPlaneUrl: string;
  readonly workerId: string;
  readonly workerToken: string;
  readonly environmentIds: ReadonlyArray<string>;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly agentBinary: string;
  readonly agentEnv: Readonly<Record<string, string>>;
  readonly providers: ReadonlyArray<ProviderBinding>;
  readonly pollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
  readonly shutdownGraceMs: number;
  readonly maxConcurrentJobs: number;
  readonly keepWorkspaces: boolean;
}

export class WorkerConfigError extends Error {
  constructor() {
    super("AXLE_CLOUD_WORKER_CONFIG is missing or invalid. See docs/cloud-execution.md.");
    this.name = "WorkerConfigError";
  }
}

const decode = Schema.decodeUnknownSync(WorkerConfigSchema);

/** Operator configuration for one worker host. Never logs or echoes the token. */
export function readWorkerConfig(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string = (path) => NodeFS.readFileSync(path, "utf8"),
): WorkerConfig {
  let raw = env.AXLE_CLOUD_WORKER_CONFIG?.trim() ?? "";
  if (!raw) {
    const path = env.AXLE_CLOUD_WORKER_CONFIG_FILE?.trim();
    if (path) {
      try {
        raw = readFile(path);
      } catch {
        throw new WorkerConfigError();
      }
    }
  }
  if (!raw) throw new WorkerConfigError();
  try {
    const parsed = decode(JSON.parse(raw));
    const controlPlaneUrl = normalizeControlPlaneUrl(parsed.controlPlaneUrl);
    if (new Set(parsed.environmentIds).size !== parsed.environmentIds.length) throw new Error();
    const providers = parsed.providers.map((binding): ProviderBinding => {
      const apiKeyEnv = binding.apiKeyEnv ?? null;
      const baseUrl = binding.baseUrl ? normalizeBaseUrl(binding.baseUrl) : null;
      if (binding.provider !== "ollama" && apiKeyEnv === null) throw new Error();
      return { providerInstanceId: binding.providerInstanceId, provider: binding.provider, apiKeyEnv, baseUrl };
    });
    if (new Set(providers.map((binding) => binding.providerInstanceId)).size !== providers.length) throw new Error();
    return {
      controlPlaneUrl,
      workerId: parsed.workerId,
      workerToken: parsed.workerToken,
      environmentIds: [...parsed.environmentIds],
      workspaceRoot: parsed.workspaceRoot,
      artifactRoot: parsed.artifactRoot,
      agentBinary: parsed.agentBinary ?? "axle",
      agentEnv: { ...(parsed.agentEnv ?? {}) },
      providers,
      pollIntervalMs: parsed.pollIntervalMs ?? 3_000,
      heartbeatIntervalMs: parsed.heartbeatIntervalMs ?? 10_000,
      shutdownGraceMs: parsed.shutdownGraceMs ?? 30_000,
      maxConcurrentJobs: parsed.maxConcurrentJobs ?? 4,
      keepWorkspaces: parsed.keepWorkspaces ?? true,
    };
  } catch {
    // The raw configuration contains worker credentials; never include it.
    throw new WorkerConfigError();
  }
}

function normalizeControlPlaneUrl(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) throw new Error();
  return value.replace(/\/+$/u, "");
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) throw new Error();
  return value;
}
