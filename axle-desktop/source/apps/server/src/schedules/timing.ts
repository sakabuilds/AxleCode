// @effect-diagnostics globalDate:off
import type { ScheduledTaskInput } from "@axle/contracts";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_MS = 86_400_000;

function localParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** Resolve one wall-clock time. Skip nonexistent DST times; use the first occurrence of repeated times. */
function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number | null {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = new Set<number>();
  for (const sample of [wall - DAY_MS, wall, wall + DAY_MS]) {
    const p = localParts(sample, timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - sample;
    const candidate = wall - offset;
    const check = localParts(candidate, timeZone);
    if (
      check.year === year &&
      check.month === month &&
      check.day === day &&
      check.hour === hour &&
      check.minute === minute
    )
      candidates.add(candidate);
  }
  return candidates.size > 0 ? Math.min(...candidates) : null;
}

export function validateSchedule(input: ScheduledTaskInput): void {
  if (!input.title.trim() || input.title.length > 200)
    throw new Error("Use a task name between 1 and 200 characters.");
  if (!input.prompt.trim() || input.prompt.length > 50_000)
    throw new Error("Use a prompt between 1 and 50,000 characters.");
  try {
    localParts(0, input.timeZone);
  } catch {
    throw new Error("Choose a valid IANA time zone, such as Africa/Lagos.");
  }
  if (
    !Number.isInteger(input.intervalHours) ||
    input.intervalHours < 1 ||
    input.intervalHours > 8760
  )
    throw new Error("The interval must be between 1 and 8,760 whole hours.");
  if (input.frequency !== "hourly" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))
    throw new Error("Choose a valid time.");
  if (input.frequency === "once") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Choose a valid date.");
    const date = new Date(`${input.date}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date)
      throw new Error("Choose a valid date.");
  }
}

/** The next occurrence is strictly after `after`; missed repeating occurrences are coalesced. */
export function nextScheduledRun(
  input: ScheduledTaskInput,
  after: number,
  previousRunAt?: string,
): string | null {
  if (input.frequency === "hourly") {
    const interval = input.intervalHours * 3_600_000;
    const anchor = previousRunAt === undefined ? after : Date.parse(previousRunAt);
    const steps = Math.max(1, Math.floor((after - anchor) / interval) + 1);
    return new Date(anchor + steps * interval).toISOString();
  }
  const [hour = 0, minute = 0] = input.time.split(":").map(Number);
  const now = localParts(after, input.timeZone);
  const base =
    input.frequency === "once"
      ? new Date(`${input.date}T00:00:00Z`).getTime()
      : Date.UTC(now.year, now.month - 1, now.day);
  // A weekly occurrence may fall in a DST gap. Include the following week, too.
  const searchDays = input.frequency === "once" ? 1 : input.frequency === "weekly" ? 16 : 9;
  for (let offset = 0; offset < searchDays; offset += 1) {
    const date = new Date(base + offset * DAY_MS);
    if (input.frequency === "weekly" && WEEKDAYS[date.getUTCDay()] !== input.dayOfWeek) continue;
    const candidate = zonedTime(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      minute,
      input.timeZone,
    );
    if (candidate !== null && candidate > after) return new Date(candidate).toISOString();
  }
  return null;
}
