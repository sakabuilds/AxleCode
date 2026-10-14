export type DraftGreetingPeriod = "morning" | "afternoon" | "evening" | "late-night";
type DraftGreetingContext =
  | DraftGreetingPeriod
  | "no-project"
  | "first-project"
  | "returning-project";

export interface DraftGreeting {
  readonly id: string;
  readonly context: DraftGreetingContext;
  readonly text: string;
  /** When present, render the selected project's interactive name after the text. */
  readonly projectSuffix?: string;
}

interface GreetingProjectRef {
  readonly environmentId: string;
  readonly projectId: string;
}

interface GreetingThread extends GreetingProjectRef {
  readonly archivedAt: string | null;
  readonly latestUserMessageAt: string | null;
}

export interface DraftGreetingInput {
  readonly now: Date;
  readonly seed: string;
  readonly projectCount: number;
  readonly activeProjectRef: GreetingProjectRef | null;
  readonly threads: readonly GreetingThread[];
}

export const DRAFT_GREETINGS: readonly DraftGreeting[] = [
  { id: "first-idea", context: "no-project", text: "What would you like to build?" },
  { id: "start-with-an-idea", context: "no-project", text: "Start with an idea." },
  {
    id: "first-project",
    context: "first-project",
    text: "What should we build in",
    projectSuffix: "?",
  },
  {
    id: "welcome-back",
    context: "returning-project",
    text: "Welcome back. What’s next for",
    projectSuffix: "?",
  },
  {
    id: "next-idea",
    context: "returning-project",
    text: "What’s the next idea for",
    projectSuffix: "?",
  },
  { id: "morning-thought", context: "morning", text: "Good morning. What’s on your mind?" },
  { id: "fresh-day", context: "morning", text: "A fresh day. What should we make?" },
  {
    id: "morning-build",
    context: "morning",
    text: "What should we build this morning in",
    projectSuffix: "?",
  },
  { id: "afternoon-thought", context: "afternoon", text: "Good afternoon. What’s on your mind?" },
  {
    id: "afternoon-idea",
    context: "afternoon",
    text: "An afternoon idea for",
    projectSuffix: "?",
  },
  { id: "evening-thought", context: "evening", text: "Good evening. What should we work on?" },
  { id: "evening-make", context: "evening", text: "What would you like to make tonight?" },
  {
    id: "evening-idea",
    context: "evening",
    text: "An evening idea for",
    projectSuffix: "?",
  },
  { id: "late-night-idea", context: "late-night", text: "A late-night idea?" },
  { id: "late-night-thought", context: "late-night", text: "What’s on your mind tonight?" },
];

export function getDraftGreetingPeriod(localHour: number): DraftGreetingPeriod {
  if (localHour >= 5 && localHour < 12) return "morning";
  if (localHour >= 12 && localHour < 17) return "afternoon";
  if (localHour >= 17 && localHour < 22) return "evening";
  return "late-night";
}

function hashGreetingSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function resolveDraftGreeting(input: DraftGreetingInput): DraftGreeting {
  const { now, seed, activeProjectRef, projectCount, threads } = input;
  const period = getDraftGreetingPeriod(now.getHours());
  const hasProjectHistory =
    activeProjectRef !== null &&
    threads.some(
      (thread) =>
        thread.environmentId === activeProjectRef.environmentId &&
        thread.projectId === activeProjectRef.projectId &&
        thread.archivedAt === null &&
        thread.latestUserMessageAt !== null,
    );
  const situation =
    activeProjectRef === null
      ? "no-project"
      : hasProjectHistory
        ? "returning-project"
        : "first-project";
  const candidates = DRAFT_GREETINGS.filter((greeting) => {
    if (greeting.context === period) {
      return activeProjectRef !== null || greeting.projectSuffix === undefined;
    }
    if (activeProjectRef === null && projectCount === 0) {
      return greeting.context === "no-project";
    }
    return activeProjectRef !== null && greeting.context === situation;
  });
  // Use the local date and day period, never minutes or changing thread counts.
  // A draft keeps its wording through typing, renders, and shell activity updates.
  const date = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const projectKey = activeProjectRef
    ? `${activeProjectRef.environmentId}\u0000${activeProjectRef.projectId}`
    : "";
  const hash = hashGreetingSeed(
    `${seed}\u0000${projectKey}\u0000${date}\u0000${period}\u0000${situation}`,
  );
  return candidates[hash % candidates.length]!;
}
