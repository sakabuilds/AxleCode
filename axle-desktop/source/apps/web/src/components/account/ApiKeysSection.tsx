import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import {
  createAccountApiKey,
  revokeAccountApiKey,
  type AccountApiKey,
} from "../../account/accountClient";
import { axleGatewayBaseUrl } from "../../account/axleGateway";
import { useAccountApiKeys } from "../../account/useAccountApiKeys";
import { SettingsSection } from "../settings/settingsLayout";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { AccountRow } from "./accountShared";
import { formatTimestamp } from "./accountFormat";

function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toastManager.add({
        type: "error",
        title: "Could not copy",
        description: "Select the value and copy it manually.",
      });
    }
  }, [value]);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8"
      aria-label={label}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/**
 * The freshly minted key. It is shown exactly once — only a hash is stored, so
 * the worker cannot reproduce it and the UI must not pretend otherwise.
 */
function NewKeyCallout({
  secret,
  onDismiss,
}: {
  readonly secret: string;
  readonly onDismiss: () => void;
}) {
  return (
    <Alert>
      <AlertTitle className="flex items-center gap-2">
        <TriangleAlertIcon className="size-4" />
        Copy this key now
      </AlertTitle>
      <AlertDescription>
        <p>
          This is the only time Axle can show it. Axle stores a hash, so a lost key has to be
          replaced rather than recovered.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px]">
            {secret}
          </code>
          <CopyButton value={secret} label="Copy the new API key" />
          <Button size="sm" variant="ghost" className="h-8" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function useApiKeyTable() {
  const { keys, loading, error, reload } = useAccountApiKeys();
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const create = useCallback(
    async (name: string) => {
      setCreating(true);
      try {
        const { secret } = await createAccountApiKey(name.trim().length > 0 ? name.trim() : null);
        setFreshSecret(secret);
        await reload();
      } catch (createError: unknown) {
        toastManager.add({
          type: "error",
          title: "Could not create an API key",
          description: createError instanceof Error ? createError.message : "Unknown error.",
        });
      } finally {
        setCreating(false);
      }
    },
    [reload],
  );

  const revoke = useCallback(
    async (key: AccountApiKey) => {
      setBusy(key.id);
      try {
        await revokeAccountApiKey(key.id);
        await reload();
        toastManager.add({ type: "success", title: "API key revoked" });
      } catch (revokeError: unknown) {
        toastManager.add({
          type: "error",
          title: "Could not revoke that key",
          description: revokeError instanceof Error ? revokeError.message : "Unknown error.",
        });
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  return {
    keys,
    loading,
    error,
    busy,
    creating,
    freshSecret,
    create,
    revoke,
    reload,
    setFreshSecret,
  };
}

export function ApiKeysSection() {
  const table = useApiKeyTable();
  const [name, setName] = useState("");
  const active = table.keys.filter((key) => key.revokedAt === null);

  return (
    <>
      <SettingsSection
        title="Axle API keys"
        icon={<KeyRoundIcon />}
        headerAction={
          <span className="text-xs text-muted-foreground">
            {active.length} active {active.length === 1 ? "key" : "keys"}
          </span>
        }
      >
        {table.freshSecret ? (
          <div className="px-1 pt-3.5">
            <NewKeyCallout
              secret={table.freshSecret}
              onDismiss={() => table.setFreshSecret(null)}
            />
          </div>
        ) : null}

        <div className="divide-y divide-border/60">
          {table.loading && table.keys.length === 0 ? (
            <div className="flex items-center gap-2 px-1 py-3.5 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Loading your keys…
            </div>
          ) : null}

          {table.error !== null ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-3.5">
              <span className="text-xs text-muted-foreground">{table.error}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => void table.reload()}
              >
                Try again
              </Button>
            </div>
          ) : null}

          {table.keys.map((key) => (
            <AccountRow
              key={key.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {key.name ?? "Untitled key"}
                  {key.revokedAt ? (
                    <Badge variant="outline" size="sm">
                      Revoked
                    </Badge>
                  ) : null}
                </span>
              }
              description={
                <span className="font-mono text-[11px]">
                  {key.prefix}… · created {formatTimestamp(key.createdAt)} ·{" "}
                  {key.lastUsedAt ? `last used ${formatTimestamp(key.lastUsedAt)}` : "never used"}
                </span>
              }
            >
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={key.revokedAt !== null || table.busy !== null}
                onClick={() => void table.revoke(key)}
              >
                {table.busy === key.id ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                ) : null}
                Revoke
              </Button>
            </AccountRow>
          ))}

          <form
            className="flex flex-wrap items-center gap-2 px-1 py-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              void table.create(name).then(() => setName(""));
            }}
          >
            <Input
              aria-label="New API key name"
              value={name}
              maxLength={60}
              placeholder="Key name, for example “Laptop”"
              className="h-8 min-w-0 flex-1"
              onChange={(event) => setName(event.target.value)}
            />
            <Button size="sm" className="h-8" disabled={table.creating} type="submit">
              {table.creating ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <PlusIcon className="size-3.5" />
              )}
              Create key
            </Button>
          </form>
        </div>
      </SettingsSection>

      <SettingsSection title="Using a key" icon={<KeyRoundIcon />}>
        <div className="divide-y divide-border/60">
          <AccountRow title="Base URL" description="Point any OpenAI-compatible client here.">
            <code className="truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {axleGatewayBaseUrl()}
            </code>
            <CopyButton value={axleGatewayBaseUrl()} label="Copy the Axle gateway base URL" />
          </AccountRow>
          <AccountRow
            title="Environment"
            description="What Axle Desktop and the Axle CLI read to reach the hosted provider."
          >
            <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              AXLE_API_KEY
            </code>
          </AccountRow>
        </div>
      </SettingsSection>
    </>
  );
}
