use axle_agent::{AgentLoop, AgentLoopOptions, ApprovalConfig, InteractionMode};
use axle_ai::{
    codex_auth_status, login_codex, logout_codex, AnthropicProvider, AssistantMessageEvent,
    CodexProvider, CompletionOptions, ContentPart, GeminiProvider, LlmProvider, Message,
    OpenAiProvider, OpenRouterProvider, DEFAULT_OPENROUTER_BASE_URL,
};
use axle_config::{AgentProfile, DEFAULT_CONTEXT_WINDOW_TOKENS};
use axle_extensions::{AxleEvent, EventBus, JsExtensionRunner};
use axle_memory::MemoryStore;
use axle_session::SessionManager;
use axle_tools::{
    is_hidden_control_tool, register_http_mcp_tools_with_header, register_stdio_mcp_tools,
    LocalExecutionTarget, ToolRegistry,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use clap::Parser;
use futures::StreamExt;
use std::env;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration as StdDuration;
use tokio::io::AsyncReadExt;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "axle")]
#[command(about = "Axle AI Coding Agent", long_about = None)]
struct Cli {
    #[arg(long, help = "Sign in with a ChatGPT Codex subscription")]
    codex_login: bool,

    #[arg(long, help = "Print ChatGPT Codex authentication status as JSON")]
    codex_auth_status: bool,

    #[arg(
        long,
        hide = true,
        help = "Refresh the saved ChatGPT plan-usage session"
    )]
    codex_auth_refresh: bool,

    #[arg(long, help = "Remove the saved ChatGPT Codex authentication")]
    codex_logout: bool,

    #[arg(short, long, help = "Prompt to execute directly")]
    prompt: Option<String>,

    #[arg(long, conflicts_with = "prompt", help = "Read the prompt from stdin")]
    prompt_stdin: bool,

    #[arg(long = "image-path", value_name = "PATH")]
    image_paths: Vec<String>,

    #[arg(long = "image-mime-type", value_name = "MIME")]
    image_mime_types: Vec<String>,

    #[arg(
        long,
        hide = true,
        help = "Run one provider-native text generation without agent tools or session state"
    )]
    text_only: bool,

    #[arg(long, help = "Reasoning effort for models that support it")]
    effort: Option<String>,

    #[arg(
        long,
        value_parser = ["build", "plan"],
        default_value = "build",
        help = "Interaction policy: build may modify the workspace, plan is read-only"
    )]
    interaction_mode: String,

    #[arg(
        long,
        help = "File used to answer tool approval requests; enables approval mode"
    )]
    approval_file: Option<String>,

    #[arg(
        long,
        default_value_t = 600,
        help = "Seconds to wait for an approval decision before the tool is denied"
    )]
    approval_timeout_seconds: u64,

    #[arg(
        long,
        help = "Provider-advertised context window, in tokens or k/m notation"
    )]
    context_window: Option<String>,

    #[arg(
        short = 'r',
        long,
        default_value = "openai",
        help = "Model API: openai, anthropic, gemini, fireworks, ollama-cloud, cerebras, groq, openrouter, ollama"
    )]
    provider: String,

    #[arg(
        short,
        long,
        default_value = "gpt-4o",
        help = "Model ID to use (e.g. gpt-4o, claude-3-5-sonnet-latest, gemini-1.5-pro)"
    )]
    model: String,

    #[arg(short, long, default_value = ".", help = "Working directory path")]
    cwd: String,

    #[arg(
        long,
        value_name = "PROGRAM",
        conflicts_with = "no_workspace_context",
        help = "Shell program the bash tool runs local commands with (e.g. powershell, pwsh, bash, cmd); falls back to AXLE_SHELL, then the platform default"
    )]
    shell: Option<String>,

    #[arg(
        long,
        hide = true,
        help = "Disable project/workspace context for a project-free chat"
    )]
    no_workspace_context: bool,

    #[arg(long, help = "Custom Base URL for OpenAI/Ollama-compatible provider")]
    base_url: Option<String>,

    #[arg(short, long, help = "Optional JS/TS extension file path to load")]
    extension: Option<String>,

    #[arg(long, help = "Write one machine-readable JSON result to stdout")]
    json: bool,

    #[arg(long, help = "Write newline-delimited JSON token events to stdout")]
    json_stream: bool,

    #[arg(
        long,
        help = "Resume an existing Axle session in the working directory"
    )]
    session: Option<String>,

    #[arg(long, help = "Instructions appended to Axle's built-in system prompt")]
    append_system_prompt: Option<String>,

    #[arg(
        long,
        value_name = "NAME",
        conflicts_with = "no_workspace_context",
        help = "Specialized agent profile from .axle/agents.toml (instructions, provider/model preference, allowed tools)"
    )]
    agent: Option<String>,

    #[arg(long, help = "HTTP MCP endpoint to expose as agent tools")]
    mcp_url: Option<String>,

    #[arg(
        long,
        requires = "mcp_url",
        help = "Environment variable containing the bearer token for --mcp-url"
    )]
    mcp_bearer_token_env_var: Option<String>,

    #[arg(
        long,
        requires = "mcp_header_env_var",
        requires = "mcp_url",
        conflicts_with = "mcp_bearer_token_env_var",
        help = "Custom HTTP MCP authentication header name"
    )]
    mcp_header_name: Option<String>,

    #[arg(
        long,
        requires = "mcp_header_name",
        requires = "mcp_url",
        conflicts_with = "mcp_bearer_token_env_var",
        help = "Environment variable containing a custom HTTP MCP header value"
    )]
    mcp_header_env_var: Option<String>,

    #[arg(
        long,
        value_name = "PROGRAM",
        conflicts_with = "no_workspace_context",
        help = "Local stdio MCP server program to expose as agent tools (e.g. npx)"
    )]
    mcp_stdio_program: Option<String>,

    #[arg(
        long,
        value_name = "ARG",
        requires = "mcp_stdio_program",
        allow_hyphen_values = true,
        help = "Argument passed to --mcp-stdio-program; repeat for multiple arguments"
    )]
    mcp_stdio_arg: Vec<String>,

    #[arg(
        long,
        conflicts_with = "no_workspace_context",
        help = "Register GitHub's remote MCP server tools using GITHUB_PERSONAL_ACCESS_TOKEN (or GITHUB_TOKEN)"
    )]
    github_mcp: bool,
}

