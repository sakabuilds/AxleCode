import {
  providerHeadersVariable,
  providerPresetHeaders,
  resolveProviderPreset,
  serializeProviderHeaders,
  type ProviderInstanceEnvironment,
} from "@axle/contracts";

const PROVIDER_BASE_URL_VARIABLE = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)_BASE_URL$/u;

/**
 * Materialize the headers a known endpoint insists on.
 *
 * A few OpenAI-compatible routers authorize by client fingerprint rather than
 * by the key alone, so a request that omits the expected `User-Agent` is
 * rejected even with a valid credential. Which headers those are is a property
 * of the endpoint, which is why the provider catalogue is keyed by hostname.
 *
 * Whenever `<PREFIX>_BASE_URL` points at such an endpoint, its headers are
 * written to `<PREFIX>_HEADERS` so model discovery and the runtime both send
 * them, without either side needing to know about the catalogue. A value the
 * user set themselves always wins, and unknown hosts are left untouched.
 */
function applyProviderPresetHeaders(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let next: NodeJS.ProcessEnv | undefined;
  for (const [name, value] of Object.entries(environment)) {
    const envPrefix = PROVIDER_BASE_URL_VARIABLE.exec(name)?.[1];
    if (!envPrefix) continue;
    const headersVariable = providerHeadersVariable(envPrefix);
    if (environment[headersVariable]?.trim()) continue;
    const headers = providerPresetHeaders(resolveProviderPreset(value ?? ""));
    if (headers.length === 0) continue;
    next ??= { ...environment };
    next[headersVariable] = serializeProviderHeaders(headers);
  }
  return next ?? environment;
}

export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!environment || environment.length === 0) {
    return applyProviderPresetHeaders(baseEnv);
  }

  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment) {
    next[variable.name] = variable.value;
  }
  return applyProviderPresetHeaders(next);
}
