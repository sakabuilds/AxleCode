# Axle configuration

How to run and configure the `axle` runtime (the Rust binary in `crates/`) and
the desktop app that embeds it. For how the pieces fit together, see
[axle-architecture.md](./axle-architecture.md).

## Build and run the runtime

```powershell
# Build the CLI (debug)
cargo build -p axle_cli

# One-shot prompt against OpenAI (key from the environment)
$env:OPENAI_API_KEY = "sk-..."
cargo run -q -p axle_cli -- -p "summarize this repository"

# Interactive-style single turn in a specific workspace
cargo run -q -p axle_cli -- --cwd C:\work\project -p "run the tests"
```

The desktop app builds the same binary through its own toolchain; the desktop
guide lives in `axle-desktop/source/README.md`.

## Providers and API keys

Select a provider with `--provider <id>` (short `-r`) and a model with
`--model <id>` (short `-m`).

| Provider id | API key environment variable | Notes |
| --- | --- | --- |
| `openai` (default) | `OPENAI_API_KEY` | `--base-url` overrides the endpoint |
| `anthropic` | `ANTHROPIC_API_KEY` | |
| `gemini` | `GEMINI_API_KEY` | alias `google` |
| `openrouter` | `OPENROUTER_API_KEY` | OpenAI wire format; sends Axle attribution headers |
| `fireworks` | `FIREWORKS_API_KEY` | |
| `cerebras` | `CEREBRAS_API_KEY` | |
| `groq` | `GROQ_API_KEY` | |
| `ollama-cloud` | `OLLAMA_API_KEY` | alias `ollama_cloud` |
| `ollama` | none | local daemon; defaults to `http://localhost:11434/v1` |
| `codex` / `chatgpt` | none | ChatGPT Codex subscription auth via `--codex-login` |

Custom OpenAI-compatible endpoints use `--provider ollama --base-url <url>`
(keyless) or any provider id with `--base-url`. Localhost base URLs never
require an API key.

The desktop model picker uses `provider/model` slugs (for example
`anthropic/claude-3-5-sonnet-latest`), split on the first `/`.

## CLI reference

### Input and workspace

| Flag | Meaning |
| --- | --- |
| `-p, --prompt <TEXT>` | Prompt to execute |
| `--prompt-stdin` | Read the prompt from stdin (conflicts with `--prompt`) |
| `-c, --cwd <PATH>` | Working directory (default `.`) |
| `--image-path <PATH>` / `--image-mime-type <MIME>` | Attach images (repeatable) |
| `--append-system-prompt <TEXT>` | Extra instructions appended to the built-in system prompt |
| `--no-workspace-context` (hidden) | Project-free chat; drops workspace tools |
| `--interaction-mode build|plan` | `plan` is read-only (default `build`) |
| `--context-window <N|k|m>` | Provider-advertised context window for compaction estimates |
| `--effort <LEVEL>` | Reasoning effort for models that support it |
| `--extension <PATH>` | Optional JS/TS extension file to load |

### Providers, sessions, output

| Flag | Meaning |
| --- | --- |
| `-r, --provider <ID>` / `-m, --model <ID>` | Provider and model selection |
| `--base-url <URL>` | Override the provider endpoint |
| `--session <ID>` | Resume an existing session in the working directory |
| `--json` | One machine-readable JSON result on stdout |
| `--json-stream` | NDJSON event stream on stdout (the desktop boundary; see the architecture doc) |
| `--text-only` (hidden) | One provider-native generation with no tools or session |

### Approvals

| Flag | Meaning |
| --- | --- |
| `--approval-file <PATH>` | Enable the approval gate; decisions are read from this JSONL file |
| `--approval-timeout-seconds <N>` | Wait before denying (default 600) |

Decision lines are `{"type":"approval_response","requestId":"<id>","decision":"allow"}`.
`allow`/`approved`/`accept`/`accept_for_session` approve;
`deny`/`denied`/`decline`/`cancel` deny. See the architecture doc for the
request-id format and the desktop's per-thread file location.

