# 13 — Glossary & Domain Model

> Alphabetical within sections. Every definition ties to the code that implements it; where a term is used loosely in the codebase, the canonical meaning is marked and the trap called out.

## 13.1 Core domain nouns

| Term | Canonical meaning in Axle | Where it lives |
| --- | --- | --- |
| **Thread** | The user-visible unit of work: a conversation/agent context. In Codex-product terms, the "chat". A thread owns turns and (usually) one workspace. | Session model + web routes (doc 08); clarified as user-facing synonym of session grouping. |
| **Turn** | One user prompt → one complete agent response cycle, including tool calls and approvals in between. The unit the loop runs. | `loop_runner.rs` (turn lifecycle); doc 04 §turn lifecycle. |
| **Project** | A workspace root (folder) registered by the user, with per-project instructions and settings. Threads attach to a project. | Project config in `axle-config`; web project state (doc 08). |
| **Environment** | A target runtime the server can operate in: the local machine ("local environment") or a remote/paired host. Env-links connect server ↔ workspace on a host. | Bootstrap channel `getLocalEnvironmentBootstrap` (preload marker); doc 05 (remote access). |
| **Draft** | Pre-turn composer/session scratch state that is not yet a committed turn — the thing you type before sending. | Web state layer; server staging of pending input. |
| **Proposed plan** | The plan-mode artifact the agent produces before executing: a structured proposal gated by user approval before build-mode execution. | `loop_runner.rs` plan/build gating (`:69-145`); doc 04. |
| **Checkpoint** | A saved restore point of session/workspace state that can be reverted to; distinct from a git commit. | Checkpoint feature (doc 03 F9). |
| **Activity** | A user-facing feed entry describing something the agent/server did (tool ran, file changed, approval needed). Aggregated view over events. | Server → web activity stream (doc 07 events). |
| **Pending approval** | A tool execution paused awaiting user decision; blocks the turn until approved/denied/timed out. | `loop_runner.rs:1916-2283`; approval channel in doc 04/07. |
| **Session** | ⚠️ **Two meanings — do not conflate.** (a) *Agent session*: the persisted event log of a thread on the agent plane (`SessionHeader` + `SessionEntry` records). (b) *Provider/auth session*: a logged-in account credential set for a model provider. | (a) `session/manager.rs`, `engine.rs`; (b) auth/accounts (doc 05). |
| **Compaction** | Automatic summarisation of older session history when context fills, producing a compacted segment that preserves continuity at lower token cost. | `session/manager.rs:296-336, 371-426, 465, 485, 530+`; doc 04. |
| **Memory** | Durable, user/project-scoped facts and preferences injected into prompts across sessions (distinct from per-session transcript). | `axle-memory` crate (`61-84, 87-104, 110, 214-232, 249-258`). |
| **Profile** | A named configuration of model + provider + approval/sandbox defaults used to launch turns. | `ModelSelection` + config; doc 04. |
| **Skill** | A packaged instruction bundle (with optional resources) that teaches the agent a workflow; discovered from skill roots. | Instructions/skills loading (doc 03 F20); prompt builder sections. |
| **Toolkit** | The named set of MCP tools the Axle server exposes outward to other agents (distinct from the agent's own tool registry). | `McpHttpServer.ts:214, 219, 291`; doc 05. |
| **MCP** | Model Context Protocol. Used in **both directions**: as *client* (Axle agent consumes external MCP servers/tools) and as *server* (Axle exposes its toolkit to others). | `crates/axle-tools/src/mcp.rs`; `apps/server/src/McpHttpServer.ts`. |
| **Plan mode / Build mode** | Two execution personalities: plan = research + propose, no side-effectful actions without approval; build = execute approved plan with normal approval gating. | Runtime mode switch in `loop_runner.rs`; doc 04. |
| **Runtime mode** | The session/engine configuration selecting approval policy + sandbox mode + which tools are allowed. | `ProviderApprovalPolicy`, `ProviderSandboxMode` (below). |
| **Relay** | The Cloudflare-hosted service that brokers remote connectivity (pairing, DPoP-authenticated tunnels, APNs push) between a desktop and remote clients. | `infra/relay/`; doc 05/06. |
| **Environment link** | A paired/registered relationship letting a remote client reach a desktop's local environment through the relay. | Relay tables (`managed_endpoint_allocations`, labels, bundle ids — doc 06). |
| **DPoP** | Demonstrating Proof-of-Possession: signed, per-request proof that a client holds the key it claims; relay endpoints require it. | Relay auth (doc 05/09); CORS header list includes `dpop`. |
| **Pairing** | The one-time ceremony that establishes an environment link (code/QR exchange → keys → link record). | Relay + desktop pairing flow; doc 03 F17. |
| **Axle home** | The app's state directory (`AXLE_HOME`), containing userdata, logs, attachments, secrets, caches, worktrees, memory, launcher data. | Launcher (`launcher.ts:41-58`); doc 10 §10.5. |
| **T3 legacy** | Historical naming from the T3 lineage that is now **frozen contract**: `T3CODE_*` env vars, `@t3tools/*` packages, `t3` package, `~/.t3`, `/api/t3-connect/*`, `/.well-known/t3/*`. Never rename. | Repo instructions; scattered call sites. |
| **Window** | Electron browser window managed by the desktop shell; hosts the web renderer at `wsUrl` from the bootstrap bridge. | `apps/desktop`; preload markers (doc 10 §10.3). |
| **Bootstrap** | The preload→renderer handshake that delivers environment info (`getLocalEnvironmentBootstrap`) and the WS URL. | `dist-electron/preload.cjs` markers `desktopBridge`, `getLocalEnvironmentBootstrap`, `PICK_FOLDER_CHANNEL`, `wsUrl`. |

## 13.2 Canonical types (TS contracts unless noted)

| Type | Definition | Values / shape | Evidence |
| --- | --- | --- | --- |
| `ModelSelection` | Which model/provider a turn runs on. | Provider instance + model id (shape at contracts `orchestration.ts:68-74`). | [V] doc 04/07. |
| `ProviderInstanceId` | Stable id for a configured provider account/host (one provider can have multiple instances). | String id. | [V] contracts; doc 04. |
| `ProviderApprovalPolicy` | When tool actions require user approval. | `untrusted` · `on-failure` · `on-request` · `never` (`orchestration.ts:39-51`). | [V] |
| `ProviderSandboxMode` | What filesystem/network power tool processes get. | `read-only` · `workspace-write` · `danger-full-access` (`orchestration.ts:39-51`). | [V] |
| `SessionHeader` | Metadata record at the head of an agent session log. | Thread/session identity fields (session crate). | [V] doc 06. |
| `SessionEntry` | One append-only entry in the session event log (message, tool call, approval, compaction marker…). | Tagged union. | [V] doc 06. |
| `AxleEvent` | The unified event envelope flowing agent → server → clients. | Typed variants; hyphenated families on one plane, dotted on the other (doc 07). | [V] |
| `ToolTimeoutPolicy` | Per-tool timeout semantics for tool execution. | Per-tool values table in doc 04 §approval/timeout. | [V] |
| `ToolExecutionMode` | How a tool call is dispatched (blocking vs streamed / interactive). | Enum in tools execution (`execution.rs`). | [V] |

## 13.3 Approval & security vocabulary

- **Approval channel** — the out-of-band request/response path that pauses a turn for user confirmation; distinct from the normal event stream so it cannot be spoofed by model output. (doc 07 approval channel.)
- **Scope** — OAuth-style permission string (`auth.ts:76-83`) attached to tokens/clients; gates WS methods and the OTLP trace endpoint (`orchestration:operate`).
- **Untrusted workspace** — a workspace the user has not trusted; pairs with `untrusted` approval policy to force confirmation for side-effectful actions. [I: naming pattern; policy list is verified.]
- **Secrets store** — `AXLE_HOME/secrets/` — where credentials live on disk (never read during this mission; do not document values).

## 13.4 Naming traps (read before grepping)

1. **Session** means two things (§13.1). Search with the file context: `session/` in Rust = agent transcript; auth session = provider login.
2. **Toolkit vs tools** — "tools" (agent's own registry) ≠ "toolkit" (MCP tools Axle exposes). Same word, opposite direction.
3. **Environment** — in desktop code it is the local runtime + remote targets; in infra/relay it is the paired host record. Same concept, two storage shapes.
4. **T3 identifiers** — appear everywhere but are frozen legacy; do not "modernize" them (doc 15 invariants).
5. **Event naming** — hyphenated (`tool-call`) vs dotted (`session.updated`) families coexist (doc 07); always grep both forms.
6. **`vp`/`vpr`** — `vp` = vite-plus CLI; `vpr = vp run`. Both appear in CI (doc 10).
