import { useCallback, useEffect, useState } from "react";

import { useAccountState } from "./AccountAuthProvider";
import { fetchAccountSnapshot, type AccountSnapshot } from "./accountClient";

export type AccountSnapshotState =
  | { readonly status: "signed-out"; readonly snapshot: null; readonly error: null }
  | { readonly status: "loading"; readonly snapshot: AccountSnapshot | null; readonly error: null }
  | { readonly status: "ready"; readonly snapshot: AccountSnapshot; readonly error: null }
  | { readonly status: "error"; readonly snapshot: AccountSnapshot | null; readonly error: string };

/**
 * Reads the account record from the Axle worker. Loads only while signed in, and
 * keeps the last good snapshot on screen if a refresh fails.
 */
export function useAccountSnapshot(): {
  readonly state: AccountSnapshotState;
  readonly reload: () => Promise<void>;
} {
  const account = useAccountState();
  const signedIn = account.status === "signed-in";
  const [state, setState] = useState<AccountSnapshotState>({
    status: "loading",
    snapshot: null,
    error: null,
  });

  const reload = useCallback(async () => {
    if (!signedIn) {
      setState({ status: "signed-out", snapshot: null, error: null });
      return;
    }
    setState((previous) =>
      previous.status === "ready"
        ? previous
        : { status: "loading", snapshot: previous.snapshot, error: null },
    );
    // The account token can lag the signed-in transition by a tick while the
    // broker frame settles, so one retry avoids a spurious unauthorized state.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const snapshot = await fetchAccountSnapshot();
        setState({ status: "ready", snapshot, error: null });
        return;
      } catch (error: unknown) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    }
    setState((previous) => ({
      status: "error",
      snapshot: previous.snapshot,
      error: lastError instanceof Error ? lastError.message : "Your account could not be loaded.",
    }));
  }, [signedIn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload };
}
