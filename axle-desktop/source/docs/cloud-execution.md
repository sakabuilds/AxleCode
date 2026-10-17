# Cloud execution

Axle Cloud jobs are long-running agent runs that execute on independent **worker hosts** — machines operated by you (or a cloud provider you choose), not by the desktop app. Desktop, mobile, and web clients only talk to the Axle **control plane** (the account API); workers claim jobs from the control plane, run the `axle` CLI on the worker, and report state back. Nothing about a job depends on a user's machine staying online.

## Architecture

```
client (desktop / mobile / web)
  |  POST /v1/cloud/jobs                     create job (prompt, repo, provider, model)
  |  GET  /v1/cloud/jobs/{jobId}             poll state + result summary
  |  GET  /v1/cloud/jobs/{jobId}/events      event log (cursor paginated)
  |  POST /v1/cloud/jobs/{jobId}/responses   answer approval / input requests
  |  POST /v1/cloud/jobs/{jobId}/cancel      request cancellation
  v
control plane (apps/account-api)
  |  POST /v1/cloud-workers/{environmentId}/claim
  |  POST /v1/cloud-workers/{environmentId}/recover
  |  POST /v1/cloud-workers/{environmentId}/jobs/{jobId}/heartbeat
  |  POST /v1/cloud-workers/{environmentId}/jobs/{jobId}/update
  v
worker (apps/cloud-worker)
  |  git clone (https-only, credential-free) -> workspace
  |  spawn `axle --prompt-stdin --json-stream --runtime-mode approval-required ...`
  |  relay approvals through the approval file
  `- upload artifacts -> jobs/{jobId}/{kind}/{name}
```

| Piece                            | Where                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Job / lease / update contracts   | `packages/contracts/src/cloudJobs.ts`                                                            |
| Control-plane routes             | `apps/account-api/src/cloudHandler.ts`                                                           |
| Job persistence                  | `apps/account-api/src/cloudStore.ts`, migration `apps/account-api/migrations/003_cloud_jobs.sql` |
| Operator config (control plane)  | `apps/account-api/src/cloudConfig.ts` (`AXLE_CLOUD_CONFIG`)                                      |
| Worker                           | `apps/cloud-worker` (`@axle/cloud-worker`)                                                       |
| CLI runtime mode + approval file | `crates/axle_cli/src/main.rs`, `crates/axle_agent/src/loop_runner.rs`                            |

## Job lifecycle

```
provisioning --+--> running --+--> waiting_for_approval --+
               |             +--> waiting_for_input ------+
               |             +--> finalizing --> completed
               |             +--> failed
               |             `--> cancelled
               +--> failed
               `--> cancelled
```

Invariants enforced by the control plane:

- `completed` requires the worker's reported `result.sourceRevision` to equal the job's `input.sourceRevision` — a job only completes when the agent's work actually landed on the source revision the job started from.
- `waiting_for_approval` and `waiting_for_input` never accept a same-state update; they move only when the worker reports progress or the user answers.
- A same-state update without an `event` is rejected as invalid.
- `update` requires the `commandId` from the current lease; stale commands are rejected.
- Heartbeats carry the lease; a lost lease halts the worker (`lease_lost`).

## Control-plane API

### Worker routes

All worker requests are `POST`, authenticated with `Authorization: Bearer <workerToken>` and a body containing `workerId` (timing-safe token comparison); the worker must be listed for the environment or the request is `403 forbidden`.

| Route                                                      | Purpose                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/v1/cloud-workers/{environmentId}/claim`                  | Claim the next queued job. `200` with a lease, or `204` when there is no work. |
| `/v1/cloud-workers/{environmentId}/recover`                | Reclaim this worker's leased job after a worker restart.                       |
| `/v1/cloud-workers/{environmentId}/jobs/{jobId}/heartbeat` | Extend the lease while the job runs.                                           |
| `/v1/cloud-workers/{environmentId}/jobs/{jobId}/update`    | Report a state transition / event. Requires `commandId`.                       |

