// @effect-diagnostics globalDate:off
import type {
  ScheduledTaskInput,
  ScheduledTaskRun,
  ServerScheduledTask,
  ThreadId,
} from "@axle/contracts";

import { nextScheduledRun, validateSchedule } from "./timing.ts";

export interface ScheduleStore {
  read(): Promise<readonly ServerScheduledTask[]>;
  write(tasks: readonly ServerScheduledTask[]): Promise<void>;
}

export interface ScheduleExecutor {
  validateTarget(threadId: ThreadId): Promise<void>;
  isBusy(threadId: ThreadId): Promise<boolean>;
  dispatch(task: ServerScheduledTask, run: ScheduledTaskRun): Promise<void>;
  inspect(
    run: ScheduledTaskRun,
  ): Promise<{ status: ScheduledTaskRun["status"]; error: string | null }>;
}

const unfinished = (run: ScheduledTaskRun) =>
  ["pending", "running", "needs-attention"].includes(run.status);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The scheduled task could not run.";
const MAX_RUN_HISTORY = 50;

function retainRuns(runs: readonly ScheduledTaskRun[]): readonly ScheduledTaskRun[] {
  let finishedSlots = Math.max(0, MAX_RUN_HISTORY - runs.filter(unfinished).length);
  return runs.filter((run) => unfinished(run) || finishedSlots-- > 0);
}

/** Serialized, durable scheduler. The journal claim precedes dispatch; executor commands are idempotent. */
export class Scheduler {
  private tasks: readonly ServerScheduledTask[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly store: ScheduleStore;
  private readonly executor: ScheduleExecutor;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    store: ScheduleStore,
    executor: ScheduleExecutor,
    now: () => number,
    createId: () => string,
  ) {
    this.store = store;
    this.executor = executor;
    this.now = now;
    this.createId = createId;
  }

  async initialize(): Promise<void> {
    this.tasks = await this.store.read();
  }

  private serialized<A>(operation: () => Promise<A>): Promise<A> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async commit(tasks: readonly ServerScheduledTask[]): Promise<void> {
    await this.store.write(tasks);
    this.tasks = tasks;
  }

  private async replace(task: ServerScheduledTask): Promise<void> {
    await this.commit(this.tasks.map((entry) => (entry.id === task.id ? task : entry)));
  }

  list(): Promise<readonly ServerScheduledTask[]> {
    return this.serialized(async () => structuredClone(this.tasks));
  }

  save(input: ScheduledTaskInput): Promise<ServerScheduledTask> {
    return this.serialized(async () => {
      validateSchedule(input);
      await this.executor.validateTarget(input.threadId);
      const existing = input.id ? this.tasks.find((task) => task.id === input.id) : undefined;
      if (input.id && !existing)
        throw new Error("This scheduled task no longer exists. Refresh the list.");
      if (!existing && this.tasks.length >= 200)
        throw new Error("This environment supports up to 200 scheduled tasks.");
      if (
        existing?.runs.some(unfinished) &&
        (input.threadId !== existing.threadId || input.prompt !== existing.prompt)
      )
        throw new Error("Wait for the current run to finish before changing its chat or prompt.");
      const now = this.now();
      const timestamp = new Date(now).toISOString();
      const sameTiming =
        existing &&
        ["frequency", "intervalHours", "time", "dayOfWeek", "date", "timeZone"].every(
          (key) =>
            input[key as keyof ScheduledTaskInput] === existing[key as keyof ServerScheduledTask],
        );
      const nextRunAt = input.active
        ? existing?.active && sameTiming
          ? existing.nextRunAt
          : nextScheduledRun(input, now)
        : null;
      if (input.active && nextRunAt === null)
        throw new Error(
          "Choose a future date and time. That occurrence has passed or does not exist in this time zone.",
        );
      const task: ServerScheduledTask = {
        ...input,
        title: input.title.trim(),
        prompt: input.prompt.trim(),
        id: existing?.id ?? this.createId(),
        nextRunAt,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        runs: existing?.runs ?? [],
      };
      await this.commit(
        existing
          ? this.tasks.map((entry) => (entry.id === existing.id ? task : entry))
          : [...this.tasks, task],
      );
      return structuredClone(task);
    });
  }

