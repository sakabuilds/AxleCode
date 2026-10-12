import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ScheduledTaskInput = Schema.Struct({
  id: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  threadId: ThreadId,
  frequency: Schema.Literals(["hourly", "daily", "weekly", "once"]),
  intervalHours: Schema.Number,
  time: Schema.String,
  dayOfWeek: Schema.Literals([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]),
  date: Schema.String,
  timeZone: TrimmedNonEmptyString,
  active: Schema.Boolean,
});
export type ScheduledTaskInput = typeof ScheduledTaskInput.Type;

export const ScheduledTaskRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  scheduledAt: IsoDateTime,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  status: Schema.Literals([
    "pending",
    "running",
    "needs-attention",
    "succeeded",
    "failed",
    "skipped",
  ]),
  error: Schema.NullOr(Schema.String),
  manual: Schema.Boolean,
});
export type ScheduledTaskRun = typeof ScheduledTaskRun.Type;

export const ServerScheduledTask = Schema.Struct({
  ...ScheduledTaskInput.fields,
  id: TrimmedNonEmptyString,
  nextRunAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  runs: Schema.Array(ScheduledTaskRun),
});
export type ServerScheduledTask = typeof ServerScheduledTask.Type;

export const ScheduledTaskList = Schema.Struct({
  tasks: Schema.Array(ServerScheduledTask),
  targets: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      title: Schema.String,
      projectTitle: Schema.String,
    }),
  ),
});
export type ScheduledTaskList = typeof ScheduledTaskList.Type;

export const ScheduledTaskIdInput = Schema.Struct({ id: TrimmedNonEmptyString });
export const ScheduledTaskDeleteResult = Schema.Struct({ deleted: Schema.Boolean });

export class ScheduledTaskError extends Schema.TaggedErrorClass<ScheduledTaskError>()(
  "ScheduledTaskError",
  { message: Schema.String },
) {}
