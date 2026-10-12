//! Offline end-to-end journey tests for the real `axle` CLI binary.
//!
//! Each test spawns the compiled `axle` executable against a local mock
//! OpenAI-compatible SSE server bound to 127.0.0.1. The provider treats local
//! base URLs as keyless, so no API key and no network access are required,
//! while everything else is the real runtime: the real agent loop, the real
//! built-in tools touching real files, the real approval gate, and the real
//! session JSONL on disk.
//!
//! Journeys covered:
//! 1. tool use (`read`) -> durable session -> `--session` resume.
//! 2. gated tool (`write`) approved through the approval file -> file written.
//! 3. gated tool denied -> tool blocked with an error result, no file written.

use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const MARKER: &str = "AXLE_E2E_MARKER_9f3a";
const RUN_TIMEOUT: Duration = Duration::from_secs(120);

/// Serialize the CLI-spawning tests so a loaded machine never turns streamed
/// frames into a timing race between journeys.
static E2E_LOCK: Mutex<()> = Mutex::new(());

fn e2e_guard() -> std::sync::MutexGuard<'static, ()> {
    E2E_LOCK.lock().unwrap_or_else(|poison| poison.into_inner())
}

struct TempWorkspace {
    path: PathBuf,
}

impl TempWorkspace {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("axle-e2e-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create temp workspace");
        Self { path }
    }

    fn file(&self, relative: &str) -> PathBuf {
        self.path.join(relative)
    }

    fn write_file(&self, relative: &str, contents: &str) {
        fs::write(self.file(relative), contents).expect("write fixture file");
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[derive(Clone, Default)]
struct MockReply {
    events: Vec<Value>,
}

impl MockReply {
    fn text(text: &str) -> Self {
        Self {
            events: vec![stream_chunk(json!({ "content": text }))],
        }
    }

    fn tool_call(id: &str, name: &str, arguments: &str) -> Self {
        Self {
            events: vec![stream_chunk(json!({
                "tool_calls": [{
                    "index": 0,
                    "id": id,
                    "type": "function",
                    "function": { "name": name, "arguments": arguments },
                }]
            }))],
        }
    }

    fn with_usage(mut self, prompt_tokens: u64, completion_tokens: u64) -> Self {
        self.events.push(json!({
            "choices": [],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            }
        }));
        self
    }
}

fn stream_chunk(delta: Value) -> Value {
    json!({
        "id": "chatcmpl-axle-e2e",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "axle-e2e-mock",
        "choices": [{ "index": 0, "delta": delta, "finish_reason": null }],
    })
}

type Handler = Box<dyn Fn(usize, &Value) -> MockReply + Send>;

struct MockLlm {
    port: u16,
    requests: Arc<Mutex<Vec<Value>>>,
}

impl MockLlm {
    fn start(handler: Handler) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock LLM server");
        let port = listener.local_addr().expect("mock port").port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let thread_requests = requests.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
                match read_http_request(&mut stream) {
                    Ok(body) => {
                        let request: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                        let index = {
                            let mut guard = thread_requests.lock().unwrap();
                            guard.push(request.clone());
                            guard.len() - 1
                        };
                        let reply = handler(index, &request);
                        write_sse(&mut stream, &reply);
                    }
                    Err(_) => {
                        let _ = stream.write_all(
                            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                    }
                }
            }
        });
        Self { port, requests }
    }

    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/v1", self.port)
    }

    fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "connection closed before request headers",
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
        if buffer.len() > 4 * 1024 * 1024 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request headers too large",
            ));
        }
    };

    let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);
    Ok(String::from_utf8_lossy(&body).to_string())
}

fn write_sse(stream: &mut TcpStream, reply: &MockReply) {
    let mut out = String::from(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: text/event-stream\r\n\
         Cache-Control: no-cache\r\n\
         Connection: close\r\n\r\n",
    );
    for event in &reply.events {
        out.push_str("data: ");
        out.push_str(&event.to_string());
        out.push_str("\n\n");
    }
    out.push_str("data: [DONE]\n\n");
    let _ = stream.write_all(out.as_bytes());
    let _ = stream.flush();
}

