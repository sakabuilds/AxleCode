// @effect-diagnostics nodeBuiltinImport:off - the plugin worker stub exercises the Node HTTP boundary.
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@axle/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/unstable/ai";
import * as NodeHttp from "node:http";

import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

class PluginWorkerStubError extends Data.TaggedError("PluginWorkerStubError")<{
  readonly message: string;
}> {}

const environmentId = EnvironmentId.make("environment-plugin-toolkit-test");
const threadId = ThreadId.make("thread-plugin-toolkit-test");
const providerInstanceId = ProviderInstanceId.make("codex");
const pluginSessionToken = "test-plugin-session-token-123456";

const invocationWithoutPluginSession = {
  environmentId,
  threadId,
  providerSessionId: "provider-session-plugin-toolkit-test",
  providerInstanceId,
  capabilities: new Set<McpInvocationContext.McpCapability>(["preview"]),
  issuedAt: 1,
  expiresAt: Number.MAX_SAFE_INTEGER,
} satisfies McpInvocationContext.McpInvocationScope;

const invocation: McpInvocationContext.McpInvocationScope = {
  ...invocationWithoutPluginSession,
  pluginSessionToken,
};

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  initializePayload: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "plugin-toolkit-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const decodeJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);
const encodeJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);

interface CapturedWorkerRequest {
  readonly authorization: string | undefined;
  readonly toolName: string | undefined;
  readonly toolArguments: Record<string, unknown> | undefined;
}

type WorkerEnvelope =
  | { readonly result: { readonly structuredContent: unknown } }
  | { readonly error: { readonly message: string } };

const readToolFields = (parsed: unknown) => {
  if (typeof parsed !== "object" || parsed === null) {
    return { toolName: undefined, toolArguments: undefined };
  }
  const params = (parsed as { readonly params?: unknown }).params;
  if (typeof params !== "object" || params === null) {
    return { toolName: undefined, toolArguments: undefined };
  }
  const name = (params as { readonly name?: unknown }).name;
  const rawArguments = (params as { readonly arguments?: unknown }).arguments;
  return {
    toolName: typeof name === "string" ? name : undefined,
    toolArguments:
      typeof rawArguments === "object" && rawArguments !== null
        ? (rawArguments as Record<string, unknown>)
        : undefined,
  };
};

const withPluginWorker = (respond: (request: CapturedWorkerRequest) => WorkerEnvelope) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const worker = yield* Effect.tryPromise({
        try: () =>
          new Promise<{
            readonly requests: CapturedWorkerRequest[];
            readonly url: string;
            readonly close: () => Promise<void>;
          }>((resolve, reject) => {
            const requests: CapturedWorkerRequest[] = [];
            const server = NodeHttp.createServer((httpRequest, response) => {
              const chunks: Buffer[] = [];
              httpRequest.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              });
              httpRequest.on("end", () => {
                const parsed = decodeJson(Buffer.concat(chunks).toString("utf8"));
                const { toolName, toolArguments } = readToolFields(parsed);
                const request: CapturedWorkerRequest = {
                  authorization: httpRequest.headers.authorization,
                  toolName,
                  toolArguments,
                };
                requests.push(request);
                response.writeHead(200, { "content-type": "application/json" });
                response.end(encodeJson(respond(request)));
              });
            });
            server.on("error", reject);
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              if (address === null || typeof address === "string") {
                reject(
                  new PluginWorkerStubError({ message: "Expected a TCP plugin worker address." }),
                );
                return;
              }
              resolve({
                requests,
                url: `http://127.0.0.1:${address.port}`,
                close: () =>
                  new Promise<void>((resolveClose, rejectClose) => {
                    server.close((error) => (error ? rejectClose(error) : resolveClose()));
                  }),
              });
            });
          }),
        catch: (cause) =>
          new PluginWorkerStubError({
            message: `Failed to start the plugin worker stub: ${String(cause)}`,
          }),
      });
      const previousUrl = process.env.AXLE_PLUGIN_WORKER_URL;
      process.env.AXLE_PLUGIN_WORKER_URL = worker.url;
      return {
        ...worker,
        restoreEnvironment: () => {
          if (previousUrl === undefined) delete process.env.AXLE_PLUGIN_WORKER_URL;
          else process.env.AXLE_PLUGIN_WORKER_URL = previousUrl;
        },
      };
    }),
    (worker) =>
      Effect.gen(function* () {
        worker.restoreEnvironment();
        yield* Effect.promise(() => worker.close());
      }),
  );

