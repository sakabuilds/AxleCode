import {
  ArrowUpRightIcon,
  CheckIcon,
  CoinsIcon,
  LoaderCircleIcon,
  MinusCircleIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import { useAccountState } from "../../account/AccountAuthProvider";
import { useAccountSnapshot } from "../../account/useAccountSnapshot";
import { formatCredits } from "../../account/axleGateway";
import { startCreditsCheckout, startPlanCheckout } from "../billing/UpgradeDialog";
import { resolveCloudPublicConfig } from "../../cloud/publicConfig";
import {
  PLAN_DISPLAY,
  PLAN_ORDER,
  planTierFromId,
  type PlanTier,
} from "../../entitlements/planCatalog";
import { useEntitlements, resolvedEntitlements } from "../../entitlements/useEntitlements";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsSection } from "../settings/settingsLayout";
import { useAxleCredits } from "./CreditsSection";

/** Credit packs start at $5; $1 buys 200 credits on the hosted provider. */
const CREDITS_PER_DOLLAR = 200;
const TOPUP_PRESETS = [5, 10, 25, 50] as const;
const MIN_TOPUP_USD = 5;
const MAX_TOPUP_USD = 500;

function wholeCents(value: number): boolean {
  return Number.isFinite(value) && Math.round(value * 100) === value * 100;
}

function PlanRow({
  tier,
  currentPlan,
  busy,
  disabled,
  email,
  accountApiUrl,
  onCheckout,
}: {
  readonly tier: PlanTier;
  readonly currentPlan: PlanTier | null;
  readonly busy: PlanTier | null;
  readonly disabled: boolean;
  readonly email: string | null;
  readonly accountApiUrl: string | null;
  readonly onCheckout: (tier: PlanTier) => void;
}) {
  const plan = PLAN_DISPLAY[tier];
  const isCurrent = currentPlan === tier;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{plan.name}</span>
          {isCurrent ? (
            <Badge variant="outline" size="sm">
              Current plan
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{plan.tagline}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] text-foreground">
          {plan.price}
          <span className="text-[11px] text-muted-foreground"> {plan.priceUnit}</span>
        </span>
        {isCurrent ? (
          <CheckIcon className="size-4 text-success-foreground" />
        ) : tier === "free" ? (
          <MinusCircleIcon className="size-4 text-muted-foreground/50" />
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy === tier || disabled || accountApiUrl === null}
            onClick={() => onCheckout(tier)}
          >
            {busy === tier ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <ArrowUpRightIcon className="size-3.5" />
            )}
            {currentPlan !== null &&
            PLAN_ORDER.indexOf(tier) < PLAN_ORDER.indexOf(currentPlan)
              ? `Switch to ${plan.name}`
              : `Upgrade to ${plan.name}`}
          </Button>
        )}
      </div>
    </div>
  );
}

