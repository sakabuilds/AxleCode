import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CoinsIcon,
  GaugeIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  SparklesIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import {
  CREDIT_USD,
  fetchAxleCredits,
  fetchAxleModelRates,
  fetchAxleUsage,
  formatCredits,
  formatUsd,
  type AxleCredits,
  type AxleModelRate,
  type AxleUsageEntry,
} from "../../account/axleGateway";
import { useAccountApiKeys } from "../../account/useAccountApiKeys";
import { SettingsSection, useRelativeTimeTick } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { AccountRow } from "./accountShared";
import { epochToIso, formatTimestamp } from "./accountFormat";

const ENTRY_LABELS: Record<string, string> = {
  daily_grant: "Daily free credits",
  spend: "Model usage",
  settle: "Usage adjustment",
  top_up: "Top-up or refund",
  refund: "Usage adjustment",
};

function entryLabel(kind: string): string {
  return ENTRY_LABELS[kind] ?? kind.replaceAll("_", " ");
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

interface CreditsLoad {
  readonly credits: AxleCredits | null;
  readonly usage: ReadonlyArray<AxleUsageEntry>;
  readonly error: string | null;
  readonly loading: boolean;
}

function useAxleCredits(
  secret: string | null,
): CreditsLoad & { readonly reload: () => Promise<void> } {
  const [state, setState] = useState<CreditsLoad>({
    credits: null,
    usage: [],
    error: null,
    loading: true,
  });

  const reload = useCallback(async () => {
    if (!secret) {
      setState({ credits: null, usage: [], error: null, loading: false });
      return;
    }
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const [credits, usage] = await Promise.all([
        fetchAxleCredits(secret),
        fetchAxleUsage(secret),
      ]);
      setState({ credits, usage, error: null, loading: false });
    } catch (error: unknown) {
      setState((previous) => ({
        ...previous,
        loading: false,
        error: error instanceof Error ? error.message : "Credits could not be loaded.",
      }));
    }
  }, [secret]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}

function BalanceCard({
  credits,
  onRefresh,
  refreshing,
}: {
  readonly credits: AxleCredits;
  readonly onRefresh: () => Promise<void>;
  readonly refreshing: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card/40 px-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CoinsIcon className="size-3.5" />
            Axle credits
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl leading-9 font-semibold tracking-tight text-foreground">
              {formatCredits(credits.credits)}
            </span>
            <span className="text-sm text-muted-foreground">≈ {formatUsd(credits.balanceUsd)}</span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={refreshing}
          onClick={() => void onRefresh()}
        >
          {refreshing ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
          Refresh
        </Button>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Every account gets {formatCredits(credits.dailyFreeCredits)} credits (
        {formatUsd(credits.dailyFreeCredits * credits.creditUsd)}) each UTC day for free, applied
        the first time you use the hosted provider that day. Unused credits roll over; there is no
        separate paid balance.
      </p>
    </div>
  );
}

/** Model rates only change with a deploy, so they load once and stay put. */
function ModelRatesSection() {
  const [models, setModels] = useState<ReadonlyArray<AxleModelRate> | null>(null);

  useEffect(() => {
    let active = true;
    fetchAxleModelRates()
      .then((rates) => {
        if (active) setModels(rates);
      })
      .catch(() => {
        if (active) setModels([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <SettingsSection
      title="Model credit rates"
      icon={<GaugeIcon />}
      headerAction={<span className="text-xs text-muted-foreground">per 1M tokens</span>}
    >
      {models === null ? (
        <div className="flex items-center gap-2 px-1 py-3.5 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          Loading model rates…
        </div>
      ) : models.length === 0 ? (
        <div className="px-1 py-3.5 text-xs text-muted-foreground">
          Could not load the model catalog. Rates are also listed with the model picker.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Context</TableHead>
              <TableHead className="text-end">Input</TableHead>
              <TableHead className="text-end">Output</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow key={model.id}>
                <TableCell className="font-medium text-foreground">{model.label}</TableCell>
                <TableCell>
                  <Badge variant="outline" size="sm">
                    Tier {model.tier}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatContextWindow(model.contextWindow)}
                </TableCell>
                <TableCell className="text-end text-muted-foreground">
                  {formatCredits(model.creditsPerMillionInput)}
                </TableCell>
                <TableCell className="text-end text-muted-foreground">
                  {formatCredits(model.creditsPerMillionOutput)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="px-1 pt-3 text-xs leading-5 text-muted-foreground">
        One credit is {formatUsd(CREDIT_USD)}. A turn is reserved at its worst case before it runs
        and the unused part is refunded from the provider's own token report, so a long reply never
        costs more than it used.
      </p>
    </SettingsSection>
  );
}

function UsageSection({
  usage,
  loading,
}: {
  readonly usage: ReadonlyArray<AxleUsageEntry>;
  readonly loading: boolean;
}) {
  useRelativeTimeTick(30_000);
  return (
    <SettingsSection title="Recent activity" icon={<SparklesIcon />}>
      {loading && usage.length === 0 ? (
        <div className="flex items-center gap-2 px-1 py-3.5 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          Loading recent activity…
        </div>
      ) : usage.length === 0 ? (
        <div className="px-1 py-3.5 text-xs text-muted-foreground">
          Nothing yet. Send a message on the Axle provider and it will show up here.
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {usage.map((entry) => {
            const spend = entry.credits < 0;
            return (
              <AccountRow
                key={`${entry.createdAt}-${entry.kind}-${entry.balanceAfter}`}
                title={
                  <span className="flex items-center gap-2">
                    {spend ? (
                      <ArrowDownRightIcon className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ArrowUpRightIcon className="size-3.5 text-muted-foreground" />
                    )}
                    {entryLabel(entry.kind)}
                    {entry.model ? (
                      <Badge variant="outline" size="sm">
                        {entry.model}
                      </Badge>
                    ) : null}
                  </span>
                }
                description={`${formatTimestamp(epochToIso(entry.createdAt))} · balance after ${formatCredits(entry.balanceAfter)}`}
              >
                <span
                  className={
                    spend
                      ? "font-mono text-[13px] tabular-nums text-muted-foreground"
                      : "font-mono text-[13px] tabular-nums text-success-foreground"
                  }
                >
                  {spend ? "" : "+"}
                  {formatCredits(entry.credits)}
                </span>
              </AccountRow>
            );
          })}
        </div>
      )}
      {usage.length > 0 ? (
        <p className="px-1 pt-3 text-xs text-muted-foreground">
          Showing the most recent {usage.length} entries.
        </p>
      ) : null}
    </SettingsSection>
  );
}

function NoKeyNotice() {
  return (
    <SettingsSection title="No API key yet" icon={<KeyRoundIcon />}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
        <p className="max-w-prose text-[13px] leading-6 text-muted-foreground">
          Credits are spent through an Axle API key. Create one and your balance and usage will
          appear here.
        </p>
        <Button size="sm" render={<Link to="/settings/account/api-keys" />}>
          Create an API key
        </Button>
      </div>
    </SettingsSection>
  );
}

/**
 * Balance, rates, and activity for the hosted provider. The balance is read
 * through one of the account's own keys, because the gateway identifies a
 * caller by key — which is exactly what keeps the balance tied to the account
 * rather than to a rotating session token.
 */
export function CreditsSection() {
  const { keys, loading: keysLoading } = useAccountApiKeys();
  const activeKey = keys.find((key) => key.revokedAt === null) ?? null;
  const { credits, usage, error, loading, reload } = useAxleCredits(activeKey?.id ?? null);

  if (keysLoading && keys.length === 0) {
    return (
      <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Checking your API keys…
      </div>
    );
  }

  if (activeKey === null) return <NoKeyNotice />;

  return (
    <>
      {credits ? (
        <BalanceCard credits={credits} onRefresh={reload} refreshing={loading} />
      ) : (
        <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          Loading your credits…
        </div>
      )}

      {error !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card/40 px-4 py-3">
          <span className="text-xs text-muted-foreground">{error}</span>
          <Button size="sm" variant="outline" className="h-8" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : null}

      <ModelRatesSection />
      <UsageSection usage={usage} loading={loading} />
    </>
  );
}
