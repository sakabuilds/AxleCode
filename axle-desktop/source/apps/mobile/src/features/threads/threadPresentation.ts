import type { StatusTone } from "../../components/StatusPill";
import type { OrchestrationLatestTurn, OrchestrationSession } from "@axle/contracts";
import { EnvironmentThreadShell } from "@axle/client-runtime/state/shell";

export function threadSortValue(thread: EnvironmentThreadShell): number {
  const candidate = Date.parse(thread.updatedAt ?? thread.createdAt);
  return Number.isNaN(candidate) ? 0 : candidate;
}

export type ThreadStatusKind =
  | "pending-approval"
  | "awaiting-input"
  | "working"
  | "connecting"
  | "error"
  | "plan-ready";

export interface ThreadStatusPresentation extends StatusTone {
  readonly kind: ThreadStatusKind;
  /** Foreground color for the leading status icon. */
  readonly iconColor: string;
  /** Background color for the leading status icon circle. */
  readonly iconBackground: string;
  /** Whether the indicator represents in-flight activity. */
  readonly pulse: boolean;
}

/** Neutral icon colors for threads with no actionable status. */
export const THREAD_STATUS_NEUTRAL_ICON = {
  iconColor: "#8f8f8f",
  iconBackground: "rgba(143,143,143,0.16)",
} as const;

/** Monochrome pill styling for active statuses (desktop "new UI" language). */
const THREAD_STATUS_NEUTRAL_TONE = {
  pillClassName: "bg-subtle",
  textClassName: "text-foreground",
} as const;

function isLatestTurnSettled(
  latestTurn: OrchestrationLatestTurn | null,
  session: OrchestrationSession | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  return session.status !== "running";
}

/**
 * Resolves the user-facing status of a thread, in priority order. Returns
 * `null` for quiescent threads so rows stay free of "Idle"-style noise.
 * Mirrors `resolveThreadStatusPill` in apps/web/src/components/Sidebar.logic.ts.
 */
export function resolveThreadStatus(
  thread: EnvironmentThreadShell,
): ThreadStatusPresentation | null {
  if (thread.hasPendingApprovals) {
    return {
      kind: "pending-approval",
      label: "Needs Approval",
      ...THREAD_STATUS_NEUTRAL_TONE,
      ...THREAD_STATUS_NEUTRAL_ICON,
      pulse: false,
    };
  }

  if (thread.hasPendingUserInput) {
    return {
      kind: "awaiting-input",
      label: "Awaiting Input",
      ...THREAD_STATUS_NEUTRAL_TONE,
      ...THREAD_STATUS_NEUTRAL_ICON,
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      kind: "working",
      label: "Working",
      ...THREAD_STATUS_NEUTRAL_TONE,
      ...THREAD_STATUS_NEUTRAL_ICON,
      pulse: true,
    };
  }

  if (thread.session?.status === "starting") {
    return {
      kind: "connecting",
      label: "Connecting",
      ...THREAD_STATUS_NEUTRAL_TONE,
      ...THREAD_STATUS_NEUTRAL_ICON,
      pulse: true,
    };
  }

  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return {
      kind: "error",
      label: "Error",
      pillClassName: "bg-danger",
      textClassName: "text-danger-foreground",
      iconColor: "#c23939",
      iconBackground: "rgba(194,57,57,0.16)",
      pulse: false,
    };
  }

  const hasPlanReadyPrompt =
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      kind: "plan-ready",
      label: "Plan Ready",
      ...THREAD_STATUS_NEUTRAL_TONE,
      ...THREAD_STATUS_NEUTRAL_ICON,
      pulse: false,
    };
  }

  return null;
}
