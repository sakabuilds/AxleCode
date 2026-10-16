import {
  CheckIcon,
  ExternalLinkIcon,
  Link2Icon,
  Link2OffIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useAccountActions } from "../../account/AccountAuthProvider";
import {
  unlinkAccountIdentity,
  type AccountIdentity,
  type SignInProvider,
} from "../../account/accountClient";
import { SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { AccountRow } from "./accountShared";
import { formatTimestamp, providerLabel } from "./accountFormat";

/**
 * Sign-in methods attached to this account. A second provider is matched to the
 * same Axle account by verified email, so connecting one does not fork it.
 */
export function ConnectedAccountsSection({
  identities,
  availableProviders,
  onChanged,
}: {
  readonly identities: ReadonlyArray<AccountIdentity>;
  readonly availableProviders: ReadonlyArray<SignInProvider>;
  readonly onChanged: () => Promise<void>;
}) {
  const { linkProvider } = useAccountActions();
  const [busy, setBusy] = useState<string | null>(null);
  const linked = useMemo(
    () => new Set(identities.map((identity) => identity.provider)),
    [identities],
  );
  const missing = availableProviders.filter((provider) => !linked.has(provider.id));
  // Removing the only identity would leave the account unreachable.
  const canDisconnect = identities.length > 1;

  const disconnect = useCallback(
    async (provider: string) => {
      setBusy(provider);
      try {
        await unlinkAccountIdentity(provider);
        await onChanged();
        toastManager.add({ type: "success", title: `Disconnected ${providerLabel(provider)}` });
      } catch (error: unknown) {
        toastManager.add({
          type: "error",
          title: `Could not disconnect ${providerLabel(provider)}`,
          description: error instanceof Error ? error.message : "Unknown error.",
        });
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const connect = useCallback(
    async (provider: string) => {
      setBusy(provider);
      try {
        await linkProvider(provider);
      } catch (error: unknown) {
        toastManager.add({
          type: "error",
          title: `Could not connect ${providerLabel(provider)}`,
          description: error instanceof Error ? error.message : "Unknown error.",
        });
      } finally {
        setBusy(null);
      }
    },
    [linkProvider],
  );

  return (
    <SettingsSection title="Sign-in methods" icon={<Link2Icon />}>
      <div className="divide-y divide-border/60">
        {identities.map((identity) => (
          <AccountRow
            key={identity.provider}
            title={
              <span className="flex items-center gap-2">
                {providerLabel(identity.provider)}
                <Badge variant="success" size="sm" className="gap-1">
                  <CheckIcon className="size-3" />
                  Connected
                </Badge>
              </span>
            }
            description={`${identity.login ?? identity.email ?? "Connected"} · joined ${formatTimestamp(identity.linkedAt)}`}
          >
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!canDisconnect || busy !== null}
              title={canDisconnect ? undefined : "Connect another sign-in method first."}
              onClick={() => void disconnect(identity.provider)}
            >
              {busy === identity.provider ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <Link2OffIcon className="size-3.5" />
              )}
              Disconnect
            </Button>
          </AccountRow>
        ))}
        {missing.map((provider) => (
          <AccountRow
            key={provider.id}
            title={provider.label}
            description="Not connected. Add it to sign in to this same account from another device."
          >
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={busy !== null}
              onClick={() => void connect(provider.id)}
            >
              {busy === provider.id ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <ExternalLinkIcon className="size-3.5" />
              )}
              Connect
            </Button>
          </AccountRow>
        ))}
        {identities.length === 0 ? (
          <AccountRow
            title="No sign-in method connected"
            description="Sign out and back in to restore access to this account."
          />
        ) : null}
      </div>
    </SettingsSection>
  );
}
