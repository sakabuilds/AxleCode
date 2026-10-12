use crate::{Tool, ToolExecutionResult, ToolRegistry};
use async_trait::async_trait;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::timeout;

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MAX_ERROR_BODY_CHARS: usize = 4_096;
const MAX_TOOL_OUTPUT_BYTES: usize = axle_config::DEFAULT_TOOL_OUTPUT_LIMIT_BYTES;
/// Per-request timeout for both MCP transports.
const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
/// Cold starts (e.g. `npx -y` downloading a package) get a longer budget.
const MCP_INITIALIZE_TIMEOUT: Duration = Duration::from_secs(120);
/// Cap for captured stderr diagnostics from a stdio server.
const MAX_STDERR_TAIL_CHARS: usize = 4_096;

fn initialize_params() -> Value {
    json!({
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": { "name": "axle", "version": env!("CARGO_PKG_VERSION") }
    })
}

#[derive(Clone)]
struct HttpMcpClient {
    inner: Arc<HttpMcpClientInner>,
}

struct HttpMcpClientInner {
    endpoint: String,
    auth_header_name: String,
    auth_header_value: String,
    /// Optional per the MCP spec: streamable HTTP servers may be stateless
    /// and omit `Mcp-Session-Id`, in which case none is sent back.
    session_id: Option<String>,
    client: reqwest::Client,
    next_request_id: AtomicU64,
}

/// One live MCP session, over either transport.
#[derive(Clone)]
enum McpConnection {
    Http(HttpMcpClient),
    Stdio(StdioMcpClient),
}

impl McpConnection {
    async fn request(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        match self {
            McpConnection::Http(client) => client.request(method, params).await,
            McpConnection::Stdio(client) => client.request(method, params).await,
        }
    }
}

#[derive(Clone)]
struct McpTool {
    name: String,
    description: String,
    parameters: Value,
    connection: McpConnection,
}

fn truncate_for_error(body: &str) -> String {
    body.chars().take(MAX_ERROR_BODY_CHARS).collect()
}

fn parse_json_rpc_body(body: &str) -> anyhow::Result<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        return Ok(value);
    }

    // Streamable HTTP transports may return a single JSON-RPC response in an
    // SSE data frame. Ignore comments/event metadata and parse the first data
    // payload that contains a response.
    for line in body.lines() {
        if let Some(data) = line.trim().strip_prefix("data:") {
            if let Ok(value) = serde_json::from_str::<Value>(data.trim()) {
                return Ok(value);
            }
        }
    }

    anyhow::bail!(
        "MCP server returned an invalid JSON-RPC response: {}",
        truncate_for_error(body)
    )
}

fn json_rpc_result(response: Value) -> anyhow::Result<Value> {
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("MCP request failed");
        anyhow::bail!("{}", message);
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("MCP response did not include a result"))
}

impl HttpMcpClient {
    async fn connect(
        endpoint: &str,
        auth_header_name: &str,
        auth_header_value: &str,
    ) -> anyhow::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(MCP_REQUEST_TIMEOUT)
            .build()?;
        let initialize = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": initialize_params()
        });
        let response = client
            .post(endpoint)
            .header(auth_header_name, auth_header_value)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .json(&initialize)
            .send()
            .await?;
        let status = response.status();
        let session_id = response
            .headers()
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response.text().await?;
        if !status.is_success() {
            anyhow::bail!(
                "MCP initialize failed with HTTP {}: {}",
                status,
                truncate_for_error(&body)
            );
        }
        json_rpc_result(parse_json_rpc_body(&body)?)?;

        Ok(Self {
            inner: Arc::new(HttpMcpClientInner {
                endpoint: endpoint.to_string(),
                auth_header_name: auth_header_name.to_string(),
                auth_header_value: auth_header_value.to_string(),
                session_id,
                client,
                next_request_id: AtomicU64::new(2),
            }),
        })
    }

    async fn request(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        let id = self.inner.next_request_id.fetch_add(1, Ordering::Relaxed);
        let mut request = self
            .inner
            .client
            .post(&self.inner.endpoint)
            .header(&self.inner.auth_header_name, &self.inner.auth_header_value)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .header("mcp-protocol-version", MCP_PROTOCOL_VERSION);
        if let Some(session_id) = self.inner.session_id.as_deref() {
            request = request.header("mcp-session-id", session_id);
        }
        let response = request
            .json(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params,
            }))
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            anyhow::bail!(
                "MCP request '{}' failed with HTTP {}: {}",
                method,
                status,
                truncate_for_error(&body)
            );
        }
        json_rpc_result(parse_json_rpc_body(&body)?)
    }
}

