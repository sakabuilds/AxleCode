// @effect-diagnostics nodeBuiltinImport:off - Tests exercise host filesystem paths directly.
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ApprovalFile, decisionFromUserPayload } from "./approval.ts";

describe("approval payload mapping", () => {
  it("maps every decision word the CLI accepts", () => {
    for (const word of ["allow", "approved", "accept", "accept_for_session", "Accept", " APPROVED "]) {
      expect(decisionFromUserPayload(word)).toBe("allow");
    }
    for (const word of ["deny", "denied", "declined", "decline", "cancel", "cancelled", "canceled"]) {
      expect(decisionFromUserPayload(word)).toBe("deny");
    }
  });

  it("maps structured payloads and defaults anything unknown to deny", () => {
    expect(decisionFromUserPayload({ decision: "allow" })).toBe("allow");
    expect(decisionFromUserPayload({ approved: true })).toBe("allow");
    expect(decisionFromUserPayload({ approved: false })).toBe("deny");
    expect(decisionFromUserPayload({ allow: true })).toBe("allow");
    expect(decisionFromUserPayload(true)).toBe("allow");
    expect(decisionFromUserPayload(false)).toBe("deny");
    expect(decisionFromUserPayload("maybe")).toBe("deny");
    expect(decisionFromUserPayload({ decision: "perhaps" })).toBe("deny");
    expect(decisionFromUserPayload(null)).toBe("deny");
    expect(decisionFromUserPayload({ nested: "unexpected" })).toBe("deny");
  });
});

describe("approval file", () => {
  it("resets and appends exactly the line format the CLI polls for", async () => {
    const root = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "axle-approval-"));
    const approvalPath = NodePath.join(root, "nested", "approval.jsonl");
    const file = new ApprovalFile(approvalPath);
    await file.reset();
    await file.append("call-1:123", "allow");
    await file.append("call-1:124", "deny");
    const lines = (await NodeFS.readFile(approvalPath, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { type: "approval_response", requestId: "call-1:123", decision: "allow" },
      { type: "approval_response", requestId: "call-1:124", decision: "deny" },
    ]);
  });
});
