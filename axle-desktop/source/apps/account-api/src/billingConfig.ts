import * as Schema from "effect/Schema";

import { CloudPlanFeatures } from "@axle/contracts";

const Plan = Schema.Struct({
  planId: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]*$/u), Schema.isMaxLength(64)),
  cloudJobsEnabled: Schema.Boolean,
  monthlyCredits: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  maxConcurrentJobs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  features: Schema.optionalKey(CloudPlanFeatures),
  /**
   * Monthly gateway credits the plan grants on the hosted provider (the
   * 2,000 / 4,000 / 10,000 allowances). Zero when omitted.
   */
  gatewayCredits: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  ),
});
const Config = Schema.Struct({
  plans: Schema.Array(Plan).check(Schema.isMinLength(1)),
  defaultPlanId: Schema.String,
  userPlans: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  creditsPerMinute: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 })),
  adminToken: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(32), Schema.isMaxLength(256)),
  ),
});
const decode = Schema.decodeUnknownSync(Config);
export type BillingConfig = typeof Config.Type;
export type PlanFeatures = CloudPlanFeatures;

/**
 * Conservative baseline for plans that omit `features`: client surfaces stay
 * closed until the operator opts them in explicitly. Cloud-job entitlement is
 * never derived from these defaults.
 */
export const DEFAULT_PLAN_FEATURES: PlanFeatures = {
  scheduledTasksMax: 2,
  pullRequestReviews: false,
  teamSharing: false,
};

export interface CloudJobEntitlement {
  readonly planId: string;
  readonly cloudJobsEnabled: boolean;
  readonly monthlyCredits: number;
  readonly maxConcurrentJobs: number;
  readonly features: PlanFeatures;
}

/** Explicit operator billing configuration; absent means the deployment is unmetered. */
export function readBillingConfig(
  env: Readonly<Record<string, string | undefined>>,
): BillingConfig | null {
  const raw = env.AXLE_BILLING_CONFIG;
  if (!raw?.trim()) return null;
  try {
    const config = decode(JSON.parse(raw));
    const planIds = new Set(config.plans.map((plan) => plan.planId));
    if (planIds.size !== config.plans.length || !planIds.has(config.defaultPlanId))
      throw new Error();
    for (const planId of Object.values(config.userPlans ?? {})) {
      if (!planIds.has(planId)) throw new Error();
    }
    return config;
  } catch {
    throw new Error("AXLE_BILLING_CONFIG is invalid. See docs/cloud-execution.md.");
  }
}

/** The server resolves the plan; clients never supply or confirm their own entitlement. */
export function resolveCloudJobEntitlement(
  config: BillingConfig,
  userId: string,
): CloudJobEntitlement {
  const planId = config.userPlans?.[userId] ?? config.defaultPlanId;
  return resolvePlanEntitlement(config, planId);
}

/** Entitlement for a known plan id; the plan is guaranteed by prior validation. */
export function resolvePlanEntitlement(config: BillingConfig, planId: string): CloudJobEntitlement {
  const plan = config.plans.find((item) => item.planId === planId)!;
  return {
    planId: plan.planId,
    cloudJobsEnabled: plan.cloudJobsEnabled,
    monthlyCredits: plan.monthlyCredits,
    maxConcurrentJobs: plan.maxConcurrentJobs,
    features: plan.features ?? DEFAULT_PLAN_FEATURES,
  };
}
