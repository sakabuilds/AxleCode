# Workbench redesign audit

Evidence date: 2026-10-14. This audit guided the desktop/web redesign. Source
inspection confirms the paths below; recorded historical test results are not
claims that live infrastructure was exercised during this audit.

## Implementation matrix

| Status                                              | Finding and evidence                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implemented, with source and recorded test evidence | The Rust agent supports tools, streaming, approval decisions, durable sessions, cancellation, and resume. The server owns orchestration, persisted events, projections, checkpoints, and terminal sessions. See root `AXLE_IMPLEMENTATION.md`, `crates/axle_agent`, `crates/axle_session`, and `apps/server/src/provider/Layers/AxleAdapter.ts`. |
| Implemented but incomplete or unreliable            | Existing documentation records Git fork-PR and scheduler/server test failures. The chat UI hardcoded its environment-unavailable flag to false, bypassing existing send, checkpoint, and plan guards; the redesign restores that decision from the live connection phase.                                                                        |
| Scaffolded                                          | `pnpm-workspace.yaml` overrides Alchemy with `stubs/alchemy-stub`. Local availability does not establish that relay deployment works.                                                                                                                                                                                                            |
| Missing in the audited implementation               | `crates/axle_tools/src/execution.rs` provides only `LocalExecutionTarget`; independent cloud execution is not implemented by the relay. No credit/entitlement ledger was found in the inspected account API and shared contracts. `apps/account-api/src/database.ts` instead records deduplicated usage events.                                  |
| Present but architecturally risky                   | `ChatView.tsx` and `Sidebar.tsx` combine presentation and operational wiring. Environment-scoped references, command callbacks, provider identity, persisted resume cursors, and terminal lifecycle must survive visual changes.                                                                                                                 |
| Requires live verification                          | Provider authentication, production relay, APNs/mobile delivery, deployment state, and packaged desktop behavior cannot be established by UI existence or this source audit. Browser preview remains desktop-only.                                                                                                                               |

## Runtime boundaries

The active chat path is `ChatView` → client-runtime `state/threadCommands.ts` →
`operations/commands.ts` → authenticated server WebSocket dispatch → orchestration
→ `AxleDriver` → `AxleAdapter` → the Rust CLI. The client-runtime serializes
commands by environment and thread. `apps/server/src/provider/builtInDrivers.ts`
registers only the aggregated Axle driver; legacy standalone adapters are not
additional active provider choices.

The server owns user-facing state and persistence. The Rust runtime owns the
agent loop and tool execution. The adapter crosses this boundary through CLI
arguments, stdin, NDJSON events, the approval file, and the persisted session
binding. A missing resume cursor or transcript must not silently start a new
conversation.

## Design decisions

- Build the new workbench around existing commands and entity hooks. Display
  actual thread, project, approval, and connection state rather than fabricated
  metrics or tasks.
- Keep the neutral visual foundation and use color for meaningful status.
- Preserve command palette access, model selection, approval controls, Git and
  checkpoint actions, editor shortcuts, and keyboard interactions.
- Derive environment availability from its live presentation: only `connected`
  permits work; `available`, `offline`, `connecting`, `reconnecting`, and `error`
  remain unavailable. A null selection preserves project-free chat behavior.
- Use `useEnvironment` and the existing connection presentation helpers for
  status badges. A saved relay connection is remote access, not an independent
  cloud worker.
- Preserve final assistant-item and turn-completed lifecycle semantics, observed
  diff statistics, runtime modes, and all authorization boundaries.
- Preserve `T3CODE_*`, `@t3tools/*`, `~/.t3`, the `t3` package/CLI, and update and
  remote-access contracts. No persistence or protocol migration is part of this
  presentation change.

## Focused verification

Run changed web logic tests and the web package typecheck. Use
`pnpm_config_verify_deps_before_run=warn` when invoking pnpm, as documented in
root `AXLE_IMPLEMENTATION.md`, to avoid an unrelated relay dependency refresh.

The primary agent performs one integrated pass using
`.agents/skills/test-axle-app/SKILL.md`: start an isolated environment with
`vp run dev --home-dir <absolute-test-directory>`, use the printed pairing URL
once in the controlled browser, and stop the environment when finished. Preserve
existing `.t3` state and never include pairing tokens in committed evidence.

The installed Node is 24.10.0; the root manifest requests `^24.13.1`, while the
server allows `>=24.10`. The contracts package exports TypeScript source and has
no build script despite the root `build:contracts` alias. The redesign does not
change shared schemas.
