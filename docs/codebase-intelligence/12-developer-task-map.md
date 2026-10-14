# 12 — Developer Task Map ("I want to do X — touch what?")

> Paths relative to `axle-desktop/source/` unless noted. Symbols + line anchors from the 2026-10-13 tree.
> **First, read:** `01-repository-map.md` (orientation), `02-system-architecture.md` (planes + flows), `15-master-codebase-context.md` (invariants). Then use this doc.
> **Frozen — never rename/touch:** `T3CODE_*` env vars, `@t3tools/*` packages, `t3` package name, `~/.t3`, `/api/t3-connect/*`, `/.well-known/t3/*`, and updater contracts (`AXLE_UPDATE_URL`, `AXLE_UPDATE_SITE_URL`, `/get/updates/*`, `latest.yml`, productName). [Repo instruction]

## 12.1 The two planes in one sentence each

- **Agent plane (Rust):** workspace of 10 crates (`axle-agent`, `axle-core`, `axle-tools`, …) — runs the turn loop, tools, sessions, compaction, memory. Start: `crates/axle-agent/src/loop_runner.rs`.
- **Control plane (TypeScript):** `apps/server` (WS/HTTP server + persistence + schedules), `apps/web` (renderer), `apps/desktop` (Electron shell + IPC), `packages/contracts` (shared types/events). Start: `packages/contracts/src/orchestration.ts`.

## 12.2 Recipes

### A. Add a new tool to the agent (Rust)
1. Implement the tool: `crates/axle-tools/src/` — follow siblings: `bash.rs` (approval/timeout wiring at `:73-94`), `write.rs` (`:44`), `edit.rs` (`:89`), `path_guard.rs:95-111` (path safety — new tools must use it).
2. Register it (name, schema, approval policy, timeout): `crates/axle-tools/src/registry.rs` — registration blocks at `:55-65`, policy mapping `:161-175`, timeout mapping `:192-225`, tool enum `:23-26/28`, dispatch `:353-367`.
3. Execution plumbing (approval prompt round-trip, cancellation, streaming): `execution.rs:16-20, 116, 129-242, 271-308`.
4. MCP-backed tools live in `mcp.rs:15-31` (client) / `:592-596`.
5. Tests: add to the same crate (journey test style at workspace level).
6. Docs to update: `03-feature-catalog.md` (tool table), `04-ai-and-agent-systems.md` (approval/timeout table).

### B. Add a tool to the shared **MCP toolkit** (exposed by the server to external agents)
- Surface name lists live in the server MCP server: `apps/server` `McpHttpServer.ts:214, 219, 291` — extend the tool table and handler dispatch there. Toolkit tool names are catalogued in doc 05 (§MCP).
- If the tool needs DB/state, follow recipe E for schema.

### C. Change planning behavior (plan mode)
1. Turn/plan orchestration + mode switching: `crates/axle-agent/src/loop_runner.rs` — plan/build gating at `:69-145`, approval decisions `:1810, 1822, 1916-2283`, tool-approval handling `:2186-2231`, denial/allow paths `:2233-2274, 2294-2313`, loop termination `:2335-2430`.
2. Prompt side (how plan mode is described to the model): `crates/axle-agent/src/prompt/builder.rs` — sections at `:199, 319, 340, 475-716`.
3. Plan state persistence: session entries (`session/manager.rs:197-254`).
4. UI: Plan-mode affordances in `apps/web` — see recipe G; server passthrough in `AxleAdapter.ts` (recipe D).

