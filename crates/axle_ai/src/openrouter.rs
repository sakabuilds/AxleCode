//! OpenRouter provider adapter.
//!
//! OpenRouter serves an OpenAI-compatible Chat Completions API, so the
//! transport, streaming parser, retry policy, and message formatting are
//! shared with [`OpenAiProvider`] instead of being duplicated. This module
//! pins the vendor-specific pieces: the default API base URL, the API key
//! environment variable, and the attribution header OpenRouter documents
//! for client applications.

use crate::openai::OpenAiProvider;
use crate::provider::{CompletionOptions, EventStream, LlmProvider};
use crate::types::Message;
use async_trait::async_trait;

pub const DEFAULT_OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
pub const OPENROUTER_API_KEY_ENV: &str = "OPENROUTER_API_KEY";

/// Provider adapter for <https://openrouter.ai>.
///
/// OpenRouter's `/chat/completions` endpoint accepts the OpenAI wire format
/// (including streamed tool calls), and the adapter intentionally reuses the
/// OpenAI client for it. Requests carry the documented `X-Title`
/// attribution header so OpenRouter can attribute usage to Axle.
pub struct OpenRouterProvider {
    inner: OpenAiProvider,
}

impl OpenRouterProvider {
    pub fn new(api_key: impl Into<String>, base_url: Option<String>) -> Self {
        let base_url = base_url.unwrap_or_else(|| DEFAULT_OPENROUTER_BASE_URL.to_string());
        Self {
            inner: OpenAiProvider::new_named_with_headers(
                api_key,
                Some(base_url),
                OPENROUTER_API_KEY_ENV,
                "openrouter",
                "OpenRouter",
                vec![("X-Title".to_string(), "Axle".to_string())],
            ),
        }
    }

    #[cfg(test)]
    pub(crate) fn base_url_for_tests(&self) -> &str {
        self.inner.base_url_for_tests()
    }
}

#[async_trait]
impl LlmProvider for OpenRouterProvider {
    fn provider_name(&self) -> &str {
        self.inner.provider_name()
    }

    async fn complete(
        &self,
        messages: &[Message],
        options: &CompletionOptions,
    ) -> anyhow::Result<Message> {
        self.inner.complete(messages, options).await
    }

    async fn stream(
        &self,
        messages: &[Message],
        options: &CompletionOptions,
    ) -> anyhow::Result<EventStream> {
        self.inner.stream(messages, options).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn options() -> CompletionOptions {
        CompletionOptions {
            model: "openai/gpt-4o-mini".to_string(),
            temperature: None,
            max_tokens: Some(64),
            reasoning_effort: None,
            thinking_level: crate::types::ThinkingLevel::Off,
            tools: Vec::new(),
        }
    }

    /// Minimal one-shot HTTP/1.1 server that captures the first request and
    /// replies with a fixed OpenAI chat completion.
    async fn spawn_capture_server() -> (String, tokio::sync::oneshot::Receiver<(String, String)>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut chunk = [0_u8; 4096];
            let (headers, body) = loop {
                let read = stream.read(&mut chunk).await.unwrap();
                if read == 0 {
                    break (String::new(), String::new());
                }
                received.extend_from_slice(&chunk[..read]);
                let Some(header_end) = received.windows(4).position(|window| window == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&received[..header_end]).to_string();
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                let body_start = header_end + 4;
                if received.len() >= body_start + content_length {
                    let body =
                        String::from_utf8_lossy(&received[body_start..body_start + content_length])
                            .to_string();
                    break (headers, body);
                }
            };
            let response_body = json!({
                "choices": [{ "message": { "content": "hello from openrouter" } }]
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream.write_all(response.as_bytes()).await.unwrap();
            let _ = sender.send((headers, body));
        });
        (format!("http://127.0.0.1:{port}/v1"), receiver)
    }

    #[test]
    fn defaults_to_openrouter_endpoint() {
        let provider = OpenRouterProvider::new("test-key", None);
        assert_eq!(provider.provider_name(), "openrouter");
        assert_eq!(provider.base_url_for_tests(), DEFAULT_OPENROUTER_BASE_URL);
    }

    #[tokio::test]
    async fn sends_attribution_header_and_uses_openai_wire_format() {
        let (base_url, captured) = spawn_capture_server().await;
        let provider = OpenRouterProvider::new("test-key", Some(base_url));
        let message = provider
            .complete(&[Message::user("hi")], &options())
            .await
            .unwrap();

        assert_eq!(message.text(), "hello from openrouter");
        assert_eq!(message.provider.as_deref(), Some("openrouter"));

        let (headers, body) = captured.await.unwrap();
        let lower_headers = headers.to_ascii_lowercase();
        assert!(
            lower_headers.contains("authorization: bearer test-key"),
            "headers: {headers}"
        );
        assert!(
            lower_headers.contains("x-title: axle"),
            "headers: {headers}"
        );
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["model"], "openai/gpt-4o-mini");
    }
}