### Client routes

Authenticated with the user's session; `cloud_access_denied` (403) when the user is not in `allowedUserIds`.

| Route                                             | Purpose                                                |
| ------------------------------------------------- | ------------------------------------------------------ |
| `POST /v1/cloud/jobs`                             | Create a job (`201` created, `200` idempotent replay). |
| `GET /v1/cloud/jobs`                              | List the user's jobs.                                  |
| `GET /v1/cloud/jobs/{jobId}`                      | Current job state and result summary.                  |
| `GET /v1/cloud/jobs/{jobId}/events?after=&limit=` | Event log (cursor paginated; default 200, max 500).    |
| `POST /v1/cloud/jobs/{jobId}/responses`           | Answer an approval or input request.                   |
| `POST /v1/cloud/jobs/{jobId}/cancel`              | Request cancellation.                                  |

### Errors

| Error                                            | Status |
| ------------------------------------------------ | ------ |
| `cloud_not_configured`                           | 503    |
| `unauthorized`                                   | 401    |
| `forbidden`, `cloud_access_denied`               | 403    |
| `cloud_not_entitled`                             | 403    |
| `insufficient_credits`, `credit_account_missing` | 402    |
| `not_found`                                      | 404    |
| `invalid_*`                                      | 400    |
| `environment_unavailable`, `model_unavailable`   | 422    |
| `capacity_exceeded`, `event_limit_exceeded`      | 429    |
| any other `CloudJobError` code                   | 409    |
| `internal_error`                                 | 500    |

## Worker configuration

`AXLE_CLOUD_WORKER_CONFIG` (JSON string) or `AXLE_CLOUD_WORKER_CONFIG_FILE` (path to a JSON file). Both are read once at startup; the raw value is never logged.

