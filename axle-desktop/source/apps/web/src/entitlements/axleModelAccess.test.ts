import type { CloudEntitlements } from "@axle/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { AxleModelRate } from "../account/axleGateway";
import { hiddenAxleModelSlugs } from "./axleModelAccess";

const rate = (id: string, plan: "free" | "paid"): AxleModelRate => ({
  id,
  label: id,
  tier: 0,
  plan,
  contextWindow: 128_000,
  creditsPerMillionInput: 10,
  creditsPerMillionOutput: 20,
});

const rates: ReadonlyArray<AxleModelRate> = [
  rate("gemma-4", "free"),
  rate("glm-5.3", "paid"),
  rate("nemotron-3-super", "paid"),
];

const entitlements = (planId: string): CloudEntitlements => ({
  planId,
  cloudJobsEnabled: planId !== "free",
  monthlyCredits: 0,
  maxConcurrentJobs: 1,
  features: { scheduledTasksMax: 2, pullRequestReviews: false, teamSharing: false },
});

describe("hidden Axle model slugs", () => {
  it("hides nothing when no plan was positively resolved", () => {
    expect(hiddenAxleModelSlugs(null, rates).size).toBe(0);
  });

  it("hides nothing when the catalog is unavailable", () => {
    expect(hiddenAxleModelSlugs(entitlements("free"), null).size).toBe(0);
  });

  it("hides paid models on the Free plan", () => {
    expect([...hiddenAxleModelSlugs(entitlements("free"), rates)].sort()).toEqual([
      "axle/glm-5.3",
      "axle/nemotron-3-super",
    ]);
  });

  it("hides nothing on a paid plan", () => {
    for (const planId of ["pro", "pro-plus", "ultra"]) {
      expect(hiddenAxleModelSlugs(entitlements(planId), rates).size).toBe(0);
    }
  });

  it("fails open for an unrecognized plan id", () => {
    expect(hiddenAxleModelSlugs(entitlements("enterprise"), rates).size).toBe(0);
  });
});