/// Stdio MCP transport: a locally launched server process speaking
/// newline-delimited JSON-RPC over stdin/stdout. Requests are serialized
/// through one lock, so a session has at most one in-flight request; a
/// timeout or protocol failure kills the process and poisons the session so
/// later calls fail fast instead of consuming mismatched responses.
#[derive(Clone)]
struct StdioMcpClient {
    inner: Arc<StdioMcpClientInner>,
}

struct StdioMcpClientInner {
    session: Mutex<Option<StdioSession>>,
    stderr_tail: Arc<std::sync::Mutex<String>>,
    program: String,
    next_request_id: AtomicU64,
}

struct StdioSession {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
}

/// Returns the command to spawn for `program`. On Windows, CreateProcess
/// cannot run batch shims like `npx.cmd` or `uvx.cmd` directly, so bare
/// program names are resolved through PATH and PATHEXT and batch shims are
/// launched through `cmd /c`. Elsewhere the program is used as given.
fn resolve_spawn_plan(program: &str, args: &[String]) -> (String, Vec<String>) {
    resolve_spawn_plan_inner(
        program,
        args,
        std::env::var("PATH").ok().as_deref(),
        std::env::var("PATHEXT").ok().as_deref(),
        cfg!(windows),
    )
}

fn resolve_spawn_plan_inner(
    program: &str,
    args: &[String],
    path_env: Option<&str>,
    pathext: Option<&str>,
    windows: bool,
) -> (String, Vec<String>) {
    let unchanged = || (program.to_string(), args.to_vec());
    if !windows
        || program.contains('\\')
        || program.contains('/')
        || std::path::Path::new(program).extension().is_some()
    {
        return unchanged();
    }
    let Some(path_env) = path_env else {
        return unchanged();
    };
    let extensions = pathext.unwrap_or(".COM;.EXE;.BAT;.CMD");
    for directory in std::env::split_paths(path_env) {
        for extension in extensions.split(';') {
            let extension = extension.trim();
            if extension.is_empty() {
                continue;
            }
            let candidate = directory.join(format!("{program}{extension}"));
            if !candidate.is_file() {
                continue;
            }
            let path = candidate.to_string_lossy().into_owned();
            let extension = extension.to_ascii_lowercase();
            if extension == ".cmd" || extension == ".bat" {
                let mut command_args = Vec::with_capacity(args.len() + 2);
                command_args.push("/c".to_string());
                command_args.push(path);
                command_args.extend(args.iter().cloned());
                return ("cmd".to_string(), command_args);
            }
            return (path, args.to_vec());
        }
    }
    unchanged()
}

impl StdioMcpClient {
    async fn connect(
        program: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
    ) -> anyhow::Result<Self> {
        let (program_command, program_args) = resolve_spawn_plan(program, args);
        let mut command = Command::new(&program_command);
        command
            .args(&program_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (key, value) in env {
            command.env(key, value);
        }
        let mut child = command.spawn().map_err(|error| {
            anyhow::anyhow!("Failed to start MCP stdio server '{program}': {error}")
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("MCP stdio server stdin was not piped"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("MCP stdio server stdout was not piped"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("MCP stdio server stderr was not piped"))?;

        // Drain stderr continuously: MCP stdio servers log there, and an
        // undrained pipe would eventually block the child. The tail is kept
        // for error messages only.
        let stderr_tail = Arc::new(std::sync::Mutex::new(String::new()));
        let tail = stderr_tail.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        if let Ok(mut current) = tail.lock() {
                            current.push_str(&line);
                            if current.len() > MAX_STDERR_TAIL_CHARS {
                                let mut cut = current.len() - MAX_STDERR_TAIL_CHARS;
                                while cut < current.len() && !current.is_char_boundary(cut) {
                                    cut += 1;
                                }
                                current.drain(..cut);
                            }
                        }
                    }
                }
            }
        });

        let client = Self {
            inner: Arc::new(StdioMcpClientInner {
                session: Mutex::new(Some(StdioSession {
                    child,
                    stdin,
                    stdout: BufReader::new(stdout).lines(),
                })),
                stderr_tail,
                program: program.to_string(),
                next_request_id: AtomicU64::new(1),
            }),
        };

