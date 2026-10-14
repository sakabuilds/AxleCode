// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off - Worker entry point owns signal handling and poll scheduling.
import * as NodeCrypto from "node:crypto";

import type { CloudJobLease } from "@axle/contracts";
import { readWorkerConfig, WorkerConfigError, type WorkerConfig } from "./config.ts";
import { CloudControlPlane, CloudControlPlaneError } from "./controlPlane.ts";
import { FileArtifactStore } from "./artifacts.ts";
import { prepareWorkspace, snapshotWorkspace } from "./git.ts";
import { CloudJobRunner, type RunDependencies } from "./runner.ts";
import { spawnAgentProcess } from "./process.ts";
import * as NodeFS from "node:fs/promises";

/**
 * Axle cloud worker entry point.
 *
 * One process per worker host: it claims jobs for each configured environment
 * (never exceeding `maxConcurrentJobs` across the whole host), runs them, and
 * keeps every lease alive with heartbeats. On SIGINT/SIGTERM it stops claiming,
 * gives running agents a bounded grace period, and exits; jobs whose leases
 * expire are swept to `interrupted` by the control plane, never replayed.
 *
 * Logging is structured JSON with a strict field whitelist: tokens, prompts,
 * provider keys, and event payloads never appear in logs.
 */

async function main(): Promise<void> {
  let config: WorkerConfig;
  try {
    config = readWorkerConfig(process.env);
  } catch (error) {
    if (error instanceof WorkerConfigError) {
      console.error(JSON.stringify({ level: "error", event: "worker.config_invalid" }));
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  const log = (fields: Record<string, unknown>): void => {
    console.log(JSON.stringify({ level: "info", workerId: config.workerId, ...fields }));
  };

  const controlPlane = new CloudControlPlane({
    baseUrl: config.controlPlaneUrl,
    workerId: config.workerId,
    token: config.workerToken,
  });
  const artifacts = new FileArtifactStore({ root: config.artifactRoot });
  await NodeFS.mkdir(config.workspaceRoot, { recursive: true });
  await NodeFS.mkdir(config.artifactRoot, { recursive: true });

  const deps: RunDependencies = {
    config,
    controlPlane,
    artifacts,
    workspace: {
      prepare: prepareWorkspace,
      snapshot: snapshotWorkspace,
      cleanup: async (workspacePath) => {
        await NodeFS.rm(workspacePath, { recursive: true, force: true });
      },
    },
    spawnAgent: spawnAgentProcess,
    env: process.env,
    randomUUID: () => NodeCrypto.randomUUID(),
    now: () => Date.now(),
    log,
  };
  const runner = new CloudJobRunner(deps);

  let stopping = false;
  const active = new Set<Promise<void>>();
  const idleWaiters: Array<() => void> = [];

  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log({ event: "worker.stopping", signal });
    for (const wake of idleWaiters.splice(0)) wake();
    const grace = setTimeout(() => {
      log({ event: "worker.force_exit" });
      process.exit(0);
    }, config.shutdownGraceMs);
    grace.unref();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  // Recover stale leases once per environment before claiming new work.
  for (const environmentId of config.environmentIds) {
    try {
      await controlPlane.recover(environmentId);
      log({ event: "worker.recovered", environmentId });
    } catch (error) {
      log({ level: "warn", event: "worker.recover_failed", environmentId, code: errorCodeOf(error) });
    }
  }

  const loops = config.environmentIds.map((environmentId) =>
    claimLoop(environmentId, async (lease) => {
      const task = runner
        .run(environmentId, lease)
        .catch((error: unknown) => {
          // The runner converts expected failures into job states itself; this
          // is a last-resort net so one bad job can never kill the worker.
          log({ level: "error", event: "worker.job_crashed", jobId: lease.job.jobId, code: errorCodeOf(error) });
        })
        .finally(() => {
          active.delete(task);
          for (const wake of idleWaiters.splice(0)) wake();
        });
      active.add(task);
    }),
  );

  log({ event: "worker.started", environments: config.environmentIds.length, maxConcurrentJobs: config.maxConcurrentJobs });
  await Promise.all(loops);

  // Drain: let in-flight jobs observe the stop flag and wind down.
  while (active.size > 0) {
    await Promise.race([Promise.all([...active]), new Promise<void>((resolve) => idleWaiters.push(resolve))]);
  }
  log({ event: "worker.stopped" });

  async function claimLoop(environmentId: string, launch: (lease: CloudJobLease) => Promise<void>): Promise<void> {
    let backoffMs = 0;
    while (!stopping) {
      if (active.size >= config.maxConcurrentJobs) {
        await Promise.race([
          new Promise<void>((resolve) => idleWaiters.push(resolve)),
          delay(config.pollIntervalMs),
        ]);
        continue;
      }
      let lease: CloudJobLease | null;
      try {
        lease = await controlPlane.claim(environmentId);
        backoffMs = 0;
      } catch (error) {
        const code = errorCodeOf(error);
        backoffMs = Math.min(30_000, backoffMs === 0 ? 1_000 : backoffMs * 2);
        log({ level: "warn", event: "worker.claim_failed", environmentId, code, backoffMs });
        await delay(backoffMs);
        continue;
      }
      if (lease === null) {
        await delay(config.pollIntervalMs);
        continue;
      }
      log({ event: "worker.claimed", environmentId, jobId: lease.job.jobId });
      await launch(lease);
      await delay(25);
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
      if (stopping) {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}

function errorCodeOf(error: unknown): string {
  if (error instanceof CloudControlPlaneError) return error.code;
  if (error instanceof Error) return error.name;
  return "unknown";
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "worker.crashed", code: errorCodeOf(error) }));
  process.exitCode = 1;
});

