import { IdCardIcon, LoaderCircleIcon, UserRoundIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { updateAccountProfile, type AccountProfile } from "../../account/accountClient";
import { SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { AccountRow } from "./accountShared";
import { formatTimestamp } from "./accountFormat";

/** Edit the name shown in Axle, plus the read-only facts the worker owns. */
export function ProfileSection({
  profile,
  onSaved,
}: {
  readonly profile: AccountProfile;
  readonly onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(profile.displayName ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(profile.displayName ?? "");
  }, [profile.displayName]);

  const fallbackName = profile.email ?? "Axle account";
  const dirty = draft.trim() !== (profile.displayName ?? "");

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await updateAccountProfile(draft.trim().length > 0 ? draft.trim() : null);
      await onSaved();
      toastManager.add({ type: "success", title: "Profile saved" });
    } catch (error: unknown) {
      toastManager.add({
        type: "error",
        title: "Could not save your profile",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved]);

  return (
    <>
      <SettingsSection title="Profile" icon={<UserRoundIcon />}>
        <div className="divide-y divide-border/60">
          <AccountRow
            title="Display name"
            description={`Shown in Axle. Leave it empty to use ${fallbackName}.`}
          >
            <Input
              aria-label="Display name"
              value={draft}
              maxLength={120}
              placeholder="Your name"
              className="h-8 w-52"
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
              Save
            </Button>
          </AccountRow>
        </div>
      </SettingsSection>

      <SettingsSection title="Account" icon={<IdCardIcon />}>
        <div className="divide-y divide-border/60">
          <AccountRow
            title="Email"
            description="Provided by your sign-in method and verified by it."
          >
            <span className="truncate text-[13px] text-muted-foreground">
              {profile.email ?? "Not set"}
            </span>
          </AccountRow>
          <AccountRow title="Member since">
            <span className="text-[13px] text-muted-foreground">
              {formatTimestamp(profile.createdAt)}
            </span>
          </AccountRow>
          <AccountRow title="Account ID" description="Quote this when reporting a problem.">
            <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {profile.id}
            </code>
          </AccountRow>
        </div>
      </SettingsSection>
    </>
  );
}
