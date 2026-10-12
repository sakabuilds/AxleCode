// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off
import { randomUUID } from "node:crypto";
import {
  CommandId,
  MessageId,
  ScheduledTaskError,
  ServerScheduledTask,
  type ScheduledTaskRun,
  type ThreadId,
} from "@axle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { Scheduler, type ScheduleExecutor } from "./Scheduler.ts";

export class ScheduledTasks extends Context.Service<ScheduledTasks, Scheduler>()(
  "axle/schedules/ScheduledTasks",
) {}

export const scheduleError = (cause: unknown) =>
  new ScheduledTaskError({
    message:
      cause instanceof Error ? cause.message : "Scheduled tasks could not be loaded. Try again.",
  });

const documentSchema = Schema.fromJsonString(Schema.Array(ServerScheduledTask));
const runMessageId = (run: ScheduledTaskRun) => MessageId.make(`schedule:${run.id}`);

export const ScheduledTasksLive = Layer.effect(
  ScheduledTasks,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const engine = yield* OrchestrationEngineService;
    const query = yield* ProjectionSnapshotQuery;

    // A single state document makes claiming a run and advancing its due time one SQLite transaction.
    yield* sql`CREATE TABLE IF NOT EXISTS scheduled_tasks_state (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)`;

    const getThread = async (threadId: ThreadId) => {
      const result = await Effect.runPromise(query.getThreadDetailById(threadId));
      if (
        Option.isNone(result) ||
        result.value.deletedAt !== null ||
        result.value.archivedAt !== null
      )
        throw new Error("The target chat was deleted or archived. Choose an active chat.");
      return result.value;
    };
    const getShell = async (threadId: ThreadId) => {
      const result = await Effect.runPromise(query.getThreadShellById(threadId));
      if (Option.isNone(result) || result.value.archivedAt !== null)
        throw new Error("The target chat was deleted or archived. Choose an active chat.");
      return result.value;
    };
    const isBusy = async (threadId: ThreadId) => {
      const thread = await getShell(threadId);
      return (
        thread.session?.status === "running" ||
        thread.session?.status === "starting" ||
        thread.latestTurn?.state === "running" ||
        thread.hasPendingApprovals ||
        thread.hasPendingUserInput
      );
    };

    const executor: ScheduleExecutor = {
      validateTarget: async (threadId) => {
        await getShell(threadId);
      },
      isBusy,
      dispatch: async (task, run) => {
        const thread = await getThread(run.threadId);
        if (thread.messages.some((entry) => entry.id === runMessageId(run))) return;
        if (await isBusy(run.threadId))
          throw new Error("The target chat started other work before this run could begin.");
        await Effect.runPromise(
          engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(`schedule:${run.id}`),
            threadId: run.threadId,
            message: {
              messageId: runMessageId(run),
              role: "user",
              text: task.prompt,
              attachments: [],
            },
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            createdAt: run.startedAt,
          }),
        );
      },
      inspect: async (run) => {
        const result = await Effect.runPromise(query.getThreadDetailById(run.threadId));
        if (Option.isNone(result) || result.value.deletedAt !== null)
          return { status: "failed", error: "The target chat was deleted." };
        const thread = result.value;
        const start = thread.messages.findIndex((entry) => entry.id === runMessageId(run));
        if (start < 0)
          return {
            status: "failed",
            error: "The scheduled message is missing from its chat. The run was not repeated.",
          };
        const subsequent = thread.messages.slice(start + 1);
        const nextUser = subsequent.findIndex((entry) => entry.role === "user");
        const messages = nextUser < 0 ? subsequent : subsequent.slice(0, nextUser);
        const finalMessage = messages.findLast((entry) => entry.role === "assistant");
        if (finalMessage && !finalMessage.streaming) return { status: "succeeded", error: null };
        if (nextUser >= 0)
          return {
            status: "failed",
            error: "Another turn started before this run produced a completed response.",
          };
        const shell = await Effect.runPromise(query.getThreadShellById(run.threadId));
        if (
          Option.isSome(shell) &&
          (shell.value.hasPendingApprovals || shell.value.hasPendingUserInput)
        )
          return { status: "needs-attention", error: "Open the chat to respond to the agent." };
        const latest = thread.latestTurn;
        if (latest && Date.parse(latest.requestedAt) >= Date.parse(run.startedAt)) {
          if (latest.state === "completed") return { status: "succeeded", error: null };
          if (latest.state === "error" || latest.state === "interrupted")
            return {
              status: "failed",
              error: thread.session?.lastError ?? "The run was interrupted.",
            };
        }
        if (
          thread.session?.status === "error" ||
          thread.session?.status === "stopped" ||
          thread.session?.status === "interrupted"
        )
          return {
            status: "failed",
            error:
              thread.session.lastError ?? "The provider session stopped before the run completed.",
          };
        if (Date.now() - Date.parse(run.startedAt) > 24 * 60 * 60_000)
          return {
            status: "failed",
            error: "The run did not complete within 24 hours. Check its chat before retrying.",
          };
        return { status: "running", error: null };
      },
    };

    const scheduler = new Scheduler(
      {
        read: () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const rows = yield* sql<{
                document: string;
              }>`SELECT document FROM scheduled_tasks_state WHERE id = 1`;
              return rows[0]
                ? yield* Schema.decodeUnknownEffect(documentSchema)(rows[0].document)
                : [];
            }),
          ),
        write: (tasks) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const document = yield* Schema.encodeEffect(documentSchema)(tasks);
              yield* sql`INSERT INTO scheduled_tasks_state (id, document) VALUES (1, ${document}) ON CONFLICT(id) DO UPDATE SET document = excluded.document`;
            }),
          ),
      },
      executor,
      Date.now,
      randomUUID,
    );

    yield* Effect.tryPromise({ try: () => scheduler.initialize(), catch: scheduleError });
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* Effect.sleep("5 seconds");
          yield* Effect.tryPromise({ try: () => scheduler.tick(), catch: scheduleError }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Scheduled task check failed", { message: error.message }),
            ),
          );
        }),
      ),
    );
    return scheduler;
  }),
);
