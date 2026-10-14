import type { CloudJobState } from "@axle/contracts";

import type { StatusTone } from "../../components/StatusPill";

export const CLOUD_JOB_STATES: ReadonlyArray<CloudJobState> = [
  "queued",
  "provisioning",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
  "finalizing",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

/** Jobs in these states still make progress on the cloud worker. */
export function isCloudJobActive(state: CloudJobState): boolean {
  switch (state) {
    case "queued":
    case "provisioning":
    case "running":
    case "waiting_for_approval":
    case "waiting_for_input":
    case "finalizing":
      return true;
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return false;
  }
}

/** Jobs that cannot act on an approval/input response because they are done. */
export function isCloudJobTerminal(state: CloudJobState): boolean {
  return !isCloudJobActive(state);
}

export function cloudJobStateTone(state: CloudJobState): StatusTone {
  switch (state) {
    case "queued":
      return {
        label: "Queued",
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-tertiary",
      };
    case "provisioning":
      return {
        label: "Provisioning",
        pillClassName: "bg-info/12",
        textClassName: "text-info",
      };
    case "running":
      return {
        label: "Running",
        pillClassName: "bg-success/12",
        textClassName: "text-success",
      };
    case "waiting_for_approval":
      return {
        label: "Needs approval",
        pillClassName: "bg-warning/12",
        textClassName: "text-warning",
      };
    case "waiting_for_input":
      return {
        label: "Needs input",
        pillClassName: "bg-warning/12",
        textClassName: "text-warning",
      };
    case "finalizing":
      return {
        label: "Finalizing",
        pillClassName: "bg-info/12",
        textClassName: "text-info",
      };
    case "completed":
      return {
        label: "Completed",
        pillClassName: "bg-success/12",
        textClassName: "text-success",
      };
    case "failed":
      return {
        label: "Failed",
        pillClassName: "bg-danger",
        textClassName: "text-danger-foreground",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-tertiary",
      };
    case "interrupted":
      return {
        label: "Interrupted",
        pillClassName: "bg-warning/12",
        textClassName: "text-warning",
      };
  }
}

/**
 * A job row's secondary line: what the job is doing, in plain language.
 * Kept separate from the pill so lists can stay scannable.
 */
export function cloudJobSummaryLine(state: CloudJobState): string {
  switch (state) {
    case "queued":
      return "Waiting for a cloud worker";
    case "provisioning":
      return "Checking out the repository";
    case "running":
      return "Working on your task";
    case "waiting_for_approval":
      return "Waiting for your approval";
    case "waiting_for_input":
      return "Waiting for your response";
    case "finalizing":
      return "Collecting results and artifacts";
    case "completed":
      return "Finished";
    case "failed":
      return "Stopped with an error";
    case "cancelled":
      return "Cancelled before finishing";
    case "interrupted":
      return "Interrupted and may be retried";
  }
}