        client
            .request_with_timeout("initialize", initialize_params(), MCP_INITIALIZE_TIMEOUT)
            .await?;
        client
            .notify("notifications/initialized", json!({}))
            .await?;
        Ok(client)
    }

    async fn request(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        self.request_with_timeout(method, params, MCP_REQUEST_TIMEOUT)
            .await
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        limit: Duration,
    ) -> anyhow::Result<Value> {
        let id = self.inner.next_request_id.fetch_add(1, Ordering::Relaxed);
        let line = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();

        let mut guard = self.inner.session.lock().await;
        let session = guard.as_mut().ok_or_else(|| self.session_down_error())?;

        let written = async {
            session.stdin.write_all(line.as_bytes()).await?;
            session.stdin.write_all(b"\n").await?;
            session.stdin.flush().await
        }
        .await;
        if let Err(error) = written {
            drop(guard);
            self.kill_session().await;
            anyhow::bail!(
                "MCP stdio server '{}' closed its input: {error}{}",
                self.inner.program,
                self.stderr_suffix()
            );
        }

        match timeout(limit, read_stdio_response(session, id)).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => {
                drop(guard);
                self.kill_session().await;
                anyhow::bail!(
                    "MCP stdio server '{}' failed during '{method}': {error}{}",
                    self.inner.program,
                    self.stderr_suffix()
                );
            }
            Err(_) => {
                drop(guard);
                self.kill_session().await;
                anyhow::bail!(
                    "MCP request '{method}' to '{}' timed out after {}s",
                    self.inner.program,
                    limit.as_secs_f64()
                );
            }
        }
    }

    async fn notify(&self, method: &str, params: Value) -> anyhow::Result<()> {
        let line = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        })
        .to_string();
        let mut guard = self.inner.session.lock().await;
        let session = guard.as_mut().ok_or_else(|| self.session_down_error())?;
        session.stdin.write_all(line.as_bytes()).await?;
        session.stdin.write_all(b"\n").await?;
        session.stdin.flush().await?;
        Ok(())
    }

    /// Kill the server process and poison the session. Later calls fail fast
    /// with the captured stderr tail instead of reading stale responses.
    async fn kill_session(&self) {
        let mut guard = self.inner.session.lock().await;
        if let Some(mut session) = guard.take() {
            let _ = session.child.start_kill();
        }
    }

    fn session_down_error(&self) -> anyhow::Error {
        anyhow::anyhow!(
            "MCP stdio server '{}' is not running{}",
            self.inner.program,
            self.stderr_suffix()
        )
    }

    fn stderr_suffix(&self) -> String {
        let tail = self
            .inner
            .stderr_tail
            .lock()
            .map(|tail| tail.clone())
            .unwrap_or_default();
        let tail = tail.trim();
        if tail.is_empty() {
            String::new()
        } else {
            format!("; last stderr: {}", truncate_for_error(tail))
        }
    }
}

/// Read stdout lines until the response matching `id` arrives. Notifications
/// (no id) and non-protocol noise are ignored; the job of this loop is to
/// keep the stream aligned with the serialized request that is waiting.
async fn read_stdio_response(session: &mut StdioSession, id: u64) -> anyhow::Result<Value> {
    loop {
        let Some(line) = session.stdout.next_line().await? else {
            anyhow::bail!("the server closed its stdout");
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if message.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        return json_rpc_result(message);
    }
}

/// Page through `tools/list` and build tool handles bound to one session.
async fn discover_tools(connection: McpConnection) -> anyhow::Result<Vec<McpTool>> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let params = cursor
            .as_ref()
            .map(|cursor| json!({ "cursor": cursor }))
            .unwrap_or_else(|| json!({}));
        let result = connection.request("tools/list", params).await?;
        let page = result
            .get("tools")
            .and_then(Value::as_array)
            .ok_or_else(|| anyhow::anyhow!("MCP tools/list response omitted tools"))?;
        for definition in page {
            let name = definition
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("MCP tool definition omitted name"))?;
            tools.push(McpTool {
                name: name.to_string(),
                description: definition
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("Tool provided by the Axle desktop app")
                    .to_string(),
                parameters: definition
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                connection: connection.clone(),
            });
        }
        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if cursor.is_none() {
            break;
        }
    }
    Ok(tools)
}

