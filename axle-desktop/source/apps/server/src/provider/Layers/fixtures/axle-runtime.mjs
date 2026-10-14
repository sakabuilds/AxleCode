// Deterministic one-shot runtime used by AxleAdapter.lifecycle.test.ts.
// Persists the prompt before provider output, just like the Rust agent loop.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const cwd = value("--cwd");
const sessionId = args.includes("--session")
  ? value("--session")
  : "11111111-1111-4111-8111-111111111111";
const sessionFile = NodePath.join(cwd, ".axle", "sessions", `${sessionId}.jsonl`);
const callFile = NodePath.join(cwd, "runtime-calls.jsonl");
const firstCall = !NodeFS.existsSync(callFile);
const history = NodeFS.existsSync(sessionFile)
  ? NodeFS.readFileSync(sessionFile, "utf8").trim().split("\n").map(JSON.parse)
  : [];
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
NodeFS.mkdirSync(NodePath.dirname(sessionFile), { recursive: true });
NodeFS.appendFileSync(sessionFile, `${JSON.stringify({ role: "user", text: prompt })}\n`);
NodeFS.appendFileSync(callFile, `${JSON.stringify({ args, sessionId, prompt })}\n`);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
emit({ type: "session", sessionId });

if (firstCall && process.env.AXLE_TEST_FAIL_FIRST === "1") {
  process.stderr.write("ECONNRESET while contacting provider\n");
  process.exitCode = 1;
} else if (prompt === "Wait until interrupted") {
  setInterval(() => {}, 1_000);
} else {
  const response = history.some((message) => message.text.includes("amber-orchid"))
    ? "The earlier fact was amber-orchid."
    : "Remembered.";
  NodeFS.appendFileSync(sessionFile, `${JSON.stringify({ role: "assistant", text: response })}\n`);
  emit({ type: "delta", delta: response });
  emit({ type: "result", response, sessionId });
  // Simulate a provider/MCP resource holding the process open after its result.
  setInterval(() => {}, 1_000);
}
