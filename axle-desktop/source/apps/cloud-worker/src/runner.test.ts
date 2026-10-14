// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Runner tests drive real wall-clock waits and temp filesystems.
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { CloudJob, CloudJobLease, CloudJobState } from "@axle/contracts";
import { CloudControlPlaneError, type CloudControlPlane, type WorkerLeaseRef, type WorkerUpdate } from "./controlPlane.ts";
import { FileArtifactStore } from "./artifacts.ts";
import type { WorkerConfig } from "./config.ts";
import type { AgentExit, AgentProcess, AgentProcessOptions } from "./process.ts";
import { CloudJobRunner, type RunDependencies, type WorkspaceOperations } from "./runner.ts";
import { TEST_REVISION, cloudJobFixture, cloudJobLeaseFixture } from "./testFixtures.ts";

const HEAD_REVISION = "b".repeat(40);

const temporaries: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix));
  temporaries.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of temporaries) {
    await NodeFS.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lease/heartbeat/update surface the runner depends on, driven by the test. */
class ScriptedControlPlane {
  readonly updates: Array<{ readonly state: CloudJobState | undefined; readonly update: WorkerUpdate }> = [];
  heartbeatCount = 0;
  cancelAfterHeartbeats: number | null = null;
  failHeartbeatWith: CloudControlPlaneError | null = null;
  /** When set, every waiting_for_approval update is answered with this payload. */
  autoApprovalPayload: string | null = null;
  response: CloudJobLease["response"] = null;
  private job: CloudJob;

  constructor(job: CloudJob) {
    this.job = job;
  }

  states(): ReadonlyArray<CloudJobState> {
    return this.updates
      .map((entry) => entry.state)
      .filter((state): state is CloudJobState => state !== undefined);
  }

  countStates(state: CloudJobState): number {
    return this.states().filter((entry) => entry === state).length;
  }

  async heartbeat(_environmentId: string, _jobId: string, lease: WorkerLeaseRef): Promise<CloudJobLease> {
    this.heartbeatCount += 1;
    const failure = this.failHeartbeatWith;
    if (failure !== null) {
      this.failHeartbeatWith = null;
      throw failure;
    }
    if (
      this.cancelAfterHeartbeats !== null &&
      this.heartbeatCount >= this.cancelAfterHeartbeats &&
      this.job.cancelRequestedAt === null
    ) {
      this.job = { ...this.job, cancelRequestedAt: new Date().toISOString() };
    }
    return {
      job: this.job,
      leaseToken: lease.leaseToken,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      response: this.response,
    };
  }

  async update(_environmentId: string, _jobId: string, _lease: WorkerLeaseRef, update: WorkerUpdate): Promise<CloudJob> {
    this.updates.push({ state: update.state, update });
    const lastSequence = this.job.lastSequence + 1;
    if (update.state === undefined) {
      this.job = { ...this.job, lastSequence };
      return this.job;
    }
    this.job =
      update.state === "completed" && update.result !== undefined
        ? { ...this.job, state: update.state, lastSequence, result: update.result }
        : update.state === "failed" && update.failureCode !== undefined
          ? { ...this.job, state: update.state, lastSequence, failureCode: update.failureCode }
          : { ...this.job, state: update.state, lastSequence };
    if (update.state === "waiting_for_approval" && update.pendingRequest !== undefined && this.autoApprovalPayload !== null) {
      this.response = { requestId: update.pendingRequest.requestId, payload: this.autoApprovalPayload };
    }
    if (update.state === "running" || update.state === "completed" || update.state === "failed" || update.state === "cancelled") {
      this.response = null;
    }
    return this.job;
  }
}

interface FakeAgent {
  readonly process: AgentProcess;
  readonly killCalls: { value: number };
  push(frame: Record<string, unknown>): void;
  exitWith(exit: AgentExit): void;
}

/** Fully test-controlled AgentProcess: frames are pushed, exit is explicit. */
function createFakeAgent(): FakeAgent {
  const buffered: Array<Record<string, unknown>> = [];
  let closed = false;
  let wake: (() => void) | null = null;
  let resolveExit!: (exit: AgentExit) => void;
  const exitPromise = new Promise<AgentExit>((resolve) => {
    resolveExit = resolve;
  });
  const signal = () => {
    const pending = wake;
    wake = null;
    pending?.();
  };
  const close = () => {
    closed = true;
    signal();
  };
  const killCalls = { value: 0 };
  const process: AgentProcess = {
    events: {
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
    exit: exitPromise,
    kill: async () => {
      killCalls.value += 1;
      close();
      resolveExit({ code: null, signal: "SIGTERM", spawnError: null, stderrTail: "" });
    },
  };
  return {
    process,
    killCalls,
    push: (frame) => {
      buffered.push(frame);
      signal();
    },
    exitWith: (exit) => {
      close();
      resolveExit(exit);
    },
  };
}

interface Harness {
  readonly job: CloudJob;
  readonly deps: RunDependencies;
  readonly controlPlane: ScriptedControlPlane;
  readonly workspaceCalls: { prepared: number; snapshots: number; cleaned: string[] };
  readonly spawns: AgentProcessOptions[];
  readonly agents: FakeAgent[];
  readonly logs: Array<Record<string, unknown>>;
  readonly artifactRoot: string;
  readonly workspaceRoot: string;
  readonly stagingDir: string;
}

async function createHarness(options: { failPrepare?: string; includeDiff?: boolean } = {}): Promise<Harness> {
  const workspaceRoot = await tempDir("axle-runner-ws-");
  const artifactRoot = await tempDir("axle-runner-art-");
  const job = cloudJobFixture();
  const config: WorkerConfig = {
    controlPlaneUrl: "https://cloud.example.test",
    workerId: "worker-1",
    workerToken: "token".padEnd(32, "0"),
    environmentIds: ["linux-standard"],
    workspaceRoot,
    artifactRoot,
    agentBinary: "axle",
    agentEnv: {},
    providers: [
      { providerInstanceId: "anthropic-default", provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", baseUrl: null },
    ],
    pollIntervalMs: 250,
    heartbeatIntervalMs: 20,
    shutdownGraceMs: 5_000,
    maxConcurrentJobs: 1,
    keepWorkspaces: false,
  };
  const artifacts = new FileArtifactStore({ root: artifactRoot });
  const controlPlane = new ScriptedControlPlane(job);
  const workspaceCalls = { prepared: 0, snapshots: 0, cleaned: [] as string[] };
  const workspace: WorkspaceOperations = {
    prepare: async () => {
      workspaceCalls.prepared += 1;
      if (options.failPrepare !== undefined) throw new Error(options.failPrepare);
    },
    snapshot: async ({ stagingDir }) => {
      workspaceCalls.snapshots += 1;
      if (options.includeDiff === false) {
        return { headRevision: TEST_REVISION, diffPath: null, bundlePath: null };
      }
      const diffPath = NodePath.join(stagingDir, "changes.diff");
      await NodeFS.writeFile(diffPath, "diff --git a/README.md b/README.md\n+agent change\n", "utf8");
      return { headRevision: HEAD_REVISION, diffPath, bundlePath: null };
    },
    cleanup: async (workspacePath) => {
      workspaceCalls.cleaned.push(workspacePath);
    },
  };
  const spawns: AgentProcessOptions[] = [];
  const agents: FakeAgent[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let uuidCounter = 0;
  const deps: RunDependencies = {
    config,
    controlPlane: controlPlane as unknown as CloudControlPlane,
    artifacts,
    workspace,
    spawnAgent: (agentOptions) => {
      spawns.push(agentOptions);
      const agent = createFakeAgent();
      agents.push(agent);
      return agent.process;
    },
    env: { ANTHROPIC_API_KEY: "test-credential" },
    randomUUID: () => `req-${String((uuidCounter += 1))}`,
    now: () => Date.now(),
    log: (event) => {
      logs.push({ ...event });
    },
  };
  return {
    job,
    deps,
    controlPlane,
    workspaceCalls,
    spawns,
    agents,
    logs,
    artifactRoot,
    workspaceRoot,
    stagingDir: artifacts.stagingDir(job.jobId),
  };
}

async function readApprovalDecisions(stagingDir: string): Promise<Array<Record<string, unknown>>> {
  const raw = await NodeFS.readFile(NodePath.join(stagingDir, "approval.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("CloudJobRunner", () => {
  it("runs a job to completion and ships transcript + diff artifacts", async () => {
    const h = await createHarness();
    const runPromise = new CloudJobRunner(h.deps).run("linux-standard", cloudJobLeaseFixture(h.job));
    await waitFor(() => h.agents.length === 1);
    const agent = h.agents[0]!;

    h.controlPlane.autoApprovalPayload = "allow";
    agent.push({ type: "session", sessionId: "session-1" });
    agent.push({ type: "tool.started", toolName: "shell", toolCallId: "call-1" });
    agent.push({
      type: "approval.requested",
      requestId: "cli-1",
      toolCallId: "call-1",
      toolName: "shell",
      arguments: { command: "pnpm test" },
      timeoutSeconds: 60,
    });
    await waitFor(() => h.controlPlane.states().includes("waiting_for_approval"));
    const waitingIndex = h.controlPlane.states().indexOf("waiting_for_approval");
    await waitFor(() => h.controlPlane.states().indexOf("running", waitingIndex + 1) > waitingIndex);
    agent.push({ type: "approval.resolved", requestId: "cli-1", decision: "allow" });
    agent.push({ type: "result", response: "all tests pass", sessionId: "session-1" });
    agent.push({ type: "shutdown" });
    agent.exitWith({ code: 0, signal: null, spawnError: null, stderrTail: "" });
    await runPromise;

    expect(h.controlPlane.states()).toEqual(["running", "waiting_for_approval", "running", "finalizing", "completed"]);
    const completed = h.controlPlane.updates.find((entry) => entry.update.state === "completed");
    expect(completed).toBeDefined();
    const result = completed!.update.result;
    expect(result).toBeDefined();
    expect(result!.sourceRevision).toBe(TEST_REVISION);
    expect(result!.headRevision).toBe(HEAD_REVISION);
    expect(result!.artifacts.map((artifact) => artifact.kind)).toEqual(["log", "diff"]);
    expect(result!.artifacts.map((artifact) => artifact.storageKey)).toEqual([
      `jobs/${h.job.jobId}/log/session.ndjson`,
      `jobs/${h.job.jobId}/diff/changes.diff`,
    ]);
    for (const artifact of result!.artifacts) {
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(artifact.sizeBytes).toBeGreaterThan(0);
    }

    const approvalLines = await readApprovalDecisions(h.stagingDir);
    expect(approvalLines).toEqual([{ type: "approval_response", requestId: "cli-1", decision: "allow" }]);
    const transcript = await NodeFS.readFile(NodePath.join(h.stagingDir, "session.ndjson"), "utf8");
    expect(transcript).toContain('"type":"approval.requested"');
    expect(transcript).toContain('"sessionId":"session-1"');

    expect(h.spawns).toHaveLength(1);
    const spawn = h.spawns[0]!;
    expect(spawn.binary).toBe("axle");
    expect(spawn.prompt).toBe("Run the tests");
    expect(spawn.cwd).toBe(NodePath.join(h.workspaceRoot, h.job.jobId));
    expect(spawn.args).toContain("--prompt-stdin");
    expect(spawn.args).toContain("--json-stream");
    expect(spawn.args[spawn.args.indexOf("--runtime-mode") + 1]).toBe("approval-required");
    expect(spawn.args[spawn.args.indexOf("--approval-file") + 1]).toBe(NodePath.join(h.stagingDir, "approval.jsonl"));
    expect(spawn.args[spawn.args.indexOf("--provider") + 1]).toBe("anthropic");
    expect(spawn.args[spawn.args.indexOf("--model") + 1]).toBe("claude-test-model");
    expect(spawn.args[spawn.args.indexOf("--interaction-mode") + 1]).toBe("build");

    expect(h.workspaceCalls.snapshots).toBe(1);
    expect(h.workspaceCalls.cleaned).toEqual([NodePath.join(h.workspaceRoot, h.job.jobId)]);
    const stored = await NodeFS.stat(NodePath.join(h.artifactRoot, "jobs", h.job.jobId, "log", "session.ndjson"));
    expect(stored.isFile()).toBe(true);
  });

  it("denies the approval when the user payload is unrecognized, then still completes", async () => {
    const h = await createHarness();
    const runPromise = new CloudJobRunner(h.deps).run("linux-standard", cloudJobLeaseFixture(h.job));
    await waitFor(() => h.agents.length === 1);
    const agent = h.agents[0]!;

    h.controlPlane.autoApprovalPayload = "maybe";
    agent.push({
      type: "approval.requested",
      requestId: "cli-9",
      toolCallId: "call-9",
      toolName: "shell",
      arguments: { command: "rm -rf build" },
      timeoutSeconds: 60,
    });
    await waitFor(() => h.controlPlane.countStates("running") >= 2);
    const approvalLines = await readApprovalDecisions(h.stagingDir);
    expect(approvalLines).toEqual([{ type: "approval_response", requestId: "cli-9", decision: "deny" }]);
    const waiting = h.controlPlane.updates.find((entry) => entry.update.state === "waiting_for_approval");
    expect((waiting!.update.pendingRequest!.payload as Record<string, unknown>).toolName).toBe("shell");

    agent.push({ type: "result", response: "stopped after deny" });
    agent.exitWith({ code: 0, signal: null, spawnError: null, stderrTail: "" });
    await runPromise;
    expect(h.controlPlane.countStates("completed")).toBe(1);
  });

  it("cancels a running job on the control plane's request and kills the agent", async () => {
    const h = await createHarness();
    const runPromise = new CloudJobRunner(h.deps).run("linux-standard", cloudJobLeaseFixture(h.job));
    await waitFor(() => h.agents.length === 1 && h.controlPlane.countStates("running") === 1);
    h.controlPlane.cancelAfterHeartbeats = h.controlPlane.heartbeatCount + 1;
    const agent = h.agents[0]!;
    agent.push({ type: "session", sessionId: "session-cancel" });

    await waitFor(() => h.controlPlane.countStates("cancelled") === 1);
    await runPromise;
    expect(agent.killCalls.value).toBeGreaterThanOrEqual(1);
    const cancelled = h.controlPlane.updates.find((entry) => entry.update.state === "cancelled")!;
    expect(cancelled.update.event).toEqual({ type: "worker.cancellation", reason: "user_requested" });
    expect(h.controlPlane.countStates("completed")).toBe(0);
    expect(h.controlPlane.countStates("finalizing")).toBe(0);
  });

  it("fails the job with runtime_failed when the agent exits non-zero", async () => {
    const h = await createHarness();
    const runPromise = new CloudJobRunner(h.deps).run("linux-standard", cloudJobLeaseFixture(h.job));
    await waitFor(() => h.agents.length === 1);
    h.agents[0]!.push({ type: "session", sessionId: "session-fail" });
    h.agents[0]!.exitWith({ code: 2, signal: null, spawnError: null, stderrTail: "tests failed badly" });
    await runPromise;

    const failed = h.controlPlane.updates.find((entry) => entry.update.state === "failed")!;
    expect(failed.update.failureCode).toBe("runtime_failed");
    expect(failed.update.event).toEqual({
      type: "worker.failure",
      code: "runtime_failed",
      message: "agent exited with code 2: tests failed badly",
    });
    expect(h.controlPlane.countStates("completed")).toBe(0);
  });

  it("fails fast with provisioning_failed when the workspace cannot be prepared", async () => {
    const h = await createHarness({ failPrepare: "clone failed: repository not found" });
    await new CloudJobRunner(h.deps).run("linux-standard", cloudJobLeaseFixture(h.job));

    const failed = h.controlPlane.updates.find((entry) => entry.update.state === "failed")!;
    expect(failed.update.failureCode).toBe("provisioning_failed");
    expect(JSON.stringify(failed.update.event)).toContain("clone failed");
    expect(h.agents).toHaveLength(0);
    expect(h.workspaceCalls.snapshots).toBe(0);
  });

  it("halts without terminal updates when the lease is lost", async () => {
    const h = await createHarness();
    const runPromise = new CloudJobRunner(h.deps).run("linux-standard", cloudJobLeaseFixture(h.job));
    await waitFor(() => h.agents.length === 1 && h.controlPlane.countStates("running") === 1);
    h.controlPlane.failHeartbeatWith = new CloudControlPlaneError("lease_lost", 409);
    await waitFor(() => h.logs.some((entry) => entry.event === "control_plane_error"));
    h.agents[0]!.exitWith({ code: 0, signal: null, spawnError: null, stderrTail: "" });
    await runPromise;

    expect(h.controlPlane.countStates("completed")).toBe(0);
    expect(h.controlPlane.countStates("failed")).toBe(0);
    expect(h.controlPlane.countStates("cancelled")).toBe(0);
    expect(h.controlPlane.countStates("finalizing")).toBe(0);
    expect(h.logs.some((entry) => entry.event === "job.halted")).toBe(true);
  });

  it("holds a finished agent open until a pending approval is answered, then settles", async () => {
    const h = await createHarness();
    const runPromise = new CloudJobRunner(h.deps).run("linux-standard", cloudJobLeaseFixture(h.job));
    await waitFor(() => h.agents.length === 1);
    const agent = h.agents[0]!;
    agent.push({
      type: "approval.requested",
      requestId: "cli-5",
      toolCallId: "call-5",
      toolName: "edit",
      arguments: { path: "src/app.ts" },
      timeoutSeconds: 30,
    });
    await waitFor(() => h.controlPlane.countStates("waiting_for_approval") === 1);
    agent.exitWith({ code: 0, signal: null, spawnError: null, stderrTail: "" });
    await sleep(80);
    expect(h.controlPlane.countStates("finalizing")).toBe(0);
    expect(h.controlPlane.countStates("completed")).toBe(0);

    h.controlPlane.response = { requestId: "req-1", payload: "allow" };
    await waitFor(() => h.controlPlane.countStates("running") >= 2);
    await runPromise;
    const approvalLines = await readApprovalDecisions(h.stagingDir);
    expect(approvalLines).toEqual([{ type: "approval_response", requestId: "cli-5", decision: "allow" }]);
    const failed = h.controlPlane.updates.find((entry) => entry.update.state === "failed")!;
    expect(failed.update.failureCode).toBe("runtime_failed");
    expect(JSON.stringify(failed.update.event)).toContain("without producing a result frame");
  });
});
