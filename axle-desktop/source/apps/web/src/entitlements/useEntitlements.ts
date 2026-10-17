import { useEffect, useSyncExternalStore } from "react";

import { useAccountState } from "../account/AccountAuthProvider";
import {
  entitlementsConfigured,
  loadEntitlements,
  readEntitlementsSnapshot,
  resetEntitlements,
  subscribeEntitlements,
  type EntitlementsSnapshot,
} from "./entitlementsStore";

/**
 * Mirrors the signed-in account's plan into client surfaces. Shared across
 * components: the first caller triggers the fetch, later callers reuse it.
 */
export function useEntitlements(): EntitlementsSnapshot {
  const account = useAccountState();
  const snapshot = useSyncExternalStore(
    subscribeEntitlements,
    readEntitlementsSnapshot,
    readEntitlementsSnapshot,
  );

  useEffect(() => {
    if (!entitlementsConfigured()) return;
    if (account.status === "signed-in") {
      loadEntitlements();
    } else if (account.status === "signed-out") {
      resetEntitlements();
    }
  }, [account.status]);

  return snapshot;
}

/** The resolved entitlements, or null when no plan positively gates features. */
export function resolvedEntitlements(snapshot: EntitlementsSnapshot) {
  return snapshot.status === "ready" ? snapshot.entitlements : null;
}
