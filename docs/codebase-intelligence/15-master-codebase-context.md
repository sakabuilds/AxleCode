# 15 — Master Codebase Context (condensed reference)

> The one file to read if you read nothing else. Everything here is verified elsewhere in this dossier; each section points to its full treatment. Compressed on purpose — no narrative.

## 15.1 What this system is

Axle is a **local-first desktop AI coding agent**: an Electron app whose real brain is a Rust agent runtime, whose control plane is a TypeScript server, and whose remote story is a Cloudflare relay. Two planes, one product:

- **Agent plane (Rust, 10 crates, workspace v1.1.22):** turn loop, tool execution, approvals, sessions, compaction, memory, prompt assembly, provider adapters.
- **Control plane (TS):** `apps/server` (WS RPC + HTTP + persistence + schedules + MCP server + terminal), `apps/web` (renderer), `apps/desktop` (Electron shell/IPC), `packages/contracts` (shared protocol), plus workers (`apps/account-api`, `axle-download-worker`), `infra/relay`, `apps/mobile`, `axle-landing`.

Canonical code root: `axle-desktop/source/` (its own `AGENTS.md` governs it). `axle-landing/` is separate (own AGENTS.md).

## 15.2 The five facts that explain everything

1. **The turn loop is an approval-gated state machine.** Every side-effectful tool call routes through an approval decision (`loop_runner.rs:69-145, 1916-2283`). Plan mode = propose; build mode = execute. Approval policies: `untrusted · on-failure · on-request · never`; sandbox: `read-only · workspace-write · danger-full-access` (`contracts/orchestration.ts:39-51`).
2. **Sessions are append-only event logs; projections are rebuildable.** SQLite event store + projections (columns in `005_Projections.ts:8-112`; migrations `001–032`). Never treat a projection as the source of truth.
3. **Everything client-visible is an event.** Agent → server → web flows through typed events (`AxleEvent`), with an out-of-band **approval channel** for confirmations. NDJSON framing between planes (doc 07 protocol table).
4. **MCP works both ways.** Axle agent consumes external MCP tools (client, `axle-tools/src/mcp.rs`) while the server exposes a **toolkit** outward (`McpHttpServer.ts:214, 219, 291`). "Toolkit" ≠ "tools".
5. **The naming history is frozen contract.** `T3CODE_*`, `@t3tools/*`, `t3` package, `~/.t3`, `/api/t3-connect/*`, `/.well-known/t3/*` — legacy names, never rename. Same for updater contracts: `AXLE_UPDATE_URL`, `AXLE_UPDATE_SITE_URL`, `/get/updates/*`, `latest.yml`, productName.

## 15.3 Entry points (where execution starts)

| Entry | Path | Notes |
| --- | --- | --- |
| Desktop app | `apps/desktop` Electron main | Creates `AXLE_HOME` layout (`launcher.ts:41-58`); bootstraps renderer via preload markers `desktopBridge`, `getLocalEnvironmentBootstrap`, `PICK_FOLDER_CHANNEL`, `wsUrl`. |
| Server | `apps/server` (`ws.ts`, `http.ts`; CLI `apps/server/scripts/cli.ts`, `stage-desktop-runtime`) | `t3` package name preserved. |
| Agent turn loop | `crates/axle-agent/src/loop_runner.rs` | Turn lifecycle, approvals, termination `:2335-2430`. |
| Adapter (bridge) | `apps/server/src/orchestration/AxleAdapter.ts` | Commands ⇄ agent; event fan-out (`:246-508`, `:861-1176`). |
| Contracts | `packages/contracts/src/orchestration.ts` | Source of truth: WS methods `:29-37`, commands `:513-752`, runtime events `:760-809`, client events `:834-855`. |
| Relay | `infra/relay` + `scripts/deploy.ts` | Cloudflare; DPoP + pairing. |
| Web app | `apps/web/src/AppRoot.tsx:17-30` | Routes table doc 08; tokens `index.css:204-283`. |

## 15.4 The contract surface (memorize the shape, not the contents)

