// Keep tool results useful without allowing a single command to dominate the
// model context or the durable session log.
pub const DEFAULT_TOOL_OUTPUT_LIMIT_BYTES: usize = 32_768;
pub const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 16_384;
pub const DEFAULT_CONTEXT_WINDOW_TOKENS: usize = 128_000;

/// Relative to a workspace root: the file that declares specialized agent
/// profiles for `axle --agent <NAME>`.
pub const AGENT_PROFILES_RELATIVE_PATH: &str = ".axle/agents.toml";

/// Pre-rebrand profile locations, newest first; read only when the current
/// file does not exist.
const LEGACY_AGENT_PROFILES_RELATIVE_PATHS: &[&str] =
    &[".rivet/agents.toml", ".sparky/agents.toml"];

/// A named specialized agent: instructions, provider/model preferences, and
/// the tool subset it may use.
///
/// Profiles come from `.axle/agents.toml`, are selected with `--agent`, and
/// are merged into one agent loop. They do not spawn processes or coordinate
/// peers — they configure the single loop Axle already runs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentProfile {
    /// Selection key for `--agent <NAME>`; `[A-Za-z0-9._-]` only.
    pub name: String,
    /// One-line human summary, shown in selection logs and the prompt.
    pub description: String,
    /// System instructions, wrapped in `<agent_instructions>` and appended to
    /// the built-in system prompt.
    pub instructions: String,
    /// Provider name from the same set `--provider` accepts. `None` keeps the
    /// CLI-selected provider.
    pub provider: Option<String>,
    /// Model ID. `None` keeps the CLI-selected model.
    pub model: Option<String>,
    /// Tool names this agent may use; empty or absent means every registered
    /// tool. Tools that return control to the user (for example `end_task`)
    /// stay available so an agent can still stop or ask.
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    /// Reserved for declared workflow settings; unknown workflow keys are
    /// rejected at parse time so a typo cannot silently do nothing.
    #[serde(default)]
    pub workflow: AgentWorkflowSettings,
}

impl AgentProfile {
    /// The text appended to the built-in system prompt for this profile.
    pub fn system_prompt_fragment(&self) -> String {
        format!(
            "<agent_profile name=\"{}\">\n{}\n\n{}\n</agent_profile>",
            self.name, self.description, self.instructions
        )
    }
}

/// Optional workflow settings a profile may declare. Empty today; the struct
/// exists so the file format can grow without breaking existing files.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentWorkflowSettings {}

/// Hand-written so an unknown workflow key is a parse error instead of being
/// silently ignored (an empty derived struct accepts any key).
impl<'de> serde::Deserialize<'de> for AgentWorkflowSettings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct RejectAnyKey;

        impl<'de> serde::de::Visitor<'de> for RejectAnyKey {
            type Value = AgentWorkflowSettings;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an empty [agents.workflow] table")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::MapAccess<'de>,
            {
                if let Some(key) = map.next_key::<String>()? {
                    return Err(serde::de::Error::unknown_field(&key, &[]));
                }
                Ok(AgentWorkflowSettings {})
            }
        }

        deserializer.deserialize_map(RejectAnyKey)
    }
}

/// The parsed contents of `.axle/agents.toml`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct AgentsConfig {
    pub agents: Vec<AgentProfile>,
}

impl std::str::FromStr for AgentsConfig {
    type Err = toml::de::Error;

    fn from_str(contents: &str) -> Result<Self, Self::Err> {
        toml::from_str(contents)
    }
}

impl AgentsConfig {
    /// Parse `.axle/agents.toml` text and validate every profile.
    pub fn parse(contents: &str) -> anyhow::Result<Self> {
        let config = contents.parse::<Self>()?;
        config.validate()?;
        Ok(config)
    }

