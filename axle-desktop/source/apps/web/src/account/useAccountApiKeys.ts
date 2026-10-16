import { useCallback, useEffect, useState } from "react";

import { useAccountState } from "./AccountAuthProvider";
import { fetchAccountApiKeys, type AccountApiKey } from "./accountClient";

export interface AccountApiKeysState {
  readonly keys: ReadonlyArray<AccountApiKey>;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The account's provider keys. Like the account snapshot, this only loads while
 * signed in, and a failed refresh keeps the last good list rather than blanking
 * the page.
 */
export function useAccountApiKeys(): AccountApiKeysState & {
  readonly reload: () => Promise<void>;
} {
  const account = useAccountState();
  const signedIn = account.status === "signed-in";
  const [state, setState] = useState<AccountApiKeysState>({
    keys: [],
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    if (!signedIn) {
      setState({ keys: [], loading: false, error: null });
      return;
    }
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const { keys } = await fetchAccountApiKeys();
      setState({ keys, loading: false, error: null });
    } catch (error: unknown) {
      setState((previous) => ({
        keys: previous.keys,
        loading: false,
        error: error instanceof Error ? error.message : "Your API keys could not be loaded.",
      }));
    }
  }, [signedIn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
