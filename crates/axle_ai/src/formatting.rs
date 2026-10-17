use crate::types::{ContentPart, Message, Role, ToolParamSchema};
use serde_json::{json, Value};

pub fn openai_messages(messages: &[Message]) -> Vec<Value> {
    fn openai_user_content(message: &Message) -> Value {
        if !message
            .content
            .iter()
            .any(|part| matches!(part, ContentPart::Image { .. }))
        {
            return Value::String(message.text());
        }
        Value::Array(
            message
                .content
                .iter()
                .filter_map(|part| match part {
                    ContentPart::Text { text } => Some(json!({ "type": "text", "text": text })),
                    ContentPart::Image { data, mime_type } => Some(json!({
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{mime_type};base64,{data}"),
                        },
                    })),
                    ContentPart::Thinking { thinking, .. } => {
                        Some(json!({ "type": "text", "text": thinking }))
                    }
                    ContentPart::ProviderState { .. } => None,
                })
                .collect(),
        )
    }

    messages
        .iter()
        .filter_map(|message| match &message.role {
            Role::System => Some(json!({ "role": "system", "content": message.text() })),
            Role::User | Role::Custom(_) => {
                Some(json!({ "role": "user", "content": openai_user_content(message) }))
            }
            Role::Assistant => {
                let text = message.text();
                let has_tool_calls = message
                    .tool_calls
                    .as_ref()
                    .map(|calls| !calls.is_empty())
                    .unwrap_or(false);

                // Skip assistant messages with no text and no tool calls — they'd
                // produce an empty "content" field that strict OpenAI-compatible
                // endpoints reject with HTTP 400.
                if text.is_empty() && !has_tool_calls {
                    return None;
                }

                // The OpenAI API spec says content should be `null` when there are
                // tool calls and no text, NOT an empty string. Strict-compatible
                // endpoints reject `"content": ""`.
                let mut value = if text.is_empty() {
                    json!({ "role": "assistant", "content": null })
                } else {
                    json!({ "role": "assistant", "content": text })
                };

                if let Some(tool_calls) = &message.tool_calls {
                    if !tool_calls.is_empty() {
                        value["tool_calls"] = json!(tool_calls
                            .iter()
                            .map(|call| json!({
                                "id": call.id,
                                "type": "function",
                                "function": {
                                    "name": call.name,
                                    "arguments": call.arguments.to_string(),
                                }
                            }))
                            .collect::<Vec<_>>());
                    }
                }
                // Thinking-capable endpoints (DeepSeek-style reasoning models
                // behind OpenRouter/AgentRouter-style relays) reject follow-up
                // requests that drop the assistant turn's reasoning with
                // "content[].thinking ... must be passed back". Replay recorded
                // thinking exactly once, under the field those APIs stream.
                let reasoning: Vec<&str> = message
                    .content
                    .iter()
                    .filter_map(|part| match part {
                        ContentPart::Thinking { thinking, .. } => Some(thinking.as_str()),
                        _ => None,
                    })
                    .collect();
                if !reasoning.is_empty() {
                    value["reasoning_content"] = json!(reasoning.join("\n\n"));
                }
                Some(value)
            }
            Role::Tool => message.tool_result.as_ref().map(|result| {
                json!({
                    "role": "tool",
                    "tool_call_id": result.tool_call_id,
                    "content": result.output,
                })
            }),
        })
        .collect()
}

pub fn openai_tools(tools: &[ToolParamSchema]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": sanitize_tool_parameters(&tool.parameters),
                }
            })
        })
        .collect()
}

/// Normalize a tool parameter schema so strict OpenAI-compatible validators
/// accept it.
///
/// Some endpoints (notably relays that validate against the stricter Codex
/// schema rules) reject object schemas whose `required` field is absent and
/// fail the whole request with `Invalid schema for function 'ls': null is not
/// of type "array"`. Fill in the missing `required` array and recurse into
/// nested object schemas so MCP-provided tools are covered too.
pub fn sanitize_tool_parameters(parameters: &Value) -> Value {
    let Value::Object(map) = parameters else {
        return parameters.clone();
    };
    let mut sanitized = map.clone();
    let is_object_schema = sanitized.contains_key("properties")
        || sanitized.get("type").and_then(Value::as_str) == Some("object");
    if is_object_schema {
        match sanitized.get("required") {
            Some(Value::Array(_)) => {}
            _ => {
                sanitized.insert("required".to_string(), Value::Array(Vec::new()));
            }
        }
        if let Some(Value::Object(properties)) = sanitized.get("properties") {
            let properties: serde_json::Map<String, Value> = properties
                .iter()
                .map(|(name, schema)| (name.clone(), sanitize_tool_parameters(schema)))
                .collect();
            sanitized.insert("properties".to_string(), Value::Object(properties));
        }
    }
    if let Some(items) = sanitized.get("items") {
        let items = sanitize_tool_parameters(items);
        sanitized.insert("items".to_string(), items);
    }
    Value::Object(sanitized)
}

