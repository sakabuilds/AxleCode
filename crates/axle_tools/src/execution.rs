//! Execution target boundary (brief section 8).
//!
//! The runtime never spawns a shell directly: the `bash` tool builds an
//! [`ExecutionRequest`] and hands it to an [`ExecutionTarget`]. The only target
//! implemented today is [`LocalExecutionTarget`], which runs commands on the
//! machine that runs the agent. Isolated sandboxes, remote workers and cloud
//! runners are *not* implemented; this contract exists so execution location
//! is not hardcoded into the agent loop when they arrive.
//!
//! # Security boundaries (explicit)
//!
//! - The local target runs commands with the same privileges, environment and
//!   filesystem access as the agent process, in the working directory the
//!   caller passes. It adds no confinement of its own.
//! - `bash` requires explicit user approval before every execution
//!   (`Tool::requires_approval`); that approval gate, not this target, is the
//!   confinement boundary for command execution today.
//! - Credentials: the local target inherits the agent process environment.
//!   [`ExecutionRequest::env`] exists so a future target receives exactly the
//!   variables it should have; nothing forwards the parent environment to a
//!   non-local target implicitly.
//! - Cancellation: dropping the `execute` future (registry timeout, Ctrl-C)
//!   kills the local child process (`kill_on_drop`). A remote target must
//!   implement its own cancellation and report it through this contract.
//! - Resource limits: the contract carries a wall-clock `timeout` only. CPU,
//!   memory, disk and network limits are per-target policy and are not modeled
//!   yet; the local target adds none.

use async_trait::async_trait;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout as tokio_timeout;

/// Environment variable that overrides the local shell program, e.g.
/// `AXLE_SHELL=bash`.
pub const SHELL_ENV_VAR: &str = "AXLE_SHELL";

/// A command to execute plus the context it needs.
#[derive(Debug, Clone)]
pub struct ExecutionRequest {
    /// Command line. Interpretation is the target's business: the local target
    /// passes it to a shell, while a stricter target may accept only a
    /// narrower grammar.
    pub command: String,
    /// Working directory. On the local target this is a path on this machine;
    /// a remote target interprets it inside its own workspace.
    pub cwd: String,
    /// Wall-clock limit; targets must stop the command when it fires.
    pub timeout: Duration,
    /// Extra environment variables for the command, layered over whatever the
    /// target already provides.
    pub env: BTreeMap<String, String>,
}

impl ExecutionRequest {
    pub fn new(command: impl Into<String>, cwd: impl Into<String>, timeout: Duration) -> Self {
        Self {
            command: command.into(),
            cwd: cwd.into(),
            timeout,
            env: BTreeMap::new(),
        }
    }

    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(key.into(), value.into());
        self
    }
}

/// What a target returns when the command ran (or its timeout fired).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionOutcome {
    /// Process exit code; `None` when the process was killed (signal or
    /// timeout) instead of exiting on its own.
    pub exit_code: Option<i32>,
    pub stdout: String,
    /// May be partial when `timed_out` is true.
    pub stderr: String,
    pub timed_out: bool,
}

impl ExecutionOutcome {
    /// True when the command ran to completion with exit code 0.
    pub fn succeeded(&self) -> bool {
        !self.timed_out && self.exit_code == Some(0)
    }
}

/// Infrastructure-level failure: the command did not run to a result.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ExecutionError {
    /// The target could not start the process (missing shell program,
    /// permissions, ...).
    #[error("failed to spawn process: {message}")]
    Spawn { message: String },
    /// The process started but the target could not run or collect it.
    #[error("command execution error: {message}")]
    Io { message: String },
    /// The target could not reach its execution environment (for future
    /// remote targets; the local target never produces this).
    #[error("execution environment unreachable: {message}")]
    Unreachable { message: String },
    /// The target refused the request under its own policy (for future
    /// sandboxed targets; the local target never produces this).
    #[error("execution rejected by target policy: {message}")]
    Rejected { message: String },
}

/// Where and how a command runs. Implemented today only by
/// [`LocalExecutionTarget`].
#[async_trait]
pub trait ExecutionTarget: Send + Sync {
    /// Stable identifier, e.g. `"local"`. Used in error messages and logs.
    fn id(&self) -> &str;
    /// One human-readable line describing where and how commands run.
    fn describe(&self) -> String;
    /// Run the command. `Ok` means the command produced a result, including a
    /// non-zero exit code or a timeout; `Err` means the target could not
    /// produce a result at all.
    async fn execute(&self, request: ExecutionRequest) -> Result<ExecutionOutcome, ExecutionError>;
}

