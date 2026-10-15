/**
 * The catalogue of known OpenAI-compatible providers, keyed by base URL.
 *
 * A preset is pure data: a display name, the headers its endpoint insists on,
 * and a hint about where its key comes from. When a user supplies a base URL,
 * Axle matches its hostname against `hosts` and then:
 *
 * - uses `label` for the provider unless the user named it themselves, and
 * - sends `headers` on every request, including the model-discovery probe.
 *
 * Adding a provider is a data edit: append an entry and it is picked up by the
 * settings form, by discovery, and by the runtime, because the settings form
 * writes the matched headers into `<PREFIX>_HEADERS` and both sides read that
 * variable. There is no code path to touch, so the catalogue can grow to as
 * many entries as needed.
 */

export interface ProviderPreset {
  /** Stable identifier, also used as the default slug when a user adds it. */
  readonly id: string;
  /** Display name shown in the model list and settings. */
  readonly label: string;
  /** Lower-case hostnames (no scheme, no port) that identify this provider. */
  readonly hosts: ReadonlyArray<string>;
  /**
   * Headers every request must carry. Most endpoints authenticate on the key
   * alone; routers that fingerprint their clients need more, which is what
   * makes this list worth keeping.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Where the user's key conventionally lives, shown as a hint in settings. */
  readonly apiKeyHint?: string;
  readonly docsUrl?: string;
}

export const PROVIDER_PRESETS: ReadonlyArray<ProviderPreset> = [
  {
    id: "agent-router",
    label: "Agent Router",
    hosts: ["agentrouter.org"],
    // Verified against the live router: the same key returns 401
    // "unauthorized client detected" for an anonymous client and 200 once the
    // request carries a recognised client fingerprint.
    headers: { "user-agent": "codex_cli_rs/0.47.0" },
    apiKeyHint: "AGENT_ROUTER_TOKEN",
    docsUrl: "https://agentrouter.org",
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    hosts: ["integrate.api.nvidia.com"],
    apiKeyHint: "NVIDIA_API_KEY",
    docsUrl: "https://build.nvidia.com",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hosts: ["api.deepseek.com"],
    docsUrl: "https://platform.deepseek.com",
  },
  {
    id: "mistral",
    label: "Mistral",
    hosts: ["api.mistral.ai"],
    docsUrl: "https://docs.mistral.ai",
  },
  {
    id: "xai",
    label: "xAI",
    hosts: ["api.x.ai"],
    docsUrl: "https://docs.x.ai",
  },
  {
    id: "together",
    label: "Together AI",
    hosts: ["api.together.xyz"],
    docsUrl: "https://docs.together.ai",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    hosts: ["api.perplexity.ai"],
    docsUrl: "https://docs.perplexity.ai",
  },
  {
    id: "moonshot",
    label: "Moonshot AI",
    hosts: ["api.moonshot.cn", "api.moonshot.ai"],
    docsUrl: "https://platform.moonshot.cn",
  },
  {
    id: "dashscope",
    label: "Alibaba DashScope",
    hosts: ["dashscope-intl.aliyuncs.com", "dashscope.aliyuncs.com"],
    docsUrl: "https://dashscope.console.aliyun.com",
  },
  // Vendors below are first-class built-in providers in the desktop app. They
  // are listed so a base URL pasted by hand still resolves to the right name.
  {
    id: "openai",
    label: "OpenAI",
    hosts: ["api.openai.com"],
    docsUrl: "https://platform.openai.com",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    hosts: ["api.anthropic.com"],
    docsUrl: "https://docs.anthropic.com",
  },
  {
    id: "google",
    label: "Google",
    hosts: ["generativelanguage.googleapis.com"],
    docsUrl: "https://ai.google.dev",
  },
  {
    id: "groq",
    label: "Groq",
    hosts: ["api.groq.com"],
    docsUrl: "https://console.groq.com",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    hosts: ["api.cerebras.ai"],
    docsUrl: "https://cloud.cerebras.ai",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    hosts: ["api.fireworks.ai"],
    docsUrl: "https://fireworks.ai",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hosts: ["openrouter.ai"],
    docsUrl: "https://openrouter.ai",
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    hosts: ["ollama.com"],
    docsUrl: "https://ollama.com",
  },
];

/** Environment variable holding a provider's extra request headers, as JSON. */
export const providerHeadersVariable = (envPrefix: string): string => `${envPrefix}_HEADERS`;

/**
 * Lower-case hostname of a base URL, with `www.` and any port removed. Returns
 * `undefined` for anything that is not a parseable absolute URL, so a partially
 * typed value never matches a preset.
 */
export function providerBaseUrlHost(baseUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** The preset a base URL belongs to, matched on hostname. */
export function resolveProviderPreset(baseUrl: string): ProviderPreset | undefined {
  const host = providerBaseUrlHost(baseUrl);
  if (!host) return undefined;
  return PROVIDER_PRESETS.find((preset) => preset.hosts.includes(host));
}

/** A preset's required headers as ordered name/value pairs. */
export function providerPresetHeaders(
  preset: ProviderPreset | undefined,
): ReadonlyArray<readonly [string, string]> {
  if (!preset?.headers) return [];
  return Object.entries(preset.headers);
}

/**
 * Read `<PREFIX>_HEADERS`. The value is a JSON object of header name to value;
 * malformed input is ignored rather than thrown, because the variable is user
 * input that reaches both discovery and the runtime.
 */
export function parseProviderHeaders(
  value: string | undefined,
): ReadonlyArray<readonly [string, string]> {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("{")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .filter(([name, headerValue]) => name.trim().length > 0 && typeof headerValue === "string")
    .map(([name, headerValue]) => [name.trim(), headerValue as string] as const);
}

/** Serialize headers for `<PREFIX>_HEADERS`, the inverse of the parser. */
export function serializeProviderHeaders(
  headers: ReadonlyArray<readonly [string, string]>,
): string {
  return JSON.stringify(Object.fromEntries(headers));
}
