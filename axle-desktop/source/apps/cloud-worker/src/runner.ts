// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Cloud worker host boundary drives child processes and wall-clock timers outside an Effect runtime.
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import type {
  CloudJob,
  CloudJobLease,
  CloudJobPendingRequest,
  CloudJobResult,
  CloudJobState,
} from "@axle/contracts";
import {
  CloudControlPlaneError,
  type CloudControlPlane,
  type WorkerLeaseRef,
} from "./controlPlane.ts";
import type { CloudArtifact, FileArtifactStore } from "./artifacts.ts";
import { ApprovalFile, decisionFromUserPayload } from "./approval.ts";
import type { AgentExit, AgentProcess, AgentProcessOptions } from "./process.ts";
import type { WorkerConfig, ProviderBinding } from "./config.ts";
import type { WorkspaceSnapshot } from "./git.ts";

/**
 * One claimed job, driven end to end: provisioning -> running -> (approval
 * round-trips) -> finalizing -> completed, or failed/cancelled. The runner
 * never decides state on its own: every transition is a control-plane update
 * fenced by the lease, and the SQL state machine rejects anything illegal.
 *
 * Two tasks run concurrently per job: an event pump that forwards the CLI's
 * NDJSON frames, and a heartbeat loop that renews the lease, watches for
 * cancellation/deadline, and hands user approval responses to the CLI's
 * approval file. Only the event pump emits runtime events, so they can never
 * race a `waiting_for_approval` state (which forbids same-state events).
 */

export type FailureCode = "provisioning_failed" | "runtime_failed" | "artifact_failed";

export interface WorkspaceOperations {
  prepare(args: {
    readonly workspaceRoot: string;
    readonly workspacePath: string;
    readonly repositoryUrl: string;
    readonly sourceRevision: string;
  }): Promise<void>;
  snapshot(args: {
    readonly workspacePath: string;
    readonly sourceRevision: string;
    readonly stagingDir: string;
  }): Promise<WorkspaceSnapshot>;
  cleanup(workspacePath: string): Promise<void>;
}

export type SpawnAgent = (options: AgentProcessOptions) => AgentProcess;

export interface RunDependencies {
  readonly config: WorkerConfig;
  readonly controlPlane: CloudControlPlane;
  readonly artifacts: FileArtifactStore;
  readonly workspace: WorkspaceOperations;
  readonly spawnAgent: SpawnAgent;
  /** Host environment handed to the agent process (provider keys included). */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly randomUUID: () => string;
  readonly now: () => number;
  readonly log: (event: Record<string, unknown>) => void;
}

type Outcome =
  | { readonly kind: "exited"; readonly exit: AgentExit }
  | { readonly kind: "cancelled" }
  | { readonly kind: "deadline" }
  | { readonly kind: "halted" }
  | { readonly kind: "failed"; readonly code: FailureCode; readonly message: string };

class RunAbortedError extends Error {
  constructor() {
    super("run aborted before the agent started");
    this.name = "RunAbortedError";
  }
}

/** Event budget kept free for state transitions and one approval round-trip. */
const EVENT_RESERVE = 16;
/** Per-string-field cap when forwarding runtime events to the control plane. */
const MAX_EVENT_FIELD_CHARS = 8_000;
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

export class CloudJobRunner {
  private readonly deps: RunDependencies;

  constructor(deps: RunDependencies) {
    this.deps = deps;
  }

  async run(environmentId: string, lease: CloudJobLease): Promise<void> {
    const context = new JobRun(this.deps, environmentId, lease);
    await context.execute();
  }
}

class JobRun {
  private readonly deps: RunDependencies;
  private readonly environmentId: string;
  private readonly jobId: string;
  private readonly lease: WorkerLeaseRef;
  private readonly controlPlane: CloudControlPlane;
  private job: CloudJob;
  private trackedState: CloudJobState;
  private provider: ProviderBinding | null = null;
  private workspacePath = "";
  private stagingDir = "";
  private transcriptPath = "";
  private transcriptBytes = 0;
  private transcriptTruncated = false;
  private approvalFile: ApprovalFile | null = null;
  private agentProcess: AgentProcess | null = null;
  private consumeTask: Promise<void> | null = null;
  private consumeError: unknown = null;
  private finalResponse: string | null = null;
  private sessionId: string | null = null;
  private pendingApproval: {
    cloudRequestId: string;
    cliRequestId: string;
    appended: boolean;
  } | null = null;
  private pendingResolve: (() => void) | null = null;
  private lastSequence = 0;
  private eventBudgetExhausted = false;
  private halted = false;
  private cancelled = false;
  private deadlineExceeded = false;
  private stopHeartbeat = false;

