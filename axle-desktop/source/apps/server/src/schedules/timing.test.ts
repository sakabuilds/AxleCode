import { ThreadId, type ScheduledTaskInput } from "@axle/contracts";
import { describe, expect, it } from "vite-plus/test";

import { nextScheduledRun, validateSchedule } from "./timing.ts";

function input(overrides: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput {
  return {
    title: "Review changes",
    prompt: "Review the latest changes.",
    threadId: ThreadId.make("thread-a"),
    frequency: "daily",
    intervalHours: 1,
    time: "09:00",
    dayOfWeek: "monday",
    date: "2026-10-11",
    timeZone: "Africa/Lagos",
    active: true,
    ...overrides,
  };
}

describe("nextScheduledRun", () => {
  it("uses the selected zone rather than the server's local zone", () => {
    expect(nextScheduledRun(input(), Date.parse("2026-10-11T07:59:00Z"))).toBe(
      "2026-10-11T08:00:00.000Z",
    );
    expect(nextScheduledRun(input(), Date.parse("2026-10-11T08:00:00Z"))).toBe(
      "2026-10-12T08:00:00.000Z",
    );
  });

  it("skips a daily time that does not exist during spring DST", () => {
    expect(
      nextScheduledRun(
        input({ time: "02:30", timeZone: "America/New_York" }),
        Date.parse("2026-03-08T05:00:00Z"),
      ),
    ).toBe("2026-03-09T06:30:00.000Z");
  });

  it("keeps weekly schedules active when the next week falls in a DST gap", () => {
    expect(
      nextScheduledRun(
        input({
          frequency: "weekly",
          time: "02:30",
          dayOfWeek: "sunday",
          timeZone: "America/New_York",
        }),
        Date.parse("2026-03-01T07:30:00Z"),
      ),
    ).toBe("2026-03-15T06:30:00.000Z");
  });

  it("chooses the first repeated local time and does not run twice during fall DST", () => {
    const task = input({ time: "01:30", timeZone: "America/New_York" });
    expect(nextScheduledRun(task, Date.parse("2026-11-01T04:00:00Z"))).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(nextScheduledRun(task, Date.parse("2026-11-01T05:45:00Z"))).toBe(
      "2026-11-02T06:30:00.000Z",
    );
  });

  it("resolves one-off dates in zones with partial-hour offsets", () => {
    const task = input({ frequency: "once", time: "12:15", timeZone: "Asia/Kathmandu" });
    expect(nextScheduledRun(task, Date.parse("2026-10-11T00:00:00Z"))).toBe(
      "2026-10-11T06:30:00.000Z",
    );
    expect(nextScheduledRun(task, Date.parse("2026-10-11T06:30:00Z"))).toBeNull();
  });

  it("does not shift an impossible one-off occurrence to another date", () => {
    expect(
      nextScheduledRun(
        input({
          frequency: "once",
          date: "2026-03-08",
          time: "02:30",
          timeZone: "America/New_York",
        }),
        Date.parse("2026-03-01T00:00:00Z"),
      ),
    ).toBeNull();
  });

  it("coalesces overdue hourly runs without drifting their original cadence", () => {
    expect(
      nextScheduledRun(
        input({ frequency: "hourly", intervalHours: 2 }),
        Date.parse("2026-10-11T17:35:00Z"),
        "2026-10-11T10:00:00.000Z",
      ),
    ).toBe("2026-10-11T18:00:00.000Z");
  });
});

describe("validateSchedule", () => {
  it.each([
    { time: "25:00" },
    { frequency: "once" as const, date: "2026-02-30" },
    { timeZone: "Not/A_Timezone" },
    { intervalHours: 0 },
    { intervalHours: 1.5 },
    { intervalHours: Number.POSITIVE_INFINITY },
    { title: " " },
    { prompt: " " },
  ])("rejects invalid scheduling input %j", (overrides) => {
    expect(() => validateSchedule(input(overrides))).toThrow();
  });
});
