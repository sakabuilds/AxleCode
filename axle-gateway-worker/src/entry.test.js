import assert from "node:assert/strict";
import test from "node:test";

import {
  handleRequest,
  hasPaidPlan,
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
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = "axle_test_key";

function request(path, init = {}, token = TOKEN) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://axle-gateway.axle-download-worker.workers.dev/v1${path}`, {
    headers,
    ...init,
  });
}

function environment(store = new MemoryCreditsStore(), extra = {}) {
  return { ledgerStore: store, now: () => FIXED_NOW, UPSTREAM_API_KEY: "upstream-secret", ...extra };
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

test("catalog exposes six real-named models split across free and paid plans", () => {
  assert.equal(AXLE_MODELS.length, 6);
  assert.deepEqual(
    AXLE_MODELS.map((model) => [model.id, model.label, model.plan]),
    [
      ["gemma-4", "Google Gemma 4", "free"],
      ["muse-glimmer", "Meta Muse Glimmer", "free"],
      ["nemotron-3.5-lightning", "Nemotron 3.5 Lightning", "free"],
      ["glm-5.3-flash", "GLM 5.3 Flash", "paid"],
      ["glm-5.3", "GLM 5.3", "paid"],
      ["nemotron-3-super", "Nemotron 3 Super", "paid"],
    ],
  );
  assert.equal(findModel("glm-5.3").upstream, "z-ai/glm-5.3");
  assert.equal(findModel("z-ai/glm-5.3-flash").id, "glm-5.3-flash");
  assert.equal(findModel("nvidia/nemotron-3-super-120b-a12b").id, "nemotron-3-super");
  assert.equal(findModel("nope"), undefined);
  for (const model of AXLE_MODELS) {
    assert.ok(model.creditsPerMillionInput > 0);
    assert.ok(model.creditsPerMillionOutput >= model.creditsPerMillionInput);
  }
});

test("creditsForTokens prices input and output at the model rate", () => {
  // gemma-4: 25 credits / 1M input, 100 credits / 1M output.
  assert.equal(creditsForTokens("gemma-4", 1_000_000, 1_000_000), 125);
  assert.equal(creditsForTokens("gemma-4", 0, 0), 0);
  // Unknown models fail closed rather than billing a guessed rate.
  assert.equal(creditsForTokens("axle-ghost", 100, 100), undefined);
});

test("creditsForUsage accepts OpenAI and Anthropic token spellings", () => {
  const openai = creditsForUsage("gemma-4", { prompt_tokens: 1000, completion_tokens: 500 });
  const anthropic = creditsForUsage("gemma-4", { input_tokens: 1000, output_tokens: 500 });
  assert.equal(openai, anthropic);
  assert.equal(openai, creditsForTokens("gemma-4", 1000, 500));
});

test("the daily grant renews instead of accumulating", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });

  const first = await ledger.ensureDailyGrant("user-1");
  assert.equal(first.granted, true);
  assert.equal(first.balance, DAILY_FREE_CREDITS);

  const second = await ledger.ensureDailyGrant("user-1");
  assert.equal(second.granted, false);
  assert.equal(second.balance, DAILY_FREE_CREDITS);

  // Spend most of the day's credits; a new UTC day resets the free bucket,
  // it does not add to whatever was left.
  await ledger.charge("user-1", 60);
  const tomorrow = new CreditsLedger(store, { now: () => FIXED_NOW + DAY_MS });
  const third = await tomorrow.ensureDailyGrant("user-1");
  assert.equal(third.granted, true);
  assert.equal(third.balance, DAILY_FREE_CREDITS);
  const fourth = await new CreditsLedger(store, { now: () => FIXED_NOW + 2 * DAY_MS }).ensureDailyGrant("user-1");
  assert.equal(fourth.balance, DAILY_FREE_CREDITS);
  assert.notEqual(utcDate(FIXED_NOW), utcDate(FIXED_NOW + DAY_MS));
});

test("spend draws the free bucket first, then plan credits, then paid credits", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  await ledger.ensureDailyGrant("user-1");
  await ledger.planCredit("user-1", 1_000, "evt_plan_1");
  await ledger.credit("user-1", 500, { kind: "purchase" }, "evt_topup_1");

  const bucketsBefore = await ledger.buckets("user-1");
  assert.deepEqual(bucketsBefore, { free: 100, plan: 1_000, paid: 500 });
  assert.equal(await ledger.balance("user-1"), 1_600);

  // 40 free + 40 of the plan bucket: spend draws free first.
  await ledger.charge("user-1", 140);
  assert.deepEqual(await ledger.buckets("user-1"), { free: 0, plan: 960, paid: 500 });

  // Then the remaining plan bucket, and finally paid credits.
  await ledger.charge("user-1", 1_060);
  assert.deepEqual(await ledger.buckets("user-1"), { free: 0, plan: 0, paid: 400 });

  const rejected = await ledger.charge("user-1", 500);
  assert.equal(rejected.charged, false);
  assert.equal(rejected.balance, 400);
  assert.equal(await ledger.balance("user-1"), 400);
});

