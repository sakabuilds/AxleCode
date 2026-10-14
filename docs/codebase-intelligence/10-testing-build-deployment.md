# 10 — Testing, Build & Deployment

> Evidence tags: **[V]** verified by direct inspection in this mission · **[I]** inferred · **[U]** unknown · **[F]** failing/blocked right now.
> All paths are relative to `axle-desktop/source/` unless noted. Line numbers refer to the file version inspected on 2026-10-13.

## 10.1 Toolchain and prerequisites

| Layer | Tool | Version / pin | Evidence |
| --- | --- | --- | --- |
| Package manager | pnpm (via corepack) | `pnpm@11.10.0` | `package.json:56` [V] |
| Node | Node.js | `^24.13.1` (engines) | `package.json:54` [V] |
| Task runner | `vite-plus` CLI (`vp`) | workspace dev dependency; `node-version-file: package.json` in CI | `.github/workflows/ci.yml:18-23` (nested) [V] |
| Typechecker | `tsgo` (via `vp run … typecheck`) | invoked repo-wide | `package.json:23` [V] |
| Linter | `oxlint` + custom `oxlint-plugin-t3code` plugin | `vp lint --report-unused-disable-directives` | `package.json:25`; plugin package in workspace [V] |
| Formatter | `vp fmt` (vite-plus formatter) | | `package.json:29-30` [V] |
| Rust | stable toolchain, cargo workspace of 10 crates | workspace version `1.1.22` | root `Cargo.toml` [V] |
| Electron | `electron 41.5.0` (catalog pin) | used by `@axle/desktop` | `pnpm-workspace.yaml` catalog [V] |
| Dependency patching | 14 patched dependencies + `alchemy: file:stubs/alchemy-stub` override | | `pnpm-workspace.yaml` [V] |

Notes:
- The `alchemy` package is stubbed out via a workspace override (`alchemy: file:stubs/alchemy-stub`). Anything importing the real Alchemy deploy SDK resolves to the stub in this repo **[V]**. Fidelity of the stub vs the real SDK is unknown **[U]** — treat any deploy path through Alchemy as unverified.
- Catalog pins (single source of truth for shared dep versions) include `effect 4.0.0-beta.78`, `react 19.2.6`, `electron 41.5.0` **[V]**.

## 10.2 Root scripts (the only correct entry points)

From `package.json` (root of `axle-desktop/source/`) — do not invent parallel commands:

| Script | Command (abridged) | Purpose |
| --- | --- | --- |
| `dev` | `node scripts/dev-runner.ts dev` (`:7`) | Full desktop dev loop (starts server + web + Electron). |
| `dev:server` / `dev:web` / `dev:desktop` | `dev-runner.ts` variants (`:8-11`) | Run one plane only. |
| `build` | `vp run --filter './apps/*' … build` (`:20`) | Build all apps/packages/plugin/scripts. |
| `build:desktop` | `vp run --filter @axle/desktop --filter t3 build && node apps/server/scripts/cli.ts stage-desktop-runtime` (`:22`) | The real desktop pipeline: builds Electron app + `t3` server package and stages the bundled server runtime. |
| `typecheck` | `vp run -r --concurrency-limit 2 typecheck` (`:23`) | Repo-wide TS typecheck; concurrency capped at 2. |
| `lint` | `vp lint --report-unused-disable-directives` (`:25`) | Repo lint; **currently 4 hard errors** (see §10.6). |
| `test` | `vp run -r test` (`:27`) | All package tests (TS side). |
| `test:desktop-smoke` | `vp run --filter @axle/desktop smoke-test` (`:28`) | Electron smoke test. |
| `fmt` / `fmt:check` | `vp fmt` / `vp fmt --check` (`:29-30`) | Format / verify formatting. |
| `build:contracts` | `vp run --filter @axle/contracts build` (`:31`) | Rebuild shared contracts the server/web consume. |
| `dist:desktop:*` | `node scripts/build-desktop-artifact.ts` (`:32-40`) | Installer/artifact builds: `dmg` (x64/arm64), `linux` (AppImage), `linux:deb`, `win` (NSIS, x64/arm64). |
| `release:smoke` | `node scripts/release-smoke.ts` (`:41`) | Post-build release verification. |
| `clean` | `rm -rf node_modules apps/*/node_modules …` (`:42`) | Nuke build outputs. Note: POSIX shell syntax — does not run on stock Windows shells. **[V]** |
| `sync:repos` | `node scripts/sync-reference-repos.ts` (`:43`) | Syncs reference repos used by tooling. |

Supporting scripts live in `scripts/` (all with co-located tests): `build-desktop-artifact.ts`, `dev-runner.ts`, `merge-update-manifests.ts`, `mobile-native-static-check.ts`, `mock-update-server.ts`, `notify-discord-release.ts`, `resolve-nightly-release.ts`, `resolve-previous-release-tag.ts`, `update-release-package-versions.ts`, `verify-github-oauth-build.mjs` **[V]**.

## 10.3 CI inventory — what actually runs on GitHub