fn record_violation(
    violations: &Arc<Mutex<Vec<String>>>,
    condition: bool,
    message: impl Into<String>,
) {
    if !condition {
        violations.lock().unwrap().push(message.into());
    }
}

fn text_of(message: &Value) -> String {
    match &message["content"] {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

struct CliRun {
    child: Child,
    lines: mpsc::Receiver<String>,
    stderr: Arc<Mutex<String>>,
}

struct CliOutcome {
    frames: Vec<Value>,
    exit_code: i32,
    stderr: String,
}

fn spawn_cli(cwd: &Path, args: &[String]) -> CliRun {
    let mut child = Command::new(env!("CARGO_BIN_EXE_axle"))
        .args(args)
        .current_dir(cwd)
        .env_remove("OPENAI_API_KEY")
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("GEMINI_API_KEY")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn the axle CLI");

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr_pipe = child.stderr.take().expect("piped stderr");
    let (sender, lines) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let stderr = Arc::new(Mutex::new(String::new()));
    let stderr_target = stderr.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr_pipe).lines() {
            match line {
                Ok(line) => {
                    let mut guard = stderr_target.lock().unwrap();
                    guard.push_str(&line);
                    guard.push('\n');
                }
                Err(_) => break,
            }
        }
    });

    CliRun {
        child,
        lines,
        stderr,
    }
}