  constructor(deps: RunDependencies, environmentId: string, lease: CloudJobLease) {
    this.deps = deps;
    this.environmentId = environmentId;
    this.job = lease.job;
    this.jobId = lease.job.jobId;
    this.lease = { leaseToken: lease.leaseToken, generation: lease.job.generation };
    this.controlPlane = deps.controlPlane;
    this.trackedState = lease.job.state;
    this.lastSequence = lease.job.lastSequence;
  }

  async execute(): Promise<void> {
    this.log({ event: "job.claimed", state: this.job.state });
    const heartbeatTask = this.heartbeatLoop();
    let outcome: Outcome;
    try {
      await this.provision();
      this.provider = this.resolveProvider();
      await this.transitionTo("running");
      outcome = await this.runAgent();
    } catch (error) {
      outcome = this.outcomeFromError(error);
    }
    this.stopHeartbeat = true;
    this.resolvePending();
    await heartbeatTask.catch(() => {});
    await this.settle(outcome);
    await this.cleanupResources();
  }

  // ---------------------------------------------------------------- provisioning

  private async provision(): Promise<void> {
    const job = this.job;
    this.workspacePath = NodePath.join(this.deps.config.workspaceRoot, this.jobId);
    this.stagingDir = this.deps.artifacts.stagingDir(this.jobId);
    await NodeFS.mkdir(this.stagingDir, { recursive: true });
    this.transcriptPath = NodePath.join(this.stagingDir, "session.ndjson");
    await NodeFS.writeFile(this.transcriptPath, "", "utf8");
    this.approvalFile = new ApprovalFile(NodePath.join(this.stagingDir, "approval.jsonl"));
    await this.approvalFile.reset();
    this.assertLive();
    await this.deps.workspace.prepare({
      workspaceRoot: this.deps.config.workspaceRoot,
      workspacePath: this.workspacePath,
      repositoryUrl: job.input.repositoryUrl,
      sourceRevision: job.input.sourceRevision,
    });
    this.assertLive();
  }

  private resolveProvider(): ProviderBinding {
    const requested = this.job.input.providerInstanceId;
    const binding = this.deps.config.providers.find(
      (entry) => entry.providerInstanceId === requested,
    );
    if (!binding)
      throw new Error(`no worker provider binding for provider instance '${requested}'`);
    if (binding.apiKeyEnv !== null && !this.deps.env[binding.apiKeyEnv]?.trim()) {
      throw new Error(`provider credential '${binding.apiKeyEnv}' is not present on this worker`);
    }
    return binding;
  }

  // ------------------------------------------------------------------ agent run

  private async runAgent(): Promise<Outcome> {
    this.startAgent();
    const process = this.agentProcess;
    if (!process) throw new Error("agent process was not started");
    const exit = await process.exit;
    await this.consumeTask;
    if (this.consumeError !== null) throw this.consumeError;
    this.log({
      event: "job.agent_exited",
      exitCode: exit.code,
      signal: exit.signal,
      spawnError: exit.spawnError,
    });
    if (this.halted) return { kind: "halted" };
    if (this.cancelled) return { kind: "cancelled" };
    if (this.deadlineExceeded) return { kind: "deadline" };
    if (this.pendingApproval !== null) {
      // The CLI gave up on its own approval timeout and exited while the
      // control plane still awaits the user's answer. Hold the run open until
      // the response (or a cancel/deadline) arrives so the state machine can
      // leave `waiting_for_approval` legitimately.
      await this.waitForResolution();
      if (this.halted) return { kind: "halted" };
      if (this.cancelled) return { kind: "cancelled" };
      if (this.deadlineExceeded) return { kind: "deadline" };
    }
    return { kind: "exited", exit };
  }

