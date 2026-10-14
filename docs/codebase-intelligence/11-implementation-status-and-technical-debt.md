# 11 — Implementation Status & Technical Debt

> Evidence tags: **[V]** verified in this mission · **[I]** inferred · **[U]** unknown · **[F]** failing right now.
> Status words: **VERIFIED WORKING** · **WORKING (unverified locally)** · **PARTIAL** · **BROKEN/FAILING** · **ABSENT** · **UNKNOWN**.
> Measurements were taken on this tree on 2026-10-13. The uncommitted UI-redesign WIP (see §11.4) means `apps/web` status may not reflect `HEAD`.

## 11.1 Subsystem status matrix

| # | Subsystem | Status | Evidence / notes |
| --- | --- | --- | --- |
| 1 | Rust agent core (`axle-core` etc., 10 crates) | **VERIFIED WORKING** | `cargo check`/`cargo test` green (~147 tests incl. `journey_e2e`). Turn loop, tools, sessions, compaction all covered by tests. |
| 2 | Tool system (bash/edit/write/read/search/MCP) | **VERIFIED WORKING** | Per-tool approval + timeout table documented in doc 04; path guard tests present. |
| 3 | Session persistence + compaction | **VERIFIED WORKING** | `session/manager.rs`, `engine.rs` with tests; NDJSON event log design (doc 06). |
| 4 | Memory system | **WORKING (unverified locally)** | `axle_memory` fully read (doc 04 §); no dedicated failing tests observed; end-to-end behavior not exercised. |
| 5 | Extensions / plugins (MCP client) | **WORKING (unverified locally)** | `mcp.rs`, plugin OAuth worker path; no local run of plugin flows. |
| 6 | Model providers | **WORKING (unverified locally)** | Adapter boundaries documented (doc 05); no live provider calls in this mission. |
| 7 | TS server: WS RPC + commands + events | **PARTIAL** | Contract shapes verified (doc 07), but `apps/server` typecheck is **BROKEN [F]** and 124 tests fail — the server assembly in the test harness is currently unbuildable/unverifiable at full type fidelity. |
| 8 | Schedules service | **PARTIAL [F]** | `schedules/Service.ts:22` exists and is feature-complete enough that 222 test-layer errors + a lint error route through it; it is not wired into `server.test.ts`. |
| 9 | Terminal manager | **WORKING (unverified locally)** | `terminal/Manager.ts:84,117`; PTY prebuild CI jobs exist but dormant. |
| 10 | Preview system | **WORKING (unverified locally)** | Documented in doc 03 F13; no local run. |
| 11 | Desktop shell + IPC | **WORKING (unverified locally)** | Preload/desktop-bridge assertions exist in the (dead) CI; bundle grep markers known. |
| 12 | Web UI (renderer) | **PARTIAL / WIP** | Typecheck passes at `HEAD`; the working tree currently carries a large uncommitted redesign (154 M + 8 untracked). Status of the WIP itself: unknown — not this mission's code. |
| 13 | Mobile app | **UNKNOWN** | EAS workflows exist (nested); never built in this mission. |
| 14 | Relay (`infra/relay`) | **UNKNOWN (runtime)** | Source + drizzle migrations + deploy script read; the worker has not been deployed or run locally. |
| 15 | Auth worker | **VERIFIED WORKING** | 21/21 tests pass. |
| 16 | GitHub auth broker | **WORKING (unverified locally)** | Security workflow exists in root CI; flows documented (doc 05/09). |
| 17 | Download/update portal (`axle-download-worker`) | **WORKING (unverified locally)** | ~399 LOC; tests only wired into dormant installer CI job. Version drift (1.1.15 vs 1.1.22). |
| 18 | Updater / release pipeline | **PARTIAL** | `release.yml` is nested and never runs on GitHub [F]; updater contracts frozen by policy; `mock-update-server.ts` + `release-smoke.ts` exist for local use. |
| 19 | Analytics (Convex) | **WORKING (unverified locally)** | Package present, version 0.0.29; privacy posture unstated [U]. |
| 20 | Landing (`axle-landing`) | **VERIFIED WORKING** | Build passes. |
| 21 | CI/CD | **BROKEN [F]** | Nested `ci.yml` is dead on GitHub; root workflows only trigger on dormant `ci/*` branches or tags. Nothing enforces typecheck/tests today. |
| 22 | Billing/quota | **ABSENT** | No billing code found anywhere (doc 05 "not found" table). |

## 11.2 Confirmed defects, prioritized

### P0 — pipeline integrity
1. **[F] CI gate is dead.** The only workflow that runs lint+typecheck+tests (`axle-desktop/source/.github/workflows/ci.yml`) lives in a nested directory GitHub never reads, and the root workflows fire only on `ci/windows-installer-artifact-*` branches or `v*` tags. Consequence: red typecheck + 124 failing tests merged/lingered unnoticed. Fix: either move the source tree to its own repo, or add a root-level workflow that `working-directory: axle-desktop/source` runs the same steps.
2. **[F] `apps/server` typecheck: ~239 errors.** 222 from `ScheduledTasks` not provided in the test layer (`schedules/Service.ts:22`; provide `ScheduledTasksLive` in `server.test.ts` layer). Remaining errors likely surface after that fix.
3. **[F] `apps/server` tests: 124 failures.** Breakdown: 111 `server.test.ts` (same missing service layer), 9 ProviderRuntimeIngestion, 2 GitManager fork-PR, 1 VcsStatusBroadcaster (Windows symlink `EPERM`, environment-specific), 1 keybindings.
4. **[F] Root lint: 4 hard errors** — `t3code(namespace-node-imports)` in account-api code and `schedules/Service.ts`.