- **WS RPC methods** (`orchestration.ts:29-37`) — list in doc 07; each maps to a handler in `ws.ts:12-23, 2175-2226`.
- **Commands** `:513-752`; **runtime events** `:760-809`; **client events** `:834-855`.
- **Scopes** `auth.ts:76-83`; OTLP trace endpoint requires `orchestration:operate`.
- **Schedules contract** `contracts/schedules.ts`; service at `schedules/Service.ts:22`.
- Event families: **hyphenated** and **dotted** naming coexist (doc 07) — grep both.
- Known duplication: shell types re-declared `orchestration.ts:1055-1160` — don't propagate.

## 15.5 Flows in miniature

- **Turn:** user input → server command → adapter → agent loop → (approval channel if needed) → tool exec (`execution.rs:129-242`) → events stream back → web state. [Full: docs 02/04.]
- **Schedule:** contract-defined schedule → `Schedules/Service.ts` poll `:42-43` → execution `:100-120` → turn dispatch → persistence `:162-172`. [Full: docs 02/07.]
- **Remote:** mobile/remote client → relay (pairing + DPoP) → desktop local environment WS → same RPC surface. [Full: doc 05.]
- **Compaction:** context pressure → session manager compacts oldest segments (`manager.rs:296-336…`) → summary entries replace raw history. [Full: docs 04/06.]

## 15.6 Invariants — break these and something subtle dies

1. Never rename frozen identifiers (§15.2.5) or updater contracts.
2. Approvals **always** go through the approval channel — never treat model output as consent.
3. Path safety: all filesystem tools use `path_guard.rs:95-111` (root-jailed). New tools must too.
4. Projections rebuild from the event store — write events, derive views; don't write projections as truth.
5. Tool policy table (approval + timeout per tool) in doc 04 is contractual; new tools must declare both.
6. Contracts first: change `contracts/` → `pnpm build:contracts` → server adapter → web consumer.
7. Keep NDJSON framing compatible; additive event variants where possible.
8. Do not disturb the uncommitted UI-redesign WIP without coordinating (doc 11 §11.4).

## 15.7 Conventions

- TS: pnpm 11.10 + vite-plus (`vp`), tsgo typecheck, oxlint (with `oxlint-plugin-t3code`), `vp fmt`. Effect 4.x-beta is pervasive server-side.
- Rust: cargo workspace; formatting/clippy standard; tests co-located; `journey_e2e` is the E2E guardian.
- Config lives through `axle-config` (agent) and server config; env vars `AXLE_HOME`, `RIVET_HOME`, `T3CODE_HOME`.
- Docs: this dossier is the system of record; update the numbered doc nearest your change.

## 15.8 Known hazards (day-one briefing)

| Hazard | Impact | Doc |
| --- | --- | --- |
| **CI is dead** — real gate is a nested workflow GitHub never runs | Red code merges freely | 10, 11 |
| `apps/server` won't typecheck (~239) & 124 tests fail — 222 errors from one missing `ScheduledTasksLive` test-layer provide | Cannot trust server-side gates | 11 |
| Root lint: 4 hard errors (`t3code(namespace-node-imports)`) | Lint gate unusable | 11 |
| Version drift + ambiguous repo identity | Release/update confusion | 10, 14 |
| Alchemy dependency is a stub | Deploys unverified | 10, 14 |
| CORS wildcard + sensitive headers, no rate limiting found | Security review needed | 09, 14 |
| Windows-only test failures (symlink EPERM etc.) | Local noise vs real defects unclear | 11, 14 |
| Billing/quota entirely absent | Product-commercial gap | 11, 14 |

## 15.9 Limitations of this dossier

- No runtime execution of the app was performed in this mission (except prior test/typecheck runs recorded in docs 10–11). All behavioral claims carry [V]/[I]/[U]/[F] tags.
- The uncommitted WIP means `apps/web` descriptions reflect HEAD + WIP mixture — treated as WIP only.
- Update/relay/mobile/APNs paths are source-read, not exercised.
- Unknowns register: doc 14. If you resolve one, update that doc and the affected numbered doc, then the index.

## 15.10 Dossier navigation

Start: `CODEBASE_INTELLIGENCE_INDEX.md` → `00-executive-overview.md` → `01-repository-map.md` → `02-system-architecture.md`. Deep dives: `03` (features) → `04` (AI/agent) → `05` (integrations) → `06` (data) → `07` (APIs) → `08` (frontend) → `09` (security) → `10` (build/deploy) → `11` (status) → `12` (task map) → `13` (glossary) → `14` (unknowns) → this file (compression back to high signal).