  private startAgent(): void {
    const binding = this.provider;
    if (!binding || !this.approvalFile)
      throw new Error("run started before provisioning completed");
    const job = this.job;
    const deadlineMs = Date.parse(job.deadlineAt);
    const remainingSeconds = Number.isFinite(deadlineMs)
      ? Math.max(60, Math.floor((deadlineMs - this.deps.now()) / 1_000))
      : 600;
    const args = [
      "--prompt-stdin",
      "--json-stream",
      "--runtime-mode",
      job.runtimeMode === "full-access" ? "full-access" : "approval-required",
      "--approval-file",
      this.approvalFilePath(),
      "--approval-timeout-seconds",
      String(Math.min(3_600, remainingSeconds - 30)),
      "--provider",
      binding.provider,
      "--model",
      job.input.model,
      "--cwd",
      this.workspacePath,
      "--interaction-mode",
      job.input.interactionMode === "plan" ? "plan" : "build",
    ];
    if (binding.baseUrl !== null) args.push("--base-url", binding.baseUrl);
    const env = { ...this.deps.env, ...this.deps.config.agentEnv };
    const spawned = this.deps.spawnAgent({
      binary: this.deps.config.agentBinary,
      args,
      cwd: this.workspacePath,
      env,
      prompt: job.input.prompt,
    });
    this.agentProcess = spawned;
    this.consumeTask = this.consumeEvents(spawned).catch((error: unknown) => {
      this.consumeError = error;
    });
    this.log({ event: "job.agent_started", provider: binding.provider });
  }

  private approvalFilePath(): string {
    if (!this.stagingDir) throw new Error("staging directory is not initialized");
    return NodePath.join(this.stagingDir, "approval.jsonl");
  }

  private async consumeEvents(process: AgentProcess): Promise<void> {
    for await (const frame of process.events) {
      const record = sanitizeEvent(frame);
      await this.appendTranscript(record);
      const type = typeof frame.type === "string" ? frame.type : "";
      switch (type) {
        case "session": {
          if (typeof frame.sessionId === "string") this.sessionId = frame.sessionId;
          await this.forwardEvent(record);
          break;
        }
        case "approval.requested": {
          await this.onApprovalRequested(record);
          break;
        }
        case "result": {
          this.finalResponse = typeof frame.response === "string" ? frame.response : "";
          await this.forwardEvent(record);
          break;
        }
        case "approval.resolved":
        case "tool.started":
        case "tool.completed":
        case "usage":
        case "shutdown": {
          await this.forwardEvent(record);
          break;
        }
        default: {
          // Unknown frame kinds are ignored so newer CLIs stay compatible.
          break;
        }
      }
    }
  }

  private async appendTranscript(record: Record<string, unknown>): Promise<void> {
    if (this.transcriptTruncated) return;
    const line = `${JSON.stringify(record)}\n`;
    this.transcriptBytes += Buffer.byteLength(line, "utf8");
    if (this.transcriptBytes > MAX_TRANSCRIPT_BYTES) {
      this.transcriptTruncated = true;
      return;
    }
    await NodeFS.appendFile(this.transcriptPath, line, "utf8");
  }

  // ------------------------------------------------------------------ approvals

