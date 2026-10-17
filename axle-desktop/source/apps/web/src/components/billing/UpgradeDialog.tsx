import { ArrowUpRightIcon, CheckIcon, SparklesIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  PLAN_DISPLAY,
  PLAN_ORDER,
  planTierFromId,
  resolvePricingUrl,
  type PlanTier,
} from "../../entitlements/planCatalog";
import { useEntitlements, resolvedEntitlements } from "../../entitlements/useEntitlements";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export type UpgradeReason =
  | "cloud-jobs"
  | "schedules"
  | "pull-request-reviews"
  | "premium-models"
  | "account-menu";

const REASON_COPY: Record<UpgradeReason, { readonly title: string; readonly description: string }> =
  {
    "cloud-jobs": {
      title: "Cloud jobs are part of Axle Pro",
      description:
        "Cloud jobs run on Axle runners that keep working when this computer is offline, with an included monthly credit bundle.",
    },
    schedules: {
      title: "You have reached the Free scheduled-task limit",
      description:
        "Pro raises the limit to 50 scheduled tasks so recurring work can keep running across all of your chats.",
    },
    "pull-request-reviews": {
      title: "Model-assisted pull-request reviews are part of Axle Pro",
      description:
        "Pro reviews your pull requests with the model of your choice and posts the findings back to GitHub.",
    },
    "premium-models": {
      title: "Premium models are part of Axle Pro",
      description:
        "Pro unlocks the top tiers of the Axle model catalog, billed from your included credits.",
    },
    "account-menu": {
      title: "Get more out of Axle",
      description:
        "Pro adds cloud jobs, unlimited scheduled tasks, pull-request reviews, and premium models. Team brings the same to every seat.",
    },
  };

interface UpgradeDialogState {
  readonly open: boolean;
  readonly reason: UpgradeReason;
}

let dialogState: UpgradeDialogState = { open: false, reason: "account-menu" };
const listeners = new Set<() => void>();

function publish(next: UpgradeDialogState): void {
  dialogState = next;
  for (const listener of listeners) {
    listener();
  }
}

export function openUpgradeDialog(reason: UpgradeReason = "account-menu"): void {
  publish({ open: true, reason });
}

export function closeUpgradeDialog(): void {
  publish({ ...dialogState, open: false });
}

function subscribeUpgradeDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readUpgradeDialogState(): UpgradeDialogState {
  return dialogState;
}

function openExternalUrl(url: string): void {
  const openExternal = window.desktopBridge?.openExternal;
  if (typeof openExternal === "function") {
    void openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function PlanCard({
  tier,
  currentPlan,
  pricingUrl,
}: {
  readonly tier: PlanTier;
  readonly currentPlan: PlanTier | null;
  readonly pricingUrl: string | null;
}) {
  const plan = PLAN_DISPLAY[tier];
  const isCurrent = currentPlan === tier;
  const isPaid = tier !== "free";
  const actionLabel =
    tier === "pro" ? "Upgrade to Pro" : tier === "team" ? "Contact sales" : "Stay on Free";

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-card/40 p-5",
        isCurrent && "border-ring/60 bg-accent/20",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
        {isCurrent ? (
          <Badge variant="outline" size="sm">
            Current plan
          </Badge>
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight text-foreground">{plan.price}</span>
        <span className="text-[11px] text-muted-foreground">{plan.priceUnit}</span>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{plan.tagline}</p>
      <ul className="mt-4 space-y-2">
        {plan.highlights.map((highlight) => (
          <li
            key={highlight}
            className="flex items-start gap-2 text-xs leading-5 text-foreground/85"
          >
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-foreground/60" />
            {highlight}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-5">
        {isCurrent ? (
          <Button variant="outline" size="sm" className="w-full" disabled>
            Current plan
          </Button>
        ) : (
          <Button
            variant={isPaid ? "default" : "outline"}
            size="sm"
            className="w-full"
            disabled={isPaid && pricingUrl === null}
            onClick={() => {
              if (isPaid && pricingUrl !== null) {
                openExternalUrl(pricingUrl);
                return;
              }
              closeUpgradeDialog();
            }}
          >
            {actionLabel}
            {isPaid ? <ArrowUpRightIcon className="size-3.5" /> : null}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Renders once at the app root; opened through `openUpgradeDialog`. */
export function UpgradeDialogHost() {
  const state = useSyncExternalStore(
    subscribeUpgradeDialog,
    readUpgradeDialogState,
    readUpgradeDialogState,
  );
  const entitlements = resolvedEntitlements(useEntitlements());
  const currentPlan = planTierFromId(entitlements?.planId ?? null);
  const pricingUrl = resolvePricingUrl();
  const copy = REASON_COPY[state.reason];

  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) closeUpgradeDialog();
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-muted-foreground" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3 sm:grid-cols-3" scrollFade={false}>
          {PLAN_ORDER.map((tier) => (
            <PlanCard key={tier} tier={tier} currentPlan={currentPlan} pricingUrl={pricingUrl} />
          ))}
          {pricingUrl === null ? (
            <p className="text-[11px] leading-4 text-muted-foreground sm:col-span-3">
              Paid checkout is not configured in this build. Set <code>VITE_PRICING_URL</code> to
              the pricing page to enable upgrades.
            </p>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