fn drive_cli(mut run: CliRun, mut on_frame: impl FnMut(&Value)) -> CliOutcome {
    let deadline = Instant::now() + RUN_TIMEOUT;
    let mut frames = Vec::new();
    loop {
        match run.lines.recv_timeout(Duration::from_millis(250)) {
            Ok(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let frame: Value = serde_json::from_str(trimmed).unwrap_or_else(|error| {
                    panic!("axle wrote a non-JSON stdout line: {trimmed:?}: {error}")
                });
                on_frame(&frame);
                frames.push(frame);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if Instant::now() >= deadline {
                    let _ = run.child.kill();
                    let _ = run.child.wait();
                    panic!(
                        "axle did not finish within {}s.\nframes so far:\n{}\nstderr:\n{}",
                        RUN_TIMEOUT.as_secs(),
                        render_frames(&frames),
                        run.stderr.lock().unwrap()
                    );
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let status = run.child.wait().expect("wait for axle");
    CliOutcome {
        frames,
        exit_code: status.code().unwrap_or(-1),
        stderr: run.stderr.lock().unwrap().clone(),
    }
}

fn render_frames(frames: &[Value]) -> String {
    frames
        .iter()
        .map(|frame| frame.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn frame_index(frames: &[Value], frame_type: &str) -> Option<usize> {
    frames.iter().position(|frame| frame["type"] == frame_type)
}

fn frame<'a>(frames: &'a [Value], frame_type: &str) -> &'a Value {
    let index = frame_index(frames, frame_type).unwrap_or_else(|| {
        panic!(
            "expected a {frame_type:?} frame.\nframes:\n{}",
            render_frames(frames)
        )
    });
    &frames[index]
}

fn session_file(workspace: &TempWorkspace, session_id: &str) -> PathBuf {
    workspace
        .path
        .join(".axle")
        .join("sessions")
        .join(format!("{session_id}.jsonl"))
}

fn read_session_entries(workspace: &TempWorkspace, session_id: &str) -> Vec<Value> {
    let path = session_file(workspace, session_id);
    let contents = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read session file {}: {error}", path.display()));
    contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line)
                .unwrap_or_else(|error| panic!("session line is not JSON: {line:?}: {error}"))
        })
        .collect()
}

fn session_message_entries(entries: &[Value]) -> Vec<&Value> {
    entries
        .iter()
        .filter(|entry| entry["type"] == "message")
        .collect()
}

fn append_approval_response(path: &Path, request_id: &str, decision: &str) {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .expect("open approval file");
    writeln!(
        file,
        "{}",
        json!({
            "type": "approval_response",
            "requestId": request_id,
            "decision": decision,
        })
    )
    .expect("append approval response");
    file.flush().expect("flush approval response");
}

fn base_args(server: &MockLlm, workspace: &TempWorkspace, prompt: &str) -> Vec<String> {
    vec![
        "--provider".to_string(),
        // The `ollama` provider is the CLI's keyless local OpenAI-compatible
        // path: it uses the same wire format as OpenAI but never requires an
        // API key, which is exactly what an offline E2E needs.
        "ollama".to_string(),
        "--model".to_string(),
        "axle-e2e-model".to_string(),
        "--base-url".to_string(),
        server.base_url(),
        "--json-stream".to_string(),
        "--cwd".to_string(),
        workspace.path.display().to_string(),
        "--prompt".to_string(),
        prompt.to_string(),
    ]
}

#[test]
fn journey_tool_use_persists_and_resumes() {
    let _guard = e2e_guard();
    let workspace = TempWorkspace::new("journey");
    workspace.write_file("notes.txt", &format!("meeting notes\n{MARKER}\n"));

    let violations = Arc::new(Mutex::new(Vec::new()));
    let server = {
        let violations = violations.clone();
        MockLlm::start(Box::new(move |index, request| {
            let messages = request["messages"].as_array().cloned().unwrap_or_default();
            match index {
                0 => {
                    record_violation(
                        &violations,
                        messages
                            .iter()
                            .any(|m| m["role"] == "user" && text_of(m).contains("read notes.txt")),
                        "the first provider call must carry the user prompt",
                    );
                    let tools = request["tools"].as_array().cloned().unwrap_or_default();
                    record_violation(
                        &violations,
                        tools.iter().any(|tool| tool["function"]["name"] == "read"),
                        "the read tool must be advertised to the provider",
                    );
                    MockReply::tool_call("call_read_1", "read", "{\"path\":\"notes.txt\"}")
                }
                1 => {
                    let tool_output = messages
                        .iter()
                        .filter(|m| m["role"] == "tool")
                        .map(text_of)
                        .collect::<Vec<_>>()
                        .join("\n");
                    record_violation(
                        &violations,
                        tool_output.contains(MARKER),
                        format!("the second provider call must carry the read output, got {tool_output:?}"),
                    );
                    MockReply::text("The notes mention the marker.").with_usage(42, 7)
                }
                other => {
                    record_violation(
                        &violations,
                        false,
                        format!("unexpected provider call #{other}"),
                    );
                    MockReply::text("unexpected")
                }
            }
        }))
    };

    let outcome = drive_cli(
        spawn_cli(
            &workspace.path,
            &base_args(
                &server,
                &workspace,
                "read notes.txt and tell me what it says",
            ),
        ),
        |_| {},
    );

    assert_eq!(
        outcome.exit_code, 0,
        "axle exited non-zero; stderr:\n{}",
        outcome.stderr
    );
    assert_eq!(
        server.request_count(),
        2,
        "the agent loop must take exactly two provider turns"
    );
    assert!(
        violations.lock().unwrap().is_empty(),
        "mock server recorded violations: {:?}",
        violations.lock().unwrap()
    );

    let session_id = frame(&outcome.frames, "session")["sessionId"]
        .as_str()
        .expect("session frame carries a sessionId")
        .to_string();

    let started = frame(&outcome.frames, "tool.started");
    assert_eq!(started["toolName"], "read");
    assert_eq!(started["toolCallId"], "call_read_1");
    assert_eq!(started["arguments"]["path"], "notes.txt");

    let completed = frame(&outcome.frames, "tool.completed");
    assert_eq!(completed["toolName"], "read");
    assert_eq!(completed["isError"], false);
    assert!(
        completed["output"]
            .as_str()
            .unwrap_or_default()
            .contains(MARKER),
        "tool.completed must carry the file contents: {completed}"
    );
    assert!(completed["durationMs"].is_number());
    assert_eq!(completed["timedOut"], false);

    let usage = frame(&outcome.frames, "usage");
    assert_eq!(usage["promptTokens"], 42);
    assert_eq!(usage["completionTokens"], 7);
    assert_eq!(usage["totalTokens"], 49);

    let result = frame(&outcome.frames, "result");
    assert_eq!(result["response"], "The notes mention the marker.");
    assert_eq!(result["sessionId"], session_id.as_str());

    // The durable session must replay exactly what happened, in order.
    let entries = read_session_entries(&workspace, &session_id);
    assert_eq!(entries[0]["type"], "session");
    assert_eq!(entries[0]["id"], session_id.as_str());
    let messages = session_message_entries(&entries);
    assert!(
        messages
            .iter()
            .any(|entry| entry["message"]["role"] == "user"
                && text_of(&entry["message"]).contains("read notes.txt")),
        "session must persist the user prompt"
    );
    assert!(
        messages
            .iter()
            .any(|entry| entry["message"]["role"] == "assistant"
                && entry["message"]["tool_calls"][0]["name"] == "read"
                && entry["message"]["tool_calls"][0]["id"] == "call_read_1"),
        "session must persist the assistant tool call"
    );
    assert!(
        messages
            .iter()
            .any(|entry| entry["message"]["role"] == "tool"
                && entry["message"]["tool_result"]["tool_call_id"] == "call_read_1"
                && entry["message"]["tool_result"]["output"]
                    .as_str()
                    .unwrap_or_default()
                    .contains(MARKER)),
        "session must persist the tool result"
    );
    assert!(
        messages
            .iter()
            .any(|entry| entry["message"]["role"] == "assistant"
                && text_of(&entry["message"]).contains("notes mention the marker")),
        "session must persist the final assistant answer"
    );

    // Resume the same session in a fresh process: the model must receive the
    // full prior conversation, and the new turn lands in the same session file.
    let resume_violations = Arc::new(Mutex::new(Vec::new()));
    let resume_server = {
        let violations = resume_violations.clone();
        let marker = MARKER.to_string();
        MockLlm::start(Box::new(move |index, request| {
            let messages = request["messages"].as_array().cloned().unwrap_or_default();
            match index {
                0 => {
                    record_violation(
                        &violations,
                        messages
                            .iter()
                            .any(|m| m["role"] == "user" && text_of(m).contains("read notes.txt")),
                        "the resumed session must replay the first user prompt",
                    );
                    record_violation(
                        &violations,
                        messages
                            .iter()
                            .any(|m| m["role"] == "tool" && text_of(m).contains(&marker)),
                        "the resumed session must replay the read tool result",
                    );
                    record_violation(
                        &violations,
                        messages.iter().any(|m| {
                            m["role"] == "user" && text_of(m).contains("what did I ask you to read")
                        }),
                        "the resumed session must carry the new user prompt",
                    );
                    MockReply::text("You asked me to read notes.txt.")
                }
                other => {
                    record_violation(
                        &violations,
                        false,
                        format!("unexpected resume provider call #{other}"),
                    );
                    MockReply::text("unexpected")
                }
            }
        }))
    };

    let mut resume_args = base_args(&resume_server, &workspace, "what did I ask you to read?");
    resume_args.push("--session".to_string());
    resume_args.push(session_id.clone());
    let resumed = drive_cli(spawn_cli(&workspace.path, &resume_args), |_| {});

    assert!(
        resume_violations.lock().unwrap().is_empty(),
        "resume mock recorded violations: {:?}",
        resume_violations.lock().unwrap()
    );
    assert_eq!(
        resumed.exit_code, 0,
        "resumed axle exited non-zero; stderr:\n{}",
        resumed.stderr
    );
    let resumed_result = frame(&resumed.frames, "result");
    assert_eq!(
        resumed_result["response"],
        "You asked me to read notes.txt."
    );
    assert_eq!(
        resumed_result["sessionId"],
        session_id.as_str(),
        "resuming must keep the same durable session id"
    );

    let entries = read_session_entries(&workspace, &session_id);
    let messages = session_message_entries(&entries);
    let user_prompts = messages
        .iter()
        .filter(|entry| entry["message"]["role"] == "user")
        .count();
    assert_eq!(
        user_prompts, 2,
        "the resumed turn must be appended to the same session file"
    );
    assert!(messages
        .iter()
        .any(|entry| entry["message"]["role"] == "assistant"
            && text_of(&entry["message"]).contains("You asked me to read notes.txt.")));
}

#[test]
fn journey_approval_allow_executes_the_gated_tool() {
    let _guard = e2e_guard();
    let workspace = TempWorkspace::new("approval-allow");
    let approval_file = workspace.file(".axle/approvals/e2e.jsonl");
    fs::create_dir_all(approval_file.parent().unwrap()).expect("create approvals dir");

    let violations = Arc::new(Mutex::new(Vec::new()));
    let server = {
        let violations = violations.clone();
        MockLlm::start(Box::new(move |index, request| {
            let messages = request["messages"].as_array().cloned().unwrap_or_default();
            match index {
                0 => {
                    record_violation(
                        &violations,
                        messages
                            .iter()
                            .any(|m| m["role"] == "user" && text_of(m).contains("create out.txt")),
                        "the approval journey must carry the user prompt",
                    );
                    MockReply::tool_call(
                        "call_write_1",
                        "write",
                        "{\"path\":\"out.txt\",\"content\":\"approved content 42\"}",
                    )
                }
                1 => {
                    let tool_output = messages
                        .iter()
                        .filter(|m| m["role"] == "tool")
                        .map(text_of)
                        .collect::<Vec<_>>()
                        .join("\n");
                    record_violation(
                        &violations,
                        tool_output.contains("Successfully wrote"),
                        format!("the approved write must succeed, got {tool_output:?}"),
                    );
                    MockReply::text("File written.")
                }
                other => {
                    record_violation(
                        &violations,
                        false,
                        format!("unexpected provider call #{other}"),
                    );
                    MockReply::text("unexpected")
                }
            }
        }))
    };

    let mut args = base_args(
        &server,
        &workspace,
        "create out.txt with the approved content",
    );
    args.push("--approval-file".to_string());
    args.push(approval_file.display().to_string());

    let approval_file_for_responder = approval_file.clone();
    let approved = Arc::new(AtomicBool::new(false));
    let approved_in_closure = approved.clone();
    let outcome = drive_cli(spawn_cli(&workspace.path, &args), move |frame| {
        if frame["type"] == "approval.requested" {
            assert_eq!(
                frame["toolName"], "write",
                "only the gated write tool asks for approval"
            );
            let request_id = frame["requestId"].as_str().expect("approval request id");
            append_approval_response(&approval_file_for_responder, request_id, "allow");
            approved_in_closure.store(true, Ordering::SeqCst);
        }
    });

    assert_eq!(
        outcome.exit_code, 0,
        "axle exited non-zero; stderr:\n{}",
        outcome.stderr
    );
    assert!(
        approved.load(Ordering::SeqCst),
        "the CLI never requested approval for the gated write"
    );
    assert!(
        violations.lock().unwrap().is_empty(),
        "mock server recorded violations: {:?}",
        violations.lock().unwrap()
    );

    let requested = frame(&outcome.frames, "approval.requested");
    assert_eq!(requested["toolCallId"], "call_write_1");
    assert_eq!(requested["timeoutSeconds"], 600);

    let resolved_index =
        frame_index(&outcome.frames, "approval.resolved").expect("approval.resolved frame");
    let completed_index =
        frame_index(&outcome.frames, "tool.completed").expect("tool.completed frame");
    assert!(
        resolved_index < completed_index,
        "the tool must only run after the approval resolves"
    );
    assert_eq!(outcome.frames[resolved_index]["decision"], "allow");
    assert_eq!(
        outcome.frames[resolved_index]["requestId"],
        requested["requestId"]
    );

    let completed = frame(&outcome.frames, "tool.completed");
    assert_eq!(completed["toolName"], "write");
    assert_eq!(completed["isError"], false);
    assert!(
        completed["output"]
            .as_str()
            .unwrap_or_default()
            .contains("Successfully wrote"),
        "tool.completed must report the write: {completed}"
    );
    assert_eq!(
        fs::read_to_string(workspace.file("out.txt")).expect("out.txt exists"),
        "approved content 42"
    );
    assert_eq!(
        frame(&outcome.frames, "result")["response"],
        "File written."
    );
}

#[test]
fn journey_approval_deny_blocks_the_gated_tool() {
    let _guard = e2e_guard();
    let workspace = TempWorkspace::new("approval-deny");
    let approval_file = workspace.file(".axle/approvals/e2e.jsonl");
    fs::create_dir_all(approval_file.parent().unwrap()).expect("create approvals dir");

    let violations = Arc::new(Mutex::new(Vec::new()));
    let server = {
        let violations = violations.clone();
        MockLlm::start(Box::new(move |index, request| {
            let messages = request["messages"].as_array().cloned().unwrap_or_default();
            match index {
                0 => MockReply::tool_call(
                    "call_write_1",
                    "write",
                    "{\"path\":\"out.txt\",\"content\":\"must never land\"}",
                ),
                1 => {
                    let tool_output = messages
                        .iter()
                        .filter(|m| m["role"] == "tool")
                        .map(text_of)
                        .collect::<Vec<_>>()
                        .join("\n");
                    record_violation(
                        &violations,
                        tool_output.contains("denied by the user"),
                        format!("the denied write must come back as an error result, got {tool_output:?}"),
                    );
                    MockReply::text("Understood; leaving out.txt untouched.")
                }
                other => {
                    record_violation(
                        &violations,
                        false,
                        format!("unexpected provider call #{other}"),
                    );
                    MockReply::text("unexpected")
                }
            }
        }))
    };

    let mut args = base_args(
        &server,
        &workspace,
        "create out.txt even if it must not be allowed",
    );
    args.push("--approval-file".to_string());
    args.push(approval_file.display().to_string());

    let approval_file_for_responder = approval_file.clone();
    let denied = Arc::new(AtomicBool::new(false));
    let denied_in_closure = denied.clone();
    let outcome = drive_cli(spawn_cli(&workspace.path, &args), move |frame| {
        if frame["type"] == "approval.requested" {
            let request_id = frame["requestId"].as_str().expect("approval request id");
            append_approval_response(&approval_file_for_responder, request_id, "deny");
            denied_in_closure.store(true, Ordering::SeqCst);
        }
    });

    assert_eq!(
        outcome.exit_code, 0,
        "axle exited non-zero; stderr:\n{}",
        outcome.stderr
    );
    assert!(
        denied.load(Ordering::SeqCst),
        "the CLI never requested approval for the gated write"
    );
    assert!(
        violations.lock().unwrap().is_empty(),
        "mock server recorded violations: {:?}",
        violations.lock().unwrap()
    );

    let resolved = frame(&outcome.frames, "approval.resolved");
    assert_eq!(resolved["decision"], "deny");
    let completed = frame(&outcome.frames, "tool.completed");
    assert_eq!(completed["isError"], true);
    assert!(
        completed["output"]
            .as_str()
            .unwrap_or_default()
            .contains("denied by the user"),
        "the deny outcome must be explicit in the tool result: {completed}"
    );
    assert!(
        !workspace.file("out.txt").exists(),
        "a denied write must never touch the filesystem"
    );
    assert_eq!(
        frame(&outcome.frames, "result")["response"],
        "Understood; leaving out.txt untouched."
    );
}
