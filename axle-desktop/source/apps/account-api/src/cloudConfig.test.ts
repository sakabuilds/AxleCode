import { describe, expect, it } from "vite-plus/test";
import { readCloudConfig } from "./cloudConfig.ts";
import { cloudConfigFixture } from "./cloudTestFixtures.ts";

describe("cloud configuration", () => {
  it("is disabled unless explicitly configured", () => expect(readCloudConfig({})).toBeNull());
  it("accepts a bounded, explicitly authorized environment", () => {
    expect(readCloudConfig({ AXLE_CLOUD_CONFIG: JSON.stringify(cloudConfigFixture) })).toEqual(cloudConfigFixture);
  });
  it.each([
    { ...cloudConfigFixture, allowedUserIds: [] },
    { ...cloudConfigFixture, maxActiveJobsPerUser: 0 },
    { ...cloudConfigFixture, workers: [{ ...cloudConfigFixture.workers[0], token: "short" }] },
    { ...cloudConfigFixture, workers: [{ ...cloudConfigFixture.workers[0], environmentIds: ["other"] }] },
    { ...cloudConfigFixture, environments: [{ ...cloudConfigFixture.environments[0], repositoryHosts: ["127.0.0.1"] }] },
    { ...cloudConfigFixture, environments: [{ ...cloudConfigFixture.environments[0], limits: { ...cloudConfigFixture.environments[0]!.limits, maxEvents: 100_000 } }] },
  ])("rejects invalid trust boundaries without exposing credentials", (config) => {
    try {
      readCloudConfig({ AXLE_CLOUD_CONFIG: JSON.stringify(config) });
      expect.fail("Expected invalid configuration");
    } catch (error) {
      expect(String(error)).toContain("AXLE_CLOUD_CONFIG is invalid");
      expect(String(error)).not.toContain("credential");
    }
  });
});