fn write_json_line(value: serde_json::Value) {
    println!("{}", value);
    let _ = io::stdout().flush();
}

fn required_api_key(variable: &str) -> anyhow::Result<String> {
    let value = env::var(variable).unwrap_or_default().trim().to_string();
    anyhow::ensure!(
        !value.is_empty(),
        "ERROR: {} environment variable is not set. Set it before running axle.",
        variable
    );
    Ok(value)
}

fn configured_base_url(cli_value: Option<&str>, default: &str) -> String {
    cli_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default.to_string())
}

/// `--agent` naming a specific provider/model wins over the CLI defaults;
/// either side falls back to the other so both refs stay valid.
fn resolve_provider_and_model(provider: Option<&str>, model: Option<&str>) -> (String, String) {
    (
        provider
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("openai")
            .to_string(),
        model
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("gpt-4o")
            .to_string(),
    )
}

/// Merge `--append-system-prompt` with the selected agent's instructions. The
/// agent text is rendered as a `<agent_profile>` block by `AgentProfile`.
fn compose_append_prompt(
    cli_append: Option<&str>,
    profile: Option<&AgentProfile>,
) -> Option<String> {
    match (cli_append, profile) {
        (Some(existing), Some(profile)) => {
            Some(format!("{existing}\n{}", profile.system_prompt_fragment()))
        }
        (Some(existing), None) => Some(existing.to_string()),
        (None, Some(profile)) => Some(profile.system_prompt_fragment()),
        (None, None) => None,
    }
}

fn parse_context_window_tokens(value: Option<&str>) -> anyhow::Result<Option<usize>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let normalized = value.to_ascii_lowercase().replace(',', "");
    let (number, multiplier) = if let Some(number) = normalized.strip_suffix('b') {
        (number, 1_000_000_000_f64)
    } else if let Some(number) = normalized.strip_suffix('m') {
        (number, 1_000_000_f64)
    } else if let Some(number) = normalized.strip_suffix('k') {
        (number, 1_000_f64)
    } else if let Some(number) = normalized.strip_suffix("tokens") {
        (number, 1_f64)
    } else {
        (normalized.as_str(), 1_f64)
    };
    let amount: f64 = number
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid context window '{value}'"))?;
    let tokens = amount * multiplier;
    anyhow::ensure!(
        tokens.is_finite() && tokens > 0.0 && tokens.fract() == 0.0,
        "Context window must be a positive whole number of tokens"
    );
    anyhow::ensure!(
        tokens <= usize::MAX as f64,
        "Context window is too large for this platform"
    );
    Ok(Some(tokens as usize))
}