fn tool_result_output(result: &Value) -> String {
    let mut output = Vec::new();
    if let Some(content) = result.get("content").and_then(Value::as_array) {
        for part in content {
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        output.push(text.to_string());
                    }
                }
                Some("image") => {
                    let mime_type = part
                        .get("mimeType")
                        .and_then(Value::as_str)
                        .unwrap_or("image");
                    output.push(format!("[{} image returned by the MCP tool]", mime_type));
                }
                Some(kind) => output.push(format!("[{} content returned by the MCP tool]", kind)),
                None => {}
            }
        }
    }
    if output.is_empty() {
        if let Some(structured) = result.get("structuredContent") {
            output.push(structured.to_string());
        }
    }
    if output.is_empty() {
        "MCP tool completed without text output.".to_string()
    } else {
        crate::tool::truncate_output(output.join("\n"), MAX_TOOL_OUTPUT_BYTES)
    }
}

#[async_trait]
impl Tool for McpTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn label(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn parameters(&self) -> Value {
        self.parameters.clone()
    }

    /// MCP tools call external services with the user's credentials; treat
    /// every remote tool call as consequential by default.
    fn requires_approval(&self) -> bool {
        true
    }

    async fn execute(&self, args: Value, _cwd: &str) -> anyhow::Result<ToolExecutionResult> {
        let result = self
            .connection
            .request(
                "tools/call",
                json!({
                    "name": self.name,
                    "arguments": args,
                }),
            )
            .await?;
        let output = tool_result_output(&result);
        Ok(
            if result.get("isError").and_then(Value::as_bool) == Some(true) {
                ToolExecutionResult::error(output)
            } else {
                ToolExecutionResult::success(output)
            },
        )
    }
}

/// Discover and register all tools exposed by one authenticated HTTP MCP
/// session. The returned tools share a session-aware client for this process.
pub async fn register_http_mcp_tools(
    registry: &mut ToolRegistry,
    endpoint: &str,
    authorization_header: &str,
) -> anyhow::Result<usize> {
    register_http_mcp_tools_with_header(registry, endpoint, "Authorization", authorization_header)
        .await
}

/// Discover and register HTTP MCP tools using an arbitrary authentication
/// header, such as a provider-specific API-key header.
pub async fn register_http_mcp_tools_with_header(
    registry: &mut ToolRegistry,
    endpoint: &str,
    auth_header_name: &str,
    auth_header_value: &str,
) -> anyhow::Result<usize> {
    let client = HttpMcpClient::connect(endpoint, auth_header_name, auth_header_value).await?;
    let tools = discover_tools(McpConnection::Http(client)).await?;
    let count = tools.len();
    for tool in tools {
        registry.register(Arc::new(tool));
    }
    Ok(count)
}

/// Discover and register all tools exposed by a local stdio MCP server, such
/// as `npx -y @modelcontextprotocol/server-everything`. The spawned process
/// lives as long as the registered tools; when it dies, calls fail fast with
/// its captured stderr tail.
pub async fn register_stdio_mcp_tools(
    registry: &mut ToolRegistry,
    program: &str,
    args: &[String],
) -> anyhow::Result<usize> {
    register_stdio_mcp_tools_with_env(registry, program, args, &BTreeMap::new()).await
}

