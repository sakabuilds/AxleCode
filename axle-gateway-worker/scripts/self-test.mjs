// One command that proves the gateway works: `npm run self-test`.
//
// Boots the real worker with a stubbed upstream, checks the catalog, the
// credit grant, exact charge math, the 402 gate, and auth — then, when a
// built `axle` binary is present, drives a real turn through it.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { startGateway } from "./lib/gateway-server.mjs";

// Capture the real fetch before the gateway swaps in its stub, so this
// script's own HTTP calls still leave the process.
const clientFetch = globalThis.fetch;

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail === undefined ? "" : ` -> ${detail}`}`);
  }
}

const KEY = "axle_self_test_key";
const auth = { Authorization: `Bearer ${KEY}` };
const json = { "Content-Type": "application/json" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const gateway = await startGateway({ port: 0 });
const base = gateway.url;
console.log(`Gateway: ${base}\n`);

console.log("Catalog and grant");
const models = await (await clientFetch(`${base}/v1/models`)).json();
check("four models are listed", models.data.length === 4, models.data.length);
check(
  "models are the tiered Axle ids",
  models.data.map((model) => model.id).join(",") ===
    "axle-20b,axle-55b,axle-320b,axle-552b",
);

const credits = await (await clientFetch(`${base}/v1/credits`, { headers: auth })).json();
check("daily grant is 100 credits", credits.credits === 100, credits.credits);
check("100 credits is $0.50", credits.balance_usd === 0.5, credits.balance_usd);

console.log("\nMetering");
const core = await clientFetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { ...auth, ...json },
  body: JSON.stringify({ model: "axle-320b", messages: [{ role: "user", content: "hi" }] }),
});
check("non-streaming turn succeeds", core.status === 200, core.status);
check(
  "charge matches the axle-320b rate",
  core.headers.get("x-axle-credits-charged") === "0.0042",
  core.headers.get("x-axle-credits-charged"),
);
check(
  "balance after the turn is exact",
  core.headers.get("x-axle-credits-remaining") === "99.9958",
  core.headers.get("x-axle-credits-remaining"),
);

const stream = await clientFetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { ...auth, ...json },
  body: JSON.stringify({
    model: "axle-20b",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  }),
});
const streamText = await stream.text();
check("streaming turn returns SSE content", streamText.includes("Hello"));
await sleep(80);
const afterStream = await (await clientFetch(`${base}/v1/credits`, { headers: auth })).json();
check(
  "streamed turn charged real usage (Axle-20b rate)",
  afterStream.credits === 99.99468,
  afterStream.credits,
);

console.log("\nGates");
const insufficient = await clientFetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { ...auth, ...json },
  body: JSON.stringify({
    model: "axle-552b",
    max_tokens: 100000,
    messages: [{ role: "user", content: "hi" }],
  }),
});
const insufficientBody = await insufficient.json();
check("oversized reservation is refused with 402", insufficient.status === 402, insufficient.status);
check(
  "402 carries the shortfall",
  insufficientBody.error?.code === "axle_insufficient_credits" &&
    insufficientBody.error.required > insufficientBody.error.balance,
);

const unknown = await clientFetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { ...auth, ...json },
  body: JSON.stringify({ model: "gpt-4o", messages: [] }),
});
check("unknown model is refused with 400", unknown.status === 400, unknown.status);

const anonymous = await clientFetch(`${base}/v1/credits`);
check("missing key is refused with 401", anonymous.status === 401, anonymous.status);

const otherUser = await (
  await clientFetch(`${base}/v1/credits`, { headers: { Authorization: "Bearer someone_else" } })
).json();
check("a different key gets its own grant", otherUser.credits === 100, otherUser.credits);

console.log("\nReal engine");
const binary = process.env.AXLE_BIN ?? new URL("../../target/release/axle", import.meta.url).pathname;
if (!existsSync(binary)) {
  console.log(`  SKIP  no axle binary at ${binary} (build it or set AXLE_BIN)`);
} else {
  // Must be async: the gateway runs in this process, so blocking the event
  // loop here would stop the server from answering the engine.
  const output = await new Promise((resolve) => {
    const child = spawn(
      binary,
      ["--provider", "axle", "--model", "axle-20b", "--text-only", "-p", "say hi", "--cwd", "/tmp"],
      {
        env: { ...process.env, AXLE_BASE_URL: `${base}/v1`, AXLE_API_KEY: "axle_engine_key" },
      },
    );
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("close", (code) => resolve(text.trim() || `exit ${code}`));
    child.on("error", (error) => resolve(`spawn error: ${error.message}`));
  });
  check("engine turn reaches the gateway", output.includes("Hello from Axle"), output);
}

await gateway.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