fn write_stream_event(event: &AssistantMessageEvent) {
    match event {
        AssistantMessageEvent::TextDelta(delta) => {
            write_json_line(serde_json::json!({ "type": "delta", "delta": delta }));
        }
        AssistantMessageEvent::ThinkingDelta(delta) => {
            write_json_line(serde_json::json!({ "type": "thinking_delta", "delta": delta }));
        }
        _ => {}
    }
}

async fn run_text_only(
    provider: Arc<dyn LlmProvider>,
    cli: &Cli,
    model: &str,
) -> anyhow::Result<()> {
    let prompt = if cli.prompt_stdin {
        let mut prompt = String::new();
        tokio::io::stdin().read_to_string(&mut prompt).await?;
        anyhow::ensure!(!prompt.trim().is_empty(), "Prompt stdin was empty");
        prompt
    } else {
        cli.prompt.clone().unwrap_or_default()
    };
    anyhow::ensure!(!prompt.trim().is_empty(), "Prompt was empty");

    let mut user_content = vec![ContentPart::Text { text: prompt }];
    user_content.extend(load_image_parts(&cli.image_paths, &cli.image_mime_types).await?);
    let capabilities = provider.capabilities(model);
    let messages = vec![
        Message::system(
            "You are Axle's concise text-generation helper. Follow the requested output format exactly. Do not use tools or explain your work.",
        ),
        Message::user_with_content(user_content),
    ];
    let options = CompletionOptions {
        model: model.to_string(),
        temperature: if capabilities.supports_temperature {
            Some(0.2)
        } else {
            None
        },
        max_tokens: Some(64),
        reasoning_effort: if capabilities.supports_reasoning_effort {
            cli.effort.clone()
        } else {
            None
        },
        tools: Vec::new(),
        ..Default::default()
    };
    let mut stream = provider.stream(&messages, &options).await?;
    let mut response = String::new();

    while let Some(event) = stream.next().await {
        match event {
            AssistantMessageEvent::TextDelta(delta) => {
                if cli.json_stream {
                    write_json_line(serde_json::json!({
                        "type": "delta",
                        "delta": delta,
                    }));
                }
                response.push_str(&delta);
            }
            AssistantMessageEvent::ThinkingDelta(delta) => {
                if cli.json_stream {
                    write_json_line(serde_json::json!({
                        "type": "thinking_delta",
                        "delta": delta,
                    }));
                }
            }
            AssistantMessageEvent::Done { usage } => {
                if cli.json_stream {
                    if let Some(usage) = usage {
                        write_json_line(serde_json::json!({
                            "type": "usage",
                            "promptTokens": usage.prompt_tokens,
                            "completionTokens": usage.completion_tokens,
                            "totalTokens": usage.total_tokens,
                            "cumulativeTotalTokens": usage.total_tokens,
                        }));
                    }
                }
            }
            AssistantMessageEvent::Error(error) => anyhow::bail!(error),
            AssistantMessageEvent::ToolCallDelta { .. }
            | AssistantMessageEvent::ProviderState(_) => {}
        }
    }

    anyhow::ensure!(
        !response.trim().is_empty(),
        "Provider returned an empty text-generation response"
    );
    if cli.json_stream {
        write_json_line(serde_json::json!({
            "type": "result",
            "response": response,
        }));
    } else if cli.json {
        println!("{}", serde_json::json!({ "response": response }));
    } else {
        println!("{}", response);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(provider: Option<&str>, model: Option<&str>) -> AgentProfile {
        AgentProfile {
            name: "test-agent".to_string(),
            description: "Test agent".to_string(),
            instructions: "Follow the test instructions.".to_string(),
            provider: provider.map(ToOwned::to_owned),
            model: model.map(ToOwned::to_owned),
            allowed_tools: Vec::new(),
            workflow: Default::default(),
        }
    }

    #[test]
    fn profile_provider_and_model_win_when_set() {
        let profile = profile(Some("anthropic"), Some("claude-3-5-sonnet-latest"));

        let (provider, model) = resolve_provider_and_model(
            profile.provider.as_deref().or(Some("openai")),
            profile.model.as_deref().or(Some("gpt-4o")),
        );

        assert_eq!(provider, "anthropic");
        assert_eq!(model, "claude-3-5-sonnet-latest");
    }

    #[test]
    fn cli_provider_and_model_fill_gaps_in_the_profile() {
        let profile = profile(None, Some("claude-3-5-sonnet-latest"));

        let (provider, model) = resolve_provider_and_model(
            profile.provider.as_deref().or(Some("gemini")),
            profile.model.as_deref().or(Some("gemini-1.5-pro")),
        );

        assert_eq!(provider, "gemini");
        assert_eq!(model, "claude-3-5-sonnet-latest");
    }

    #[test]
    fn missing_everything_falls_back_to_openai_defaults() {
        let (provider, model) = resolve_provider_and_model(None, None);

        assert_eq!(provider, "openai");
        assert_eq!(model, "gpt-4o");
    }

    #[test]
    fn append_prompt_keeps_existing_instructions_and_adds_the_profile_block() {
        let profile = profile(Some("anthropic"), None);

        let combined = compose_append_prompt(Some("Always answer in French."), Some(&profile))
            .expect("combined prompt");
        assert!(combined.starts_with("Always answer in French."));
        assert!(combined.contains("<agent_profile name=\"test-agent\">"));
        assert!(combined.contains("Follow the test instructions."));

        let profile_only = compose_append_prompt(None, Some(&profile)).expect("profile only");
        assert!(profile_only.starts_with("<agent_profile"));

        let cli_only = compose_append_prompt(Some("Keep it short."), None).expect("cli only");
        assert_eq!(cli_only, "Keep it short.");

        assert!(compose_append_prompt(None, None).is_none());
    }
}

struct ProgressIndicator {
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl ProgressIndicator {
    fn start() -> Self {
        eprint!("Axle is working");
        let _ = io::stderr().flush();
        let (stop, mut stopped) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(750));
            interval.tick().await;
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        eprint!(".");
                        let _ = io::stderr().flush();
                    }
                    _ = &mut stopped => break,
                }
            }
        });
        Self {
            stop: Some(stop),
            task: Some(task),
        }
    }

    async fn finish(mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
        eprintln!();
    }
}

