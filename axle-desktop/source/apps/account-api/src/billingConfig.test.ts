import { describe, expect, it } from "vite-plus/test";
import { readBillingConfig, resolveCloudJobEntitlement } from "./billingConfig.ts";

const valid = {
  plans: [
    { planId: "free", cloudJobsEnabled: false, monthlyCredits: 20, maxConcurrentJobs: 1 },
    { planId: "pro", cloudJobsEnabled: true, monthlyCredits: 500, maxConcurrentJobs: 4 },
  ],
  defaultPlanId: "free",
  userPlans: { "user-a": "pro" },
  creditsPerMinute: 3,
  adminToken: "test-only-admin-credential-1234567890123456",
};

describe("billing configuration", () => {
  it("treats an absent or blank configuration as unmetered", () => {
    expect(readBillingConfig({})).toBeNull();
    expect(readBillingConfig({ AXLE_BILLING_CONFIG: "   " })).toBeNull();
  });
  it("parses a valid plan set", () => {
    const config = readBillingConfig({ AXLE_BILLING_CONFIG: JSON.stringify(valid) });
    expect(config?.creditsPerMinute).toBe(3);
    expect(config?.plans).toHaveLength(2);
    expect(config?.adminToken).toBe("test-only-admin-credential-1234567890123456");
  });
  it.each([
    ["not json", "AXLE_BILLING_CONFIG is invalid. See docs/cloud-execution.md."],
    [JSON.stringify({ ...valid, defaultPlanId: "missing" }), "AXLE_BILLING_CONFIG is invalid. See docs/cloud-execution.md."],
    [JSON.stringify({ ...valid, plans: [valid.plans[0], valid.plans[0]] }), "AXLE_BILLING_CONFIG is invalid. See docs/cloud-execution.md."],
    [JSON.stringify({ ...valid, userPlans: { "user-a": "unknown" } }), "AXLE_BILLING_CONFIG is invalid. See docs/cloud-execution.md."],
    [JSON.stringify({ ...valid, creditsPerMinute: -1 }), "AXLE_BILLING_CONFIG is invalid. See docs/cloud-execution.md."],
    [JSON.stringify({ ...valid, adminToken: "too-short" }), "AXLE_BILLING_CONFIG is invalid. See docs/cloud-execution.md."],
  ])("rejects invalid configuration %s without echoing it", (raw, message) => {
    expect(() => readBillingConfig({ AXLE_BILLING_CONFIG: raw })).toThrowError(message);
  });
  it("resolves the default plan and per-user assignments server-side", () => {
    const config = readBillingConfig({ AXLE_BILLING_CONFIG: JSON.stringify(valid) })!;
    expect(resolveCloudJobEntitlement(config, "user-a")).toEqual({
      planId: "pro", cloudJobsEnabled: true, monthlyCredits: 500, maxConcurrentJobs: 4,
    });
    expect(resolveCloudJobEntitlement(config, "stranger")).toEqual({
      planId: "free", cloudJobsEnabled: false, monthlyCredits: 20, maxConcurrentJobs: 1,
    });
  });
});