/// How a shell program receives the command string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellInvocation {
    /// `<program> <flag> <command>`, e.g. `sh -c`, `bash -c`.
    CommandFlag(&'static str),
    /// `<program> -NoProfile -Command <command>` (Windows PowerShell / pwsh).
    PowerShell,
    /// `<program> /C <command>` (cmd.exe).
    Cmd,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ShellProgram {
    program: String,
    invocation: ShellInvocation,
}

impl ShellProgram {
    fn from_name(program: &str) -> Self {
        let name = Path::new(program)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(program)
            .to_ascii_lowercase();
        let invocation = match name.as_str() {
            "powershell" | "pwsh" => ShellInvocation::PowerShell,
            "cmd" => ShellInvocation::Cmd,
            _ => ShellInvocation::CommandFlag("-c"),
        };
        Self {
            program: program.to_string(),
            invocation,
        }
    }

    fn platform_default() -> Self {
        if cfg!(windows) {
            Self::from_name("powershell")
        } else {
            Self::from_name("sh")
        }
    }

    /// First non-empty of `explicit`, `env_override`, platform default.
    fn resolve(explicit: Option<&str>, env_override: Option<&str>) -> Self {
        let chosen = explicit
            .into_iter()
            .chain(env_override)
            .find(|program| !program.trim().is_empty());
        match chosen {
            Some(program) => Self::from_name(program.trim()),
            None => Self::platform_default(),
        }
    }

    fn description(&self) -> String {
        match self.invocation {
            ShellInvocation::CommandFlag(flag) => format!("{} {} <command>", self.program, flag),
            ShellInvocation::PowerShell => {
                format!("{} -NoProfile -Command <command>", self.program)
            }
            ShellInvocation::Cmd => format!("{} /C <command>", self.program),
        }
    }

    fn build_command(&self, command: &str) -> Command {
        let mut cmd = Command::new(&self.program);
        match self.invocation {
            ShellInvocation::CommandFlag(flag) => {
                cmd.arg(flag).arg(command);
            }
            ShellInvocation::PowerShell => {
                cmd.args(["-NoProfile", "-Command"]).arg(command);
            }
            ShellInvocation::Cmd => {
                cmd.arg("/C").arg(command);
            }
        }
        cmd
    }
}

/// Runs commands on the local machine through a shell program.
///
/// Shell resolution order (first non-empty wins): an explicit program passed
/// to [`LocalExecutionTarget::with_shell_program`], the `AXLE_SHELL`
/// environment variable, then the platform default (`powershell` on Windows,
/// `sh` elsewhere).
#[derive(Debug, Clone)]
pub struct LocalExecutionTarget {
    shell: ShellProgram,
}

impl LocalExecutionTarget {
    /// Platform default with no environment override (deterministic; used by
    /// tests and callers that already resolved their shell).
    pub fn platform_default() -> Self {
        Self {
            shell: ShellProgram::platform_default(),
        }
    }

    /// Resolve a shell: explicit program first, then `AXLE_SHELL`, then the
    /// platform default.
    pub fn with_shell_program(program: Option<&str>) -> Self {
        let env_override = std::env::var(SHELL_ENV_VAR).ok();
        Self {
            shell: ShellProgram::resolve(program, env_override.as_deref()),
        }
    }

    /// `with_shell_program(None)`: honours `AXLE_SHELL`, then the platform
    /// default. This is the shell the agent runtime uses by default.
    pub fn from_env() -> Self {
        Self::with_shell_program(None)
    }

    /// Shell that will run commands, e.g. `powershell`, `/usr/bin/bash`.
    pub fn shell_program(&self) -> &str {
        &self.shell.program
    }

    /// Shell invocation shape, e.g. `powershell -NoProfile -Command <command>`.
    pub fn shell_description(&self) -> String {
        self.shell.description()
    }
}

impl Default for LocalExecutionTarget {
    fn default() -> Self {
        Self::from_env()
    }
}

#[async_trait]
impl ExecutionTarget for LocalExecutionTarget {
    fn id(&self) -> &str {
        "local"
    }

    fn describe(&self) -> String {
        format!("local machine, shell: {}", self.shell.description())
    }

    async fn execute(&self, request: ExecutionRequest) -> Result<ExecutionOutcome, ExecutionError> {
        let mut cmd = self.shell.build_command(&request.command);
        cmd.current_dir(&request.cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if !request.env.is_empty() {
            cmd.envs(&request.env);
        }

        let child = cmd.spawn().map_err(|error| ExecutionError::Spawn {
            message: format!("{error} (shell '{}')", self.shell.program),
        })?;

        match tokio_timeout(request.timeout, child.wait_with_output()).await {
            Ok(Ok(output)) => Ok(ExecutionOutcome {
                exit_code: output.status.code(),
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                timed_out: false,
            }),
            Ok(Err(error)) => Err(ExecutionError::Io {
                message: format!("failed to collect command output: {error}"),
            }),
            Err(_) => {
                // Dropping the child kills it (`kill_on_drop`). Partial output
                // is not collected: it is buffered inside the killed process,
                // matching the historical bash tool behavior.
                Ok(ExecutionOutcome {
                    exit_code: None,
                    stdout: String::new(),
                    stderr: String::new(),
                    timed_out: true,
                })
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::sync::Arc;
    use std::sync::Mutex;

    /// Deterministic [`ExecutionTarget`] for tool-level tests: records the
    /// requests it receives and replays one canned result.
    pub(crate) struct RecordingTarget {
        result: Result<ExecutionOutcome, ExecutionError>,
        requests: Mutex<Vec<ExecutionRequest>>,
    }

    impl RecordingTarget {
        pub(crate) fn new(outcome: ExecutionOutcome) -> Arc<Self> {
            Arc::new(Self {
                result: Ok(outcome),
                requests: Mutex::new(Vec::new()),
            })
        }

        pub(crate) fn failing(error: ExecutionError) -> Arc<Self> {
            Arc::new(Self {
                result: Err(error),
                requests: Mutex::new(Vec::new()),
            })
        }

        pub(crate) fn requests(&self) -> Vec<ExecutionRequest> {
            self.requests.lock().expect("recording target lock").clone()
        }
    }

    #[async_trait]
    impl ExecutionTarget for RecordingTarget {
        fn id(&self) -> &str {
            "recording"
        }

        fn describe(&self) -> String {
            "recording target (tests)".to_string()
        }

        async fn execute(
            &self,
            request: ExecutionRequest,
        ) -> Result<ExecutionOutcome, ExecutionError> {
            self.requests
                .lock()
                .expect("recording target lock")
                .push(request);
            self.result.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_resolution_prefers_explicit_then_env_then_platform() {
        let explicit = ShellProgram::resolve(Some("bash"), Some("pwsh"));
        assert_eq!(explicit.program, "bash");
        assert_eq!(explicit.invocation, ShellInvocation::CommandFlag("-c"));

        let from_env = ShellProgram::resolve(None, Some("pwsh"));
        assert_eq!(from_env.program, "pwsh");
        assert_eq!(from_env.invocation, ShellInvocation::PowerShell);

        let blank = ShellProgram::resolve(Some("   "), Some(""));
        assert_eq!(blank, ShellProgram::platform_default());
    }

    #[test]
    fn shell_invocation_shape_is_derived_from_program_name() {
        assert_eq!(
            ShellProgram::from_name("powershell").invocation,
            ShellInvocation::PowerShell
        );
        assert_eq!(
            ShellProgram::from_name("pwsh").invocation,
            ShellInvocation::PowerShell
        );
        assert_eq!(
            ShellProgram::from_name("cmd.exe").invocation,
            ShellInvocation::Cmd
        );
        assert_eq!(
            ShellProgram::from_name("bash").invocation,
            ShellInvocation::CommandFlag("-c")
        );
        assert_eq!(
            ShellProgram::from_name("/usr/bin/zsh").invocation,
            ShellInvocation::CommandFlag("-c")
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_shell_paths_resolve_by_file_name() {
        let shell =
            ShellProgram::from_name(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        assert_eq!(
            shell.program,
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        );
        assert_eq!(shell.invocation, ShellInvocation::PowerShell);
    }

    #[test]
    fn local_target_identity_and_description_match_the_shell() {
        let target = LocalExecutionTarget::with_shell_program(Some("bash"));
        assert_eq!(target.id(), "local");
        assert_eq!(target.shell_program(), "bash");
        assert!(target.describe().contains("bash -c <command>"));
    }

    #[tokio::test]
    async fn local_target_runs_commands_and_reports_exit_codes() {
        let target = LocalExecutionTarget::platform_default();
        let cwd = std::env::temp_dir().display().to_string();

        let ok = target
            .execute(ExecutionRequest::new(
                "echo axle-exec-ok",
                cwd.clone(),
                Duration::from_secs(30),
            ))
            .await
            .unwrap();
        assert!(
            ok.succeeded(),
            "stdout: {} stderr: {}",
            ok.stdout,
            ok.stderr
        );
        assert!(ok.stdout.contains("axle-exec-ok"));

        let failed = target
            .execute(ExecutionRequest::new(
                "exit 7",
                cwd,
                Duration::from_secs(30),
            ))
            .await
            .unwrap();
        assert_eq!(failed.exit_code, Some(7));
        assert!(!failed.succeeded());
        assert!(!failed.timed_out);
    }

    #[tokio::test]
    async fn local_target_keeps_stdout_and_stderr_separate() {
        let target = LocalExecutionTarget::platform_default();
        let command = if cfg!(windows) {
            "Write-Output axle-out; [Console]::Error.WriteLine('axle-err')"
        } else {
            "echo axle-out; echo axle-err >&2"
        };

        let outcome = target
            .execute(ExecutionRequest::new(
                command,
                std::env::temp_dir().display().to_string(),
                Duration::from_secs(30),
            ))
            .await
            .unwrap();

        assert!(
            outcome.stdout.contains("axle-out"),
            "stdout: {}",
            outcome.stdout
        );
        assert!(
            !outcome.stdout.contains("axle-err"),
            "stdout: {}",
            outcome.stdout
        );
        assert!(
            outcome.stderr.contains("axle-err"),
            "stderr: {}",
            outcome.stderr
        );
    }

    #[tokio::test]
    async fn local_target_passes_request_env_to_the_command() {
        let target = LocalExecutionTarget::platform_default();
        let command = if cfg!(windows) {
            "Write-Output $env:AXLE_EXEC_TEST"
        } else {
            "echo $AXLE_EXEC_TEST"
        };

        let outcome = target
            .execute(
                ExecutionRequest::new(
                    command,
                    std::env::temp_dir().display().to_string(),
                    Duration::from_secs(30),
                )
                .with_env("AXLE_EXEC_TEST", "axle-env-ok"),
            )
            .await
            .unwrap();

        assert!(
            outcome.stdout.contains("axle-env-ok"),
            "stdout: {}",
            outcome.stdout
        );
    }

    #[tokio::test]
    async fn local_target_runs_in_the_requested_directory() {
        let dir = tempfile::tempdir().unwrap();
        let expected = dir
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let target = LocalExecutionTarget::platform_default();
        let command = if cfg!(windows) {
            "(Get-Location).Path"
        } else {
            "pwd"
        };

        let outcome = target
            .execute(ExecutionRequest::new(
                command,
                dir.path().display().to_string(),
                Duration::from_secs(30),
            ))
            .await
            .unwrap();

        let reported = outcome.stdout.trim().to_lowercase();
        assert!(
            reported.ends_with(&expected.to_lowercase()),
            "expected {} in {:?}",
            expected,
            outcome.stdout
        );
    }

    #[tokio::test]
    async fn local_target_stops_commands_at_the_timeout() {
        let target = LocalExecutionTarget::platform_default();
        let command = if cfg!(windows) {
            "Start-Sleep -Seconds 30"
        } else {
            "sleep 30"
        };
        let started = std::time::Instant::now();

        let outcome = target
            .execute(ExecutionRequest::new(
                command,
                std::env::temp_dir().display().to_string(),
                Duration::from_millis(200),
            ))
            .await
            .unwrap();

        assert!(outcome.timed_out);
        assert_eq!(outcome.exit_code, None);
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "timeout was not enforced"
        );
    }

    #[tokio::test]
    async fn unknown_shell_program_reports_a_spawn_error() {
        let target = LocalExecutionTarget {
            shell: ShellProgram::from_name("axle-shell-that-does-not-exist"),
        };

        let error = target
            .execute(ExecutionRequest::new(
                "echo hi",
                ".",
                Duration::from_secs(5),
            ))
            .await
            .unwrap_err();

        match error {
            ExecutionError::Spawn { message } => {
                assert!(message.contains("axle-shell-that-does-not-exist"));
            }
            other => panic!("expected spawn error, got {other:?}"),
        }
    }
}