impl Drop for ProgressIndicator {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(task) = self.task.take() {
            task.abort();
            eprintln!();
        }
    }
}

async fn run_prompt(
    agent_loop: &AgentLoop,
    session: &mut SessionManager,
    prompt: &str,
    images: Vec<ContentPart>,
    json_stream: bool,
    show_progress: bool,
) -> anyhow::Result<String> {
    let progress = show_progress.then(ProgressIndicator::start);
    let result = if json_stream {
        agent_loop
            .run_turn_streaming_with_images(prompt, images, session, write_stream_event)
            .await
    } else {
        agent_loop
            .run_turn_with_images(prompt, images, session)
            .await
    };
    if let Some(progress) = progress {
        progress.finish().await;
    }
    result
}

async fn load_image_parts(
    paths: &[String],
    mime_types: &[String],
) -> anyhow::Result<Vec<ContentPart>> {
    anyhow::ensure!(
        paths.len() == mime_types.len(),
        "Each --image-path must have a matching --image-mime-type"
    );
    let mut images = Vec::with_capacity(paths.len());
    for (path, mime_type) in paths.iter().zip(mime_types) {
        let bytes = tokio::fs::read(path).await?;
        anyhow::ensure!(!bytes.is_empty(), "Image attachment '{}' is empty", path);
        images.push(ContentPart::Image {
            data: BASE64_STANDARD.encode(bytes),
            mime_type: mime_type.clone(),
        });
    }
    Ok(images)
}

fn write_result(cli: &Cli, result: &str, session_id: &str) {
    if cli.json_stream {
        write_json_line(serde_json::json!({
            "type": "result",
            "response": result,
            "sessionId": session_id,
        }));
    } else if cli.json {
        println!(
            "{}",
            serde_json::json!({
                "response": result,
                "sessionId": session_id,
            })
        );
    } else {
        println!("\nAxle Response:\n{}", result);
    }
}