GitHub only executes workflows if they live in **the repository that holds them**. This repo (`thatcreativetayo/AxleCode`) has workflows in two places with very different meaning:

### Root `.github/workflows/` (the only ones GitHub runs) — 6 files [V]

| Workflow | Trigger | Purpose / notes |
| --- | --- | --- |
| `axle-installers-ci.yml` | push to branch `ci/windows-installer-artifact-073adc3` only (`:4-6`) | Effectively dormant — fires only for that one throwaway branch. Contains `test-update-feeds` (runs `npm --prefix axle-download-worker test`) plus installer build jobs (`build-wsl-node-pty`, `build-macos-x64`). Injects `AXLE_GITHUB_CLIENT_ID`, `AXLE_GITHUB_AUTH_BROKER_URL`, `AXLE_PLUGIN_WORKER_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_AXLE_PLUGIN_WORKER_URL` into the build **[V]**. |
| `axle-windows-artifact.yml` | push to `ci/windows-installer-artifact-*` (`:4-6`) | Manual Windows installer artifact builds (WSL node-pty prebuild + Windows x64 NSIS). Same dormant-branch pattern **[V]**. |
| `build-macos.yml` | push tags `v*` + `workflow_dispatch` (`:3-7`) | macOS x64 DMG pipeline: cargo `axle_cli` build, desktop build, `dist:desktop:dmg:x64`, updater artifact verification; `contents: write` to attach release assets **[V]**. |
| `github-auth-security.yml` | (present) | Security checks for the GitHub auth broker path **[V]** (workflow exists; contents not deep-read). |
| `plugin-auth-pr.yml` | (present) | Plugin-auth related PR checks **[V]** (contents not deep-read). |
| `replay-pr20-main.yml` | (present) | Replay/backfill workflow **[V]** (contents not deep-read). |

### Nested `axle-desktop/source/.github/workflows/` — 10 files — **never executed by GitHub** [F]

GitHub Actions reads workflows only from the repository root `.github/workflows/`. These nested files are dead as CI from GitHub's point of view, including:

- **`ci.yml`** — the "real" gate (check job: `vp check`, `vpr typecheck`, `vp run build:desktop`, preload-bundle grep for `desktopBridge|getLocalEnvironmentBootstrap|PICK_FOLDER_CHANNEL|wsUrl`; test job: package tests). Runner `blacksmith-8vcpu-ubuntu-2404`, 10-min timeout each **[V]**.
- `deploy-relay.yml`, `issue-labels.yml`, `mobile-eas-preview.yml`, `mobile-eas-production.yml`, `mobile-showcase-screenshots.yml`, `pr-size.yml`, `pr-vouch.yml`, `release.yml` **[V]**.

**BOTTOM LINE [F]:** the only automated gate capable of catching the currently-failing server typecheck/tests exists at `axle-desktop/source/.github/workflows/ci.yml` and GitHub never runs it. This is the single highest-leverage structural fix in the delivery pipeline.

### `release.yml` (nested; designed for a pipeline that assumes the repo root is `source/`) [V]

Triggers: tag push `v*.*.*` (excluding `v*-nightly.*`), cron `0 */3 * * *` (nightly), and `workflow_dispatch` with inputs `channel` (stable|nightly) and `version` (`release.yml:3-27`). Key jobs:

1. `check_changes` (schedule-only) — skips a nightly when HEAD equals the last nightly tag (`:30-35`).
2. `preflight` — emits `release_channel`, `version`, `tag`, `release_name`, `short_sha`, `previous_tag`, `cli_dist_tag`, `is_prerelease`, `make_latest`, `ref` (`:63-81`), and assembles `relay_public_config` outputs (Neon auth URLs, relay URL; `:180-193`).
3. `build_wsl_node_pty` (`:265-268`), `build` (`:306-316`, gated on preflight + relay config success), then platform builds and publishing steps.

Because it is nested, this pipeline only runs if the source directory is ever pushed as its own repository — see doc 14 open question about canonical repo identity.

## 10.4 Test suite status (as measured earlier in this mission, same tree)

| Suite | Command | Status |
| --- | --- | --- |
| Rust workspace | `cargo check` / `cargo test` (10 crates) | **Green** — ~147 tests passing, including the `journey_e2e` end-to-end test. [V] |
| `apps/web` typecheck | `vp run --filter @axle/web typecheck` | **Passing**. [V] |
| `apps/desktop` typecheck | `vp run --filter @axle/desktop typecheck` | **Passing**. [V] |
| `apps/server` typecheck | `vpr typecheck` equivalent | **[F] ~239 errors.** 222 of them are one systemic cause: `ScheduledTasks` service not provided in `server.test.ts` test layer (`schedules/Service.ts:22` defines the service; fix = provide `ScheduledTasksLive` in the test layer). |
| `apps/server` tests | `vp run --filter t3 test` | **[F] 124 failures**: 111 in `server.test.ts` (same missing-layer family), 2 GitManager fork-PR tests, 9 ProviderRuntimeIngestion tests, 1 VcsStatusBroadcaster test (Windows symlink `EPERM` — environment-specific), 1 keybindings test. |
| Auth worker | worker tests | **21/21 passing**. [V] |
| Landing (`axle-landing`) | build | **Passing**. [V] |
| Root lint | `vp lint` | **[F] 4 hard errors** — `t3code(namespace-node-imports)` rule in account-api code + `schedules/Service.ts`. |
| Download worker | `npm --prefix axle-download-worker test` | Only wired into the dormant installer CI job; not verified locally in this mission **[U]**. |
| Relay | `infra/relay` deploy + tests | `scripts/deploy.test.ts` exists; runtime not exercised locally **[U]**. |
| Mobile | EAS workflows (nested) | Not built locally **[U]**. |

