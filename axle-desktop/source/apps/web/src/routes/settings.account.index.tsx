import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  CoinsIcon,
  KeyRoundIcon,
  Link2Icon,
  LogOutIcon,
  LoaderCircleIcon,
  MonitorSmartphoneIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import { useAccountActions } from "../account/AccountAuthProvider";
import { signOutAccount } from "../account/accountClient";
import { providerLabel } from "../components/account/accountFormat";
import {
  AccountIdentityHeader,
  AccountPage,
  AccountRow,
} from "../components/account/accountShared";
import { SettingsSection } from "../components/settings/settingsLayout";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";

function OverviewPage() {
  const { signOut } = useAccountActions();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      // Revoke server-side while the token can still be read, then clear locally.
      await signOutAccount();
    } catch {
      // A failed revoke must not trap the user in a signed-in shell.
    } finally {
      setSigningOut(false);
      signOut();
    }
  }, [signOut]);

  return (
    <AccountPage
      title="Account"
      description="Your Axle profile, sign-in methods, sessions, and hosted-provider credits."
    >
      {(snapshot) => {
        const activeSessions = snapshot.sessions.filter((session) => session.revokedAt === null);
        return (
          <>
            <AccountIdentityHeader snapshot={snapshot} />

            <SettingsSection title="At a glance" icon={<MonitorSmartphoneIcon />}>
              <div className="divide-y divide-border/60">
                <AccountRow title="Email">
                  <span className="truncate text-[13px] text-muted-foreground">
                    {snapshot.user.email ?? "Not set"}
                  </span>
                </AccountRow>
                <AccountRow title="Sign-in methods">
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {snapshot.identities.length === 0 ? (
                      <span className="text-[13px] text-muted-foreground">None</span>
                    ) : (
                      snapshot.identities.map((identity) => (
                        <Badge key={identity.provider} variant="outline" size="sm">
                          {providerLabel(identity.provider)}
                        </Badge>
                      ))
                    )}
                  </span>
                </AccountRow>
                <AccountRow
                  title="Active sessions"
                  description="Devices that can read this account without signing in again."
                >
                  <span className="text-[13px] text-muted-foreground">{activeSessions.length}</span>
                </AccountRow>
              </div>
            </SettingsSection>

            <SettingsSection title="Manage" icon={<KeyRoundIcon />}>
              <div className="divide-y divide-border/60">
                <AccountRow
                  title="Profile"
                  description="Change the name Axle shows and review your account details."
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    render={<Link to="/settings/account/profile" />}
                  >
                    Open
                    <ArrowRightIcon className="size-3.5" />
                  </Button>
                </AccountRow>
                <AccountRow
                  title="Sign-in methods"
                  description="Connect GitHub or Google so either one signs you in to this account."
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    render={<Link to="/settings/account/connections" />}
                  >
                    <Link2Icon className="size-3.5" />
                    Manage
                  </Button>
                </AccountRow>
                <AccountRow
                  title="Devices and sessions"
                  description="Revoke a device you no longer use."
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    render={<Link to="/settings/account/sessions" />}
                  >
                    <MonitorSmartphoneIcon className="size-3.5" />
                    Review
                  </Button>
                </AccountRow>
                <AccountRow
                  title="Credits"
                  description="Your Axle credit balance, model rates, and recent usage."
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    render={<Link to="/settings/account/credits" />}
                  >
                    <CoinsIcon className="size-3.5" />
                    View
                  </Button>
                </AccountRow>
                <AccountRow title="API keys" description="Keys for the Axle hosted provider.">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    render={<Link to="/settings/account/api-keys" />}
                  >
                    <KeyRoundIcon className="size-3.5" />
                    Manage
                  </Button>
                </AccountRow>
              </div>
            </SettingsSection>

            <SettingsSection title="Sign out" icon={<LogOutIcon />}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
                <p className="max-w-prose text-[13px] leading-6 text-muted-foreground">
                  Signs out on this device and revokes its session. Other devices stay signed in.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={signingOut}
                  className={cn(signingOut && "opacity-70")}
                  onClick={() => void handleSignOut()}
                >
                  {signingOut ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : (
                    <LogOutIcon className="size-3.5" />
                  )}
                  Sign out
                </Button>
              </div>
            </SettingsSection>
          </>
        );
      }}
    </AccountPage>
  );
}

export const Route = createFileRoute("/settings/account/")({
  component: OverviewPage,
});
