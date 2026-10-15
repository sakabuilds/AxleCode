// Boots the real gateway worker on a plain Node HTTP server so it can be
// exercised locally — by curl, by the `axle` binary, or by the self-test —
// with no Cloudflare account, no D1 database, and no upstream API key.
import http from "node:http";

import { handleRequest } from "../../src/entry.js";
import { MemoryCreditsStore } from "../../src/stores/memory.js";

/**
 * A stand-in for the upstream provider. It returns deterministic content and
 * usage (12 prompt + 4 completion tokens) so charge math can be asserted
 * exactly, and it honors `stream: true` with a real SSE body so the gateway's
 * streaming meter is exercised too.
 */
export function installStubUpstream() {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    if (body.stream) {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" from Axle"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\n',
        "data: [DONE]\n\n",
      ];
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }
    return Response.json({
      id: "chatcmpl-local",
      object: "chat.completion",
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello from Axle (local upstream)." },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    });
  };
  return {
    restore() {
      globalThis.fetch = original;
    },
    get calls() {
      return calls;
    },
  };
}

/**
 * Start the gateway. Returns the bound `url`, the credits `store`, and a
 * `close()` handle. `port: 0` picks a free port.
 */
export async function startGateway({ port = 0, env = {}, stubUpstream = true } = {}) {
  const upstream = stubUpstream ? installStubUpstream() : undefined;
  const store = env.ledgerStore ?? new MemoryCreditsStore();
  const gatewayEnv = { UPSTREAM_API_KEY: "local-upstream-key", ...env, ledgerStore: store };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await handleRequest(request, gatewayEnv, {
      waitUntil: (promise) => promise.catch(() => undefined),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    store,
    upstream,
    close: () =>
      new Promise((resolve) => {
        // Tests and the CLI use keep-alive sockets; drop them so close()
        // does not wait for an idle connection to time out.
        server.closeAllConnections?.();
        server.close(resolve);
        upstream?.restore();
      }),
  };
}
