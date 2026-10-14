import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AgentExecutionTarget, CloudJobCreateInput, CloudSourceRevision } from "./cloudJobs.ts";

const decodeInput = Schema.decodeUnknownSync(CloudJobCreateInput);
const decodeRevision = Schema.decodeUnknownSync(CloudSourceRevision);
const decodeTarget = Schema.decodeUnknownSync(AgentExecutionTarget);
const input = {
  commandId: "create-1", environmentId: "linux", repositoryUrl: "https://github.com/example/project.git",
  sourceRevision: "a".repeat(40), prompt: "Run the tests", providerInstanceId: "axle",
  model: "configured-model", runtimeMode: "approval-required", interactionMode: "default",
};

describe("cloud job contracts", () => {
  it("requires an immutable full Git object id", () => {
    expect(decodeRevision("a".repeat(40))).toHaveLength(40);
    expect(decodeRevision("b".repeat(64))).toHaveLength(64);
    for (const revision of ["main", "HEAD", "abcd123", "a".repeat(41)]) {
      expect(() => decodeRevision(revision)).toThrow();
    }
  });
  it("distinguishes local agent hosting from an identified cloud environment", () => {
    expect(decodeTarget({ kind: "local" })).toEqual({ kind: "local" });
    expect(() => decodeTarget({ kind: "cloud" })).toThrow();
  });
  it("accepts supervised work and rejects unbounded prompts and full access", () => {
    expect(decodeInput(input)).toEqual(input);
    expect(() => decodeInput({ ...input, runtimeMode: "full-access" })).toThrow();
    expect(() => decodeInput({ ...input, prompt: "a".repeat(32_769) })).toThrow();
  });
});