function TopUpBox({
  email,
  accountApiUrl,
  signedIn,
}: {
  readonly email: string | null;
  readonly accountApiUrl: string | null;
  readonly signedIn: boolean;
}) {
  const [amount, setAmount] = useState<number | null>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buy = useCallback(
    async (usd: number) => {
      if (accountApiUrl === null) {
        setError("Checkout is not configured in this build.");
        return;
      }
      if (!signedIn) {
        setError("Sign in to buy credits.");
        return;
      }
      if (!wholeCents(usd) || usd < MIN_TOPUP_USD || usd > MAX_TOPUP_USD) {
        setError(`Enter an amount between $${MIN_TOPUP_USD} and $${MAX_TOPUP_USD}.`);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await startCreditsCheckout({ accountApiUrl, usd, email });
      } catch {
        setError("Could not start checkout. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [accountApiUrl, email, signedIn],
  );

  const amountText = amount === null ? "" : String(amount);
  const valid = amount !== null && wholeCents(amount) && amount >= MIN_TOPUP_USD && amount <= MAX_TOPUP_USD;

  return (
    <div className="px-1 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-foreground">Buy more credits</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Credits never expire. $1 buys {formatCredits(CREDITS_PER_DOLLAR)} credits; packs start
            at ${MIN_TOPUP_USD}.
          </p>
        </div>
        {valid && amount !== null ? (
          <Badge variant="secondary" size="sm">
            {formatCredits(amount * CREDITS_PER_DOLLAR)} credits
          </Badge>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {TOPUP_PRESETS.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant="outline"
            className={cn("h-8", amount === preset && "border-ring bg-accent")}
            disabled={busy}
            onClick={() => {
              setAmount(preset);
              void buy(preset);
            }}
          >
            ${preset}
          </Button>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            type="number"
            min={MIN_TOPUP_USD}
            max={MAX_TOPUP_USD}
            step="0.01"
            value={amountText}
            placeholder="Custom"
            className="h-8 w-24 text-[13px]"
            onChange={(event) => {
              const parsed = Number(event.target.value);
              setAmount(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
            }}
          />
          <Button
            size="sm"
            className="h-8"
            disabled={busy || !valid}
            onClick={() => amount !== null && void buy(amount)}
          >
            {busy ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <CoinsIcon className="size-3.5" />
            )}
            Buy credits
          </Button>
        </div>
      </div>
      {error !== null ? (
        <p className="mt-2 text-[11px] leading-4 text-destructive-foreground">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * The billing page: current plan, per-tier upgrade buttons, the credit
 * balance with its buckets, and one-time credit packs. Enforcement stays
 * server-side; this page only presents and starts hosted checkouts.
 */
export function BillingSection() {
  const account = useAccountState();
  const { state: accountSnapshot } = useAccountSnapshot();
  const entitlements = resolvedEntitlements(useEntitlements());
  const currentPlan = planTierFromId(entitlements?.planId ?? null);
  const { credits, connected, loading, reload } = useAxleCredits();
  const accountApiUrl = resolveCloudPublicConfig().accountApiUrl;
  const email =
    accountSnapshot.snapshot?.user?.email ?? account.user?.primaryEmailAddress?.emailAddress ?? null;
  const [checkoutBusy, setCheckoutBusy] = useState<PlanTier | null>(null);

  const checkout = useCallback(
    async (tier: PlanTier) => {
      if (tier === "free" || accountApiUrl === null) return;
      if (account.status !== "signed-in") return;
      setCheckoutBusy(tier);
      try {
        await startPlanCheckout({ accountApiUrl, plan: tier, email });
      } finally {
        setCheckoutBusy(null);
      }
    },
    [account.status, accountApiUrl, email],
  );

  return (
    <>
      <SettingsSection title="Current plan" icon={<SparklesIcon />}>
        <div className="px-1 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-foreground">
                  {currentPlan === null ? "Unknown plan" : PLAN_DISPLAY[currentPlan].name}
                </span>
                {currentPlan !== null && currentPlan !== "free" ? (
                  <Badge variant="secondary" size="sm">
                    {PLAN_DISPLAY[currentPlan].price}/{PLAN_DISPLAY[currentPlan].priceUnit}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {entitlements === null
                  ? "Plans are not configured in this deployment."
                  : currentPlan === null
                    ? "This account's plan could not be resolved."
                    : PLAN_DISPLAY[currentPlan].tagline}
              </p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-border/60 border-t border-border/60">
          {PLAN_ORDER.map((tier) => (
            <PlanRow
              key={tier}
              tier={tier}
              currentPlan={currentPlan}
              busy={checkoutBusy}
              disabled={account.status !== "signed-in"}
              email={email}
              accountApiUrl={accountApiUrl}
              onCheckout={(tier) => void checkout(tier)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Credits" icon={<CoinsIcon />}>
        {connected === false ? (
          <p className="px-1 py-4 text-[13px] leading-6 text-muted-foreground">
            This app is not spending from your Axle account yet. Create an API key under API keys to
            connect the hosted provider.
          </p>
        ) : credits === null ? (
          <div className="flex items-center gap-2 px-1 py-4 text-[13px] text-muted-foreground">
            {loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
            {loading ? "Loading your credits…" : "Credits could not be loaded."}
          </div>
        ) : (
          <div className="px-1 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-2xl font-semibold tracking-tight text-foreground">
                {formatCredits(credits.credits)} credits
              </span>
              <Button size="sm" variant="outline" className="h-8" onClick={() => void reload()}>
                {loading ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
                Refresh
              </Button>
            </div>
            <div className="mt-2 grid gap-1.5 text-xs leading-5 text-muted-foreground sm:grid-cols-3">
              <span>
                <span className="text-foreground/80">{formatCredits(credits.freeCredits)}</span>{" "}
                free — renews daily
              </span>
              <span>
                <span className="text-foreground/80">{formatCredits(credits.planCredits)}</span>{" "}
                plan — monthly allowance
              </span>
              <span>
                <span className="text-foreground/80">{formatCredits(credits.paidCredits)}</span>{" "}
                purchased — never expires
              </span>
            </div>
          </div>
        )}
        <div className="border-t border-border/60">
          <TopUpBox
            email={email}
            accountApiUrl={accountApiUrl}
            signedIn={account.status === "signed-in"}
          />
        </div>
      </SettingsSection>
    </>
  );
}
