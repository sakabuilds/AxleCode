import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@axle/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ScheduledTasks, scheduleError } from "./Service.ts";

export const schedulesHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "schedules",
  Effect.fnUntraced(function* (handlers) {
    const scheduler = yield* ScheduledTasks;
    const query = yield* ProjectionSnapshotQuery;
    return handlers
      .handle(
        "list",
        Effect.fn("environment.schedules.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const tasks = yield* Effect.tryPromise({
            try: () => scheduler.list(),
            catch: scheduleError,
          });
          const snapshot = yield* query.getShellSnapshot().pipe(Effect.mapError(scheduleError));
          return {
            tasks,
            targets: snapshot.threads
              .filter((thread) => thread.archivedAt === null)
              .map((thread) => ({
                threadId: thread.id,
                title: thread.title,
                projectTitle:
                  snapshot.projects.find((project) => project.id === thread.projectId)?.title ??
                  "Project",
              })),
          };
        }),
      )
      .handle(
        "save",
        Effect.fn("environment.schedules.save")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* Effect.tryPromise({
            try: () => scheduler.save(args.payload),
            catch: scheduleError,
          });
        }),
      )
      .handle(
        "remove",
        Effect.fn("environment.schedules.remove")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* Effect.tryPromise({
            try: () => scheduler.remove(args.payload.id),
            catch: scheduleError,
          });
        }),
      )
      .handle(
        "run",
        Effect.fn("environment.schedules.run")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* Effect.tryPromise({
            try: () => scheduler.runNow(args.payload.id),
            catch: scheduleError,
          });
        }),
      );
  }),
);