  private async onApprovalRequested(record: Record<string, unknown>): Promise<void> {
    if (this.halted || this.cancelled || this.deadlineExceeded) return;
    const cliRequestId = typeof record.requestId === "string" ? record.requestId : null;
    if (cliRequestId === null) return;
    const cloudRequestId = this.deps.randomUUID();
    const pendingRequest: CloudJobPendingRequest = {
      requestId: cloudRequestId,
      kind: "approval",
      payload: {
        cliRequestId,
        toolName: typeof record.toolName === "string" ? record.toolName : null,
        arguments: record.arguments ?? null,
        timeoutSeconds: typeof record.timeoutSeconds === "number" ? record.timeoutSeconds : null,
      },
    };
    this.pendingApproval = { cloudRequestId, cliRequestId, appended: false };
    try {
      const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
        state: "waiting_for_approval",
        pendingRequest,
      });
      this.trackedState = job.state;
      this.lastSequence = job.lastSequence;
      this.log({
        event: "job.waiting_for_approval",
        toolName: typeof record.toolName === "string" ? record.toolName : null,
      });
    } catch (error) {
      this.pendingApproval = null;
      if (error instanceof CloudControlPlaneError && error.code === "invalid_transition") {
        // Cancellation or a terminal sweep raced the request; the heartbeat
        // loop settles the job on its next tick.
        this.log({ event: "job.approval_rejected", code: error.code });
        return;
      }
      throw error;
    }
  }

  private async tryResolveApproval(response: CloudJobLease["response"]): Promise<void> {
    const pending = this.pendingApproval;
    if (pending === null || response === null || response.requestId !== pending.cloudRequestId)
      return;
    if (!pending.appended) {
      if (!this.approvalFile) return;
      const decision = decisionFromUserPayload(response.payload);
      await this.approvalFile.append(pending.cliRequestId, decision);
      pending.appended = true;
      this.log({ event: "job.approval_answered", decision });
    }
    try {
      const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
        state: "running",
      });
      this.trackedState = job.state;
      this.lastSequence = job.lastSequence;
      this.pendingApproval = null;
      this.resolvePending();
    } catch (error) {
      if (error instanceof CloudControlPlaneError && error.code === "invalid_transition") {
        // The resume already won an earlier attempt (or a cancel landed); a
        // fresh heartbeat reflects the authoritative state.
        this.pendingApproval = null;
        this.resolvePending();
        return;
      }
      this.handleControlPlaneError(error, "approval_resume");
    }
  }

  // ------------------------------------------------------------------ heartbeat

  private async heartbeatLoop(): Promise<void> {
    const interval = this.deps.config.heartbeatIntervalMs;
    while (!this.stopped()) {
      try {
        await this.heartbeatOnce();
      } catch (error) {
        // A single bad tick (for example a full disk while writing the
        // approval file) must never kill the lease-renewal loop.
        this.handleControlPlaneError(error, "heartbeat");
      }
      if (this.stopped()) break;
      await this.sleepInterruptibly(interval);
    }
  }

  private async heartbeatOnce(): Promise<void> {
    if (this.halted) return;
    let lease: CloudJobLease;
    try {
      lease = await this.controlPlane.heartbeat(this.environmentId, this.jobId, this.lease);
    } catch (error) {
      this.handleControlPlaneError(error, "heartbeat");
      return;
    }
    this.job = lease.job;
    this.lastSequence = lease.job.lastSequence;
    if (lease.job.cancelRequestedAt !== null) {
      if (!this.cancelled) await this.onCancelRequested();
      return;
    }
    if (this.deps.now() >= Date.parse(lease.job.deadlineAt) && !this.deadlineExceeded) {
      await this.onDeadlineExceeded();
      return;
    }
    if (
      this.pendingApproval !== null &&
      !this.halted &&
      !this.cancelled &&
      !this.deadlineExceeded
    ) {
      await this.tryResolveApproval(lease.response);
    }
  }

  private async onCancelRequested(): Promise<void> {
    this.cancelled = true;
    this.log({ event: "job.cancel_requested" });
    await this.killAgent();
    await this.updateCancelled("user_requested");
    this.resolvePending();
  }

  private async updateCancelled(reason: string): Promise<void> {
    if (this.halted) return;
    try {
      const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
        state: "cancelled",
        event: { type: "worker.cancellation", reason },
      });
      this.trackedState = job.state;
      this.lastSequence = job.lastSequence;
      this.log({ event: "job.cancelled" });
    } catch (error) {
      if (error instanceof CloudControlPlaneError && error.code === "event_limit_exceeded") {
        try {
          const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
            state: "cancelled",
          });
          this.trackedState = job.state;
          this.lastSequence = job.lastSequence;
          return;
        } catch (retryError) {
          this.handleControlPlaneError(retryError, "cancel");
          return;
        }
      }
      this.handleControlPlaneError(error, "cancel");
    }
  }

  private async onDeadlineExceeded(): Promise<void> {
    this.deadlineExceeded = true;
    this.log({ event: "job.deadline_exceeded" });
    await this.killAgent();
    await this.markFailed("runtime_failed", "deadline_exceeded");
    this.resolvePending();
  }

  // -------------------------------------------------------------------- settling

  private async settle(outcome: Outcome): Promise<void> {
    switch (outcome.kind) {
      case "halted": {
        this.log({ event: "job.halted" });
        return;
      }
      case "cancelled":
      case "deadline": {
        return;
      }
      case "failed": {
        await this.markFailed(outcome.code, outcome.message);
        return;
      }
      case "exited": {
        await this.finalizeRun(outcome.exit);
        return;
      }
    }
  }

  private async finalizeRun(exit: AgentExit): Promise<void> {
    if (this.halted || this.cancelled || this.deadlineExceeded) return;
    if (exit.spawnError !== null) {
      await this.markFailed("runtime_failed", `agent process failed to start: ${exit.spawnError}`);
      return;
    }
    if (exit.code !== 0) {
      await this.markFailed("runtime_failed", exitSummary(exit));
      return;
    }
    if (this.finalResponse === null) {
      await this.markFailed("runtime_failed", "agent exited without producing a result frame");
      return;
    }
    let snapshot: WorkspaceSnapshot;
    const artifacts: CloudArtifact[] = [];
    try {
      await this.transitionTo("finalizing");
      snapshot = await this.deps.workspace.snapshot({
        workspacePath: this.workspacePath,
        sourceRevision: this.job.input.sourceRevision,
        stagingDir: this.stagingDir,
      });
      artifacts.push(
        await this.deps.artifacts.writeFromFile({
          jobId: this.jobId,
          kind: "log",
          name: "session.ndjson",
          sourcePath: this.transcriptPath,
        }),
      );
      if (snapshot.diffPath !== null) {
        artifacts.push(
          await this.deps.artifacts.writeFromFile({
            jobId: this.jobId,
            kind: "diff",
            name: "changes.diff",
            sourcePath: snapshot.diffPath,
          }),
        );
      }
      if (snapshot.bundlePath !== null) {
        artifacts.push(
          await this.deps.artifacts.writeFromFile({
            jobId: this.jobId,
            kind: "git-bundle",
            name: "changes.bundle",
            sourcePath: snapshot.bundlePath,
          }),
        );
      }
    } catch (error) {
      await this.markFailed("artifact_failed", messageOf(error));
      return;
    }
    const result: CloudJobResult = {
      sourceRevision: this.job.input.sourceRevision,
      headRevision: snapshot.headRevision,
      artifacts,
    };
    await this.completeJob(result);
  }

  private async completeJob(result: CloudJobResult): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.halted || this.cancelled || this.deadlineExceeded) return;
      try {
        const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
          state: "completed",
          result,
        });
        this.trackedState = job.state;
        this.lastSequence = job.lastSequence;
        this.log({
          event: "job.completed",
          artifacts: result.artifacts.length,
          headRevision: result.headRevision,
        });
        return;
      } catch (error) {
        if (error instanceof CloudControlPlaneError && error.code === "lease_lost") {
          this.handleControlPlaneError(error, "complete");
          return;
        }
        this.log({ event: "job.complete_retry", attempt: attempt + 1 });
        await delay(500 * (attempt + 1));
      }
    }
    // The terminal receipt never landed; the recovery sweep classifies the job
    // once the lease expires, and worker storage still holds the artifacts.
    this.log({ level: "error", event: "job.complete_failed" });
  }

  private async markFailed(code: FailureCode, message: string): Promise<void> {
    if (this.halted) return;
    if (
      this.trackedState === "completed" ||
      this.trackedState === "failed" ||
      this.trackedState === "cancelled"
    )
      return;
    const event = { type: "worker.failure", code, message: message.slice(0, 2_000) };
    try {
      const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
        state: "failed",
        failureCode: code,
        event,
      });
      this.trackedState = job.state;
      this.lastSequence = job.lastSequence;
      this.log({ level: "error", event: "job.failed", code, message: event.message });
    } catch (error) {
      if (error instanceof CloudControlPlaneError && error.code === "event_limit_exceeded") {
        try {
          const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
            state: "failed",
            failureCode: code,
          });
          this.trackedState = job.state;
          this.lastSequence = job.lastSequence;
          this.log({ level: "error", event: "job.failed", code });
          return;
        } catch (retryError) {
          this.handleControlPlaneError(retryError, "failure");
          return;
        }
      }
      this.handleControlPlaneError(error, "failure");
    }
  }

  private async transitionTo(state: CloudJobState): Promise<void> {
    const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
      state,
    });
    this.trackedState = job.state;
    this.lastSequence = job.lastSequence;
    this.log({ event: "job.state", state });
  }

  // --------------------------------------------------------------------- events

  private async forwardEvent(record: Record<string, unknown>): Promise<void> {
    if (this.halted || this.cancelled || this.deadlineExceeded) return;
    if (this.trackedState !== "running") return;
    if (this.eventBudgetExhausted) return;
    if (!this.hasEventBudget()) {
      this.eventBudgetExhausted = true;
      return;
    }
    try {
      const job = await this.controlPlane.update(this.environmentId, this.jobId, this.lease, {
        event: record,
      });
      this.lastSequence = job.lastSequence;
    } catch (error) {
      if (
        error instanceof CloudControlPlaneError &&
        (error.code === "lease_lost" || error.code === "not_found")
      ) {
        this.handleControlPlaneError(error, "event");
        return;
      }
      if (error instanceof CloudControlPlaneError && error.code === "event_limit_exceeded") {
        this.eventBudgetExhausted = true;
        return;
      }
      // Runtime events are best effort; the transcript artifact keeps the
      // complete record, so a failed forward never fails the job.
      this.log({ level: "warn", event: "event_forward_dropped", code: errorCodeOf(error) });
    }
  }

  private hasEventBudget(): boolean {
    return this.lastSequence + EVENT_RESERVE <= this.job.limits.maxEvents;
  }

  // ------------------------------------------------------------------ helpers

  private async killAgent(): Promise<void> {
    const process = this.agentProcess;
    if (!process) return;
    try {
      await process.kill();
    } catch {
      // The process is already gone; nothing else to do.
    }
  }

  private async cleanupResources(): Promise<void> {
    await this.killAgent();
    if (!this.deps.config.keepWorkspaces && this.workspacePath.length > 0) {
      try {
        await this.deps.workspace.cleanup(this.workspacePath);
      } catch {
        this.log({ level: "warn", event: "workspace_cleanup_failed" });
      }
    }
  }

  private outcomeFromError(error: unknown): Outcome {
    if (this.cancelled) return { kind: "cancelled" };
    if (this.deadlineExceeded) return { kind: "deadline" };
    if (this.halted) return { kind: "halted" };
    if (error instanceof RunAbortedError) {
      return this.cancelled ? { kind: "cancelled" } : { kind: "halted" };
    }
    const code: FailureCode =
      this.trackedState === "provisioning" ? "provisioning_failed" : "runtime_failed";
    return { kind: "failed", code, message: messageOf(error) };
  }

  private assertLive(): void {
    if (this.halted || this.cancelled || this.deadlineExceeded) throw new RunAbortedError();
  }

  private stopped(): boolean {
    return this.stopHeartbeat || this.halted || this.cancelled || this.deadlineExceeded;
  }

  private handleControlPlaneError(error: unknown, phase: string): void {
    if (error instanceof CloudControlPlaneError) {
      this.log({
        level: "warn",
        event: "control_plane_error",
        phase,
        code: error.code,
        status: error.status,
      });
      if (
        error.code === "lease_lost" ||
        error.code === "not_found" ||
        error.code === "unauthorized" ||
        error.status === 401 ||
        error.status === 403
      ) {
        this.halted = true;
        this.stopHeartbeat = true;
        this.resolvePending();
      }
      return;
    }
    this.log({ level: "warn", event: "control_plane_error", phase, code: errorCodeOf(error) });
  }

  private resolvePending(): void {
    const pending = this.pendingResolve;
    this.pendingResolve = null;
    pending?.();
  }

  private waitForResolution(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  private async sleepInterruptibly(totalMs: number): Promise<void> {
    // Wall clock, not the injected `now`: a test clock that stands still must
    // not turn this slice loop into a busy wait.
    const end = Date.now() + totalMs;
    while (!this.stopped() && Date.now() < end) {
      await delay(Math.min(250, Math.max(1, end - Date.now())));
    }
  }

  private log(fields: Record<string, unknown>): void {
    this.deps.log({ jobId: this.jobId, environmentId: this.environmentId, ...fields });
  }
}

function sanitizeEvent(event: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    out[key] =
      typeof value === "string" && value.length > MAX_EVENT_FIELD_CHARS
        ? `${value.slice(0, MAX_EVENT_FIELD_CHARS)}\u2026(truncated)`
        : value;
  }
  return out;
}

function exitSummary(exit: AgentExit): string {
  const code = exit.code === null ? "signal" : `code ${exit.code}`;
  const tail = exit.stderrTail.trim().slice(-1_000);
  return tail.length > 0 ? `agent exited with ${code}: ${tail}` : `agent exited with ${code}`;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 2_000);
  return `non-error failure: ${String(error).slice(0, 2_000)}`;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof CloudControlPlaneError) return error.code;
  if (error instanceof Error) return error.name;
  return "unknown";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
