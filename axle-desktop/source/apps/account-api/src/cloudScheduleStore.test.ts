// @effect-diagnostics globalDate:off
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCloudScheduleStore } from "./cloudScheduleStore.ts";
import {
  billingConfigFixture,
  cloudConfigFixture,
  cloudScheduleFixture,
} from "./cloudTestFixtures.ts";

describe("cloud schedule store request boundaries", () => {
  const query = vi.fn(async (_operation?: string, _args?: unknown): Promise<unknown> => null);
  const store = createCloudScheduleStore(query, cloudConfigFixture, billingConfigFixture);
  beforeEach(() => query.mockClear());

  it("binds saves to the owner, the plan limit, and a computed next run", async () => {
    await store.save("user-a", cloudScheduleFixture);
    expect(query).toHaveBeenCalledWith(
      "schedule-save",
      expect.objectContaining({
        userId: "user-a",
        schedule: cloudScheduleFixture,
        maxSchedules: 2,
        nextRunAt: expect.any(Date),
      }),
    );
  });

  it("stores an inactive schedule without a next run", async () => {
    await store.save("user-a", { ...cloudScheduleFixture, active: false });
    expect(query).toHaveBeenCalledWith(
      "schedule-save",
      expect.objectContaining({ nextRunAt: null }),
    );
  });

  it.each([
    ["environment_unavailable", { environmentId: "unconfigured" }],
    ["model_unavailable", { model: "unconfigured" }],
    ["invalid_schedule", { timeZone: "Not/AZone" }],
    ["invalid_schedule", { time: "25:00" }],
  ])("rejects a save with %s before touching storage", async (code, overrides) => {
    await expect(
      store.save("user-a", { ...cloudScheduleFixture, ...overrides }),
    ).rejects.toMatchObject({ code });
    expect(query).not.toHaveBeenCalled();
  });

  it("requires pinned commits on hosts without branch resolution", async () => {
    const gitlabConfig = {
      ...cloudConfigFixture,
      environments: [{ ...cloudConfigFixture.environments[0]!, repositoryHosts: ["gitlab.com"] }],
    };
    const gitlab = createCloudScheduleStore(query, gitlabConfig, billingConfigFixture);
    const input = {
      ...cloudScheduleFixture,
      repositoryUrl: "https://gitlab.com/example/project.git",
    };
    await expect(gitlab.save("user-a", input)).rejects.toMatchObject({
      code: "invalid_source_ref",
    });
    expect(query).not.toHaveBeenCalled();
    await gitlab.save("user-a", { ...input, sourceRef: "a".repeat(40) });
    expect(query).toHaveBeenCalledWith(
      "schedule-save",
      expect.objectContaining({ userId: "user-a" }),
    );
  });

  it("rejects plans without the cloud-job entitlement", async () => {
    await expect(store.save("user-b", cloudScheduleFixture)).rejects.toMatchObject({
      code: "cloud_not_entitled",
    });
    expect(query).not.toHaveBeenCalledWith("schedule-save", expect.anything());
  });

  it("passes ownership boundaries through list, remove, and due", async () => {
    query.mockResolvedValueOnce({ schedules: [] });
    await store.list("user-a");
    expect(query).toHaveBeenCalledWith("schedule-list", { userId: "user-a" });

    query.mockResolvedValueOnce({ deleted: true });
    expect(await store.remove("user-a", "schedule-1")).toBe(true);
    expect(query).toHaveBeenCalledWith("schedule-remove", {
      userId: "user-a",
      scheduleId: "schedule-1",
    });

    const now = new Date("2026-10-19T08:00:00.000Z");
    query.mockResolvedValueOnce({ schedules: [] });
    await store.due(now, 20);
    expect(query).toHaveBeenCalledWith("schedule-due", { now, limit: 20 });
  });

  it("compare-and-sets the due slot and records the run result", async () => {
    query.mockResolvedValueOnce({ advanced: true });
    const expected = new Date("2026-10-19T08:00:00.000Z");
    const next = new Date("2026-10-20T08:00:00.000Z");
    expect(await store.advance("schedule-1", expected, next)).toBe(true);
    expect(query).toHaveBeenCalledWith("schedule-advance", {
      scheduleId: "schedule-1",
      expectedNextRunAt: expected,
      nextRunAt: next,
    });

    await store.recordResult("schedule-1", {
      jobId: "job-1",
      sourceRevision: "b".repeat(40),
      error: null,
    });
    expect(query).toHaveBeenCalledWith("schedule-result", {
      scheduleId: "schedule-1",
      jobId: "job-1",
      sourceRevision: "b".repeat(40),
      error: null,
    });
  });
});
