// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Tests exercise real child processes and timeouts.
import { describe, expect, it } from "vite-plus/test";
import { spawnAgentProcess, type AgentExit, type AgentProcess } from "./process.ts";

const NODE = process.execPath;

async function collectEvents(process: AgentProcess): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const frame of process.events) {
    events.push(frame);
  }
  return events;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("timed out")), timeoutMs);
    }),
  ]);
}

describe("spawnAgentProcess", () => {
  it("parses NDJSON frames, skips junk, and delivers the prompt on stdin", async () => {
    const script = [
      'const frames = [',
      '  JSON.stringify({ type: "session", sessionId: "s1" }),',
      '  "definitely not json",',
      '  JSON.stringify({ type: "result", response: "ok" }),',
      '  JSON.stringify([1, 2, 3]),',
      '  JSON.stringify({ type: "shutdown" })',
      '];',
      'let index = 0;',
      'const timer = setInterval(() => {',
      '  if (index < frames.length) { process.stdout.write(frames[index] + "\\n"); index += 1; return; }',
      '  clearInterval(timer);',
      '  let prompt = "";',
      '  process.stdin.setEncoding("utf8");',
      '  process.stdin.on("data", (chunk) => { prompt += chunk; });',
      '  process.stdin.on("end", () => {',
      '    process.stdout.write(JSON.stringify({ type: "usage", prompt }) + "\\n");',
      '    process.exit(0);',
      '  });',
      '}, 5);',
    ].join("\n");
    const agent = spawnAgentProcess({
      binary: NODE,
      args: ["-e", script],
      cwd: globalThis.process.cwd(),
      env: { ...globalThis.process.env },
      prompt: "cloud prompt payload",
    });
    const events = await collectEvents(agent);
    const exit: AgentExit = await withTimeout(agent.exit, 5_000);

    expect(exit).toEqual({ code: 0, signal: null, spawnError: null, stderrTail: "" });
    expect(events.map((frame) => frame.type)).toEqual(["session", "result", "shutdown", "usage"]);
    expect(events[3]!.prompt).toBe("cloud prompt payload");
    expect(events[0]!.sessionId).toBe("s1");
  });

  it("drops lines over maxLineBytes instead of buffering them", async () => {
    const script = [
      'process.stdout.write(JSON.stringify({ type: "session", sessionId: "x".repeat(200) }) + "\\n");',
      'process.stdout.write(JSON.stringify({ type: "shutdown" }) + "\\n");',
      'process.exit(0);',
    ].join("\n");
    const agent = spawnAgentProcess({
      binary: NODE,
      args: ["-e", script],
      cwd: globalThis.process.cwd(),
      env: { ...globalThis.process.env },
      prompt: "prompt",
      maxLineBytes: 64,
    });
    const events = await collectEvents(agent);
    expect(events).toEqual([{ type: "shutdown" }]);
    expect((await withTimeout(agent.exit, 5_000)).code).toBe(0);
  });

  it("reports a spawn error instead of throwing when the binary is missing", async () => {
    const agent = spawnAgentProcess({
      binary: "axle-binary-that-does-not-exist-xyz",
      args: [],
      cwd: globalThis.process.cwd(),
      env: { ...globalThis.process.env },
      prompt: "prompt",
    });
    const exit = await withTimeout(agent.exit, 5_000);
    expect(exit.code).toBeNull();
    expect(exit.signal).toBeNull();
    expect(exit.spawnError).toContain("ENOENT");
  });

  it("kills a live agent and settles its exit", async () => {
    const script = "setInterval(() => {}, 1000); process.stdin.resume();";
    const agent = spawnAgentProcess({
      binary: NODE,
      args: ["-e", script],
      cwd: globalThis.process.cwd(),
      env: { ...globalThis.process.env },
      prompt: "prompt",
    });
    await withTimeout(agent.kill(), 15_000);
    const exit = await withTimeout(agent.exit, 5_000);
    expect(exit.spawnError).toBeNull();
    expect(exit.code !== 0 || exit.signal !== null).toBe(true);
  });
});