/// Same as [`register_stdio_mcp_tools`], with extra environment variables
/// (for example credentials) passed to the spawned server.
pub async fn register_stdio_mcp_tools_with_env(
    registry: &mut ToolRegistry,
    program: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
) -> anyhow::Result<usize> {
    let client = StdioMcpClient::connect(program, args, env).await?;
    let tools = discover_tools(McpConnection::Stdio(client)).await?;
    let count = tools.len();
    for tool in tools {
        registry.register(Arc::new(tool));
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_and_sse_json_rpc_responses() {
        let json = parse_json_rpc_body(r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#).unwrap();
        assert_eq!(json["result"]["ok"], true);

        let sse = parse_json_rpc_body(
            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"ok\":true}}\n\n",
        )
        .unwrap();
        assert_eq!(sse["result"]["ok"], true);
    }

    #[test]
    fn keeps_text_and_summarizes_binary_tool_content() {
        let result = json!({
            "content": [
                { "type": "text", "text": "{\"url\":\"http://localhost:8080\"}" },
                { "type": "image", "mimeType": "image/png", "data": "large-base64" }
            ]
        });
        let output = tool_result_output(&result);
        assert!(output.contains("localhost:8080"));
        assert!(output.contains("image/png image returned"));
        assert!(!output.contains("large-base64"));
    }

    /// Env var that turns the test binary into a fake MCP stdio server. The
    /// transport tests spawn this same binary with the variable set, so the
    /// fake server needs no external runtime or fixture binary.
    const FAKE_SERVER_ENV: &str = "AXLE_MCP_FAKE_SERVER";

    fn fake_server_command() -> (String, Vec<String>, BTreeMap<String, String>) {
        let program = std::env::current_exe()
            .expect("test binary path")
            .to_string_lossy()
            .into_owned();
        let args = vec![
            "mcp::tests::serves_as_fake_mcp_stdio_server".to_string(),
            "--exact".to_string(),
            "--nocapture".to_string(),
        ];
        let mut env = BTreeMap::new();
        env.insert(FAKE_SERVER_ENV.to_string(), "1".to_string());
        (program, args, env)
    }

    /// No-op in a normal test run; acts as the fake server when spawned with
    /// [`FAKE_SERVER_ENV`] set.
    #[test]
    fn serves_as_fake_mcp_stdio_server() {
        if std::env::var(FAKE_SERVER_ENV).is_err() {
            return;
        }
        run_fake_server();
    }

    /// Minimal newline-delimited JSON-RPC server: initialize, tools/list with
    /// two tools ("echo", "fail"), a "sleep" call that never answers, and a
    /// "crash" call that writes to stderr and exits without responding.
    fn run_fake_server() {
        use std::io::{BufRead, Write};

        let stdin = std::io::stdin();
        let mut stdout = std::io::stdout();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { return };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let id = message.get("id").cloned();
            let method = message.get("method").and_then(Value::as_str).unwrap_or("");
            let mut respond = |response: Value| {
                writeln!(stdout, "{response}").unwrap();
                stdout.flush().unwrap();
            };
            match method {
                "initialize" => respond(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": MCP_PROTOCOL_VERSION,
                        "capabilities": { "tools": {} },
                        "serverInfo": { "name": "fake-axle-mcp", "version": "1.0.0" }
                    }
                })),
                "notifications/initialized" => {}
                "tools/list" => respond(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": [
                            {
                                "name": "echo",
                                "description": "Echo text back to the caller",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": { "text": { "type": "string" } }
                                }
                            },
                            {
                                "name": "fail",
                                "description": "Report an error result",
                                "inputSchema": { "type": "object", "properties": {} }
                            }
                        ]
                    }
                })),
                "tools/call" => {
                    let name = message
                        .get("params")
                        .and_then(|params| params.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    match name {
                        "sleep" => {}
                        "crash" => {
                            eprintln!("fake server crashing as requested");
                            std::process::exit(7);
                        }
                        "fail" => respond(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "isError": true,
                                "content": [{ "type": "text", "text": "boom" }]
                            }
                        })),
                        _ => {
                            let text = message
                                .get("params")
                                .and_then(|params| params.get("arguments"))
                                .and_then(|arguments| arguments.get("text"))
                                .and_then(Value::as_str)
                                .unwrap_or("(no text)");
                            respond(json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": {
                                    "content": [{ "type": "text", "text": format!("echo: {text}") }]
                                }
                            }));
                        }
                    }
                }
                _ => {
                    if let Some(id) = id {
                        respond(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32601, "message": "method not found" }
                        }));
                    }
                }
            }
        }
    }

    #[tokio::test]
    async fn stdio_transport_discovers_and_calls_tools() {
        let (program, args, env) = fake_server_command();
        let client = StdioMcpClient::connect(&program, &args, &env)
            .await
            .unwrap();
        let tools = discover_tools(McpConnection::Stdio(client)).await.unwrap();

        let names: Vec<&str> = tools.iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(names, ["echo", "fail"]);

        let echo = tools.iter().find(|tool| tool.name == "echo").unwrap();
        assert_eq!(echo.description, "Echo text back to the caller");
        // MCP tools call external services with the user's credentials.
        assert!(echo.requires_approval());

        let result = echo.execute(json!({ "text": "hello" }), ".").await.unwrap();
        assert!(!result.is_error);
        assert_eq!(result.output, "echo: hello");

        let fail = tools.iter().find(|tool| tool.name == "fail").unwrap();
        let result = fail.execute(json!({}), ".").await.unwrap();
        assert!(result.is_error);
        assert_eq!(result.output, "boom");
    }

    #[tokio::test]
    async fn stdio_timeout_kills_the_server_and_later_calls_fail_fast() {
        let (program, args, env) = fake_server_command();
        let client = StdioMcpClient::connect(&program, &args, &env)
            .await
            .unwrap();
        let error = client
            .request_with_timeout(
                "tools/call",
                json!({ "name": "sleep", "arguments": {} }),
                Duration::from_millis(300),
            )
            .await
            .err()
            .expect("timeout should fail the request");
        assert!(
            error.to_string().contains("timed out after 0.3s"),
            "{error}"
        );

        // The session was killed; the next request fails immediately instead
        // of consuming a response meant for the timed-out call.
        let error = client.request("tools/list", json!({})).await.unwrap_err();
        assert!(error.to_string().contains("is not running"), "{error}");
    }

    #[tokio::test]
    async fn stdio_crash_surfaces_the_stderr_tail() {
        let (program, args, env) = fake_server_command();
        let client = StdioMcpClient::connect(&program, &args, &env)
            .await
            .unwrap();
        let error = client
            .request("tools/call", json!({ "name": "crash", "arguments": {} }))
            .await
            .unwrap_err();
        assert!(
            error.to_string().contains("failed during 'tools/call'"),
            "{error}"
        );

        // The stderr drain task races with the error path; poll briefly so
        // the assertion is deterministic.
        let mut tail = String::new();
        for _ in 0..50 {
            tail = client.stderr_suffix();
            if tail.contains("fake server crashing") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            tail.contains("fake server crashing"),
            "stderr tail: {tail:?}"
        );
    }

    #[tokio::test]
    async fn stdio_connect_reports_a_missing_program() {
        let error = StdioMcpClient::connect(
            "axle-definitely-missing-program-4f3a9",
            &[],
            &BTreeMap::new(),
        )
        .await
        .err()
        .expect("missing program should fail to connect");
        assert!(
            error
                .to_string()
                .contains("Failed to start MCP stdio server"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn stdio_registrar_registers_discovered_tools() {
        let (program, args, env) = fake_server_command();
        let mut registry = ToolRegistry::default();
        let count = register_stdio_mcp_tools_with_env(&mut registry, &program, &args, &env)
            .await
            .unwrap();
        assert_eq!(count, 2);
        assert!(registry.get("echo").is_some());
        assert!(registry.get("fail").is_some());
    }

    #[test]
    fn resolves_windows_batch_shims_through_cmd() {
        let directory = tempfile::tempdir().unwrap();
        let shim = directory.path().join("fake-npx.cmd");
        std::fs::write(&shim, "@echo off\n").unwrap();
        let args = vec!["-y".to_string(), "server".to_string()];
        let (program, resolved_args) = resolve_spawn_plan_inner(
            "fake-npx",
            &args,
            Some(&directory.path().to_string_lossy()),
            Some(".exe;.cmd"),
            true,
        );
        assert_eq!(program, "cmd");
        assert_eq!(resolved_args[0], "/c");
        assert_eq!(resolved_args[1], shim.to_string_lossy());
        assert_eq!(&resolved_args[2..], ["-y", "server"]);
    }

    #[test]
    fn resolves_windows_executables_directly() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("fake-tool.exe");
        std::fs::write(&executable, "").unwrap();
        let (program, args) = resolve_spawn_plan_inner(
            "fake-tool",
            &[],
            Some(&directory.path().to_string_lossy()),
            Some(".exe;.cmd"),
            true,
        );
        assert_eq!(program, executable.to_string_lossy());
        assert!(args.is_empty());
    }

    #[test]
    fn leaves_unix_and_pre_qualified_programs_untouched() {
        let args = vec!["--flag".to_string()];
        let (program, resolved) = resolve_spawn_plan_inner("npx", &args, None, None, false);
        assert_eq!(program, "npx");
        assert_eq!(resolved, args);

        let (program, resolved) =
            resolve_spawn_plan_inner(r"C:\tools\npx.cmd", &args, None, None, true);
        assert_eq!(program, r"C:\tools\npx.cmd");
        assert_eq!(resolved, args);
    }

    #[test]
    fn falls_back_to_the_original_program_when_not_found() {
        let directory = tempfile::tempdir().unwrap();
        let (program, args) = resolve_spawn_plan_inner(
            "missing-tool",
            &[],
            Some(&directory.path().to_string_lossy()),
            Some(".cmd"),
            true,
        );
        assert_eq!(program, "missing-tool");
        assert!(args.is_empty());
    }
}