test("plan grants set the bucket and are idempotent per reference", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });

  const first = await ledger.planCredit("user-1", 2_000, "evt_1");
  assert.equal(first.applied, true);
  const retry = await ledger.planCredit("user-1", 2_000, "evt_1");
  assert.equal(retry.applied, false);
  assert.equal(await ledger.balance("user-1"), 2_000);

  // A new event (next month, or an upgrade) replaces, never accumulates.
  const nextMonth = await ledger.planCredit("user-1", 4_000, "evt_2");
  assert.equal(nextMonth.applied, true);
  assert.equal(await ledger.balance("user-1"), 4_000);
});

test("purchased credits persist and are idempotent per reference", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });

  const first = await ledger.credit("user-1", 1_000, { kind: "purchase" }, "evt_topup_1");
  assert.equal(first.applied, true);
  const retry = await ledger.credit("user-1", 1_000, { kind: "purchase" }, "evt_topup_1");
  assert.equal(retry.applied, false);
  assert.equal(await ledger.balance("user-1"), 1_000);

  const buckets = await ledger.buckets("user-1");
  assert.deepEqual(buckets, { free: 0, plan: 0, paid: 1_000 });
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

test("GET /v1/models lists the six Axle models with their plan", async () => {
  const response = await handleRequest(request("/models", { method: "GET" }), environment());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 6);
  assert.equal(body.data[0].owned_by, "axle");
  assert.equal(body.data[0].axle.plan, "free");
  assert.equal(body.data[3].axle.plan, "paid");
  assert.equal(body.data[4].name, "GLM 5.3");
});