pub fn anthropic_messages(messages: &[Message]) -> (String, Vec<Value>) {
    let mut system = String::new();
    let mut formatted: Vec<Value> = Vec::new();

    // Temporary accumulator for consecutive tool results
    let mut pending_tool_results: Vec<Value> = Vec::new();

    fn flush_tool_results(formatted: &mut Vec<Value>, results: &mut Vec<Value>) {
        if results.is_empty() {
            return;
        }
        formatted.push(json!({
            "role": "user",
            "content": std::mem::take(results),
        }));
    }

    for message in messages {
        match &message.role {
            Role::System => {
                flush_tool_results(&mut formatted, &mut pending_tool_results);
                system.push_str(&message.text());
                system.push('\n');
            }
            Role::User | Role::Custom(_) => {
                flush_tool_results(&mut formatted, &mut pending_tool_results);
                let mut content = Vec::new();
                for part in &message.content {
                    match part {
                        ContentPart::Text { text } => {
                            content.push(json!({ "type": "text", "text": text }));
                        }
                        ContentPart::Image { data, mime_type } => {
                            content.push(json!({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": mime_type,
                                    "data": data,
                                },
                            }));
                        }
                        ContentPart::Thinking { thinking, .. } => {
                            content.push(json!({ "type": "text", "text": thinking }));
                        }
                        ContentPart::ProviderState { .. } => {}
                    }
                }
                formatted.push(json!({ "role": "user", "content": content }));
            }
            Role::Assistant => {
                flush_tool_results(&mut formatted, &mut pending_tool_results);
                let mut content = Vec::new();
                if !message.text().is_empty() {
                    content.push(json!({ "type": "text", "text": message.text() }));
                }
                for call in message.tool_calls.clone().unwrap_or_default() {
                    content.push(json!({
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": call.arguments,
                    }));
                }
                // Skip assistant messages with no text and no tool calls — empty content
                // would cause Anthropic to reject the request with HTTP 400.
                if !content.is_empty() {
                    formatted.push(json!({ "role": "assistant", "content": content }));
                }
            }
            Role::Tool => {
                if let Some(result) = &message.tool_result {
                    pending_tool_results.push(json!({
                        "type": "tool_result",
                        "tool_use_id": result.tool_call_id,
                        "content": result.output,
                        "is_error": result.is_error,
                    }));
                }
            }
        }
    }

    flush_tool_results(&mut formatted, &mut pending_tool_results);

    (system.trim().to_string(), formatted)
}

pub fn anthropic_tools(tools: &[ToolParamSchema]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters,
            })
        })
        .collect()
}

pub fn gemini_messages(messages: &[Message]) -> (Option<Value>, Vec<Value>) {
    let mut system = None;
    let mut contents = Vec::new();

    for message in messages {
        match &message.role {
            Role::System => {
                system = Some(json!({ "parts": [{ "text": message.text() }] }));
            }
            Role::User | Role::Custom(_) => contents.push(json!({
                "role": "user",
                "parts": message
                    .content
                    .iter()
                    .filter_map(|part| match part {
                        ContentPart::Text { text }
                        | ContentPart::Thinking { thinking: text, .. } => {
                            Some(json!({ "text": text }))
                        }
                        ContentPart::Image { data, mime_type } => Some(json!({
                            "inline_data": { "mime_type": mime_type, "data": data }
                        })),
                        ContentPart::ProviderState { .. } => None,
                    })
                    .collect::<Vec<_>>(),
            })),
            Role::Assistant => {
                let mut parts = Vec::new();
                if !message.text().is_empty() {
                    parts.push(json!({ "text": message.text() }));
                }
                for call in message.tool_calls.clone().unwrap_or_default() {
                    parts.push(json!({
                        "functionCall": { "name": call.name, "args": call.arguments }
                    }));
                }
                contents.push(json!({ "role": "model", "parts": parts }));
            }
            Role::Tool => {
                if let Some(result) = &message.tool_result {
                    contents.push(json!({
                        "role": "user",
                        "parts": [{
                            "functionResponse": {
                                "name": result.tool_call_id,
                                "response": {
                                    "output": result.output,
                                    "is_error": result.is_error,
                                }
                            }
                        }]
                    }));
                }
            }
        }
    }

    (system, contents)
}