| Field                 | Required | Default | Notes                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controlPlaneUrl`     | yes      | —       | `http(s)`, no credentials in the URL; trailing slashes stripped.                                                                                                                                                                                                                                                                              |
| `workerId`            | yes      | —       | `[A-Za-z0-9][A-Za-z0-9_-]*`, at most 128 chars; must match the control plane's `workers[].workerId`.                                                                                                                                                                                                                                          |
| `workerToken`         | yes      | —       | 32-256 chars; must match `workers[].token`.                                                                                                                                                                                                                                                                                                   |
| `environmentIds`      | yes      | —       | Non-empty, unique; environments the worker is bound to on the control plane.                                                                                                                                                                                                                                                                  |
| `workspaceRoot`       | yes      | —       | Where per-job clones are created.                                                                                                                                                                                                                                                                                                             |
| `artifactRoot`        | yes      | —       | Artifact store root (`jobs/{jobId}/...`).                                                                                                                                                                                                                                                                                                     |
| `agentBinary`         | no       | `axle`  | Path/name of the CLI binary to spawn.                                                                                                                                                                                                                                                                                                         |
| `agentEnv`            | no       | `{}`    | Extra environment variables for the agent process.                                                                                                                                                                                                                                                                                            |
| `providers`           | yes      | —       | Non-empty array of `{ providerInstanceId, provider, apiKeyEnv?, baseUrl? }`. `provider` is one of `openai`, `anthropic`, `gemini`, `fireworks`, `ollama-cloud`, `cerebras`, `groq`, `openrouter`, `mistral`, `deepseek`, `xai`, `ollama`. `apiKeyEnv` is required unless the provider is `ollama`; `baseUrl` overrides the provider endpoint. |
| `pollIntervalMs`      | no       | `3000`  | 250-60000.                                                                                                                                                                                                                                                                                                                                    |
| `heartbeatIntervalMs` | no       | `10000` | 1000-120000.                                                                                                                                                                                                                                                                                                                                  |
| `shutdownGraceMs`     | no       | `30000` | 1000-600000; time in-flight jobs get to wind down on SIGINT/SIGTERM.                                                                                                                                                                                                                                                                          |
| `maxConcurrentJobs`   | no       | `4`     | 1-100.                                                                                                                                                                                                                                                                                                                                        |
| `keepWorkspaces`      | no       | `true`  | Keep job workspaces after completion for inspection.                                                                                                                                                                                                                                                                                          |

Example — see also `apps/cloud-worker/.env.example`:

```json
{
  "controlPlaneUrl": "https://accounts.example.com",
  "workerId": "worker-1",
  "workerToken": "replace-with-a-32-plus-character-token",
  "environmentIds": ["linux-standard"],
  "workspaceRoot": "/var/lib/axle-cloud/work",
  "artifactRoot": "/var/lib/axle-cloud/artifacts",
  "providers": [
    {
      "providerInstanceId": "anthropic-default",
      "provider": "anthropic",
      "apiKeyEnv": "ANTHROPIC_API_KEY"
    }
  ]
}
```

Provider credentials live only in the worker host environment (e.g. `ANTHROPIC_API_KEY`) and are passed to the agent process for the provider the claimed job selected. They never transit the control plane.

## Control-plane configuration

`AXLE_CLOUD_CONFIG` on the account API (JSON string). When absent, every cloud route reports `cloud_not_configured` (503). Do not announce a runner or paid entitlement until this configuration and billing are actually enabled.

| Field                  | Notes                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environments[]`       | `{ environmentId, repositoryHosts[], providerModels[{ providerInstanceId, model }], maxConcurrentJobs (1-100), limits }`. `repositoryHosts` are DNS names (no `.localhost`); `limits` = `{ maxDurationSeconds <= 86400, maxEvents 10-10000, cpuMillis <= 32000, memoryMb <= 65536, diskMb <= 1048576 }`, with `maxDurationSeconds >= leaseSeconds`. |
| `workers[]`            | `{ workerId, token (32-256), environmentIds[] }`. Worker ids and tokens must be unique and a worker's environments must exist.                                                                                                                                                                                                                      |
| `allowedUserIds[]`     | Non-empty; only these users can create jobs or answer requests.                                                                                                                                                                                                                                                                                     |
| `maxActiveJobsPerUser` | 1-100.                                                                                                                                                                                                                                                                                                                                              |
| `leaseSeconds`         | 15-300.                                                                                                                                                                                                                                                                                                                                             |

## Billing and credits

`AXLE_BILLING_CONFIG` on the account API (JSON string). When absent, cloud jobs are unmetered: no reservation is taken and no charge is applied, while `maxActiveJobsPerUser` still applies.

```json
{
  "plans": [
    { "planId": "free", "cloudJobsEnabled": false, "monthlyCredits": 20, "maxConcurrentJobs": 1 },
    {
      "planId": "pro",
      "cloudJobsEnabled": true,
      "monthlyCredits": 500,
      "maxConcurrentJobs": 4,
      "features": {
        "scheduledTasksMax": 50,
        "pullRequestReviews": true,
        "premiumModels": true,
        "teamSharing": false
      }
    }
  ],
  "defaultPlanId": "free",
  "userPlans": { "user-1": "pro" },
  "creditsPerMinute": 3,
  "adminToken": "replace-with-a-32-plus-character-operator-token"
}
```

- `plans[]`: unique plan ids. `cloudJobsEnabled` gates job creation (`cloud_not_entitled`); `monthlyCredits` is granted once per calendar month on first use; `maxConcurrentJobs` caps concurrent work per user (combined with `maxActiveJobsPerUser`, whichever is lower wins).
- `features` (optional per plan): advisory gates for client surfaces, resolved server-side and exposed through `GET /v1/cloud/billing` as `account.entitlements`. Plans that omit `features` fall back to the closed baseline `{ scheduledTasksMax: 2, pullRequestReviews: false, premiumModels: false, teamSharing: false }`. `entitlements` is `null` on unmetered deployments, which clients treat as everything unlocked — only a positively resolved plan may gate a feature.
- `defaultPlanId`: plan for users without an explicit assignment.
- `userPlans`: optional per-user overrides; values must reference a configured plan.
- `creditsPerMinute`: reservation and settlement rate. Set 0 to keep plans and accounting while charging nothing.
- `adminToken`: optional operator credential (32-256 chars) for credit grants.