    /// Load and validate `.axle/agents.toml` from a workspace root.
    pub fn load(workspace_root: &str) -> anyhow::Result<Self> {
        let path = std::path::Path::new(workspace_root).join(AGENT_PROFILES_RELATIVE_PATH);
        let contents = match std::fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(primary_error) => {
                let mut legacy = None;
                for relative in LEGACY_AGENT_PROFILES_RELATIVE_PATHS {
                    let candidate = std::path::Path::new(workspace_root).join(relative);
                    if let Ok(contents) = std::fs::read_to_string(&candidate) {
                        legacy = Some(contents);
                        break;
                    }
                }
                legacy.ok_or_else(|| {
                    anyhow::anyhow!("Could not read {}: {primary_error}", path.display())
                })?
            }
        };
        Self::parse(&contents)
    }

    pub fn get(&self, name: &str) -> Option<&AgentProfile> {
        self.agents.iter().find(|agent| agent.name == name)
    }

    fn validate(&self) -> anyhow::Result<()> {
        let mut seen = std::collections::HashSet::new();
        for agent in &self.agents {
            anyhow::ensure!(!agent.name.trim().is_empty(), "agent name cannot be empty");
            anyhow::ensure!(
                agent
                    .name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')),
                "agent name '{}' may only contain letters, digits, '-', '_' and '.'",
                agent.name
            );
            anyhow::ensure!(
                seen.insert(agent.name.as_str()),
                "duplicate agent name '{}'",
                agent.name
            );
            anyhow::ensure!(
                !agent.instructions.trim().is_empty(),
                "agent '{}' has empty instructions",
                agent.name
            );
            anyhow::ensure!(
                !agent.description.trim().is_empty(),
                "agent '{}' has an empty description",
                agent.name
            );
            for tool in &agent.allowed_tools {
                anyhow::ensure!(
                    !tool.trim().is_empty(),
                    "agent '{}' lists an empty allowed tool name",
                    agent.name
                );
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolOutputLimits {
    pub read_bytes: usize,
    pub bash_bytes: usize,
}

impl Default for ToolOutputLimits {
    fn default() -> Self {
        Self {
            read_bytes: DEFAULT_TOOL_OUTPUT_LIMIT_BYTES,
            bash_bytes: DEFAULT_TOOL_OUTPUT_LIMIT_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AxleConfig {
    pub tool_output_limits: ToolOutputLimits,
    pub default_max_output_tokens: u32,
    pub default_context_window_tokens: usize,
}

impl Default for AxleConfig {
    fn default() -> Self {
        Self {
            tool_output_limits: ToolOutputLimits::default(),
            default_max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
            default_context_window_tokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
        }
    }
}

pub fn max_output_tokens_for_model(model: &str) -> u32 {
    let model = model.to_ascii_lowercase();
    if model.contains("gpt-4o") {
        16_384
    } else if model.contains("claude-3-5-sonnet") || model.contains("gemini-1.5") {
        8_192
    } else {
        DEFAULT_MAX_OUTPUT_TOKENS
    }
}

/// What a model family accepts on the wire. The agent loop consults this
/// before forwarding optional request parameters, so a parameter the model
/// rejects is dropped locally instead of failing at the provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelCapabilities {
    /// Sampling temperature is accepted.
    pub supports_temperature: bool,
    /// A reasoning-effort hint is accepted.
    pub supports_reasoning_effort: bool,
    /// Tool/function schemas are accepted.
    pub supports_tools: bool,
    /// Image content parts are accepted.
    pub supports_images: bool,
}

impl ModelCapabilities {
    pub const fn standard() -> Self {
        Self {
            supports_temperature: true,
            supports_reasoning_effort: true,
            supports_tools: true,
            supports_images: true,
        }
    }

    /// Reasoning-first families (OpenAI o-series, GPT-5+) reject sampling
    /// parameters such as temperature.
    pub const fn reasoning() -> Self {
        Self {
            supports_temperature: false,
            supports_reasoning_effort: true,
            supports_tools: true,
            supports_images: true,
        }
    }
}

/// Model-family behavior keyed off the model id, kept beside
/// [`max_output_tokens_for_model`] so the runtime has one catalogue of model
/// knowledge. Providers can still override through their trait impl.
pub fn model_capabilities(model: &str) -> ModelCapabilities {
    let model = model.to_ascii_lowercase();
    let reasoning_family = model.starts_with("gpt-5")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4");
    if reasoning_family {
        ModelCapabilities::reasoning()
    } else {
        ModelCapabilities::standard()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_models_get_specific_output_limits() {
        assert_eq!(max_output_tokens_for_model("gpt-4o"), 16_384);
        assert_eq!(
            max_output_tokens_for_model("claude-3-5-sonnet-latest"),
            8_192
        );
        assert_eq!(
            max_output_tokens_for_model("unknown"),
            DEFAULT_MAX_OUTPUT_TOKENS
        );
    }

    #[test]
    fn reasoning_families_drop_sampling_temperature() {
        assert!(!model_capabilities("gpt-5.6-sol").supports_temperature);
        assert!(model_capabilities("gpt-5.6-sol").supports_reasoning_effort);
        assert!(!model_capabilities("o3-mini").supports_temperature);
        assert!(!model_capabilities("o4-mini").supports_temperature);
        assert!(model_capabilities("gpt-4o").supports_temperature);
        assert!(model_capabilities("anthropic/claude-3.5-sonnet").supports_temperature);
    }

    const REVIEWER_PROFILE: &str = r#"
[[agents]]
name = "reviewer"
description = "Read-only code reviewer"
instructions = """
Review diffs for correctness. Never edit files.
"""
provider = "anthropic"
model = "claude-3-5-sonnet-latest"
allowed_tools = ["read", "grep", "find", "ls"]

[[agents]]
name = "doc-writer"
description = "Documentation writer"
instructions = "Write and update documentation only."
"#;

    #[test]
    fn agent_profiles_parse_optional_fields() {
        let config = AgentsConfig::parse(REVIEWER_PROFILE).expect("profile config parses");

        let reviewer = config.get("reviewer").expect("reviewer profile");
        assert_eq!(reviewer.description, "Read-only code reviewer");
        assert_eq!(reviewer.provider.as_deref(), Some("anthropic"));
        assert_eq!(reviewer.model.as_deref(), Some("claude-3-5-sonnet-latest"));
        assert_eq!(reviewer.allowed_tools, vec!["read", "grep", "find", "ls"]);
        assert!(reviewer.instructions.contains("Never edit files"));

        let doc_writer = config.get("doc-writer").expect("doc-writer profile");
        assert!(doc_writer.provider.is_none());
        assert!(doc_writer.model.is_none());
        assert!(doc_writer.allowed_tools.is_empty());
    }

    #[test]
    fn agent_prompt_fragment_names_the_profile_and_keeps_instructions() {
        let config = AgentsConfig::parse(REVIEWER_PROFILE).unwrap();
        let fragment = config.get("reviewer").unwrap().system_prompt_fragment();

        assert!(fragment.starts_with("<agent_profile name=\"reviewer\">"));
        assert!(fragment.contains("Read-only code reviewer"));
        assert!(fragment.contains("Never edit files"));
        assert!(fragment.ends_with("</agent_profile>"));
    }

    #[test]
    fn agent_profile_validation_rejects_bad_configs() {
        let cases = [
            (
                "duplicate names",
                r#"
[[agents]]
name = "dup"
description = "One"
instructions = "Do one thing."

[[agents]]
name = "dup"
description = "Two"
instructions = "Do another thing."
"#,
                "duplicate agent name 'dup'",
            ),
            (
                "empty instructions",
                r#"
[[agents]]
name = "blank"
description = "No instructions"
instructions = "   "
"#,
                "agent 'blank' has empty instructions",
            ),
            (
                "invalid name characters",
                r#"
[[agents]]
name = "bad name!"
description = "Invalid"
instructions = "Do something."
"#,
                "agent name 'bad name!' may only contain",
            ),
            (
                "empty allowed tool entry",
                r#"
[[agents]]
name = "tool-list"
description = "Blank tool entry"
instructions = "Do something."
allowed_tools = ["read", " "]
"#,
                "agent 'tool-list' lists an empty allowed tool name",
            ),
        ];

        for (label, contents, expected) in cases {
            let error = AgentsConfig::parse(contents).expect_err(label);
            assert!(
                error.to_string().contains(expected),
                "{label}: error was {error}"
            );
        }
    }

    #[test]
    fn agent_profiles_reject_unknown_fields() {
        let error = AgentsConfig::parse(
            r#"
[[agents]]
name = "typo"
description = "Has a misspelled key"
instructions = "Do something."
allowed_tool = ["read"]
"#,
        )
        .expect_err("unknown field must fail");

        assert!(
            error.to_string().contains("allowed_tool"),
            "error was {error}"
        );

        let nested_error = AgentsConfig::parse(
            r#"
[[agents]]
name = "nested-typo"
description = "Has a misspelled workflow key"
instructions = "Do something."

[agents.workflow]
retiries = 2
"#,
        )
        .expect_err("unknown nested workflow field must fail");

        assert!(
            nested_error.to_string().contains("retiries"),
            "error was {nested_error}"
        );
    }
}