pub fn gemini_tools(tools: &[ToolParamSchema]) -> Value {
    json!([{
        "functionDeclarations": tools
            .iter()
            .map(|tool| json!({
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            }))
            .collect::<Vec<_>>()
    }])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_preserves_assistant_tool_calls_and_results() {
        let messages = vec![
            Message::assistant(
                "",
                Some(vec![crate::types::ToolCall {
                    id: "call-1".to_string(),
                    name: "read".to_string(),
                    arguments: json!({ "path": "README.md" }),
                }]),
            ),
            Message::tool_result("call-1", "contents", false),
        ];

        let formatted = openai_messages(&messages);
        assert_eq!(formatted[0]["tool_calls"][0]["function"]["name"], "read");
        assert_eq!(formatted[1]["tool_call_id"], "call-1");
    }

    #[test]
    fn openai_skips_empty_assistant_messages() {
        let messages = vec![
            Message::user("hello"),
            // An assistant message with no text and no tool_calls — should be skipped
            Message::assistant("", None::<Vec<crate::types::ToolCall>>),
            Message::assistant("hi there", None),
        ];

        let formatted = openai_messages(&messages);

        // The empty assistant should be filtered out: user -> assistant
        assert_eq!(formatted.len(), 2);
        assert_eq!(formatted[0]["role"], "user");
        assert_eq!(formatted[1]["role"], "assistant");
        assert_eq!(formatted[1]["content"], "hi there");
    }

    #[test]
    fn openai_uses_null_content_for_assistant_with_only_tool_calls() {
        let messages = vec![
            Message::user("read a file"),
            Message::assistant(
                "",
                Some(vec![crate::types::ToolCall {
                    id: "call-1".to_string(),
                    name: "read".to_string(),
                    arguments: json!({"path": "README.md"}),
                }]),
            ),
        ];

        let formatted = openai_messages(&messages);

        assert_eq!(formatted.len(), 2);
        assert_eq!(formatted[1]["role"], "assistant");
        // Content should be null, not empty string
        assert!(formatted[1]["content"].is_null());
        assert_eq!(formatted[1]["tool_calls"][0]["function"]["name"], "read");
    }

    #[test]
    fn anthropic_merges_consecutive_tool_results() {
        let messages = vec![
            Message::user("read two files"),
            Message::assistant(
                "",
                Some(vec![
                    crate::types::ToolCall {
                        id: "toolu_1".to_string(),
                        name: "read".to_string(),
                        arguments: json!({ "path": "a.txt" }),
                    },
                    crate::types::ToolCall {
                        id: "toolu_2".to_string(),
                        name: "read".to_string(),
                        arguments: json!({ "path": "b.txt" }),
                    },
                ]),
            ),
            Message::tool_result("toolu_1", "contents of a", false),
            Message::tool_result("toolu_2", "contents of b", false),
            Message::assistant("Here are both files.", None),
        ];

        let (_system, formatted) = anthropic_messages(&messages);

        // Should have: user, assistant (with 2 tool_use), user (1 with 2 tool_results merged), assistant
        assert_eq!(formatted.len(), 4);

        // The third message should be a single user message with TWO tool_result blocks
        assert_eq!(formatted[2]["role"], "user");
        let content = formatted[2]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "tool_result");
        assert_eq!(content[0]["tool_use_id"], "toolu_1");
        assert_eq!(content[1]["type"], "tool_result");
        assert_eq!(content[1]["tool_use_id"], "toolu_2");
    }

    #[test]
    fn anthropic_skips_empty_assistant_content() {
        let messages = vec![
            Message::user("hello"),
            // An assistant message with no text and no tool_calls — should be skipped
            Message::assistant("", None::<Vec<crate::types::ToolCall>>),
            Message::assistant("hi there", None),
        ];

        let (_system, formatted) = anthropic_messages(&messages);

        // The empty assistant should be filtered out: user -> assistant
        assert_eq!(formatted.len(), 2);
        assert_eq!(formatted[0]["role"], "user");
        assert_eq!(formatted[1]["role"], "assistant");
        assert_eq!(formatted[1]["content"][0]["text"], "hi there");
    }

    #[test]
    fn openai_replays_recorded_thinking_as_reasoning_content() {
        let mut assistant = Message::assistant("done", None);
        assistant.content.push(ContentPart::Thinking {
            thinking: "step one".to_string(),
            signature: None,
        });
        let messages = vec![Message::user("go"), assistant];

        let formatted = openai_messages(&messages);

        assert_eq!(formatted[1]["reasoning_content"], "step one");
        assert_eq!(formatted[1]["content"], "done");
    }

    #[test]
    fn assistant_messages_without_thinking_gain_no_reasoning_field() {
        let messages = vec![Message::user("go"), Message::assistant("done", None)];

        let formatted = openai_messages(&messages);

        assert!(formatted[1].get("reasoning_content").is_none());
    }

    #[test]
    fn tool_schemas_gain_a_required_array_before_strict_validation() {
        let tools = vec![ToolParamSchema {
            name: "ls".to_string(),
            description: "List files".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "nested": {
                        "type": "object",
                        "properties": { "deep": { "type": "boolean" } }
                    }
                }
            }),
        }];

        let formatted = openai_tools(&tools);

        assert_eq!(
            formatted[0]["function"]["parameters"]["required"],
            json!([])
        );
        assert_eq!(
            formatted[0]["function"]["parameters"]["properties"]["nested"]["required"],
            json!([])
        );
        assert_eq!(
            formatted[0]["function"]["parameters"]["properties"]["path"],
            json!({ "type": "string" })
        );
    }

    #[test]
    fn sanitizer_preserves_declared_required_arrays_and_array_items() {
        let parameters = json!({
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": { "summary": { "type": "string" } },
                        "required": ["summary"]
                    }
                }
            },
            "required": ["steps"]
        });

        let sanitized = sanitize_tool_parameters(&parameters);

        assert_eq!(sanitized["required"], json!(["steps"]));
        assert_eq!(
            sanitized["properties"]["steps"]["items"]["required"],
            json!(["summary"])
        );
    }
}