Ledger policy — accounting runs in the same database transaction as the job state change:

1. **Reserve** — job creation reserves `ceil(maxDurationSeconds / 60) * creditsPerMinute`; creation fails with `insufficient_credits` (402) when the balance cannot cover it, and `credit_account_missing` (402) for an account without a balance row. The client never supplies its plan, balance, or limits; the server resolves them from configuration.
2. **Meter** — the metered window starts at the first worker claim.
3. **Settle** — on a terminal state the charge is `ceil(runtimeMinutes) * creditsPerMinute`, capped by the reservation, and the remainder is released. Jobs cancelled before any worker claimed them are released in full. Settlement is idempotent.
4. **Grants** — `POST /v1/cloud/credits/grant` with the `x-axle-admin` header requires the configured `adminToken` (403 otherwise) and a body `{ userId, entryId, amount, note? }`; `entryId` makes retries idempotent.

Routes: `GET /v1/cloud/billing` returns the caller's `{ account: { planId, balance, updatedAt, entitlements }, entries[] }` with the 50 most recent ledger entries.

## Agent process contract

The worker spawns the CLI with:

```
axle --prompt-stdin --json-stream --runtime-mode approval-required \
     --approval-file <staging>/approval.ndjson --approval-timeout-seconds <n> \
     --provider <kind> --model <model> --cwd <workspace> \
     --interaction-mode build|plan [--base-url <url>]
```

- The prompt is written to stdin; stdout is parsed as NDJSON (non-JSON and array lines are skipped; oversized lines are dropped).
- Approval requests stream back as events; the worker appends decisions to the approval file:

  ```json
  { "type": "approval_response", "requestId": "<cli request id>", "decision": "allow" }
  ```

  The CLI polls the file every 150 ms. Anything unrecognised is **denied** — approvals default to deny.

- Cancellation: the worker sends `SIGTERM` and waits `shutdownGraceMs`; the job settles as `cancelled`.
- A non-zero agent exit fails the job as `runtime_failed`; a provisioning failure fails it as `provisioning_failed`, and an agent that exits while an approval is pending is held open until the request settles.

## Security model

- **Repositories**: clone URLs must be https and their host must be listed in the environment's `repositoryHosts`; clones run credential-free (`GIT_CONFIG_NOSYSTEM=1`, no credential helpers), so a worker cannot leak user tokens and a job cannot fetch anything the environment does not allow.
- **Workspaces**: one clone per job under `workspaceRoot`; nothing is shared between jobs.
- **Approvals**: default-deny; the worker only writes an allow when the user, through the control plane, allows that exact request id.
- **Artifacts**: storage keys are confined to `jobs/{jobId}/{kind}/{name}` and validated against traversal; writes over the store's byte limit (default 100 MB) are rejected.
- **Credentials**: the worker token is compared with a timing-safe hash and never logged; invalid config errors never echo the raw configuration.
- **Observability**: logs never include prompts, worker capabilities, or DB error details.

## Limitations

- The control plane stores only artifact **manifests** (kind, `storageKey`, `sha256`, `sizeBytes`); artifact bytes stay on worker storage and are fetched out of band.
- One job is leased to one worker at a time; `recover` exists for worker restarts, not for parallel execution of the same job.
- Per-environment `maxConcurrentJobs`, lease duration, and per-job limits are enforced; a job that exceeds `maxDurationSeconds` is failed.
- Workers are operator-run: the product makes no claim of a default public runner.
