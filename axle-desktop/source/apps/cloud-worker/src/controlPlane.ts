// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Worker HTTP client applies its own transport backoff outside an Effect runtime.
import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";

import {
  CloudJob,
  CloudJobLease,
  type CloudJobPendingRequest,
  type CloudJobResult,
  type CloudJobState,
} from "@axle/contracts";

const decodeJob = Schema.decodeUnknownSync(CloudJob);
const decodeLease = Schema.decodeUnknownSync(CloudJobLease);

export class CloudControlPlaneError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(`cloud control plane rejected the request (${code})`);
    this.name = "CloudControlPlaneError";
    this.code = code;
    this.status = status;
  }
}

export interface WorkerLeaseRef {
  readonly leaseToken: string;
  readonly generation: number;
}

export interface WorkerUpdate {
  readonly commandId?: string;
  readonly state?: CloudJobState;
  readonly event?: unknown;
  readonly pendingRequest?: CloudJobPendingRequest;
  readonly result?: CloudJobResult;
  readonly failureCode?: "provisioning_failed" | "runtime_failed" | "artifact_failed";
}

export interface CloudControlPlaneOptions {
  readonly baseUrl: string;
  readonly workerId: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly attempts?: number;
  readonly retryDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly randomUUID?: () => string;
}

/**
 * Worker-side client for the account API cloud control plane. Every request is
 * authorized by the worker capability (worker id plus bearer token); lease
 * fencing is enforced by the control plane, not here.
 */
export class CloudControlPlane {
  private readonly baseUrl: string;
  private readonly workerId: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly randomUUID: () => string;

  constructor(options: CloudControlPlaneOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.workerId = options.workerId;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.attempts = options.attempts ?? 4;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.randomUUID = options.randomUUID ?? (() => NodeCrypto.randomUUID());
  }

  async claim(environmentId: string): Promise<CloudJobLease | null> {
    const { body } = await this.post(environmentId, "claim", { workerId: this.workerId, environmentId });
    if (body === null || body === undefined) return null;
    return this.decodeLease(body);
  }

  async recover(environmentId: string): Promise<void> {
    await this.post(environmentId, "recover", { workerId: this.workerId, environmentId });
  }

  async heartbeat(environmentId: string, jobId: string, lease: WorkerLeaseRef): Promise<CloudJobLease> {
    const { body } = await this.post(environmentId, `jobs/${encodeURIComponent(jobId)}/heartbeat`, {
      workerId: this.workerId,
      leaseToken: lease.leaseToken,
      generation: lease.generation,
    });
    return this.decodeLease(body);
  }

  async update(
    environmentId: string,
    jobId: string,
    lease: WorkerLeaseRef,
    update: WorkerUpdate,
  ): Promise<CloudJob> {
    const payload: Record<string, unknown> = {
      workerId: this.workerId,
      leaseToken: lease.leaseToken,
      generation: lease.generation,
      commandId: update.commandId ?? this.randomUUID(),
    };
    if (update.state !== undefined) payload.state = update.state;
    if (update.event !== undefined) payload.event = update.event;
    if (update.pendingRequest !== undefined) payload.pendingRequest = update.pendingRequest;
    if (update.result !== undefined) payload.result = update.result;
    if (update.failureCode !== undefined) payload.failureCode = update.failureCode;
    const { body } = await this.post(environmentId, `jobs/${encodeURIComponent(jobId)}/update`, payload);
    try {
      return decodeJob(body);
    } catch {
      throw new CloudControlPlaneError("invalid_response", 200);
    }
  }

  private decodeLease(body: unknown): CloudJobLease {
    try {
      return decodeLease(body);
    } catch {
      throw new CloudControlPlaneError("invalid_response", 200);
    }
  }

  private async post(
    environmentId: string,
    subpath: string,
    payload: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const url = `${this.baseUrl}/v1/cloud-workers/${encodeURIComponent(environmentId)}/${subpath}`;
    let attempt = 0;
    while (true) {
      attempt += 1;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch {
        if (attempt < this.attempts) {
          await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw new CloudControlPlaneError("network_error", 0);
      }
      if ((response.status === 429 || response.status >= 500) && attempt < this.attempts) {
        await this.sleep(this.retryDelayFor(response, attempt));
        continue;
      }
      const text = await response.text();
      let body: unknown = null;
      if (text.trim().length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      if (!response.ok) throw new CloudControlPlaneError(errorCode(body) ?? `http_${response.status}`, response.status);
      return { status: response.status, body };
    }
  }

  private retryDelayFor(response: Response, attempt: number): number {
    const header = response.headers.get("retry-after");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 60) return seconds * 1_000;
    }
    return this.retryDelayMs * 2 ** (attempt - 1);
  }
}

function errorCode(body: unknown): string | null {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>).error;
    if (typeof value === "string" && value.length > 0 && value.length <= 64) return value;
  }
  return null;
}
