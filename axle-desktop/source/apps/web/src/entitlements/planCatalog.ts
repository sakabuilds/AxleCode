/**
 * Display metadata for the Axle plan catalog.
 *
 * Enforcement always happens server-side from `AXLE_BILLING_CONFIG`; this file
 * only decides how a plan is presented. Prices are display copy — keep them in
 * sync with the pricing page before announcing paid sign-up.
 */

export type PlanTier = "free" | "pro" | "team";

export interface PlanDisplay {
  readonly tier: PlanTier;
  readonly name: string;
  readonly price: string;
  readonly priceUnit: string;
  readonly tagline: string;
  readonly highlights: readonly string[];
}

export const PLAN_ORDER: readonly PlanTier[] = ["free", "pro", "team"];

export const PLAN_DISPLAY: Record<PlanTier, PlanDisplay> = {
  free: {
    tier: "free",
    name: "Free",
    price: "$0",
    priceUnit: "forever",
    tagline: "Your local workspace, free to keep.",
    highlights: [
      "Local projects, terminal, and Git tools",
      "Bring your own model keys or local models",
      "Daily Axle model credits",
      "Up to 2 scheduled tasks",
    ],
  },
  pro: {
    tier: "pro",
    name: "Pro",
    price: "$20",
    priceUnit: "per month",
    tagline: "For individual work that should not wait.",
    highlights: [
      "Cloud jobs that keep running when you are offline",
      "Unlimited scheduled tasks",
      "Model-assisted pull-request reviews",
      "Premium Axle models",
    ],
  },
  team: {
    tier: "team",
    name: "Team",
    price: "$40",
    priceUnit: "per user / month",
    tagline: "Shared workflows for teams building together.",
    highlights: [
      "Everything in Pro, for every seat",
      "Shared workspace features as they ship",
      "Pooled credits and centralized billing",
      "Priority cloud capacity",
    ],
  },
};

export function planTierFromId(planId: string | null | undefined): PlanTier | null {
  return planId === "free" || planId === "pro" || planId === "team" ? planId : null;
}

/** Where the upgrade CTAs send people; unset means the CTA is disabled. */
export function resolvePricingUrl(): string | null {
  const raw = import.meta.env.VITE_PRICING_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
