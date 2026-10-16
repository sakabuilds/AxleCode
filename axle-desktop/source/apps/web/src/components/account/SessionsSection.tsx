import { LogOutIcon, LoaderCircleIcon, MonitorSmartphoneIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { revokeAccountSession, type AccountSession } from "../../account/accountClient";
import { SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { AccountRow } from "./accountShared";
import { describeSessionMethod, formatTimestamp } from "./accountFormat";

/** Devices holding a live session. Revoking one signs that device out only. */
export function SessionsSection({
  sessions,
  onChanged,
}: {
  readonly sessions: ReadonlyArray<AccountSession>;
  readonly onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const active = sessions.filter((session) => session.revokedAt === null);

  const revoke = useCallback(
    async (sessionId: string) => {
      setBusy(sessionId);
      try {
        await revokeAccountSession(sessionId);
        await onChanged();
        toastManager.add({ type: "success", title: "Session revoked" });
      } catch (error: unknown) {
        toastManager.add({
          type: "error",
          title: "Could not revoke that session",
          description: error instanceof Error ? error.message : "Unknown error.",
        });
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  return (
    <SettingsSection
      title="Devices and sessions"
      icon={<MonitorSmartphoneIcon />}
      headerAction={
        <span className="text-xs text-muted-foreground">
          {active.length} active {active.length === 1 ? "session" : "sessions"}
        </span>
      }
    >
      {sessions.length === 0 ? (
        <div className="px-1 py-3.5 text-xs text-muted-foreground">No sessions recorded yet.</div>
      ) : (
        <div className="divide-y divide-border/60">
          {sessions.map((session) => (
            <AccountRow
              key={session.sessionId}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {describeSessionMethod(session.method)}
                  {session.current ? (
                    <Badge variant="outline" size="sm">
                      This device
                    </Badge>
                  ) : null}
                  {session.revokedAt ? (
                    <Badge variant="outline" size="sm">
                      Revoked
                    </Badge>
                  ) : null}
                </span>
              }
              description={
                session.revokedAt
                  ? `Revoked ${formatTimestamp(session.revokedAt)}`
                  : `Last used ${formatTimestamp(session.lastSeenAt)} · expires ${formatTimestamp(session.expiresAt)}`
              }
            >
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={session.revokedAt !== null || busy !== null}
                onClick={() => void revoke(session.sessionId)}
              >
                {busy === session.sessionId ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                ) : (
                  <LogOutIcon className="size-3.5" />
                )}
                Revoke
              </Button>
            </AccountRow>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
