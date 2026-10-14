// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Spawns the Axle CLI and enforces its kill grace period outside an Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";

/**
 * One agent process (the Axle CLI) and its NDJSON event stream.
 *
 * The worker never shells out: the binary and every argument are passed to
 * `spawn` verbatim, so prompts and file paths can never be interpreted by a
 * shell. The prompt travels over stdin (`--prompt-stdin`) because Windows
 * command lines cap out around 32k characters and cloud prompts are allowed
 * to reach the same order of magnitude.
 */

export interface AgentProcessOptions {
  readonly binary: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly prompt: string;
  /** Lines longer than this are dropped instead of buffered. Default 1 MiB. */
  readonly maxLineBytes?: number;
  /** How much of stderr to retain for failure diagnostics. Default 64 KiB. */
  readonly maxStderrBytes?: number;
}

export interface AgentExit {
  readonly code: number | null;
  readonly signal: string | null;
  /** Populated when the process could not be spawned at all (e.g. ENOENT). */
  readonly spawnError: string | null;
  readonly stderrTail: string;
}

export interface AgentProcess {
  readonly events: AsyncIterable<Record<string, unknown>>;
  readonly exit: Promise<AgentExit>;
  /** Ask the CLI to stop; escalates to SIGKILL after a grace period. */
  kill(): Promise<void>;
}

export function spawnAgentProcess(options: AgentProcessOptions): AgentProcess {
  const maxLineBytes = options.maxLineBytes ?? 1_048_576;
  const maxStderrBytes = options.maxStderrBytes ?? 65_536;
  const child = NodeChildProcess.spawn(options.binary, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const queue = createEventQueue();
  let stderrTail = "";

  const readline = NodeReadline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  readline.on("line", (line) => {
    if (line.length === 0) return;
    if (Buffer.byteLength(line, "utf8") > maxLineBytes) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      queue.push(parsed as Record<string, unknown>);
    }
  });
  readline.on("close", () => queue.close());

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderrTail = (stderrTail + text).slice(-maxStderrBytes);
  });

  // When --prompt-stdin is used the CLI reads until EOF; write once and close.
  child.stdin?.on("error", () => {});
  if (child.stdin) {
    child.stdin.end(options.prompt, "utf8");
  }

  const exit = new Promise<AgentExit>((resolve) => {
    let settled = false;
    const finish = (entry: AgentExit) => {
      if (settled) return;
      settled = true;
      queue.close();
      resolve(entry);
    };
    child.once("error", (error: Error) => {
      finish({ code: null, signal: null, spawnError: error.message, stderrTail });
    });
    child.once("close", (code, signal) => {
      finish({ code, signal, spawnError: null, stderrTail });
    });
  });

  return {
    events: queue.iterable,
    exit,
    kill: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill("SIGTERM");
      } catch {
        return;
      }
      const stopped = await Promise.race([
        exit.then(() => true),
        delay(10_000).then(() => false),
      ]);
      if (!stopped && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process is already gone.
        }
        await Promise.race([exit, delay(5_000)]);
      }
    },
  };
}

interface EventQueue {
  readonly iterable: AsyncIterable<Record<string, unknown>>;
  push(event: Record<string, unknown>): void;
  close(): void;
}

function createEventQueue(): EventQueue {
  const buffered: Array<Record<string, unknown>> = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const signal = () => {
    const pending = wake;
    wake = null;
    pending?.();
  };
  return {
    push: (event) => {
      if (closed) return;
      buffered.push(event);
      signal();
    },
    close: () => {
      closed = true;
      signal();
    },
    iterable: {
      // A single consumer owns the queue; the runner is the only reader.
      [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
        return {
          next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
            while (true) {
              const next = buffered.shift();
              if (next !== undefined) return { done: false, value: next };
              if (closed) return { done: true, value: undefined };
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          },
        };
      },
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


