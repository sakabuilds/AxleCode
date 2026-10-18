import {
  ArrowUpRightIcon,
  CheckIcon,
  LoaderCircleIcon,
  MinusCircleIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import { useAccountState } from "../../account/AccountAuthProvider";
import { useAccountSnapshot } from "../../account/useAccountSnapshot";
import { startPlanCheckout } from "../billing/UpgradeDialog";
import { resolveCloudPublicConfig } from "../../cloud/publicConfig";
import {
  PLAN_DISPLAY,
  PLAN_ORDER,
  planTierFromId,
  type PlanTier,
} from "../../entitlements/planCatalog";
import { useEntitlements, resolvedEntitlements } from "../../entitlements/useEntitlements";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SettingsSection } from "../settings/settingsLayout";

function PlanRow({
  tier,
  currentPlan,
  busy,
  disabled,
  onCheckout,
}: {
  readonly tier: PlanTier;
  readonly currentPlan: PlanTier;
  readonly busy: PlanTier | null;
  readonly disabled: boolean;
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
            disabled={busy === tier || disabled}
            onClick={() => onCheckout(tier)}
          >
            {busy === tier ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <ArrowUpRightIcon className="size-3.5" />
            )}
            {PLAN_ORDER.indexOf(tier) < PLAN_ORDER.indexOf(currentPlan)
              ? `Switch to ${plan.name}`
              : `Upgrade to ${plan.name}`}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The plan tab of the billing page: the current plan plus per-tier upgrade
 * buttons. Enforcement stays server-side; this section only presents and
 * starts hosted checkouts. An unresolved plan displays as Free — every
 * account falls back to the Free tier — while the note under the name
 * explains what could not be refreshed.
 */
export function BillingPlanSection() {
  const account = useAccountState();
  const { state: accountSnapshot } = useAccountSnapshot();
  const entitlementSnapshot = useEntitlements();
  const entitlements = resolvedEntitlements(entitlementSnapshot);
  const resolvedPlan = planTierFromId(entitlements?.planId ?? null);
  const currentPlan: PlanTier = resolvedPlan ?? "free";
  const accountApiUrl = resolveCloudPublicConfig().accountApiUrl;
  const email =
    accountSnapshot.snapshot?.user?.email ??
    account.user?.primaryEmailAddress?.emailAddress ??
    null;
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

  const planNote = (() => {
    if (resolvedPlan !== null) return PLAN_DISPLAY[resolvedPlan].tagline;
    if (entitlementSnapshot.status === "loading") return "Checking your plan…";
    if (account.status !== "signed-in") return "Sign in to sync your plan across your devices.";
    if (accountApiUrl === null) {
      return "This build has no account service, so plans and checkout are unavailable.";
    }
    return "Your plan could not be refreshed; showing the Free plan until it loads.";
  })();

  return (
    <SettingsSection title="Current plan" icon={<SparklesIcon />}>
      <div className="px-1 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-foreground">
                {PLAN_DISPLAY[currentPlan].name}
              </span>
              {resolvedPlan !== null && resolvedPlan !== "free" ? (
                <Badge variant="secondary" size="sm">
                  {PLAN_DISPLAY[resolvedPlan].price}/{PLAN_DISPLAY[resolvedPlan].priceUnit}
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{planNote}</p>
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
            disabled={account.status !== "signed-in" || accountApiUrl === null}
            onCheckout={(tier) => void checkout(tier)}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
