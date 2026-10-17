/**
 * React binding over `axleProviderConnection`: reads whether the Axle
 * provider is connected to an account and writes the key into primary
 * settings, which is what makes chats spend from the account balance.
 *
 * @module useAxleProviderConnection
 */
import { useCallback } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../hooks/useSettings";
import { usePrimaryEnvironment } from "../state/environments";
import {
  AXLE_PROVIDER_INSTANCE_ID,
  isAxleProviderConnected,
  withAxleProviderApiKey,
} from "./axleProviderConnection";

export function useAxleProviderConnection(): {
  readonly connected: boolean;
  /** False before a server environment is paired; settings cannot be written yet. */
  readonly canConnect: boolean;
  readonly connect: (secret: string) => void;
} {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const canConnect = usePrimaryEnvironment() !== null;

  const connected = isAxleProviderConnected(
    settings.providerInstances[AXLE_PROVIDER_INSTANCE_ID]?.environment,
  );

  const connect = useCallback(
    (secret: string) => {
      if (!canConnect || secret.trim().length === 0) return;
      const instance = settings.providerInstances[AXLE_PROVIDER_INSTANCE_ID];
      updateSettings({
        providerInstances: {
          ...settings.providerInstances,
          [AXLE_PROVIDER_INSTANCE_ID]: withAxleProviderApiKey(instance, secret),
        },
      });
    },
    [canConnect, settings, updateSettings],
  );

  return { connected, canConnect, connect };
}
