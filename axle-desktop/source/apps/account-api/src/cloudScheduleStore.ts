// @effect-diagnostics globalDate:off
import type { CloudSchedule, CloudScheduleInput } from "@axle/contracts";
import { nextScheduledRun, validateScheduleTiming } from "@axle/shared/scheduleTiming";

import type { BillingConfig } from "./billingConfig.ts";
import type { CloudConfig } from "./cloudConfig.ts";
import { CloudJobError } from "./cloudErrors.ts";
import { createCloudEntitlementResolver, type CloudQuery } from "./cloudStore.ts";
import {
  resolveCloudEnvironment,
  validateCloudModel,
  validateCloudRepository,
} from "./cloudTargets.ts";

const PINNED_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export interface DueCloudSchedule extends CloudSchedule {
  readonly userId: string;
}

/**
 * Control-plane schedule store. Schedules live next to cloud jobs so a run can
 * be dispatched while the user's machine is offline; the local scheduler in
 * `apps/server` is untouched and keeps targeting local threads.
 */
export function createCloudScheduleStore(
  query: CloudQuery,
  config: CloudConfig,
  billing: BillingConfig | null = null,
) {
  const entitlementFor = createCloudEntitlementResolver(query, billing);
  return {
    async list(userId: string): Promise<{ schedules: ReadonlyArray<CloudSchedule> }> {
      return (await query("schedule-list", { userId })) as {
        schedules: ReadonlyArray<CloudSchedule>;
      };
    },
    async get(userId: string, scheduleId: string): Promise<CloudSchedule> {
      return (await query("schedule-get", { userId, scheduleId })) as CloudSchedule;
    },
    async save(userId: string, input: CloudScheduleInput): Promise<CloudSchedule> {
      const environment = resolveCloudEnvironment(config, input.environmentId);
      const repository = validateCloudRepository(environment, input.repositoryUrl);
      validateCloudModel(environment, input.providerInstanceId, input.model);
      // Branch tracking needs a resolver; only github.com is supported today,
      // so other hosts must pin a full commit id.
      if (!PINNED_REVISION.test(input.sourceRef) && repository.hostname !== "github.com")
        throw new CloudJobError("invalid_source_ref");
      try {
        validateScheduleTiming(input);
      } catch {
        throw new CloudJobError("invalid_schedule");
      }
      const entitlement = await entitlementFor(userId);
      if (entitlement !== null && !entitlement.cloudJobsEnabled)
        throw new CloudJobError("cloud_not_entitled");
      const nextRunAt = input.active ? nextScheduledRun(input, Date.now()) : null;
      return (await query("schedule-save", {
        userId,
        schedule: input,
        maxSchedules: entitlement?.features.scheduledTasksMax ?? null,
        nextRunAt: nextRunAt === null ? null : new Date(nextRunAt),
      })) as CloudSchedule;
    },
    async remove(userId: string, scheduleId: string): Promise<boolean> {
      const result = (await query("schedule-remove", { userId, scheduleId })) as {
        deleted: boolean;
      };
      return result.deleted;
    },
    /** Every active schedule due at `now`, across all users. Internal to the runner. */
    async due(now: Date, limit: number): Promise<ReadonlyArray<DueCloudSchedule>> {
      const result = (await query("schedule-due", { now, limit })) as {
        schedules: ReadonlyArray<DueCloudSchedule>;
      };
      return result.schedules;
    },
    /**
     * Compare-and-set on the due slot so overlapping runners cannot both
     * dispatch the same occurrence. The losing runner reports false.
     */
    async advance(
      scheduleId: string,
      expectedNextRunAt: Date,
      nextRunAt: Date | null,
    ): Promise<boolean> {
      const result = (await query("schedule-advance", {
        scheduleId,
        expectedNextRunAt,
        nextRunAt,
      })) as { advanced: boolean };
      return result.advanced;
    },
    async recordResult(
      scheduleId: string,
      result: { jobId: string | null; sourceRevision: string | null; error: string | null },
    ): Promise<void> {
      await query("schedule-result", { scheduleId, ...result });
    },
  };
}
export type CloudScheduleStore = ReturnType<typeof createCloudScheduleStore>;
