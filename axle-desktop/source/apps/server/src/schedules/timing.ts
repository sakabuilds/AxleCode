import type { ScheduledTaskInput } from "@axle/contracts";
import { nextScheduledRun, validateScheduleTiming } from "@axle/shared/scheduleTiming";

export { nextScheduledRun };

export function validateSchedule(input: ScheduledTaskInput): void {
  if (!input.title.trim() || input.title.length > 200)
    throw new Error("Use a task name between 1 and 200 characters.");
  if (!input.prompt.trim() || input.prompt.length > 50_000)
    throw new Error("Use a prompt between 1 and 50,000 characters.");
  validateScheduleTiming(input);
}