### MCP and integrations

| Flag | Meaning |
| --- | --- |
| `--mcp-url <URL>` | HTTP MCP endpoint exposed as tools |
| `--mcp-bearer-token-env-var <VAR>` | Env var holding the bearer token |
| `--mcp-header-name <NAME>` + `--mcp-header-env-var <VAR>` | Custom auth header instead of bearer |
| `--mcp-stdio-program <PROGRAM>` / `--mcp-stdio-arg <ARG>` | Local stdio MCP server (repeat `--mcp-stdio-arg`) |
| `--github-mcp` | GitHub's hosted remote MCP server, using `GITHUB_PERSONAL_ACCESS_TOKEN` (or `GITHUB_TOKEN`) |

### ChatGPT Codex subscription auth

`--codex-login`, `--codex-auth-status`, `--codex-logout` manage the saved
ChatGPT credentials used by `--provider codex`.

## Workspace files (`.axle/`)

Everything Axle persists lives under the working directory's `.axle/` folder,
which `axle_session` adds to `.gitignore` automatically.

| Path | Contents |
| --- | --- |
| `.axle/sessions/<id>.jsonl` | Durable session transcript (append-only, flushed per write) |
| `.axle/agents.toml` | Specialized agent profiles for `--agent <NAME>` |
| `.axle/approvals/<name>.jsonl` | Approval decisions (the desktop names files `<sha256(threadId)>.jsonl`) |
| `.axle/memories.json` | Project memory store (the global store lives outside the workspace; see the environment table) |
| `.axle/project-free-memory/memories.json` | Memory store for `--no-workspace-context` chats |

### Agent profiles (`.axle/agents.toml`)

```toml
[[agents]]
name = "code-reviewer"
description = "Read-only reviewer."
instructions = """
Review the code the user points you at. Report findings with file and line.
Never edit files.
"""
allowed_tools = ["read", "grep", "find", "ls", "web_search"]

[[agents]]
name = "claude-reviewer"
provider = "anthropic"
model = "claude-3-5-sonnet-latest"
allowed_tools = ["read", "grep", "find", "ls", "web_search"]
```

Fields: `name` (required), `description`, `instructions` (appended to the
system prompt), `provider` / `model` (override the CLI defaults when set), and
`allowed_tools` (empty or omitted means every tool). Unknown fields are
rejected at load time. The repository ships working examples in `.axle/agents.toml`.

## Environment variables

| Variable | Effect |
| --- | --- |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `FIREWORKS_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `OLLAMA_API_KEY` | Provider credentials (see the table above) |
| `GITHUB_PERSONAL_ACCESS_TOKEN` / `GITHUB_TOKEN` | Token for `--github-mcp` |
| `AXLE_SHELL` | Shell program the `bash` tool uses (overridden by `--shell`) |
| `AXLE_HOME` | Base directory for the global memory store (`<AXLE_HOME>/memory/memories.json`) |
| `AXLE_MEMORY_GLOBAL_DIR` | Directory holding the global `memories.json` (wins over `AXLE_HOME`) |
| `AXLE_CODEX_HOME` | Override the saved ChatGPT Codex auth location |

## Desktop configuration

- Model API keys are managed in the app under **Settings > Models** rather than
  environment variables; the server passes provider/model to the runtime as
  `--provider` / `--model`.
- Approval files are created per thread under the workspace and are
  gitignored; the web UI's Approve once / Always allow this session / Decline /
  Cancel turn actions map onto the decision values above.
- Environment forwarding (including into WSL) is implemented in
  `axle-desktop/source/apps/desktop/src/backend/DesktopBackendConfiguration.ts`.
- Deeper desktop documentation (remote access, CI, workspace layout) lives in
  `axle-desktop/source/docs/`.
