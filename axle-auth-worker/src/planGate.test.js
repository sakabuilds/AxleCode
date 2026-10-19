import assert from "node:assert/strict";
import test from "node:test";

import { pluginPlanAllows } from "./index.js";

function envWithPlan(plan, calls = []) {
  return {
    ACCOUNT_API_URL: "https://account.invalid",
    INTERNAL_API_TOKEN: "test-token",
    ACCOUNT_API_SERVICE: {
      fetch: async (url, init) => {
        calls.push({ url: String(url), auth: init?.headers?.authorization });
        if (plan === "throw") throw new Error("billing unreachable");
        if (plan === "error") return new Response("nope", { status: 500 });
        return new Response(JSON.stringify({ paid: plan === "paid" }), { status: 200 });
      },
    },
  };
}

test("github and other free plugins skip the plan lookup", async () => {
  assert.equal(await pluginPlanAllows({}, { userId: "user_free" }, "github"), true);
});

test("deployments without billing configuration stay open", async () => {
  assert.equal(await pluginPlanAllows({}, { userId: "user_free" }, "jira"), true);
  assert.equal(
    await pluginPlanAllows(
      { ACCOUNT_API_URL: "https://account.invalid" },
      { userId: "user_free" },
      "jira",
    ),
    true,
  );
});

test("guest sessions are free and cannot connect paid plugins", async () => {
  const calls = [];
  const allowed = await pluginPlanAllows(envWithPlan("paid", calls), { userId: "guest_abc123" }, "jira");
  assert.equal(allowed, false);
  assert.equal(calls.length, 0);
});

test("paid plans connect paid plugins through the account API", async () => {
  const calls = [];
  const env = envWithPlan("paid", calls);
  assert.equal(await pluginPlanAllows(env, { userId: "user_paid" }, "jira"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, "Bearer test-token");
  assert.match(calls[0].url, /\/v1\/billing\/plan\?user_id=user_paid$/u);
});

test("free plans block paid plugins", async () => {
  assert.equal(await pluginPlanAllows(envWithPlan("free"), { userId: "user_free" }, "slack"), false);
});

test("billing outages fail open so paying users are never locked out", async () => {
  assert.equal(await pluginPlanAllows(envWithPlan("throw"), { userId: "user_paid" }, "jira"), true);
  assert.equal(await pluginPlanAllows(envWithPlan("error"), { userId: "user_paid" }, "jira"), true);
});
