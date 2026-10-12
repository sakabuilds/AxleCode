import type { ScheduledTaskInput } from "@axle/contracts";
import * as Effect from "effect/Effect";

import { PrimaryEnvironmentHttpClient } from "../../environments/primary/httpClient";
import { runPrimaryHttp } from "../../lib/runtime";

export const listSchedules = () =>
  runPrimaryHttp(
    Effect.flatMap(PrimaryEnvironmentHttpClient, (client) =>
      client.schedules.list({ headers: {} }),
    ),
  );
export const saveSchedule = (payload: ScheduledTaskInput) =>
  runPrimaryHttp(
    Effect.flatMap(PrimaryEnvironmentHttpClient, (client) =>
      client.schedules.save({ headers: {}, payload }),
    ),
  );
export const removeSchedule = (id: string) =>
  runPrimaryHttp(
    Effect.flatMap(PrimaryEnvironmentHttpClient, (client) =>
      client.schedules.remove({ headers: {}, payload: { id } }),
    ),
  );
export const runSchedule = (id: string) =>
  runPrimaryHttp(
    Effect.flatMap(PrimaryEnvironmentHttpClient, (client) =>
      client.schedules.run({ headers: {}, payload: { id } }),
    ),
  );
