// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

/**
 * Bridge between the control plane's approval round-trip and the CLI's
 * approval file.
 *
 * The CLI polls its `--approval-file` (150ms) for newline-delimited JSON of
 * the shape `{"type":"approval_response","requestId":...,"decision":...}` and
 * keeps the request pending until it sees a line matching its own request id,
 * so stale or malformed lines can never approve a different tool call.
 */

export type ApprovalDecision = "allow" | "deny";

const ALLOW_WORDS = new Set([
  "allow",
  "allowed",
  "approve",
  "approved",
  "accept",
  "accepted",
  "accept_for_session",
  "acceptforsession",
  "yes",
  "true",
]);

const DENY_WORDS = new Set([
  "deny",
  "denied",
  "decline",
  "declined",
  "reject",
  "rejected",
  "cancel",
  "cancelled",
  "canceled",
  "no",
  "false",
]);

/**
 * Map a user-supplied response payload onto a concrete decision. The payload
 * crosses the network as `unknown`; anything unrecognized resolves to `deny`
 * so a malformed answer can never silently grant full tool access, and the
 * CLI is never left waiting on an unparseable decision word.
 */
export function decisionFromUserPayload(payload: unknown): ApprovalDecision {
  if (typeof payload === "string") return decisionFromWord(payload);
  if (payload === true) return "allow";
  if (payload === false) return "deny";
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.decision === "string") return decisionFromWord(record.decision);
    if (typeof record.approved === "boolean") return record.approved ? "allow" : "deny";
    if (typeof record.allow === "boolean") return record.allow ? "allow" : "deny";
  }
  return "deny";
}

function decisionFromWord(word: string): ApprovalDecision {
  const normalized = word.trim().toLowerCase();
  if (ALLOW_WORDS.has(normalized)) return "allow";
  if (DENY_WORDS.has(normalized)) return "deny";
  return "deny";
}

export class ApprovalFile {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Create an empty file so the CLI never has to wait for it to appear. */
  async reset(): Promise<void> {
    await NodeFS.mkdir(NodePath.dirname(this.path), { recursive: true });
    await NodeFS.writeFile(this.path, "", "utf8");
  }

  /** Append one decision line. Duplicate lines for the same request are harmless. */
  async append(requestId: string, decision: ApprovalDecision): Promise<void> {
    const line = `${JSON.stringify({ type: "approval_response", requestId, decision })}\n`;
    await NodeFS.appendFile(this.path, line, "utf8");
  }
}