const makePluginToolkitLayer = (
  brokerCalls: Array<PreviewAutomationBroker.PreviewAutomationInvokeInput>,
) =>
  McpHttpServer.PluginToolkitRegistrationLive.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(
      Layer.mock(PreviewAutomationBroker.PreviewAutomationBroker)({
        invoke: ((request: PreviewAutomationBroker.PreviewAutomationInvokeInput) => {
          brokerCalls.push(request);
          return Effect.succeed({ comments: [{ id: "comment-1" }], error: null });
        }) as PreviewAutomationBroker.PreviewAutomationBroker["Service"]["invoke"],
      }),
    ),
  );

it.effect(
  "proxies plugin authorization and calls through the worker with the invocation session token",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const worker = yield* withPluginWorker((request) => ({
          result: {
            structuredContent:
              request.toolName === "axle_request_plugin_authorization"
                ? { status: "pending", authorizationUrl: "https://example.test/authorize" }
                : { ok: true, action: request.toolArguments?.action ?? null },
          },
        }));
        const server = yield* McpServer.McpServer;

        const pluginCall = yield* server
          .callTool({
            name: "axle_plugin_call",
            arguments: {
              pluginId: "gmail",
              action: "send_email",
              input: { to: "user@example.test" },
            },
          })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
        expect(pluginCall.isError).not.toBe(true);
        expect(pluginCall.structuredContent).toEqual({ ok: true, action: "send_email" });

        const authorization = yield* server
          .callTool({ name: "axle_request_plugin_authorization", arguments: { pluginId: "gmail" } })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
        expect(authorization.isError).not.toBe(true);
        expect(authorization.structuredContent).toEqual({
          status: "pending",
          authorizationUrl: "https://example.test/authorize",
        });

        expect(worker.requests.map(({ authorization: header }) => header)).toEqual([
          `Bearer ${pluginSessionToken}`,
          `Bearer ${pluginSessionToken}`,
        ]);
        expect(worker.requests.map(({ toolName }) => toolName)).toEqual([
          "axle_plugin_call",
          "axle_request_plugin_authorization",
        ]);
        expect(server.tools.map(({ tool }) => tool.name).sort()).toEqual([
          "axle_plugin_call",
          "axle_request_plugin_authorization",
          "getPullRequestComments",
        ]);
      }),
    ).pipe(Effect.provide(makePluginToolkitLayer([]))),
);

it.effect("refuses plugin calls when the invocation has no plugin session token", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const worker = yield* withPluginWorker(() => ({
        result: { structuredContent: { ok: true } },
      }));
      const server = yield* McpServer.McpServer;

      const result = yield* server
        .callTool({
          name: "axle_plugin_call",
          arguments: { pluginId: "gmail", action: "send_email", input: {} },
        })
        .pipe(
          Effect.provideService(
            McpInvocationContext.McpInvocationContext,
            invocationWithoutPluginSession,
          ),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError).not.toBe(true);
      expect(String((result.structuredContent as { readonly error?: unknown }).error)).toContain(
        "unavailable",
      );
      expect(result.structuredContent).toMatchObject({
        pluginId: "gmail",
        action: "send_email",
      });
      expect(worker.requests).toEqual([]);
    }),
  ).pipe(Effect.provide(makePluginToolkitLayer([]))),
);

it.effect("surfaces worker JSON-RPC errors as structured plugin call results", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* withPluginWorker(() => ({ error: { message: "gmail is not connected." } }));
      const server = yield* McpServer.McpServer;

      const result = yield* server
        .callTool({
          name: "axle_plugin_call",
          arguments: { pluginId: "gmail", action: "send_email", input: {} },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        error: "gmail is not connected.",
        pluginId: "gmail",
        action: "send_email",
      });
    }),
  ).pipe(Effect.provide(makePluginToolkitLayer([]))),
);

it.effect("routes getPullRequestComments through the broker with the invocation scope", () => {
  const brokerCalls: Array<PreviewAutomationBroker.PreviewAutomationInvokeInput> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;

      const result = yield* server
        .callTool({
          name: "getPullRequestComments",
          arguments: { repository: "owner/repo", number: 7 },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ comments: [{ id: "comment-1" }], error: null });
      expect(brokerCalls).toHaveLength(1);
      expect(brokerCalls[0]).toMatchObject({
        operation: "githubPullRequestComments",
        input: { repository: "owner/repo", number: 7 },
        timeoutMs: 30_000,
      });
      expect(brokerCalls[0]?.scope.threadId).toBe(threadId);
      expect(brokerCalls[0]?.scope.pluginSessionToken).toBe(pluginSessionToken);
    }),
  ).pipe(Effect.provide(makePluginToolkitLayer(brokerCalls)));
});
