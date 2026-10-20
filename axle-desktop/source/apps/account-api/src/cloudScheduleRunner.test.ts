// @effect-diagnostics globalDate:off
import { describe, expect, it, vi } from "vite-plus/test";
import type { CloudJob } from "@axle/contracts";
import { CloudJobError } from "./cloudErrors.ts";
import { createCloudScheduleRunner } from "./cloudScheduleRunner.ts";
import type { CloudScheduleStore, DueCloudSchedule } from "./cloudScheduleStore.ts";
import type { CloudJobStore } from "./cloudStore.ts";
import { cloudScheduleFixture } from "./cloudTestFixtures.ts";

const REVISION = "b".repeat(40);
const SLOT = "2026-10-19T08:00:00.000Z";

function scheduleView(overrides: Partial<DueCloudSchedule> = {}): DueCloudSchedule {
  return {
    ...cloudScheduleFixture,
    sourceRevision: null,
    nextRunAt: SLOT,
    lastJobId: null,
    lastError: null,
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    userId: "user-a",
    ...overrides,
  } as DueCloudSchedule;
}

function dispatchResult(jobId = "job-1"): { job: CloudJob; created: boolean } {
  return {
    job: {
      jobId,
      input: { sourceRevision: REVISION },
    } as unknown as CloudJob,
    created: true,
  };
}

function createHarness(options: { due?: ReadonlyArray<DueCloudSchedule> } = {}) {
  const schedules = {
    list: vi.fn(),
    get: vi.fn(async () => scheduleView()),
    save: vi.fn(),
    remove: vi.fn(),
    due: vi.fn(async () => options.due ?? [scheduleView()]),
    advance: vi.fn(async () => true),
    recordResult: vi.fn(async () => {}),
  } as unknown as CloudScheduleStore;
  const jobs = {
    dispatchScheduled: vi.fn(async () => dispatchResult()),
  } as unknown as CloudJobStore;
  const revisions = { resolve: vi.fn(async () => REVISION) };
  const log = vi.fn();
  const runner = createCloudScheduleRunner({ schedules, jobs, revisions, log });
  return { schedules, jobs, revisions, log, runner };
}

describe("cloud schedule runner", () => {
  it("claims a due occurrence, dispatches full-access work, and records the job", async () => {
    const h = createHarness();
    expect(await h.runner.runDue(new Date(SLOT))).toEqual({ dispatched: 1, failed: 0 });
    expect(h.schedules.advance).toHaveBeenCalledWith(
      "schedule-1",
      new Date(SLOT),
      new Date("2026-10-20T08:00:00.000Z"),
    );
    expect(h.jobs.dispatchScheduled).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({
        commandId: expect.stringMatching(/^s-[a-f0-9]{62}$/u),
        environmentId: "linux-test",
        sourceRevision: REVISION,
        prompt: cloudScheduleFixture.prompt,
        runtimeMode: "approval-required",
        interactionMode: "default",
      }),
      "schedule-1",
    );
    expect(h.schedules.recordResult).toHaveBeenCalledWith("schedule-1", {
      jobId: "job-1",
      sourceRevision: REVISION,
      error: null,
    });
  });

  it("skips an occurrence another runner already claimed", async () => {
    const h = createHarness();
    vi.mocked(h.schedules.advance).mockResolvedValueOnce(false);
    expect(await h.runner.runDue(new Date(SLOT))).toEqual({ dispatched: 0, failed: 0 });
    expect(h.jobs.dispatchScheduled).not.toHaveBeenCalled();
  });

  it("consumes a one-shot occurrence when it fires", async () => {
    const h = createHarness({
      due: [scheduleView({ frequency: "once", date: "2026-10-19" })],
    });
    await h.runner.runDue(new Date(SLOT));
    expect(h.schedules.advance).toHaveBeenCalledWith("schedule-1", new Date(SLOT), null);
  });

  it("records a revision failure instead of retrying the same slot", async () => {
    const h = createHarness();
    vi.mocked(h.revisions.resolve).mockRejectedValueOnce(
      new CloudJobError("source_revision_unavailable"),
    );
    expect(await h.runner.runDue(new Date(SLOT))).toEqual({ dispatched: 0, failed: 1 });
    expect(h.schedules.recordResult).toHaveBeenCalledWith("schedule-1", {
      jobId: null,
      sourceRevision: null,
      error: "source_revision_unavailable",
    });
    expect(h.log).toHaveBeenCalledWith(
      "cloud_schedule.dispatch_failed",
      expect.objectContaining({ scheduleId: "schedule-1", code: "source_revision_unavailable" }),
    );
  });

  it("records a dispatch failure such as exhausted credits", async () => {
    const h = createHarness();
    vi.mocked(h.jobs.dispatchScheduled).mockRejectedValueOnce(
      new CloudJobError("insufficient_credits"),
    );
    expect(await h.runner.runDue(new Date(SLOT))).toEqual({ dispatched: 0, failed: 1 });
    expect(h.schedules.recordResult).toHaveBeenCalledWith("schedule-1", {
      jobId: null,
      sourceRevision: null,
      error: "insufficient_credits",
    });
  });

  it("dispatches a manual run without moving the next occurrence", async () => {
    const h = createHarness();
    const job = await h.runner.runNow("user-a", "schedule-1");
    expect(job.jobId).toBe("job-1");
    expect(h.schedules.advance).not.toHaveBeenCalled();
    expect(h.jobs.dispatchScheduled).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ commandId: expect.stringMatching(/^manual-/u) }),
      "schedule-1",
    );
    expect(h.schedules.recordResult).toHaveBeenCalledWith("schedule-1", {
      jobId: "job-1",
      sourceRevision: REVISION,
      error: null,
    });
  });

  it("records and rethrows manual dispatch failures", async () => {
    const h = createHarness();
    vi.mocked(h.revisions.resolve).mockRejectedValueOnce(
      new CloudJobError("source_revision_unavailable"),
    );
    await expect(h.runner.runNow("user-a", "schedule-1")).rejects.toMatchObject({
      code: "source_revision_unavailable",
    });
    expect(h.schedules.recordResult).toHaveBeenCalledWith("schedule-1", {
      jobId: null,
      sourceRevision: null,
      error: "source_revision_unavailable",
    });
  });
});
