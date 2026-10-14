import { describe, expect, it } from "vite-plus/test";

import {
  CLOUD_JOB_STATES,
  cloudJobStateTone,
  cloudJobSummaryLine,
  isCloudJobActive,
  isCloudJobTerminal,
} from "./cloudJobPresentation";

describe("cloudJobPresentation", () => {
  it("covers every contract state with a tone and a summary", () => {
    for (const state of CLOUD_JOB_STATES) {
      const tone = cloudJobStateTone(state);
      expect(tone.label.length).toBeGreaterThan(0);
      expect(tone.pillClassName.length).toBeGreaterThan(0);
      expect(tone.textClassName.length).toBeGreaterThan(0);
      expect(cloudJobSummaryLine(state).length).toBeGreaterThan(0);
    }
  });

  it("marks only in-flight states as active", () => {
    const active = CLOUD_JOB_STATES.filter(isCloudJobActive);
    expect(active).toEqual([
      "queued",
      "provisioning",
      "running",
      "waiting_for_approval",
      "waiting_for_input",
      "finalizing",
    ]);
    for (const state of CLOUD_JOB_STATES) {
      expect(isCloudJobTerminal(state)).toBe(!isCloudJobActive(state));
    }
  });

  it("treats approval and input needs as warning states, not errors", () => {
    const approval = cloudJobStateTone("waiting_for_approval");
    const input = cloudJobStateTone("waiting_for_input");
    const failed = cloudJobStateTone("failed");
    expect(approval.textClassName).toBe("text-warning");
    expect(input.textClassName).toBe("text-warning");
    expect(failed.textClassName).toBe("text-danger-foreground");
  });
});