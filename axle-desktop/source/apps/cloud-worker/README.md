# @axle/cloud-worker

Independent cloud-execution worker for Axle Cloud jobs. It claims jobs from the Axle control plane, provisions an isolated workspace, runs the `axle` CLI in approval-required mode, relays approvals, stores artifacts, and reports state transitions back to the control plane.

Full architecture, the control-plane API, configuration schema, and security model: [`docs/cloud-execution.md`](../../docs/cloud-execution.md).

## Run

```powershell
# .env.example shows the shape; the raw config is never logged.
$env:AXLE_CLOUD_WORKER_CONFIG = '{"controlPlaneUrl":"https://accounts.example.com", ...}'
node src/index.ts
```

Or point `AXLE_CLOUD_WORKER_CONFIG_FILE` at a JSON file on the host. `npm run dev` watches the source; `npm start` runs it once.

The process logs one JSON object per line (`worker.claimed`, `worker.claim_failed`, `worker.stopped`, ...), backs off on claim failures, and shuts down gracefully on SIGINT/SIGTERM, letting in-flight jobs finish within `shutdownGraceMs`.

## Configuration

| Field | Required | Default |
| --- | --- | --- |
| `controlPlaneUrl` | yes | — |
| `workerId` | yes | — |
| `workerToken` | yes | — |
| `environmentIds` | yes | — |
| `workspaceRoot` | yes | — |
| `artifactRoot` | yes | — |
| `agentBinary` | no | `axle` |
| `agentEnv` | no | `{}` |
| `providers` | yes | — |
| `pollIntervalMs` | no | `3000` |
| `heartbeatIntervalMs` | no | `10000` |
| `shutdownGraceMs` | no | `30000` |
| `maxConcurrentJobs` | no | `4` |
| `keepWorkspaces` | no | `true` |

See `docs/cloud-execution.md` for validation rules and a full example. Provider keys (e.g. `ANTHROPIC_API_KEY`) live only in the worker host environment and are passed to the agent process.

## Layout

| File | Role |
| --- | --- |
| `src/index.ts` | Claim loops, concurrency, graceful shutdown |
| `src/config.ts` | Environment configuration schema + validation |
| `src/controlPlane.ts` | Control-plane HTTP client (claim / heartbeat / update) |
| `src/runner.ts` | Job lifecycle: provision, run, approvals, finalize |
| `src/process.ts` | CLI spawn, NDJSON parsing, cancellation |
| `src/approval.ts` | Approval-file protocol |
| `src/git.ts` | Credential-free workspace checkout |
| `src/artifacts.ts` | Artifact store (`jobs/{jobId}/...`) |

## Test

```
npx tsgo --noEmit
npx vp test run
```