### D. Add/extend a WS RPC or server command (contract → server → web)
The contract is the source of truth; everything else follows it.
1. Define the method/command/event: `packages/contracts/src/orchestration.ts` — WS method list `:29-37`, policies `:39-51`, `ModelSelection` `:68-74`, command union `:513-752`, runtime events `:760-809`, client events `:834-855`. (Note the duplicated shell block at `:1055-1160` — don't copy it further.)
2. Server implementation: `apps/server` — request routing in `ws.ts:12-23` (method table) and `:2175-2226`; HTTP routes `http.ts:43, 51, 61, 195-246, 297, 332`; orchestration adapter `AxleAdapter.ts` (turn dispatch `:246-508`, events `:861-869`, `:949-1013`, `:1015-1176`).
3. Web client: consume via the connection layer under `apps/web/src/connection/` and state under `apps/web/src/state/` (files listed in doc 08).
4. Rebuild contracts: `pnpm build:contracts`.
5. Tests: `apps/server` has `server.test.ts` (see doc 11 §11.2 — currently red; fix the ScheduledTasks layer before adding tests).
6. Docs: update `07-api-and-events.md`.

### E. Change server persistence (agent plane DB)
1. Migrations are ordered TS modules `001–032` (doc 06 lists all names + the evolution story). Add the next number; never edit an applied migration.
2. Projection schema reference: `005_Projections.ts` columns (`:8-112`) — projections are **rebuildable** from the event store; keep that invariant.
3. Migration test style: e.g. tests for `016, 019, 024, 025, 026, 027_028, 029, 031`.
4. Reader/writer call sites are under `apps/server` persistence layer; `AxleAdapter.ts` mediates turn/session writes.
5. Docs: `06-data-model-and-lifecycle.md`.

### F. Change relay/infra DB or endpoints (`infra/relay`)
1. Drizzle migrations in `infra/relay` (baseline tables: 7 + later ones for label, managed_endpoint_allocations, bundle_id/aps_environment — doc 06).
2. Deploy path: `infra/relay/scripts/deploy.ts` (+ `deploy.test.ts`). Cloudflare target (workflow vars in `release.yml:187-193`).
3. Endpoints + auth (DPoP, pairing) — read `infra/relay` sources and doc 05/09 first; contracts are sensitive.

### G. Add a screen/route or fix UI state (`apps/web`)
1. Routes: 10 top-level route files + settings children (table in doc 08). Composition root `AppRoot.tsx:17-30`.
2. State: `src/state/`, hooks `src/hooks/`, connection `src/connection/`, helpers `src/lib/` (file lists in doc 08).
3. Design tokens (single source): `src/index.css:204-283`; fonts DM Sans / JetBrains Mono. Use tokens, don't hardcode.
4. Markdown rendering is sanitized (`rehype-sanitize`) — keep it that way for anything model-generated.
5. ⚠️ A large uncommitted redesign already touches these files (doc 11 §11.4). Rebase/coordinate before starting.

### H. Add a settings page
- Follow existing settings children under `apps/web` routes (doc 08 table); server-side settings persist through the standard config path (`axle_config` crate `3-5, 9-14, 24-92, 142-178, 213-264` for agent-side config; server config for control-plane settings).

### I. Add auth / scopes
1. Scopes are enumerated in `packages/contracts/src/auth.ts:76-83` — add there first, then enforce server-side (check every WS method ↔ scope mapping; the current map is listed in doc 07).
2. GitHub auth broker flows + security checks: root CI `github-auth-security.yml` exists as the gate for this area.
3. DPoP: keep proof binding on relay endpoints; CORS headers list includes `dpop` (`httpCors.ts`) — see doc 09 SEC findings before editing.
4. Plugin OAuth: plugin worker + `plugin-auth-pr.yml` CI.

### J. Add a background job / schedule
1. Service: `apps/server/src/schedules/Service.ts:22` (service), `:42-43` (poll loop), `:100-120` (execution), `:162-172` (persistence hooks).
2. Registration/lifecycle lives in server wiring (the layer that provides services) — and **must** be provided in tests (`ScheduledTasksLive`); this is the root cause of the 222 typecheck errors (doc 11).
3. Schedule contract: `packages/contracts/src/schedules.ts` (doc 07 §schedules).
4. UI: schedules views in `apps/web` (doc 08).

### K. Streaming / NDJSON protocol changes
- Rust-side NDJSON framing between agent and server: see `stream_parser.rs` (per-provider wire parsing) and the protocol table in doc 07. Any change ripples to `AxleAdapter.ts:785, 828, 861-869, 1015-1176`.
- Keep event names consistent within their family (doc 07 documents the hyphen/dot split) and additive-only where possible.

### L. Billing/quota (currently ABSENT)
- No billing code exists (doc 05 not-found table). If adding: new surface belongs in `apps/account-api` or a new worker + contracts additions; there is no schema to migrate because none exists. This is greenfield — design first, then follow recipe D.

### M. Triage a production failure
1. Server logs: `serverLogger` output; provider logs under `AXLE_HOME/userdata/logs/provider`; terminals logs under `logs/terminals`.
2. Traces: server OTLP proxy `POST /api/observability/v1/traces` (`http.ts:43, 242-297`), scope `orchestration:operate`; relay traces via `makeRelayTraceLayer`.
3. Turn-level replay: session NDJSON event logs (doc 06) — replay by session id.
4. Approval stuck? Inspect approval channel handling in `loop_runner.rs:2186-2274` and the approval flow in doc 04.

### N. Add/verify mobile behavior
- `apps/mobile` + mobile scripts (`mobile-native-static-check.ts` — run it: `pnpm lint:mobile`), EAS workflows are nested (doc 10 §10.3). Not verifiable end-to-end locally without EAS.

### O. Tests & deploys
- Run per doc 10 §10.9. Remember: CI does not currently run (P0). Verify locally.

## 12.3 Fast file finder (most-touched files)

| I need… | File |
| --- | --- |
| Turn loop / approvals / plan gating | `crates/axle-agent/src/loop_runner.rs` |
| Prompt assembly / system sections | `crates/axle-agent/src/prompt/builder.rs` |
| Tool registration & policy | `crates/axle-tools/src/registry.rs` |
| Session persistence/compaction | `crates/axle-agent/src/session/manager.rs`, `engine.rs` |
| Memory | `crates/axle-memory/src` (doc 04 §memory) |
| Config model | `crates/axle-config/src` |
| Server RPC | `apps/server/src/ws.ts` |
| Server HTTP/routes/CORS | `apps/server/src/http.ts`, `httpCors.ts`, `startupAccess.ts` |
| Adapter (agent⇄server) | `apps/server/src/orchestration/AxleAdapter.ts` |
| Schedules | `apps/server/src/schedules/Service.ts` |
| Terminal | `apps/server/src/terminal/Manager.ts` |
| MCP server surface | `apps/server/src/McpHttpServer.ts` |
| Contracts | `packages/contracts/src/orchestration.ts`, `auth.ts`, `schedules.ts` |
| Web composition | `apps/web/src/AppRoot.tsx` |
| Design tokens | `apps/web/src/index.css:204-283` |
| Desktop IPC preload | `apps/desktop` (`dist-electron/preload.cjs` markers) |
| Migrations | server migrations `001–032`; relay drizzle under `infra/relay` |
