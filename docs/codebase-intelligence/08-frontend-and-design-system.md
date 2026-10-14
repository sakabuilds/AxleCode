# 08 — Frontend, UX, and Design System

Part of the Axle codebase-intelligence dossier (index: `CODEBASE_INTELLIGENCE_INDEX.md`). Evidence date 2026-10-13. Primary app: `axle-desktop/source/apps/web` (`@axle/web`, version 1.1.22, React 19.2.6). The desktop Electron shell renders this same app; mobile is a separate Expo codebase (`apps/mobile`, summarized in `05`/`11`).

---

## 1. Routes (TanStack Router file routes, `apps/web/src/routes/`)

| Route file | URL | Purpose |
| --- | --- | --- |
| `__root.tsx` | — | Root layout/error boundary |
| `_chat.tsx` | (layout) | Chat experience layout |
| `_chat.index.tsx` | `/` | Empty chat / entry |
| `_chat.$environmentId.$threadId.tsx` | `/$environmentId/$threadId` | A thread against an environment |
| `_chat.draft.$draftId.tsx` | `/draft/$draftId` | New-thread draft flow |
| `onboarding.tsx` | `/onboarding` | First-run setup |
| `plugins.tsx` | `/plugins` | Plugin catalog/authorization |
| `pull-requests.tsx` | `/pull-requests` | PR list/review |
| `schedules.tsx` | `/schedules` | Scheduled tasks |
| `settings.tsx` (+10 children) | `/settings/...` | general, models, personalize, instructions, memory, plugins, source-control, keybindings, diagnostics, archived |

## 2. Renderer composition

`AppRoot.tsx:17-30` wraps everything in (in order): `MotionConfig reducedMotion="user"` with `AXLE_TRANSITION` (`lib/motion.ts`) → `AppAtomRegistryProvider` (`rpc/atomRegistry`) → `AccountAuthProvider` → `RouterProvider`; hosts rendered outside the router so they survive navigation: `PluginAuthorizationCardHost`, `PreviewAutomationHosts`, `ElectronBrowserHost` (comment at AppRoot.tsx:12-16 explains the Electron webview must not unmount on route transitions).

Key components (all under `apps/web/src/components/`): `ChatView.tsx` (streaming conversation), `ChatMarkdown.tsx` (markdown rendering), `AppSidebarLayout.tsx` + thread sidebar, `BranchToolbar*.tsx` (git context strip, branch/env/mode selectors), `CommandPalette.tsx` + `CommandPaletteResults.tsx`, `DiffPanel.tsx`/`DiffPanelShell.tsx` (uses `@pierre/diffs`, `@pierre/trees`), `EnvironmentPanel.tsx`, `ConnectionStatusDot.tsx`, `DesktopUpdateBanner.tsx`, `AnimatedHeight.tsx`, chat composer (Lexical-based, plan-mode chip), terminal surfaces (xterm), `browser/BrowserDeviceToolbar.tsx`, `components/plugins/*`, `components/preview/*`.

## 3. State management

| Concern | Mechanism | Files |
| --- | --- | --- |
| Server state / queries | Effect Atom React (`@effect/atom-react`) with a per-app `AtomRegistry` | `rpc/atomRegistry.tsx`, `state/queries.ts`, `state/query.ts`, `state/use-atom-query-runner.ts` |
| Commands | Atom command hooks | `state/use-atom-command.ts`, `state/chatThreadActions.ts` |
| UI state | Zustand + React context + `useLocalStorage` | `useLocalStorage.ts`, `state/*` |
| Domain stores | one module per domain: threads, projects, sessions, terminal(+sessions), git, vcs, review, sourceControl(+Actions), preview, relay, environments, shell, assets, presentation, entities, runtime, primaryEnvironment | `apps/web/src/state/` (listed) |
| Connection | `connection/` + `state/desktopLocal.ts`, `runtime.ts`, `catalog.ts` | catalog of environments, local desktop bootstrap |
| Settings | `hooks/useSettings.ts` (has tests) | — |
| Demo mode | `src/demo/` + `build:demo` (`vp build --mode demo`) + MSW (`msw` devDep, worker in `apps/web/public`) | Mocked-data surface — do not confuse with production paths |

