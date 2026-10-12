use crate::execution::{ExecutionError, ExecutionRequest, ExecutionTarget, LocalExecutionTarget};
use crate::tool::{
    truncate_output, Tool, ToolExecutionMode, ToolExecutionResult, ToolTimeoutPolicy,
};
use async_trait::async_trait;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

pub struct BashTool {
    output_limit: usize,
    target: Arc<dyn ExecutionTarget>,
}

impl BashTool {
    /// Runs commands on the local machine. Registry-built tools use
    /// [`BashTool::with_target`] so the registry's execution target applies.
    pub fn new(output_limit: usize) -> Self {
        Self::with_target(output_limit, Arc::new(LocalExecutionTarget::from_env()))
    }

    /// Runs commands through an explicit execution target (section 8
    /// boundary). The registry rebuilds `bash` when its target is swapped.
    pub fn with_target(output_limit: usize, target: Arc<dyn ExecutionTarget>) -> Self {
        Self {
            output_limit,
            target,
        }
    }
}

impl Default for BashTool {
    fn default() -> Self {
        Self::new(axle_config::DEFAULT_TOOL_OUTPUT_LIMIT_BYTES)
    }
}

#[async_trait]
impl Tool for BashTool {
    fn name(&self) -> &str {
        "bash"
    }

    fn label(&self) -> &str {
        "Bash Terminal"
    }

