# Axle Codebase Intelligence — Master Index

> A 17-document reverse-engineering dossier of the Axle codebase (`C:\Users\Ariyo Eyitayo\Desktop\Axle`), produced 2026-10-13.
> **Scope:** investigation + documentation only. No code was changed; no commits were made. The uncommitted UI-redesign WIP present in the working tree was left untouched and is treated strictly as WIP.
> **Evidence discipline:** every claim is tagged — **[V]** verified by direct source inspection · **[I]** inferred · **[U]** unknown · **[F]** currently failing. File paths + symbols + line numbers are given where practical. No secret values appear anywhere.

## Read in this order

**If you have 15 minutes:** `00` → `15` → `11`.
**If you're starting to ship code:** `01` → `02` → `12` → `15`.
**If you're fixing the delivery pipeline today:** `10` → `11` → `14`.

| # | Document | What it answers | Key contents |
| --- | --- | --- | --- |
| 00 | `00-executive-overview.md` | What is this product, really? | Two-plane architecture fact, stack table, capability highlights, top-5 verified problems, maturity table. |
| 01 | `01-repository-map.md` | Where is everything? | Root layout, 10 Rust crates, TS workspace (apps/infra/packages), executable entry points, do-not-inspect list. |
| 02 | `02-system-architecture.md` | How do the pieces talk? | Container + turn + schedule Mermaid diagrams, package dependency graph, patterns applied vs inconsistent, trade-offs. |
| 03 | `03-feature-catalog.md` | What does it do? | F1–F24 features with code traces and status (chat, plan mode, approvals, tools, sessions, compaction, memory, models, checkpoints, git/PR, terminal, preview, plugins, schedules, archive, onboarding, remote access, mobile, extensions, instructions/skills, command palette, diagnostics, updates, accounts). |
| 04 | `04-ai-and-agent-systems.md` | How does the agent actually work? | Turn lifecycle, approval gating, exact per-tool approval/timeout table, prompt assembly, providers, sessions/compaction, memory, extensions, MCP client, failure table. |
| 05 | `05-integrations.md` | What does it connect to? | 14-row integration matrix: model providers, web search, MCP both directions + toolkit names, GitHub, plugin OAuth, preview, terminal, relay/APNs, analytics, updates; not-found table (no billing). |
| 06 | `06-data-model-and-lifecycle.md` | Where does state live? | Event-store tables, projection columns (from `005`), migrations `001–032` evolution, ER diagram, agent-plane files, relay Postgres tables + indexes, retention, concurrency table. |
| 07 | `07-api-and-events.md` | What's the protocol? | WS RPC methods, commands, event lists (hyphenated vs dotted), server HTTP routes, NDJSON protocol table, approval channel, MCP, auth worker routes, relay APIs, desktop IPC, schedules contract. |
| 08 | `08-frontend-and-design-system.md` | How is the UI built? | Route table, renderer composition, state management, design tokens (`index.css:204-283`), UX states, keyboard/a11y, markdown safety (rehype-sanitize), WIP warnings. |
| 09 | `09-security-and-reliability.md` | What's dangerous? | SEC-1..11 + REL-1..7 findings with severity, confirmed-vs-hypothesis, remediation; positive controls. |
| 10 | `10-testing-build-deployment.md` | How is it built, tested, released? | Toolchain pins, root scripts table, full CI inventory (root vs nested), the dead-gate finding, test status table, app-home/env layout, migrations, observability, version drift. |
| 11 | `11-implementation-status-and-technical-debt.md` | What works, what's broken? | 22-subsystem status matrix, P0/P1/P2 defect list with evidence, WIP handling rules, verification backlog, debt themes ranked. |
| 12 | `12-developer-task-map.md` | "I want to do X — where?" | Recipes A–O (new tool, MCP tool, planning change, WS RPC, DB change, web screen, auth, schedules, streaming, billing, triage, mobile, deploys) + fast file finder. |
| 13 | `13-glossary-and-domain-model.md` | What do these words mean? | Domain nouns (thread/turn/session-two-meanings/compaction/memory/relay/DPoP…), canonical types (`ModelSelection`, `ProviderApprovalPolicy`, `SessionEntry`…), naming traps. |
| 14 | `14-open-questions-and-unknowns.md` | What does nobody know yet? | 22 open questions, each with known/why-matters/how-to-resolve. The dossier's honesty register. |
| 15 | `15-master-codebase-context.md` | Give me the compressed truth. | The five facts that explain everything, entry points, invariants, conventions, known hazards, limitations. |
| — | `_coverage-ledger.md` | How was this produced? | Phase plan, running log of inspected areas, mission constraints. |

## The three facts to carry into any change

1. **Two planes:** Rust agent runtime (crates) + TypeScript control plane (server/web/desktop/contracts). Bridge = `AxleAdapter.ts`; contract source of truth = `packages/contracts/src/orchestration.ts`.
2. **Frozen identifiers:** `T3CODE_*`, `@t3tools/*`, `t3`, `~/.t3`, `/api/t3-connect/*`, `/.well-known/t3/*`, and all updater contracts (`AXLE_UPDATE_URL`, `AXLE_UPDATE_SITE_URL`, `/get/updates/*`, `latest.yml`, productName). Never rename.
3. **CI does not run today.** The real gate (`axle-desktop/source/.github/workflows/ci.yml`) is nested where GitHub cannot see it. Verify everything locally until this is fixed (docs 10/11 have the how and the fix).

## Status snapshot (2026-10-13)

- Rust workspace: green (~147 tests). Web/desktop typecheck: green. Auth worker: 21/21.
- `apps/server`: ~239 typecheck errors (222 from one missing test-layer service), 124 test failures, 4 root lint errors — all invisible to CI because of fact 3.
- Working tree: large uncommitted UI-redesign WIP (154 M + 8 untracked, `apps/web`) — coordinate before touching web.
