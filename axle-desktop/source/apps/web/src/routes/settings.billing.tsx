import { Link, createFileRoute } from "@tanstack/react-router";
import { CoinsIcon, CreditCardIcon } from "lucide-react";
import type { ComponentType } from "react";

import { BillingPlanSection } from "../components/account/BillingSection";
import { CreditsSection } from "../components/account/CreditsSection";
import { cn } from "../lib/utils";

type BillingTab = "plan" | "credits";

const BILLING_TABS: ReadonlyArray<{
  id: BillingTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "plan", label: "Plan", icon: CreditCardIcon },
  { id: "credits", label: "Credits", icon: CoinsIcon },
];

/**
 * Billing lives in the Settings sidebar; the plan and the credits ledger are
 * tabs inside it so everything about paying for Axle is one page. The active
 * tab is a search param so both tabs are deep-linkable.
 */
function BillingRoutePage() {
  const { tab } = Route.useSearch();
  const activeTab: BillingTab = tab === "credits" ? "credits" : "plan";
  return (
    <div className="scrollbar-gutter-both min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-8 sm:px-10 sm:py-11">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-9 pb-12">
        <div className="space-y-2 pb-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-tight text-foreground">
            Billing
          </h1>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            Your plan, monthly credits, and one-time credit packs. Checkouts open in Bachs&apos;s
            secure hosted page.
          </p>
        </div>

        <nav
          aria-label="Billing sections"
          className="flex w-fit items-center gap-1 rounded-xl border border-border/70 bg-muted/30 p-1"
        >
          {BILLING_TABS.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <Link
                key={id}
                to="/settings/billing"
                search={id === "credits" ? { tab: "credits" } : {}}
                replace
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive
                    ? "bg-background font-medium text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>

        {activeTab === "credits" ? <CreditsSection /> : <BillingPlanSection />}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/billing")({
  validateSearch: (search: Record<string, unknown>): { tab?: BillingTab } =>
    search.tab === "credits" ? { tab: "credits" } : {},
  component: BillingRoutePage,
});
