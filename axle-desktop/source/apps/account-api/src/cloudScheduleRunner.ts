// @effect-diagnostics cryptoRandomUUID:off globalDate:off
import * as NodeCrypto from "node:crypto";

import type { CloudJob, CloudJobCreateInput } from "@axle/contracts";
import { nextScheduledRun } from "@axle/shared/scheduleTiming";

import { CloudJobError } from "./cloudErrors.ts";
import type { CloudRevisionResolver } from "./cloudRevision.ts";
import type { CloudScheduleStore, DueCloudSchedule } from "./cloudScheduleStore.ts";
import type { CloudJobStore } from "./cloudStore.ts";

export interface CloudScheduleRunner {
  /** Dispatches every due schedule. Safe to call from overlapping triggers. */
  runDue(now?: Date): Promise<{ dispatched: number; failed: number }>;
  /** Manual trigger; dispatches now without moving the next occurrence. */
  runNow(userId: string, scheduleId: string): Promise<CloudJob>;
}

/**
 * Turns due cloud schedules into cloud jobs. The occurrence is claimed before
 * dispatch; failures are recorded on the schedule and reported to the next
 * occurrence instead of retrying in a loop.
 */
export function createCloudScheduleRunner(options: {
  schedules: CloudScheduleStore;
  jobs: CloudJobStore;
  revisions: CloudRevisionResolver;
  log?: (message: string, detail: Record<string, unknown>) => void;
}): CloudScheduleRunner {
  const log = options.log ?? (() => {});
  const dispatch = async (schedule: DueCloudSchedule, commandId: string): Promise<CloudJob> => {
    const sourceRevision = await options.revisions.resolve(
      schedule.repositoryUrl,
      schedule.sourceRef,
    );
    const input: CloudJobCreateInput = {
      commandId,
      environmentId: schedule.environmentId,
      repositoryUrl: schedule.repositoryUrl,
      sourceRevision,
      prompt: schedule.prompt,
      providerInstanceId: schedule.providerInstanceId,
      model: schedule.model,
      runtimeMode: "approval-required",
      interactionMode: "default",
    };
    const result = await options.jobs.dispatchScheduled(
      schedule.userId,
      input,
      schedule.scheduleId,
    );
    return result.job;
  };
  const commandIdFor = (scheduleId: string, slot: string): string =>
    `s-${NodeCrypto.createHash("sha256")
      .update(`${scheduleId}:${slot}`)
      .digest("hex")
      .slice(0, 62)}`;
  return {
    async runDue(now = new Date()) {
      let dispatched = 0;
      let failed = 0;
      const due = await options.schedules.due(now, 20);
      for (const schedule of due) {
        const slot = schedule.nextRunAt;
        if (slot === null) continue;
        const slotMs = Date.parse(slot);
        if (!Number.isFinite(slotMs)) continue;
        const next = nextScheduledRun(schedule, slotMs, slot);
        // Claim the occurrence before dispatch so overlapping runners skip it.
        const claimed = await options.schedules.advance(
          schedule.scheduleId,
          new Date(slotMs),
          next === null ? null : new Date(next),
        );
        if (!claimed) continue;
        try {
          const job = await dispatch(schedule, commandIdFor(schedule.scheduleId, slot));
          await options.schedules.recordResult(schedule.scheduleId, {
            jobId: job.jobId,
            sourceRevision: job.input.sourceRevision,
            error: null,
          });
          dispatched += 1;
        } catch (error) {
          const code = error instanceof CloudJobError ? error.code : "dispatch_failed";
          await options.schedules.recordResult(schedule.scheduleId, {
            jobId: null,
            sourceRevision: null,
            error: code,
          });
          failed += 1;
          log("cloud_schedule.dispatch_failed", { scheduleId: schedule.scheduleId, code });
        }
      }
      return { dispatched, failed };
    },
    async runNow(userId, scheduleId) {
      const schedule = await options.schedules.get(userId, scheduleId);
      const commandId = `manual-${NodeCrypto.randomUUID()}`;
      try {
        const job = await dispatch({ ...schedule, userId }, commandId);
        await options.schedules.recordResult(scheduleId, {
          jobId: job.jobId,
          sourceRevision: job.input.sourceRevision,
          error: null,
        });
        return job;
      } catch (error) {
        const code = error instanceof CloudJobError ? error.code : "dispatch_failed";
        await options.schedules.recordResult(scheduleId, {
          jobId: null,
          sourceRevision: null,
          error: code,
        });
        throw error;
      }
    },
  };
}
