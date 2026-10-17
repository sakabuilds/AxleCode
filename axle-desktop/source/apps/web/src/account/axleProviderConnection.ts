/**
 * Connects the desktop app to the user's Axle account.
 *
 * The gateway identifies a caller by key, so the spend only leaves the daily
 * free grant behind once the Axle provider chats with an account key. The key
 * is stored the same way every provider secret is: as a sensitive
 * `AXLE_API_KEY` environment variable on the `axle` provider instance, which
 * the server materializes before it spawns the runtime.
 *
 * @module axleProviderConnection
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
} from "@axle/contracts";

export const AXLE_PROVIDER_INSTANCE_ID = ProviderInstanceId.make("axle");
export const AXLE_PROVIDER_DRIVER_KIND = ProviderDriverKind.make("axle");
export const AXLE_API_KEY_VARIABLE = "AXLE_API_KEY";

const AXLE_DEFAULT_DISPLAY_NAME = "Axle";
const DEFAULT_AXLE_DRIVER_CONFIG: Record<string, unknown> = { binaryPath: "" };

/**
 * Whether the Axle provider carries an account key. A stored secret comes
 * back redacted (`valueRedacted: true`, empty value), which is exactly the
 * state a successfully saved key ends up in.
 */
export function isAxleProviderConnected(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined,
): boolean {
  const variable = environment?.find((entry) => entry.name === AXLE_API_KEY_VARIABLE);
  if (variable === undefined) return false;
  return variable.valueRedacted === true || variable.value.trim().length > 0;
}

/**
 * The `axle` instance with `AXLE_API_KEY` set to `secret`, preserving every
 * other instance field and environment variable. Reconnecting an instance
 * that already has a key replaces it.
 */
export function withAxleProviderApiKey(
  instance: ProviderInstanceConfig | undefined,
  secret: string,
): ProviderInstanceConfig {
  const environment = (instance?.environment ?? []).filter(
    (variable) => variable.name !== AXLE_API_KEY_VARIABLE,
  );
  environment.push({
    name: AXLE_API_KEY_VARIABLE,
    value: secret,
    sensitive: true,
    valueRedacted: false,
  });
  return {
    driver: instance?.driver ?? AXLE_PROVIDER_DRIVER_KIND,
    displayName: instance?.displayName ?? AXLE_DEFAULT_DISPLAY_NAME,
    ...(instance?.accentColor === undefined ? {} : { accentColor: instance.accentColor }),
    enabled: instance?.enabled ?? true,
    environment,
    config: instance?.config ?? DEFAULT_AXLE_DRIVER_CONFIG,
  };
}