test("GET /v1/credits renews the free bucket and reports all three buckets", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  const userId = await resolveUserId(request("/credits"));
  await ledger.planCredit(userId, 2_000, "evt_plan_1");
  await ledger.credit(userId, 250, { kind: "purchase" }, "evt_topup_1");

  const response = await handleRequest(
    request("/credits", { method: "GET" }),
    environment(store),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.credits, DAILY_FREE_CREDITS + 2_000 + 250);
  assert.equal(body.free_credits, DAILY_FREE_CREDITS);
  assert.equal(body.plan_credits, 2_000);
  assert.equal(body.paid_credits, 250);
  assert.equal(body.daily_free_credits, DAILY_FREE_CREDITS);
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
  await ledger.charge(userId, 12.5, { model: "gemma-4", reserved: true });
  await ledger.credit(userId, 4, { model: "gemma-4", kind: "refund" });

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
  assert.equal(body.entries[1].model, "gemma-4");
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

test("paid models require a paid plan and fail open when billing is unreachable", async () => {
  const paidModel = JSON.stringify({
    model: "glm-5.3",
    max_tokens: 256,
    messages: [{ role: "user", content: "hi" }],
  });

  // No account API configured: the gateway stays open.
  assert.equal(await hasPaidPlan("user-open", environment()), true);

  // The gateway hashes a bearer token into the user id it asks billing about.
  async function hashedUserId(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  }
  const roles = new Map();
  roles.set(await hashedUserId("axl_free_plan_user"), "free");
  roles.set(await hashedUserId("axl_paid_plan_user"), "paid");
  roles.set(await hashedUserId("axl_outage_user"), "outage");

  const chatUpstream = () =>
    Response.json({
      id: "chatcmpl-1",
      choices: [{ message: { role: "assistant", content: "hi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

  await withStubbedFetch(
    async (url) => {
      if (String(url).includes("/v1/billing/plan")) {
        const role = roles.get(new URL(String(url)).searchParams.get("user_id") ?? "") ?? "free";
        if (role === "outage") return new Response("boom", { status: 500 });
        return Response.json({ planId: role === "paid" ? "pro" : "free", paid: role === "paid" });
      }
      return chatUpstream();
    },
    async () => {
      const freeUser = await handleRequest(
        request("/chat/completions", { method: "POST", body: paidModel }, "axl_free_plan_user"),
        environment(new MemoryCreditsStore(), {
          ACCOUNT_API_URL: "https://accounts.example.test",
          INTERNAL_API_TOKEN: "internal-secret",
        }),
      );
      assert.equal(freeUser.status, 403);
      const body = await freeUser.json();
      assert.equal(body.error.code, "axle_plan_required");

      const paidUser = await handleRequest(
        request("/chat/completions", { method: "POST", body: paidModel }, "axl_paid_plan_user"),
        environment(new MemoryCreditsStore(), {
          ACCOUNT_API_URL: "https://accounts.example.test",
          INTERNAL_API_TOKEN: "internal-secret",
        }),
      );
      assert.equal(paidUser.status, 200);

      const outage = await handleRequest(
        request("/chat/completions", { method: "POST", body: paidModel }, "axl_outage_user"),
        environment(new MemoryCreditsStore(), {
          ACCOUNT_API_URL: "https://accounts.example.test",
          INTERNAL_API_TOKEN: "internal-secret",
        }),
      );
      assert.equal(outage.status, 200);
    },
  );
  // With the stub still in place, an explicit billing outage fails open.
  const failing = await withStubbedFetch(
    async (url) => {
      if (String(url).includes("/v1/billing/plan")) {
        return new Response("boom", { status: 500 });
      }
      return chatUpstream();
    },
    () =>
      handleRequest(
        request("/chat/completions", { method: "POST", body: paidModel }, "axl_outage_2"),
        environment(new MemoryCreditsStore(), {
          ACCOUNT_API_URL: "https://accounts.example.test",
          INTERNAL_API_TOKEN: "internal-secret",
        }),
      ),
  );
  assert.equal(failing.status, 200);
});

test("the internal credit route applies purchases and plan grants idempotently", async () => {
  const store = new MemoryCreditsStore();
  const env = environment(store, { INTERNAL_API_TOKEN: "internal-secret" });
  const internal = (body, token = "internal-secret") =>
    handleRequest(
      request("/internal/credits", { method: "POST", body: JSON.stringify(body) }, token),
      env,
    );

  const unauthorized = await internal({ user_id: "user-1", amount: 100, bucket: "paid", reference: "evt_1" }, "wrong");
  assert.equal(unauthorized.status, 401);
  const unconfigured = await handleRequest(
    request("/internal/credits", {
      method: "POST",
      body: JSON.stringify({ user_id: "user-1", amount: 100, bucket: "paid", reference: "evt_1" }),
    }, "internal-secret"),
    environment(store),
  );
  assert.equal(unconfigured.status, 401);

  const invalid = await internal({ user_id: "user-1", amount: 100, bucket: "store", reference: "evt_1" });
  assert.equal(invalid.status, 400);
  const missing = await internal({ user_id: "user-1", amount: 100, bucket: "paid" });
  assert.equal(missing.status, 400);

  const purchase = await internal({ user_id: "user-1", amount: 1_000, bucket: "paid", reference: "evt_topup_1" });
  assert.equal(purchase.status, 200);
  assert.equal((await purchase.json()).applied, true);
  const purchaseRetry = await internal({ user_id: "user-1", amount: 1_000, bucket: "paid", reference: "evt_topup_1" });
  assert.equal((await purchaseRetry.json()).applied, false);

  const plan = await internal({ user_id: "user-1", amount: 2_000, bucket: "plan", reference: "evt_plan_1" });
  assert.equal((await plan.json()).applied, true);
  const planRetry = await internal({ user_id: "user-1", amount: 2_000, bucket: "plan", reference: "evt_plan_1" });
  assert.equal((await planRetry.json()).applied, false);

  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  assert.deepEqual(await ledger.buckets("user-1"), { free: 0, plan: 2_000, paid: 1_000 });
});

test("a completed turn charges actual usage and refunds the reservation", async () => {
  const store = new MemoryCreditsStore();
  const env = environment(store);
  let upstreamBody;

  await withStubbedFetch(
    async (url, init) => {
      upstreamBody = JSON.parse(init.body);
      assert.match(String(url), /integrate\.api\.nvidia\.com\/v1\/chat\/completions$/u);
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
          body: JSON.stringify({ model: "gemma-4", messages: [{ role: "user", content: "hi" }] }),
        }),
        env,
      );
      assert.equal(response.status, 200);
      const actual = creditsForUsage("gemma-4", { prompt_tokens: 1000, completion_tokens: 500 });
      assert.equal(response.headers.get("x-axle-credits-charged"), String(actual));
      assert.equal(Number(response.headers.get("x-axle-credits-remaining")), DAILY_FREE_CREDITS - actual);
    },
  );

  assert.equal(upstreamBody.model, "google/gemma-4-31b-it");
  const userId = await resolveUserId(request("/chat/completions"));
  assert.equal(
    await new CreditsLedger(store, { now: () => FIXED_NOW }).balance(userId),
    DAILY_FREE_CREDITS - creditsForUsage("gemma-4", { prompt_tokens: 1000, completion_tokens: 500 }),
  );
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
        model: "glm-5.3",
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
  const small = reserveCredits("glm-5.3", { messages: [], max_tokens: 256 });
  const large = reserveCredits("glm-5.3", { messages: [], max_tokens: 4096 });
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
            model: "gemma-4",
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
  const expected =
    DAILY_FREE_CREDITS - creditsForUsage("gemma-4", { prompt_tokens: 1000, completion_tokens: 500 });
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