### P1 — security/reliability (see doc 09 for full finding set)
5. CORS wildcard `*` combined with credential-ish headers (`authorization`, `b3`, `traceparent`, `content-type`, `dpop`) in `httpCors.ts` — verify the wildcard cannot be combined with an authenticated browser context; keep DPoP binding intact (doc 09 SEC findings).
6. `startupAccess.ts` loopback/wildcard startup logic — confirm non-loopback startup is deliberately gated and cannot be reached by a misconfigured launch.
7. Orphan process reaping after abrupt server crash is **unknown** [U]; tool child processes may survive.
8. SQLite journaling/busy-timeout settings for concurrent writes are **unknown** [U]; session store is single-writer by design [I].

### P2 — correctness/consistency debt
9. Event naming inconsistency: hyphenated vs dotted event types across the two planes (doc 07) — forces stringly-typed mapping in consumers.
10. Duplicated type declarations: shell re-declaration block in `contracts/orchestration.ts:1055-1160` mirrors Rust-side shell types; drift risk.
11. Version drift across components (doc 10 §10.8).
12. Repo identity ambiguity: README → `thatcreativetayo/AxleCode`, `apps/server/package.json` repository → `pingdotgg/t3code` [V]. Confuses release tooling that derives slugs from manifests.
13. Alchemy stub (`file:stubs/alchemy-stub`) means any Alchemy-based deploy is untested against the real SDK [V]/[U].
14. `clean` script uses POSIX `rm -rf` — broken on stock Windows shells (`package.json:42`).

## 11.3 Features shipped vs stubbed vs absent (roll-up of doc 03)

- Shipped and covered by Rust tests: chat turning, plan mode, approvals, tool suite, sessions/history, compaction, checkpoints, model config, terminal, git/PR flows, hook system, MCP both directions, schedules (agent-side), remote access protocol, instructions/skills loading.
- Shipped but unverified locally: memory end-to-end, preview, plugin OAuth worker, relay, mobile, analytics, download portal, desktop IPC.
- Absent: billing/quota, team/org administration beyond accounts, marketplace publishing pipeline for plugins [I].
- WIP (not part of this mission's code): UI redesign in working tree.

## 11.4 Uncommitted WIP — how to treat it

**[V]** The working tree contains 154 modified + 8 untracked files, overwhelmingly under `axle-desktop/source/apps/web`, alongside `ui-redesign-*.md` documents timestamped 2026-10-13. Rules applied during this audit:
- No file in the WIP set was edited by this mission.
- Status statements about `apps/web` above describe `HEAD` unless marked WIP.
- Before any release/build decision, the WIP must either be committed behind review or stashed — audits and CI measurements are not reproducible on a dirty tree.

## 11.5 Unverified-but-shipped areas (verification backlog)

| Area | Why unverified | Cheapest verification |
| --- | --- | --- |
| Relay worker end-to-end | Not deployed locally | `infra/relay`: run drizzle migrate + `deploy.ts` dry-run against miniflare/dev; exercise DPoP + pairing endpoints. |
| APNs push path | Requires Apple credentials | Unit-level: inspect notification payload construction; simulate with mock APNs. |
| Mobile builds | EAS + native toolchains | Run `mobile-native-static-check.ts` locally (script exists) then EAS preview. |
| Alchemy deploy path | Stubbed dependency | Compare `stubs/alchemy-stub` API surface vs real SDK version pinned in lockfile. |
| Download worker tests | CI job dormant | `npm --prefix axle-download-worker test` locally. |
| Update/auto-update flow | Needs packaged build | `mock-update-server.ts` + `release:smoke` against a local artifact. |
| Web reconnect policy under WS drop | Not exercised | Kill server mid-session; watch client reconnect/backoff (code path in web connection layer). |

## 11.6 Technical-debt themes (ranked by leverage)

1. **Delivery safety net is absent.** Nothing stops red code from merging; fix CI location first (P0-1). Everything else gets cheaper once this exists.
2. **Server test harness divergence.** One missing layer throws 222 typecheck errors + 111 test failures — a single structural fix with outsized effect.
3. **Two-plane type duplication.** Rust types ↔ TS contracts get hand-mirrored (`orchestration.ts`), with at least one visible duplicate block. Generation or a schema registry would de-risk drift.
4. **Naming drift (hyphen vs dot events, T3 legacy strings).** Frozen `T3CODE_*`/`@t3tools/*` identifiers are contractual and must stay, but *new* surfaces should use one canonical naming style. Doc 07 lists both families.
5. **Dependency stubbing without fidelity tests.** Stubs are a reasonable unblock; without a contract test against the real package they silently rot.
6. **Version/repo identity spawl.** Single source-of-truth version + repo slug would remove release ambiguity.

## 11.7 What "good" looks like next (no code changes made — recommendations only)

1. Add a root workflow (or migrate the repo) so `vp check`, `vpr typecheck`, `vp run build:desktop`, and package tests actually run on PRs — reuse nested `ci.yml` content verbatim, it is already well-formed.
2. Land the `ScheduledTasksLive` test-layer fix; re-run typecheck/tests to expose the true residual error count.
3. Fix the 4 lint errors; then ratchet lint to zero-warnings for touched packages.
4. Squash or commit the UI-redesign WIP so measurements become reproducible.
5. Reconcile version strings + repo slug; decide the canonical release home (doc 14 Q1).
6. Schedule a relay/mobile/update-path verification spike (§11.5) and record results here.