    fn description(&self) -> &str {
        "Execute shell commands in the terminal (PowerShell/cmd on Windows, sh/bash on Unix)."
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Command line to execute"
                },
                "timeout_seconds": {
                    "type": "number",
                    "description": "Optional timeout in seconds (default: 300)"
                }
            },
            "required": ["command"]
        })
    }

    fn execution_mode(&self) -> ToolExecutionMode {
        ToolExecutionMode::Sequential
    }

    fn timeout_policy(&self) -> ToolTimeoutPolicy {
        ToolTimeoutPolicy::SelfManaged
    }

    fn requires_approval(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        args: serde_json::Value,
        cwd: &str,
    ) -> anyhow::Result<ToolExecutionResult> {
        let command_str = match args.get("command").and_then(|v| v.as_str()) {
            Some(cmd) => cmd,
            None => return Ok(ToolExecutionResult::error("Missing 'command' parameter")),
        };

        let timeout_secs = args
            .get("timeout_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(300);

        let request = ExecutionRequest::new(command_str, cwd, Duration::from_secs(timeout_secs));
        let outcome = match self.target.execute(request).await {
            Ok(outcome) => outcome,
            Err(ExecutionError::Spawn { message }) => {
                return Ok(ToolExecutionResult::error(format!(
                    "Failed to spawn command ({}): {}",
                    self.target.id(),
                    message
                )))
            }
            Err(other) => {
                return Ok(ToolExecutionResult::error(format!(
                    "Command execution error: {}",
                    other
                )))
            }
        };

        let mut combined = String::new();
        if !outcome.stdout.is_empty() {
            combined.push_str(&outcome.stdout);
        }
        if !outcome.stderr.is_empty() {
            if !combined.is_empty() {
                combined.push_str("\n--- STDERR ---\n");
            }
            combined.push_str(&outcome.stderr);
        }
        combined = truncate_output(combined, self.output_limit);

        if outcome.timed_out {
            let mut message = format!("Command timed out after {} seconds", timeout_secs);
            if !combined.is_empty() {
                message.push_str(":\n");
                message.push_str(&combined);
            }
            return Ok(ToolExecutionResult::timeout(message));
        }

        if outcome.exit_code == Some(0) {
            Ok(ToolExecutionResult::success(combined))
        } else {
            Ok(ToolExecutionResult::error(format!(
                "Command failed with exit code {:?}:\n{}",
                outcome.exit_code, combined
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::test_support::RecordingTarget;
    use crate::execution::ExecutionOutcome;

    fn outcome(
        stdout: &str,
        stderr: &str,
        exit_code: Option<i32>,
        timed_out: bool,
    ) -> ExecutionOutcome {
        ExecutionOutcome {
            exit_code,
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
            timed_out,
        }
    }

    #[tokio::test]
    async fn combines_stdout_and_stderr_with_a_separator() {
        let tool = BashTool::with_target(
            4096,
            RecordingTarget::new(outcome("out\n", "err\n", Some(0), false)),
        );

        let result = tool
            .execute(json!({ "command": "anything" }), "C:/workspace")
            .await
            .unwrap();

        assert!(!result.is_error, "output: {}", result.output);
        assert_eq!(result.output, "out\n\n--- STDERR ---\nerr\n");
    }

    #[tokio::test]
    async fn reports_failed_exit_codes() {
        let tool = BashTool::with_target(
            4096,
            RecordingTarget::new(outcome("", "boom", Some(3), false)),
        );

        let result = tool.execute(json!({ "command": "x" }), ".").await.unwrap();

        assert!(result.is_error);
        assert!(!result.timed_out);
        assert!(
            result
                .output
                .starts_with("Command failed with exit code Some(3):"),
            "output: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn reports_timeouts_with_the_configured_seconds() {
        let tool = BashTool::with_target(4096, RecordingTarget::new(outcome("", "", None, true)));

        let result = tool
            .execute(json!({ "command": "x", "timeout_seconds": 5 }), ".")
            .await
            .unwrap();

        assert!(result.is_error);
        assert!(result.timed_out);
        assert_eq!(result.output, "Command timed out after 5 seconds");
    }

    #[tokio::test]
    async fn includes_partial_output_when_a_target_reports_it_on_timeout() {
        let tool = BashTool::with_target(
            4096,
            RecordingTarget::new(outcome("partial line\n", "", None, true)),
        );

        let result = tool.execute(json!({ "command": "x" }), ".").await.unwrap();

        assert!(result.timed_out);
        assert_eq!(
            result.output,
            "Command timed out after 300 seconds:\npartial line\n"
        );
    }

    #[tokio::test]
    async fn spawn_failures_name_the_target() {
        let tool = BashTool::with_target(
            4096,
            RecordingTarget::failing(ExecutionError::Spawn {
                message: "no such shell".to_string(),
            }),
        );

        let result = tool.execute(json!({ "command": "x" }), ".").await.unwrap();

        assert!(result.is_error);
        assert_eq!(
            result.output,
            "Failed to spawn command (recording): no such shell"
        );
    }

    #[tokio::test]
    async fn other_target_errors_keep_their_message() {
        let tool = BashTool::with_target(
            4096,
            RecordingTarget::failing(ExecutionError::Rejected {
                message: "command denied by policy".to_string(),
            }),
        );

        let result = tool.execute(json!({ "command": "x" }), ".").await.unwrap();

        assert!(result.is_error);
        assert_eq!(
            result.output,
            "Command execution error: execution rejected by target policy: command denied by policy"
        );
    }

    #[tokio::test]
    async fn missing_command_is_reported_without_calling_the_target() {
        let target = RecordingTarget::new(outcome("", "", Some(0), false));
        let tool = BashTool::with_target(4096, target.clone());

        let result = tool.execute(json!({}), ".").await.unwrap();

        assert!(result.is_error);
        assert_eq!(result.output, "Missing 'command' parameter");
        assert!(target.requests().is_empty());
    }

    #[tokio::test]
    async fn requests_carry_cwd_and_the_default_timeout() {
        let target = RecordingTarget::new(outcome("", "", Some(0), false));
        let tool = BashTool::with_target(4096, target.clone());

        let _ = tool
            .execute(json!({ "command": "echo hi" }), "C:/workspace")
            .await
            .unwrap();

        let requests = target.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].command, "echo hi");
        assert_eq!(requests[0].cwd, "C:/workspace");
        assert_eq!(requests[0].timeout, Duration::from_secs(300));
        assert!(requests[0].env.is_empty());
    }

    #[tokio::test]
    async fn truncates_combined_output_at_the_configured_limit() {
        let tool = BashTool::with_target(
            8,
            RecordingTarget::new(outcome("0123456789", "", Some(0), false)),
        );

        let result = tool.execute(json!({ "command": "x" }), ".").await.unwrap();

        assert!(
            result.output.contains("truncated at 8 bytes"),
            "output: {}",
            result.output
        );
    }
}