Interpretation: the Rust core plane is the healthiest surface. The TS server plane's failures are dominated by one fixable test-harness omission plus a small set of real/branch-defect tests. None of the red state is caught by anything GitHub runs today (see §10.3).

## 10.5 Configuration, environment and app-home layout

- Desktop launcher creates the app home (`AXLE_HOME`) with subdirs: `userdata/`, `logs/provider/`, `logs/terminals/`, `attachments/`, `secrets/`, `caches/`, `worktrees/`, `memory/`, `launcher/` — `apps/desktop` launcher (`launcher.ts:41-58`) **[V]**.
- Legacy home dirs recognized/migrated from: `.Rivet`, `.sparky-desktop`, `.t3` (naming history — T3 lineage) **[V]**.
- Env vars that matter: `AXLE_HOME`, `RIVET_HOME`, `T3CODE_HOME` **[V]**. Provider logs land under `AXLE_HOME/userdata/logs/provider` **[V]**.
- Server/relay config template: `infra/relay/.env.example` **[V]** (do not copy secrets from anywhere into docs).
- CI builds inject: `AXLE_GITHUB_CLIENT_ID`, `AXLE_GITHUB_AUTH_BROKER_URL`, `AXLE_PLUGIN_WORKER_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_AXLE_PLUGIN_WORKER_URL` (`axle-installers-ci.yml`) **[V]**.
- Frozen update contracts (do not touch — enforced by repo instructions): `AXLE_UPDATE_URL`, `AXLE_UPDATE_SITE_URL`, `/get/updates/*`, `latest.yml`, productName **[V]**.

## 10.6 Migrations & deployment

- **Server DB (agent plane):** TypeScript migration set `001–032` applied by the persistence layer; several migrations carry their own tests (`016`, `019`, `024`, `025`, `026`, `027_028`, `029`, `031`) **[V]**.
- **Relay DB (infra/relay):** Drizzle-managed migrations + `infra/relay/scripts/deploy.ts` (with `deploy.test.ts`) **[V]**. Deployment target is Cloudflare (workflow references `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `RELAY_DOMAIN`) **[V]**.
- **Desktop updates:** update manifests merged via `scripts/merge-update-manifests.ts`; release smoke via `scripts/release-smoke.ts`; a `mock-update-server.ts` exists for local verification **[V]**.
- **Download/update portal:** `axle-download-worker/` (Cloudflare worker, ~399 LOC, version ~1.1.15) with its own tests — only invoked from the dormant installer CI job **[V]/[U]**.

## 10.7 Observability

| Surface | Mechanism | Evidence |
| --- | --- | --- |
| Server logs | `serverLogger.ts` structured logger | [V] |
| Traces | OTLP proxy endpoint `POST /api/observability/v1/traces` on the server; scope-gated `orchestration:operate` | `apps/server/src/http.ts:43,242-297` [V] |
| Provider logs | files under `AXLE_HOME/userdata/logs/provider` | launcher layout [V] |
| Relay tracing | `makeRelayTraceLayer` in `infra/relay` `observability.ts` | [V] |
| Product analytics | Convex-backed analytics package (version 0.0.29 in the TS workspace) | [V] |
| Crash/error reporting beyond the above | none found | [U] |

## 10.8 Version drift (delivery risk, verified)

Same repo carries at least four different version strings: Rust workspace + TS desktop `1.1.22`; `axle-download-worker` ~`1.1.15`; analytics `0.0.29`; README references `v1.1.23` **[V]**. Combined with the dual repo-identity references (README → `thatcreativetayo/AxleCode`; `apps/server/package.json` repository field → `pingdotgg/t3code` **[V]**) this makes "which artifact belongs to which release" ambiguous without the release pipeline — see doc 14.

## 10.9 What a developer should actually run (checklist)

1. `pnpm install` (corepack will pick pnpm 11.10.0; Node 24.13.x).
2. `pnpm dev` for the full loop; `pnpm dev:web` when only touching the renderer.
3. Before pushing: `pnpm typecheck` (expect current server failures — see §10.4), `pnpm lint`, `pnpm test`.
4. Touching Rust: `cargo check` then `cargo test` from the workspace root (or `-p <crate>` for speed).
5. Touching contracts: `pnpm build:contracts` before consumers' typecheck.
6. Desktop packaging locally: `pnpm build:desktop` → `pnpm dist:desktop:win` (or `:dmg`/`:linux`).
7. Never rely on CI today — see §10.3. Verify locally, or fix the CI wiring first.
