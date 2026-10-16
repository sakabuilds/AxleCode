import assert from "node:assert/strict";
import test from "node:test";

import {
  handleRequest,
  reserveCredits,
  resolveUserId,
  usageScanner,
} from "./entry.js";
import { CreditsLedger, utcDate } from "./ledger.js";
import {
  AXLE_MODELS,
  DAILY_FREE_CREDITS,
  creditsForTokens,
  creditsForUsage,
  findModel,
} from "./pricing.js";
import { MemoryCreditsStore } from "./stores/memory.js";

const FIXED_NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const TOKEN = "axle_test_key";

function request(path, init = {}) {
  return new Request(`https://axle-gateway.axle-download-worker.workers.dev/v1${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    ...init,
  });
}

function environment(store = new MemoryCreditsStore()) {
  return { ledgerStore: store, now: () => FIXED_NOW, UPSTREAM_API_KEY: "upstream-secret" };
}

async function withStubbedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function sseBody(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

test("catalog exposes five tiered models resolvable by Axle or upstream id", () => {
  assert.equal(AXLE_MODELS.length, 5);
  assert.equal(findModel("axle-pro").upstream, "anthropic/claude-sonnet-4");
  assert.equal(findModel("anthropic/claude-sonnet-4").id, "axle-pro");
  assert.equal(findModel("nope"), undefined);

  const tiers = AXLE_MODELS.map((model) => model.tier);
  assert.deepEqual(tiers, [1, 2, 3, 4, 5]);
  for (let index = 1; index < AXLE_MODELS.length; index += 1) {
    assert.ok(
      AXLE_MODELS[index].creditsPerMillionOutput >
        AXLE_MODELS[index - 1].creditsPerMillionOutput,
      "smarter models must cost more per token",
    );
  }
});

test("creditsForTokens prices input and output at the model rate", () => {
  // axle-nano: 40 credits / 1M input, 160 credits / 1M output.
  assert.equal(creditsForTokens("axle-nano", 1_000_000, 1_000_000), 200);
  assert.equal(creditsForTokens("axle-nano", 0, 0), 0);
  // Unknown models fail closed rather than billing a guessed rate.
  assert.equal(creditsForTokens("axle-ghost", 100, 100), undefined);
});

test("creditsForUsage accepts OpenAI and Anthropic token spellings", () => {
  const openai = creditsForUsage("axle-nano", { prompt_tokens: 1000, completion_tokens: 500 });
  const anthropic = creditsForUsage("axle-nano", { input_tokens: 1000, output_tokens: 500 });
  assert.equal(openai, anthropic);
  assert.equal(openai, creditsForTokens("axle-nano", 1000, 500));
});

test("the daily grant lands exactly once per UTC day", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });

  const first = await ledger.ensureDailyGrant("user-1");
  assert.equal(first.granted, true);
  assert.equal(first.balance, DAILY_FREE_CREDITS);

  const second = await ledger.ensureDailyGrant("user-1");
  assert.equal(second.granted, false);
  assert.equal(second.balance, DAILY_FREE_CREDITS);

  const tomorrow = new CreditsLedger(store, { now: () => FIXED_NOW + 24 * 60 * 60 * 1000 });
  const third = await tomorrow.ensureDailyGrant("user-1");
  assert.equal(third.granted, true);
  assert.equal(third.balance, DAILY_FREE_CREDITS * 2);
  assert.notEqual(utcDate(FIXED_NOW), utcDate(FIXED_NOW + 24 * 60 * 60 * 1000));
});

test("a charge never overdraws the balance", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  await ledger.ensureDailyGrant("user-1");

  const ok = await ledger.charge("user-1", 60);
  assert.equal(ok.charged, true);
  assert.equal(ok.balance, 40);

  const rejected = await ledger.charge("user-1", 60);
  assert.equal(rejected.charged, false);
  assert.equal(rejected.balance, 40);
  assert.equal(await ledger.balance("user-1"), 40);
});

test("GET /v1/models lists the five Axle models", async () => {
  const response = await handleRequest(request("/models", { method: "GET" }), environment());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 5);
  assert.equal(body.data[0].owned_by, "axle");
});

test("GET /v1/credits grants the free daily balance and reports USD", async () => {
  const response = await handleRequest(request("/credits", { method: "GET" }), environment());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.credits, DAILY_FREE_CREDITS);
  assert.equal(body.balance_usd, 0.5);
});

test("requests without an Axle key are rejected", async () => {
  const anonymous = new Request("https://axle-gateway.axle-download-worker.workers.dev/v1/credits");
  const response = await handleRequest(anonymous, environment());
  assert.equal(response.status, 401);
});

test("GET /v1/usage reports the ledger behind the balance, newest first", async () => {
  const store = new MemoryCreditsStore();
  const env = environment(store);
  const userId = await resolveUserId(request("/usage"));

  // A grant, then a spend whose real cost was refunded down.
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  await ledger.ensureDailyGrant(userId);
  await ledger.charge(userId, 12.5, { model: "axle-nano", reserved: true });
  await ledger.credit(userId, 4, { model: "axle-nano", kind: "refund" });

  const response = await handleRequest(request("/usage", { method: "GET" }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.object, "axle.usage");
  assert.equal(body.credit_usd, 0.005);
  assert.equal(body.entries.length, 3);
  assert.deepEqual(
    body.entries.map((entry) => [entry.kind, entry.credits]),
    [
      ["top_up", 4],
      ["spend", -12.5],
      ["daily_grant", 100],
    ],
  );
  assert.equal(body.entries[1].model, "axle-nano");
  assert.equal(body.entries[0].balance_after, 91.5);
  assert.equal(body.entries[0].created_at, FIXED_NOW);
});

test("GET /v1/usage rejects an anonymous caller and clamps its limit", async () => {
  const anonymous = new Request("https://axle-gateway.axle-download-worker.workers.dev/v1/usage");
  assert.equal((await handleRequest(anonymous, environment())).status, 401);

  const store = new MemoryCreditsStore();
  const env = environment(store);
  const userId = await resolveUserId(request("/usage"));
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  await ledger.ensureDailyGrant(userId);
  for (let index = 0; index < 5; index += 1) await ledger.charge(userId, 1);

  const limited = await handleRequest(request("/usage?limit=2", { method: "GET" }), env);
  assert.equal((await limited.json()).entries.length, 2);

  const absurd = await handleRequest(request("/usage?limit=9999", { method: "GET" }), env);
  assert.equal(absurd.status, 200);
  assert.ok((await absurd.json()).entries.length <= 100);
});

test("an unknown model is refused before any upstream call", async () => {
  const response = await handleRequest(
    request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    }),
    environment(),
  );
  assert.equal(response.status, 400);
  assert.match(JSON.stringify(await response.json()), /Unknown model/u);
});

test("a completed turn charges actual usage and refunds the reservation", async () => {
  const store = new MemoryCreditsStore();
  const env = environment(store);
  let upstreamBody;

  await withStubbedFetch(
    async (url, init) => {
      upstreamBody = JSON.parse(init.body);
      assert.match(String(url), /openrouter\.ai\/api\/v1\/chat\/completions$/u);
      return Response.json({
        id: "chatcmpl-1",
        model: upstreamBody.model,
        choices: [{ message: { role: "assistant", content: "hi" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      });
    },
    async () => {
      const response = await handleRequest(
        request("/chat/completions", {
          method: "POST",
          body: JSON.stringify({ model: "axle-nano", messages: [{ role: "user", content: "hi" }] }),
        }),
        env,
      );
      assert.equal(response.status, 200);
      const actual = creditsForUsage("axle-nano", { prompt_tokens: 1000, completion_tokens: 500 });
      assert.equal(response.headers.get("x-axle-credits-charged"), String(actual));
      assert.equal(Number(response.headers.get("x-axle-credits-remaining")), DAILY_FREE_CREDITS - actual);
    },
  );

  assert.equal(upstreamBody.model, "openai/gpt-4o-mini");
  const userId = await resolveUserId(request("/chat/completions"));
  assert.equal(await new CreditsLedger(store, { now: () => FIXED_NOW }).balance(userId), DAILY_FREE_CREDITS - creditsForUsage("axle-nano", { prompt_tokens: 1000, completion_tokens: 500 }));
});

test("a request reserves more than the balance is refused with 402", async () => {
  const store = new MemoryCreditsStore();
  const env = environment(store);
  const userId = await resolveUserId(request("/chat/completions"));
  // Pre-seed today's grant so the request cannot collect the free 100 credits.
  await store.grantDaily(userId, utcDate(FIXED_NOW), 0.5);

  const response = await handleRequest(
    request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "axle-max",
        max_tokens: 16384,
        messages: [{ role: "user", content: "hello" }],
      }),
    }),
    env,
  );
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.error.code, "axle_insufficient_credits");
  assert.ok(body.error.required > body.error.balance);
});

test("reserveCredits uses max_tokens when present", () => {
  const small = reserveCredits("axle-core", { messages: [], max_tokens: 256 });
  const large = reserveCredits("axle-core", { messages: [], max_tokens: 4096 });
  assert.ok(large > small);
  assert.equal(reserveCredits("axle-ghost", { messages: [] }), undefined);
});

test("streaming turns are charged from the usage chunk after the stream ends", async () => {
  const store = new MemoryCreditsStore();
  const env = environment(store);
  const scheduled = [];
  const ctx = { waitUntil: (promise) => scheduled.push(promise) };

  await withStubbedFetch(
    async () =>
      new Response(
        sseBody([
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":500}}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    async () => {
      const response = await handleRequest(
        request("/chat/completions", {
          method: "POST",
          body: JSON.stringify({
            model: "axle-nano",
            stream: true,
            messages: [{ role: "user", content: "hi" }],
          }),
        }),
        env,
        ctx,
      );
      assert.equal(response.status, 200);
      // Drain the stream so the scanner flushes and settlement is scheduled.
      await response.text();
      await Promise.all(scheduled);
    },
  );

  const userId = await resolveUserId(request("/chat/completions"));
  const expected = DAILY_FREE_CREDITS - creditsForUsage("axle-nano", { prompt_tokens: 1000, completion_tokens: 500 });
  assert.equal(await new CreditsLedger(store, { now: () => FIXED_NOW }).balance(userId), expected);
});

test("usageScanner ignores non-usage lines and tolerates split chunks", () => {
  const seen = [];
  const scanner = usageScanner((usage) => seen.push(usage));
  const writer = scanner.writable.getWriter();
  const parts = ['data: {"choices":[{"d', 'elta":{"content":"x"}}]}\n\n', 'data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n'];
  for (const part of parts) writer.write(new TextEncoder().encode(part));
  writer.close();
  return scanner.readable
    .pipeTo(new WritableStream({ write() {} }))
    .then(() => {
      assert.deepEqual(seen, [{ prompt_tokens: 1, completion_tokens: 2 }]);
    });
});