  remove(id: string): Promise<{ deleted: boolean }> {
    return this.serialized(async () => {
      const task = this.tasks.find((entry) => entry.id === id);
      if (task?.runs.some(unfinished))
        throw new Error(
          "Wait for the current run to finish, or stop it in its chat, before deleting this task.",
        );
      await this.commit(this.tasks.filter((entry) => entry.id !== id));
      return { deleted: task !== undefined };
    });
  }

  runNow(id: string): Promise<ServerScheduledTask> {
    return this.serialized(async () => {
      const task = this.tasks.find((entry) => entry.id === id);
      if (!task) throw new Error("This scheduled task no longer exists.");
      if (task.runs.some(unfinished) || (await this.executor.isBusy(task.threadId)))
        throw new Error(
          "This chat is already working. Wait for it to finish before running the task.",
        );
      return this.start(task, true);
    });
  }

  private async updateRun(
    task: ServerScheduledTask,
    run: ScheduledTaskRun,
  ): Promise<ServerScheduledTask> {
    const updated = {
      ...task,
      updatedAt: new Date(this.now()).toISOString(),
      runs: task.runs.map((entry) => (entry.id === run.id ? run : entry)),
    };
    await this.replace(updated);
    return updated;
  }

  private async dispatch(
    task: ServerScheduledTask,
    run: ScheduledTaskRun,
  ): Promise<ServerScheduledTask> {
    try {
      await this.executor.dispatch(task, run);
    } catch (error) {
      return this.updateRun(task, {
        ...run,
        status: "failed",
        completedAt: new Date(this.now()).toISOString(),
        error: message(error),
      });
    }
    // A failed journal commit must leave the durable pending claim available for
    // recovery, even if the executor has already accepted the command.
    return this.updateRun(task, { ...run, status: "running" });
  }

  private async start(task: ServerScheduledTask, manual: boolean): Promise<ServerScheduledTask> {
    const timestamp = new Date(this.now()).toISOString();
    const scheduledAt = manual ? timestamp : (task.nextRunAt ?? timestamp);
    const busy = task.runs.some(unfinished) || (await this.executor.isBusy(task.threadId));
    const run: ScheduledTaskRun = {
      id: this.createId(),
      threadId: task.threadId,
      scheduledAt,
      startedAt: timestamp,
      completedAt: busy ? timestamp : null,
      status: busy ? "skipped" : "pending",
      error: busy
        ? "Skipped because the target chat was already working or waiting for input."
        : null,
      manual,
    };
    const nextRunAt = manual ? task.nextRunAt : nextScheduledRun(task, this.now(), scheduledAt);
    const claimed: ServerScheduledTask = {
      ...task,
      nextRunAt,
      active: manual ? task.active : nextRunAt !== null,
      updatedAt: timestamp,
      runs: retainRuns([run, ...task.runs]),
    };
    await this.replace(claimed);
    return busy ? claimed : this.dispatch(claimed, run);
  }

  tick(): Promise<void> {
    return this.serialized(async () => {
      const failures: unknown[] = [];
      for (const original of [...this.tasks]) {
        try {
          let task = this.tasks.find((entry) => entry.id === original.id)!;
          for (const run of task.runs.filter(unfinished)) {
            if (run.status === "pending") {
              // A crash may have occurred after command acceptance but before the journal update.
              // The executor uses this same run id for dispatch deduplication on every retry.
              task = await this.dispatch(task, run);
              continue;
            }
            const result = await this.executor.inspect(run);
            if (result.status !== run.status || result.error !== run.error) {
              task = await this.updateRun(task, {
                ...run,
                ...result,
                completedAt: ["succeeded", "failed", "skipped"].includes(result.status)
                  ? new Date(this.now()).toISOString()
                  : null,
              });
            }
          }
          if (task.active && task.nextRunAt !== null && Date.parse(task.nextRunAt) <= this.now())
            await this.start(task, false);
        } catch (error) {
          // Keep an unconfirmed run recoverable, but do not let one unavailable
          // target prevent other tasks from being inspected or dispatched.
          failures.push(error);
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, failures.map(message).join("; "));
    });
  }
}