fn output_snippet(output: &str, max_bytes: usize) -> &str {
    if output.len() <= max_bytes {
        return output;
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !output.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &output[..boundary]
}

fn format_duration_ms(duration_ms: u64) -> String {
    if duration_ms < 1_000 {
        format!("{}ms", duration_ms)
    } else if duration_ms < 60_000 {
        format!("{:.1}s", duration_ms as f64 / 1_000.0)
    } else {
        format!("{:.1}m", duration_ms as f64 / 60_000.0)
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    let cli = Cli::parse();

    if cli.codex_login {
        println!("{}", serde_json::to_string(&login_codex().await?)?);
        return Ok(());
    }
    if cli.codex_auth_refresh {
        let _ = axle_ai::codex_auth::valid_codex_credentials().await?;
        println!("{}", serde_json::to_string(&codex_auth_status())?);
        return Ok(());
    }
    if cli.codex_auth_status {
        println!("{}", serde_json::to_string(&codex_auth_status())?);
        return Ok(());
    }
    if cli.codex_logout {
        println!("{}", serde_json::to_string(&logout_codex().await?)?);
        return Ok(());
    }

    if !cli.json && !cli.json_stream {
        tracing_subscriber::fmt()
            .with_env_filter(EnvFilter::from_default_env().add_directive("axle=info".parse()?))
            .init();
    }

    // A specialized agent profile is workspace configuration, so it loads
    // before provider construction: the profile can prefer a provider/model,
    // and an unknown name must fail before any network setup.
    let cli_append_prompt = cli.append_system_prompt.clone();
    let cli_provider = cli.provider.clone();
    let cli_model = cli.model.clone();
    let agent_profile: Option<AgentProfile> = match cli.agent.as_deref() {
        Some(name) => {
            let config = axle_config::AgentsConfig::load(&cli.cwd)?;
            let profile = config.get(name).cloned().ok_or_else(|| {
                anyhow::anyhow!(
                    "--agent '{name}' is not defined in {}",
                    Path::new(&cli.cwd)
                        .join(axle_config::AGENT_PROFILES_RELATIVE_PATH)
                        .display()
                )
            })?;
            tracing::info!(
                agent = %profile.name,
                provider = profile.provider.as_deref().unwrap_or("cli default"),
                model = profile.model.as_deref().unwrap_or("cli default"),
                allowed_tools = profile.allowed_tools.len(),
                "Specialized agent profile loaded"
            );
            Some(profile)
        }
        None => None,
    };
    let (effective_provider, effective_model) = resolve_provider_and_model(
        agent_profile
            .as_ref()
            .and_then(|profile| profile.provider.as_deref())
            .or(Some(cli_provider.as_str())),
        agent_profile
            .as_ref()
            .and_then(|profile| profile.model.as_deref())
            .or(Some(cli_model.as_str())),
    );
    let effective_append_prompt =
        compose_append_prompt(cli_append_prompt.as_deref(), agent_profile.as_ref());

    let provider: Arc<dyn LlmProvider> = match effective_provider.to_lowercase().as_str() {
        "openai-codex" | "codex" | "chatgpt" => Arc::new(CodexProvider::new()),
        "anthropic" => {
            let key = required_api_key("ANTHROPIC_API_KEY")?;
            let base_url =
                configured_base_url(cli.base_url.as_deref(), "https://api.anthropic.com/v1");
            Arc::new(AnthropicProvider::new(key, Some(base_url)))
        }
        "gemini" | "google" => {
            let key = required_api_key("GEMINI_API_KEY")?;
            let base_url = configured_base_url(
                cli.base_url.as_deref(),
                "https://generativelanguage.googleapis.com/v1beta",
            );
            Arc::new(GeminiProvider::new_with_base_url(key, Some(base_url)))
        }
        "fireworks" => {
            let key = required_api_key("FIREWORKS_API_KEY")?;
            let base_url = configured_base_url(
                cli.base_url.as_deref(),
                "https://api.fireworks.ai/inference/v1",
            );
            Arc::new(OpenAiProvider::new_named(
                key,
                Some(base_url),
                "FIREWORKS_API_KEY",
                "fireworks",
                "Fireworks",
            ))
        }
        "ollama-cloud" | "ollama_cloud" => {
            let key = required_api_key("OLLAMA_API_KEY")?;
            let base_url = configured_base_url(cli.base_url.as_deref(), "https://ollama.com/v1");
            Arc::new(OpenAiProvider::new_named(
                key,
                Some(base_url),
                "OLLAMA_API_KEY",
                "ollama-cloud",
                "Ollama Cloud",
            ))
        }
        "cerebras" => {
            let key = required_api_key("CEREBRAS_API_KEY")?;
            let base_url =
                configured_base_url(cli.base_url.as_deref(), "https://api.cerebras.ai/v1");
            Arc::new(OpenAiProvider::new_named(
                key,
                Some(base_url),
                "CEREBRAS_API_KEY",
                "cerebras",
                "Cerebras",
            ))
        }
        "groq" => {
            let key = required_api_key("GROQ_API_KEY")?;
            let base_url =
                configured_base_url(cli.base_url.as_deref(), "https://api.groq.com/openai/v1");
            Arc::new(OpenAiProvider::new_named(
                key,
                Some(base_url),
                "GROQ_API_KEY",
                "groq",
                "Groq",
            ))
        }
        "openrouter" => {
            let key = required_api_key("OPENROUTER_API_KEY")?;
            let base_url =
                configured_base_url(cli.base_url.as_deref(), DEFAULT_OPENROUTER_BASE_URL);
            Arc::new(OpenRouterProvider::new(key, Some(base_url)))
        }
        "ollama" => {
            let base_url =
                configured_base_url(cli.base_url.as_deref(), "http://localhost:11434/v1");
            Arc::new(OpenAiProvider::new_named(
                "",
                Some(base_url),
                "OLLAMA_API_KEY",
                "ollama",
                "Ollama",
            ))
        }
        "openai" | _ => {
            let key = required_api_key("OPENAI_API_KEY")?;
            let base_url =
                configured_base_url(cli.base_url.as_deref(), "https://api.openai.com/v1");
            Arc::new(OpenAiProvider::new(key, Some(base_url)))
        }
    };

    if cli.text_only {
        run_text_only(provider, &cli, &effective_model).await?;
        return Ok(());
    }

    let project_free_memory_dir = cli.no_workspace_context.then(|| {
        Path::new(&cli.cwd)
            .join(".axle")
            .join("project-free-memory")
    });
    let memory_store = std::sync::Arc::new(tokio::sync::Mutex::new(
        MemoryStore::load(&cli.cwd, project_free_memory_dir.as_deref()).await?,
    ));
    let mut tool_registry = if cli.no_workspace_context {
        ToolRegistry::with_project_free(axle_config::ToolOutputLimits::default())
    } else {
        ToolRegistry::with_memory_store(
            axle_config::ToolOutputLimits::default(),
            memory_store.clone(),
        )
    };
    tool_registry.set_execution_target(Arc::new(LocalExecutionTarget::with_shell_program(
        cli.shell.as_deref(),
    )));
    let execution_target = tool_registry.execution_target();
    tracing::info!(
        target_id = execution_target.id(),
        target_description = %execution_target.describe(),
        "Execution target ready"
    );
    if !cli.no_workspace_context {
        if let Some(mcp_url) = cli.mcp_url.as_deref() {
            let (header_name, token_variable) = if let Some(header_name) =
                cli.mcp_header_name.as_deref()
            {
                let token_variable = cli
                    .mcp_header_env_var
                    .as_deref()
                    .expect("clap validates custom MCP header requirements");
                (header_name, token_variable)
            } else {
                let token_variable = cli
                    .mcp_bearer_token_env_var
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("--mcp-url requires --mcp-bearer-token-env-var or --mcp-header-name with --mcp-header-env-var"))?;
                ("Authorization", token_variable)
            };
            let token = required_api_key(token_variable)?;
            let header_value = if header_name == "Authorization" {
                format!("Bearer {}", token)
            } else {
                token
            };
            let tool_count = register_http_mcp_tools_with_header(
                &mut tool_registry,
                mcp_url,
                header_name,
                &header_value,
            )
            .await?;
            tracing::info!(mcp_url, tool_count, "Loaded HTTP MCP tools");
        }
        if let Some(program) = cli.mcp_stdio_program.as_deref() {
            let tool_count =
                register_stdio_mcp_tools(&mut tool_registry, program, &cli.mcp_stdio_arg).await?;
            tracing::info!(program, tool_count, "Loaded stdio MCP tools");
        }
        if cli.github_mcp {
            let token = ["GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_TOKEN"]
                .iter()
                .find_map(|name| env::var(name).ok().filter(|value| !value.trim().is_empty()))
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "--github-mcp requires GITHUB_PERSONAL_ACCESS_TOKEN (or GITHUB_TOKEN). \
                         Create a fine-grained token with repository access at \
                         https://github.com/settings/personal-access-tokens"
                    )
                })?;
            let tool_count = register_http_mcp_tools_with_header(
                &mut tool_registry,
                "https://api.githubcopilot.com/mcp/",
                "Authorization",
                &format!("Bearer {}", token.trim()),
            )
            .await?;
            tracing::info!(tool_count, "Loaded GitHub MCP tools");
        }
    }
    let extension_runner = if !cli.no_workspace_context {
        if let Some(extension_path) = cli.extension.as_deref() {
            let runner = JsExtensionRunner::new();
            runner
                .load_extension_file(Path::new(extension_path))
                .await?;
            let tool_count = runner.register_tools(&mut tool_registry).await?;
            tracing::info!(
                extension_path,
                tool_count,
                "Loaded JavaScript extension API"
            );
            Some(runner)
        } else {
            None
        }
    } else {
        None
    };
    // Apply the agent tool policy last so it covers built-ins, MCP tools and
    // extension tools alike.
    if let Some(profile) = agent_profile.as_ref() {
        tool_registry.restrict_to(&profile.allowed_tools);
    }
    let mut event_bus = EventBus::new();

    if let Some(runner) = extension_runner.clone() {
        event_bus.subscribe(move |event| {
            if let Err(error) = runner.emit_event_nowait(event) {
                tracing::error!("Failed to dispatch event to JavaScript extension: {error}");
            }
        });
    }

    if cli.json_stream {
        event_bus.subscribe(|event| match event {
            AxleEvent::ToolExecutionStart {
                tool_call_id,
                tool_name,
                arguments,
            } if !is_hidden_control_tool(tool_name) => write_json_line(serde_json::json!({
                "type": "tool.started",
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "arguments": arguments,
            })),
            AxleEvent::ToolExecutionEnd {
                tool_call_id,
                tool_name,
                output,
                is_error,
                duration_ms,
                timed_out,
            } if !is_hidden_control_tool(tool_name) => write_json_line(serde_json::json!({
                "type": "tool.completed",
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "output": output,
                "isError": is_error,
                "durationMs": duration_ms,
                "timedOut": timed_out,
            })),
            AxleEvent::UsageUpdate {
                prompt_tokens,
                completion_tokens,
                total_tokens,
                cumulative_total_tokens,
            } => write_json_line(serde_json::json!({
                "type": "usage",
                "promptTokens": prompt_tokens,
                "completionTokens": completion_tokens,
                "totalTokens": total_tokens,
                "cumulativeTotalTokens": cumulative_total_tokens,
            })),
            AxleEvent::ToolApprovalRequested {
                request_id,
                tool_call_id,
                tool_name,
                arguments,
                timeout_seconds,
            } => write_json_line(serde_json::json!({
                "type": "approval.requested",
                "requestId": request_id,
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "arguments": arguments,
                "timeoutSeconds": timeout_seconds,
            })),
            AxleEvent::ToolApprovalResolved {
                request_id,
                tool_call_id,
                tool_name,
                decision,
                reason,
            } => write_json_line(serde_json::json!({
                "type": "approval.resolved",
                "requestId": request_id,
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "decision": decision,
                "reason": reason,
            })),
            _ => {}
        });
    } else if !cli.json {
        event_bus.subscribe(|event| match event {
            AxleEvent::TurnStart { turn_index } => {
                println!("--- Turn {} ---", turn_index);
            }
            AxleEvent::ToolExecutionStart {
                tool_name,
                arguments,
                ..
            } if !is_hidden_control_tool(tool_name) => {
                println!("Tool Call [{}] args: {}", tool_name, arguments);
            }
            AxleEvent::ToolExecutionEnd {
                tool_name,
                is_error,
                output,
                duration_ms,
                timed_out,
                ..
            } if !is_hidden_control_tool(tool_name) => {
                let status = if *timed_out {
                    "TIMED OUT"
                } else if *is_error {
                    "FAILED"
                } else {
                    "OK"
                };
                let duration = format_duration_ms(*duration_ms);
                let snippet = output_snippet(output, 300);
                if *is_error {
                    eprintln!("Tool [{}] status: {} after {}", tool_name, status, duration);
                    eprintln!("   Output snippet: {}", snippet);
                } else {
                    println!("Tool [{}] status: {} in {}", tool_name, status, duration);
                    println!("   Output snippet: {}", snippet);
                }
            }
            AxleEvent::ToolApprovalRequested {
                tool_name,
                timeout_seconds,
                ..
            } => {
                eprintln!(
                    "Approval required for tool [{}]. Waiting up to {}s for a decision via the approval file.",
                    tool_name, timeout_seconds
                );
            }
            AxleEvent::ToolApprovalResolved {
                tool_name,
                decision,
                reason,
                ..
            } => {
                eprintln!(
                    "Approval for tool [{}] resolved: {} ({})",
                    tool_name, decision, reason
                );
            }
            _ => {}
        });
    }

    let mut session = match cli.session.as_deref() {
        Some(session_id) => SessionManager::load(&cli.cwd, session_id).await?,
        None => SessionManager::create_new(&cli.cwd, None).await?,
    };
    if !cli.json && !cli.json_stream {
        println!(
            "Axle AI Agent initialized. Session ID: {}",
            session.session_id()
        );
    } else if cli.json_stream {
        // Publish the durable session identity before the first provider call.
        // The desktop can then reuse the same session if this one-shot process
        // loses its terminal result after the session file was created.
        write_json_line(serde_json::json!({
            "type": "session",
            "sessionId": session.session_id(),
        }));
    }

    let interaction_mode = match cli.interaction_mode.as_str() {
        "plan" => InteractionMode::Plan,
        _ => InteractionMode::Build,
    };
    // The desktop supplies provider/model metadata through --context-window.
    // The standalone CLI has no discovery handshake before its first request,
    // so this conservative value is only a local compaction estimate when
    // metadata is unavailable; it is not advertised as provider capacity.
    let context_window_tokens = parse_context_window_tokens(cli.context_window.as_deref())?
        .or(Some(DEFAULT_CONTEXT_WINDOW_TOKENS));

    const DEFAULT_PROMPT: &str = "Summarize your available tools and environment.";
    let prompt_from_stdin = if cli.prompt_stdin {
        let mut prompt = String::new();
        tokio::io::stdin().read_to_string(&mut prompt).await?;
        anyhow::ensure!(!prompt.trim().is_empty(), "Prompt stdin was empty");
        Some(prompt)
    } else {
        None
    };
    let prompt = prompt_from_stdin
        .as_deref()
        .or(cli.prompt.as_deref())
        .unwrap_or(DEFAULT_PROMPT);
    let memory_context = if cli.no_workspace_context {
        None
    } else {
        let context = memory_store.lock().await.render_context(prompt);
        (!context.is_empty()).then_some(context)
    };

    let loop_options = AgentLoopOptions {
        cwd: cli.cwd.clone(),
        workspace_context: !cli.no_workspace_context,
        model_name: effective_model.clone(),
        temperature: Some(0.7),
        reasoning_effort: cli.effort.clone(),
        append_system_prompt: effective_append_prompt.clone(),
        context_window_tokens,
        memory_context,
        interaction_mode,
        approval: cli.approval_file.as_ref().map(|file| ApprovalConfig {
            file: PathBuf::from(file),
            timeout: StdDuration::from_secs(cli.approval_timeout_seconds),
        }),
    };

    let agent_loop = AgentLoop::new(provider, tool_registry, event_bus, loop_options);

    let image_parts = load_image_parts(&cli.image_paths, &cli.image_mime_types).await?;
    if !cli.json && !cli.json_stream {
        if cli.prompt.is_some() {
            println!("\nUser Prompt: {}\n", prompt);
        } else {
            println!("\nNo prompt supplied. Running default Axle status check...\n");
        }
    }

    let interrupted = tokio::select! {
        result = async {
            if prompt.trim().eq_ignore_ascii_case("/compact") {
                let compacted = agent_loop.compact_session(&mut session).await?;
                Ok(if compacted {
                    "Context compacted.".to_string()
                } else {
                    "Context was already compact.".to_string()
                })
            } else {
                run_prompt(
                    &agent_loop,
                    &mut session,
                    prompt,
                    image_parts,
                    cli.json_stream,
                    !cli.json && !cli.json_stream,
                )
                .await
            }
        } => {
            let result = result?;
            write_result(&cli, &result, session.session_id());
            false
        }
        signal = tokio::signal::ctrl_c() => {
            signal?;
            true
        }
    };

    if interrupted {
        session.save().await?;
        if cli.json_stream {
            write_json_line(serde_json::json!({
                "type": "shutdown",
                "message": "Interrupt received; session saved.",
                "sessionId": session.session_id(),
            }));
        } else if cli.json {
            eprintln!(
                "Interrupt received; session {} saved.",
                session.session_id()
            );
        } else {
            println!(
                "\nInterrupt received. Session {} saved. Exiting gracefully.",
                session.session_id()
            );
        }
    }

    Ok(())
}
