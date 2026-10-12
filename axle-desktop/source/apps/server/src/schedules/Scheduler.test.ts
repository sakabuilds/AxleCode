import {
  ThreadId,
  type ScheduledTaskInput,
  type ScheduledTaskRun,
  type ServerScheduledTask,
} from "@axle/contracts";
import { describe, expect, it } from "vite-plus/test";

import { Scheduler, type ScheduleExecutor, type ScheduleStore } from "./Scheduler.ts";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const HOUR = 3_600_000;

function input(overrides: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput {
  return {
    id: "task-a",
    title: "Review changes",
    prompt: "Review the latest changes.",
    threadId: ThreadId.make("thread-a"),
    frequency: "hourly",
    intervalHours: 1,
    time: "12:00",
    dayOfWeek: "monday",
    date: "2026-10-11",
    timeZone: "UTC",
    active: true,
    ...overrides,
  };
}

function task(overrides: Partial<ServerScheduledTask> = {}): ServerScheduledTask {
  return {
    ...input(),
    id: "task-a",
    nextRunAt: new Date(NOW).toISOString(),
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    runs: [],
    ...overrides,
  };
}

function run(overrides: Partial<ScheduledTaskRun> = {}): ScheduledTaskRun {
  return {
    id: "original-run",
    threadId: ThreadId.make("thread-a"),
    scheduledAt: "2026-10-11T11:00:00.000Z",
    startedAt: "2026-10-11T11:00:00.000Z",
    completedAt: null,
    status: "running",
    error: null,
    manual: false,
    ...overrides,
  };
}

function harness(initial: readonly ServerScheduledTask[] = [task()]) {
  let stored = structuredClone(initial);
  let now = NOW;
  let sequence = 0;
  let rejectWrite: (tasks: readonly ServerScheduledTask[]) => boolean = () => false;
  const busy = new Set<ThreadId>();
  const accepted = new Set<string>();
  const attempts: ScheduledTaskRun[] = [];
  const results = new Map<string, { status: ScheduledTaskRun["status"]; error: string | null }>();
  const inspectionFailures = new Set<string>();
  const dispatchFailures = new Set<string>();
  const store: ScheduleStore = {
    read: async () => structuredClone(stored),
    write: async (tasks) => {
      if (rejectWrite(tasks)) throw new Error("The schedule journal is unavailable.");
      stored = structuredClone(tasks);
    },
  };
  const executor: ScheduleExecutor = {
    validateTarget: async () => undefined,
    isBusy: async (threadId) => busy.has(threadId),
    dispatch: async (scheduledTask, scheduledRun) => {
      attempts.push(structuredClone(scheduledRun));
      expect(stored.find((entry) => entry.id === scheduledTask.id)?.runs).toContainEqual(
        expect.objectContaining({ id: scheduledRun.id, status: "pending" }),
      );
      if (dispatchFailures.has(scheduledTask.id)) throw new Error("The provider rejected the run.");
      accepted.add(scheduledRun.id);
      busy.add(scheduledRun.threadId);
    },
    inspect: async (scheduledRun) => {
      if (inspectionFailures.has(scheduledRun.id))
        throw new Error("The target is temporarily unavailable.");
      return results.get(scheduledRun.id) ?? { status: "running", error: null };
    },
  };
  const create = () =>
    new Scheduler(
      store,
      executor,
      () => now,
      () => `generated-${++sequence}`,
    );
  return {
    scheduler: create(),
    stored: () => stored,
    setTime: (value: number) => {
      now = value;
    },
    rejectWrites: (predicate: typeof rejectWrite) => {
      rejectWrite = predicate;
    },
    restart: async () => {
      const scheduler = create();
      await scheduler.initialize();
      return scheduler;
    },
    busy,
    accepted,
    attempts,
    results,
    inspectionFailures,
    dispatchFailures,
  };
}

describe("Scheduler durability", () => {
  it("persists a pending claim before dispatch and suppresses concurrent manual runs", async () => {
    const state = harness([task({ active: false, nextRunAt: null })]);
    await state.scheduler.initialize();
    const outcomes = await Promise.allSettled([
      state.scheduler.runNow("task-a"),
      state.scheduler.runNow("task-a"),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected"]);
    expect(state.accepted.size).toBe(1);
    expect(state.stored()[0]?.runs[0]).toMatchObject({ status: "running", manual: true });
  });

  it("does not dispatch when the initial claim cannot be persisted", async () => {
    const state = harness();
    await state.scheduler.initialize();
    state.rejectWrites(() => true);
    await expect(state.scheduler.runNow("task-a")).rejects.toThrow("journal is unavailable");
    expect(state.attempts).toHaveLength(0);
    expect(state.stored()[0]?.runs).toEqual([]);
  });

  it("recovers a pending journal after acceptance without creating another command identity", async () => {
    const state = harness([task({ active: false, nextRunAt: null })]);
    await state.scheduler.initialize();
    state.rejectWrites((tasks) =>
      tasks.some((entry) => entry.runs.some((entryRun) => entryRun.status === "running")),
    );
    await expect(state.scheduler.runNow("task-a")).rejects.toThrow("journal is unavailable");
    expect(state.stored()[0]?.runs[0]?.status).toBe("pending");
    expect(state.accepted.size).toBe(1);

    state.rejectWrites(() => false);
    const restarted = await state.restart();
    await restarted.tick();
    expect(state.attempts).toHaveLength(2);
    expect(state.attempts[0]?.id).toBe(state.attempts[1]?.id);
    expect(state.accepted.size).toBe(1);
    expect(state.stored()[0]?.runs[0]?.status).toBe("running");
  });

  it("dispatches a durable pending claim that was not accepted before restart", async () => {
    const state = harness([
      task({ active: false, nextRunAt: null, runs: [run({ status: "pending" })] }),
    ]);
    const restarted = await state.restart();
    await restarted.tick();
    expect(state.attempts.map((entry) => entry.id)).toEqual(["original-run"]);
    expect(state.stored()[0]?.runs[0]?.status).toBe("running");
  });

  it("persists pause across restarts and does not run an overdue paused task", async () => {
    const state = harness();
    await state.scheduler.initialize();
    await state.scheduler.save(input({ active: false }));
    state.setTime(NOW + 4 * HOUR);
    const restarted = await state.restart();
    await restarted.tick();
    expect(state.accepted.size).toBe(0);
    expect(state.stored()[0]).toMatchObject({ active: false, nextRunAt: null });
  });
});

describe("Scheduler execution", () => {
  it("coalesces missed recurring occurrences once and preserves hourly cadence", async () => {
    const state = harness([task({ intervalHours: 2, nextRunAt: "2026-10-11T10:00:00.000Z" })]);
    state.setTime(Date.parse("2026-10-11T17:35:00Z"));
    await state.scheduler.initialize();
    await state.scheduler.tick();
    await state.scheduler.tick();
    expect(state.accepted.size).toBe(1);
    expect(state.stored()[0]).toMatchObject({ nextRunAt: "2026-10-11T18:00:00.000Z" });
    expect(state.stored()[0]?.runs[0]?.scheduledAt).toBe("2026-10-11T10:00:00.000Z");
  });

  it("disables one-off tasks after claiming their occurrence", async () => {
    const state = harness([task({ frequency: "once" })]);
    await state.scheduler.initialize();
    await state.scheduler.tick();
    await state.scheduler.tick();
    expect(state.accepted.size).toBe(1);
    expect(state.stored()[0]).toMatchObject({ active: false, nextRunAt: null });
  });

  it("records skipped occurrences instead of overlapping existing thread work", async () => {
    const state = harness();
    state.busy.add(ThreadId.make("thread-a"));
    await state.scheduler.initialize();
    await state.scheduler.tick();
    expect(state.attempts).toHaveLength(0);
    expect(state.stored()[0]?.runs[0]).toMatchObject({
      status: "skipped",
      completedAt: new Date(NOW).toISOString(),
    });
    expect(state.stored()[0]?.nextRunAt).toBe("2026-10-11T13:00:00.000Z");
  });

  it("retains unfinished runs when many later occurrences are skipped", async () => {
    const state = harness([task({ runs: [run()] })]);
    state.busy.add(ThreadId.make("thread-a"));
    await state.scheduler.initialize();
    for (let interval = 0; interval < 55; interval += 1) {
      state.setTime(NOW + interval * HOUR);
      await state.scheduler.tick();
    }
    const history = state.stored()[0]?.runs;
    expect(history).toHaveLength(50);
    expect(history).toContainEqual(
      expect.objectContaining({ id: "original-run", status: "running" }),
    );
    expect(state.attempts).toHaveLength(0);
  });

  it("isolates a temporary inspection failure and keeps that run recoverable", async () => {
    const state = harness([
      task({ active: false, nextRunAt: null, runs: [run()] }),
      task({ id: "task-b", threadId: ThreadId.make("thread-b") }),
    ]);
    state.inspectionFailures.add("original-run");
    await state.scheduler.initialize();
    await expect(state.scheduler.tick()).rejects.toThrow("temporarily unavailable");
    expect(state.accepted.size).toBe(1);
    expect(state.stored()[0]?.runs[0]?.status).toBe("running");
    expect(state.stored()[1]?.runs[0]?.status).toBe("running");

    state.inspectionFailures.clear();
    state.results.set("original-run", { status: "succeeded", error: null });
    await state.scheduler.tick();
    expect(state.stored()[0]?.runs[0]).toMatchObject({
      status: "succeeded",
      completedAt: new Date(NOW).toISOString(),
    });
  });

  it("records provider rejection without preventing another scheduled task", async () => {
    const state = harness([task(), task({ id: "task-b", threadId: ThreadId.make("thread-b") })]);
    state.dispatchFailures.add("task-a");
    await state.scheduler.initialize();
    await state.scheduler.tick();
    expect(state.stored()[0]?.runs[0]).toMatchObject({
      status: "failed",
      error: "The provider rejected the run.",
    });
    expect(state.stored()[1]?.runs[0]?.status).toBe("running");
  });
});
