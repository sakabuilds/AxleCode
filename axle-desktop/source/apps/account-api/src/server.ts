// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { createAccountAuthenticator } from "./auth.ts";
import { readAccountApiConfig } from "./config.ts";
import { createAccountDatabase } from "./database.ts";
import { readBillingConfig } from "./billingConfig.ts";
import { readCloudConfig } from "./cloudConfig.ts";
import { createCloudRequestHandler } from "./cloudHandler.ts";
import { createCloudDatabase, createCloudJobStore } from "./cloudStore.ts";
import { createAccountRequestHandler, RequestValidationError } from "./handler.ts";

const localEnvFile = NodeURL.fileURLToPath(new URL("../.env.local", import.meta.url));
if (NodeFS.existsSync(localEnvFile)) NodeProcess.loadEnvFile(localEnvFile);

const config = readAccountApiConfig();
const database = createAccountDatabase(config);
const authenticate = createAccountAuthenticator(config);
const cloudConfig = readCloudConfig(NodeProcess.env);
const billingConfig = readBillingConfig(NodeProcess.env);
const cloudDatabase = cloudConfig ? createCloudDatabase(config.databaseUrl) : null;
const handleCloudRequest = createCloudRequestHandler({
  config: cloudConfig,
  billing: billingConfig,
  store: cloudConfig && cloudDatabase ? createCloudJobStore(cloudDatabase.query, cloudConfig, billingConfig) : null,
  authenticate,
  touchSession: database.touchSession,
  corsOrigin: config.corsOrigin,
});
const handleRequest = createAccountRequestHandler({
  database,
  authenticate,
  corsOrigin: config.corsOrigin,
});

const server = NodeHttp.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const body = await readBody(request);
    const webRequest = toWebRequest(request, body, url);
    const result = await handleCloudRequest(webRequest) ?? await handleRequest(webRequest);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
  } catch (error) {
    const invalid = error instanceof RequestValidationError;
    if (!invalid) console.error("Account API transport failed", { method: request.method });
    response.writeHead(invalid ? 400 : 500, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": config.corsOrigin,
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ error: invalid ? error.message : "internal_error" }));
  }
});

await database.migrate();
await cloudDatabase?.migrate();
server.listen(config.port, config.host, () => {
  console.log(`Axle account API listening on ${config.host}:${config.port}`);
});

function toWebRequest(request: NodeHttp.IncomingMessage, body: string, url: URL): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return new Request(url, {
    method: request.method ?? "GET",
    headers,
    ...(body.length > 0 ? { body } : {}),
  });
}

async function readBody(request: NodeHttp.IncomingMessage): Promise<string> {
  const chunks: Array<Buffer> = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 256 * 1024) {
      throw new RequestValidationError("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
