/**
 * Shared chrome for the Axle account pages.
 *
 * Every account page needs the same four states — signed out, loading, failed,
 * and loaded — so they are resolved once here and each page renders only its
 * own content.
 */

import { LoaderCircleIcon, LogInIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useAccountActions, useAccountState } from "../../account/AccountAuthProvider";
import type { AccountSnapshot } from "../../account/accountClient";
import { useAccountSnapshot } from "../../account/useAccountSnapshot";
import { cn } from "../../lib/utils";
import { SettingsPageContainer, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { AccountAvatar } from "./AccountAvatar";

/** A settings row: label and description on the left, controls on the right. */
export function AccountRow({
  title,
  description,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-1 py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        {description ? (
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

function SignedOutNotice() {
  const account = useAccountState();
  const { signIn } = useAccountActions();
  const loading = account.status === "loading";
  return (
    <SettingsSection title="Sign in" icon={<ShieldCheckIcon />}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
        <p className="max-w-prose text-[13px] leading-6 text-muted-foreground">
          {loading
            ? "Checking your Axle session…"
            : "You are not signed in. Sign in with GitHub or Google to sync your profile, provider keys, and credits across every device."}
        </p>
        <Button size="sm" disabled={loading} onClick={() => signIn()}>
          <LogInIcon className="size-3.5" />
          Sign in to Axle
        </Button>
      </div>
    </SettingsSection>
  );
}

function SnapshotUnavailable({
  error,
  onRetry,
}: {
  readonly error: string | null;
  readonly onRetry: () => Promise<void>;
}) {
  return (
    <SettingsSection title="Account unavailable" icon={<ShieldCheckIcon />}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
        <p className="max-w-prose text-[13px] leading-6 text-muted-foreground">
          {error ?? "Your account could not be loaded."}
        </p>
        <Button size="sm" variant="outline" onClick={() => void onRetry()}>
          <RefreshCwIcon className="size-3.5" />
          Try again
        </Button>
      </div>
    </SettingsSection>
  );
}

/**
 * Resolves the account state and hands the loaded snapshot to `children`.
 * `children` is only called once a snapshot exists, so pages never have to
 * narrow it themselves.
 */
export function AccountPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: (snapshot: AccountSnapshot, reload: () => Promise<void>) => ReactNode;
}) {
  const account = useAccountState();
  const { state, reload } = useAccountSnapshot();
  // `exactOptionalPropertyTypes` is on, so an absent description must be
  // omitted rather than passed as explicitly undefined.
  const header = { title, ...(description === undefined ? {} : { description }) };

  if (account.status !== "signed-in") {
    return (
      <SettingsPageContainer {...header}>
        <SignedOutNotice />
      </SettingsPageContainer>
    );
  }

  if (state.snapshot === null) {
    if (state.status === "loading") {
      return (
        <SettingsPageContainer {...header}>
          <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Loading your account…
          </div>
        </SettingsPageContainer>
      );
    }
    return (
      <SettingsPageContainer {...header}>
        <SnapshotUnavailable error={state.error} onRetry={reload} />
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer {...header}>{children(state.snapshot, reload)}</SettingsPageContainer>
  );
}

/** The identity card every account page can lead with. */
export function AccountIdentityHeader({
  snapshot,
  className,
}: {
  readonly snapshot: AccountSnapshot;
  readonly className?: string;
}) {
  const { user } = snapshot;
  const label = user.displayName ?? user.email ?? "Axle account";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border/80 bg-card/40 px-4 py-3.5",
        className,
      )}
    >
      <AccountAvatar url={user.avatarUrl} name={label} email={user.email} className="size-11" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {user.email ?? "No email on file"}
        </div>
      </div>
    </div>
  );
}
