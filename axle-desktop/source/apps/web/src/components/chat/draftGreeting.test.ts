import { describe, expect, it } from "vite-plus/test";

import {
  DRAFT_GREETINGS,
  getDraftGreetingPeriod,
  resolveDraftGreeting,
  type DraftGreetingInput,
} from "./draftGreeting";

const projectRef = { environmentId: "local", projectId: "axle" };
const usedThread = {
  ...projectRef,
  archivedAt: null,
  latestUserMessageAt: "2026-10-13T10:00:00.000Z",
};

function context(overrides: Partial<DraftGreetingInput> = {}): DraftGreetingInput {
  return {
    now: new Date(2026, 9, 14, 9),
    seed: "/draft/one",
    projectCount: 1,
    activeProjectRef: projectRef,
    threads: [],
    ...overrides,
  };
}

function sampleGreetings(input: DraftGreetingInput) {
  return Array.from({ length: 100 }, (_, index) =>
    resolveDraftGreeting({ ...input, seed: `/draft/${index}` }),
  );
}

describe("getDraftGreetingPeriod", () => {
  it.each([
    [0, "late-night"],
    [4, "late-night"],
    [5, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [16, "afternoon"],
    [17, "evening"],
    [21, "evening"],
    [22, "late-night"],
    [23, "late-night"],
  ] as const)("uses %s:00 as %s", (hour, period) => {
    expect(getDraftGreetingPeriod(hour)).toBe(period);
  });
});

describe("resolveDraftGreeting", () => {
  it("contains 15 distinct, reachable greetings", () => {
    expect(DRAFT_GREETINGS).toHaveLength(15);
    expect(new Set(DRAFT_GREETINGS.map((greeting) => greeting.id)).size).toBe(15);
    expect(new Set(DRAFT_GREETINGS.map((greeting) => greeting.text)).size).toBe(15);

    const seen = new Set<string>();
    for (const hour of [0, 5, 12, 17, 22]) {
      for (const input of [
        context({ activeProjectRef: null, projectCount: 0 }),
        context({ activeProjectRef: null }),
        context(),
        context({ threads: [usedThread] }),
      ]) {
        for (const greeting of sampleGreetings({ ...input, now: new Date(2026, 9, 14, hour) })) {
          seen.add(greeting.id);
        }
      }
    }
    expect(seen.size).toBe(15);
  });

  it("welcomes a workspace with no projects without implying prior work", () => {
    const greetings = sampleGreetings(context({ projectCount: 0, activeProjectRef: null }));
    expect(new Set(greetings.map((greeting) => greeting.context))).toEqual(
      new Set(["no-project", "morning"]),
    );
    expect(greetings.every((greeting) => greeting.projectSuffix === undefined)).toBe(true);
  });

  it("keeps an unselected project out of the headline at every hour", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const greetings = sampleGreetings(
        context({
          now: new Date(2026, 9, 14, hour),
          activeProjectRef: null,
          threads: [usedThread],
        }),
      );
      expect(greetings.every((greeting) => greeting.projectSuffix === undefined)).toBe(true);
      expect(new Set(greetings.map((greeting) => greeting.context))).toEqual(
        new Set([getDraftGreetingPeriod(hour)]),
      );
    }
  });

  it("mixes first-project copy with only the current local day's period", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const greetings = sampleGreetings(context({ now: new Date(2026, 9, 14, hour) }));
      expect(new Set(greetings.map((greeting) => greeting.context))).toEqual(
        new Set(["first-project", getDraftGreetingPeriod(hour)]),
      );
    }
  });

  it("offers returning-project copy only for real messages in that scoped project", () => {
    const greetings = sampleGreetings(context({ threads: [usedThread] }));
    expect(new Set(greetings.map((greeting) => greeting.context))).toEqual(
      new Set(["returning-project", "morning"]),
    );
    expect(
      greetings
        .filter((greeting) => greeting.context === "returning-project")
        .every((greeting) => greeting.projectSuffix !== undefined),
    ).toBe(true);
  });

  it.each([
    ["an empty thread", { ...usedThread, latestUserMessageAt: null }],
    ["an archived thread", { ...usedThread, archivedAt: "2026-10-13T11:00:00.000Z" }],
    ["another environment", { ...usedThread, environmentId: "remote" }],
    ["another project", { ...usedThread, projectId: "other" }],
  ] as const)("does not treat %s as project history", (_, thread) => {
    const greetings = sampleGreetings(context({ threads: [thread] }));
    expect(greetings.some((greeting) => greeting.context === "returning-project")).toBe(false);
    expect(greetings.some((greeting) => greeting.context === "first-project")).toBe(true);
  });

  it("keeps the same draft stable within a local day period and across unrelated shell updates", () => {
    const input = context({ threads: [usedThread] });
    const expected = resolveDraftGreeting(input);
    expect(resolveDraftGreeting(input)).toBe(expected);
    expect(
      resolveDraftGreeting({
        ...input,
        now: new Date(2026, 9, 14, 11, 59, 59),
        threads: [usedThread, { ...usedThread, projectId: "unrelated" }],
      }),
    ).toBe(expected);
  });

  it("varies across draft identities and local dates without random selection", () => {
    const input = context();
    expect(new Set(sampleGreetings(input).map((greeting) => greeting.id)).size).toBeGreaterThan(1);
    const dailyGreetings = Array.from(
      { length: 14 },
      (_, day) => resolveDraftGreeting({ ...input, now: new Date(2026, 9, day + 1, 9) }).id,
    );
    expect(new Set(dailyGreetings).size).toBeGreaterThan(1);
  });
});