## 4. Design system

**Styling stack:** Tailwind CSS v4 via `@tailwindcss/vite`; single token file `apps/web/src/index.css` with `@theme inline` at 204-283. Tokens are semantic CSS variables mapped to Tailwind color utilities:

- Surfaces: `--background`, `--foreground`, `--card(-foreground)`, `--popover(-foreground)`, `--primary(-foreground)`, `--secondary(-foreground)`, `--muted(-foreground)`, `--accent(-foreground)`, `--destructive(-foreground)`, `--border`, `--input`, `--ring`.
- Status: `--success(-foreground)`, `--warning(-foreground)`, `--info(-foreground)`.
- Sidebar-specific: `--sidebar`, `--sidebar-foreground`, `--sidebar-accent(-foreground)`, `--sidebar-border`, `--sidebar-ring`.
- Typography: `--font-sans` (DM Sans variable, `@fontsource-variable/dm-sans`), `--font-heading` alias, `--font-mono` (JetBrains Mono), explicit weights 400/500/600 (`index.css:217-247`).
- Component utilities: `class-variance-authority` + `tailwind-merge`; primitives from `@base-ui/react`; icons from `lucide-react`; motion from `framer-motion` (reduced-motion honored globally); list virtualization `@legendapp/list`; auto-animate for height/transition polish; drag-and-drop via `@dnd-kit/*`.

**Theming:** themes are applied by swapping the semantic variables (see `hooks/useTheme.ts` + tests); sidebar tokens are first-class so the shell can theme independently.

## 5. UX states and error handling

- Streaming: assistant deltas render live; thinking appears separately; tool cards show running/completed with duration and timeout state (driven by the NDJSON events in `07`).
- Connection state: `ConnectionStatusDot.tsx`; disconnected/local-server discovery in `state/desktopLocal.ts` and `connection/*`.
- Updates: `DesktopUpdateBanner.tsx` + `lib/desktopUpdate.ts` (tested).
- Errors: typed errors from `@axle/contracts`; root/route error handling in `__root.tsx`; empty states exist per settings page and archived list.
- Permission-denied: auth scopes surface through `account/*` and `AccountAuthProvider`.

## 6. Keyboard and accessibility

- Command palette + results with keyboard navigation.
- Keybindings: contract `packages/contracts/src/keybindings.ts`, server `src/keybindings.ts`, settings page `settings.keybindings.tsx`; project-script keybindings in `lib/projectScriptKeybindings.ts` (tested). One keybindings test currently fails — see `11`.
- Focus management utilities: `lib/terminalFocus.ts`, `lib/previewFocus.ts`, `lib/elementContext.ts` (tested).
- Reduced motion honored (`MotionConfig reducedMotion="user"`).
- **[U]** No systematic a11y audit was performed; labels/roles were not enumerated.

## 7. Markdown/HTML safety

`ChatMarkdown.tsx` composes `react-markdown` with `remark-gfm`, `remark-breaks`, `rehype-raw` **and `rehype-sanitize`** — raw HTML is sanitized before rendering, which is the correct pairing for agent-generated content. Keep `rehype-sanitize` in place for any future markdown surface.

## 8. Incomplete / placeholder surface (as of this pass)

- A large uncommitted redesign touches 154 files, heavily `apps/web/src/components/*` (ChatView, BranchToolbar, DiffPanel, CommandPalette, sidebar, etc.) plus `ui-redesign-*.md` notes at the TS workspace root. Treat the committed UI as ground truth; the working tree shows an in-flight visual overhaul whose intent is documented only in those markdown files (not read in this pass).
- Demo mode is a real mocked-data surface (`src/demo`, MSW); never cite demo behavior as product behavior.
- Mobile UI parity is not established; mobile has its own feature set under `apps/mobile/src/features/` (agent-awareness, threads, terminal, diffs, review).
