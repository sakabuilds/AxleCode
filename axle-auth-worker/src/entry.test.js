import assert from "node:assert/strict";
import test from "node:test";

import worker, { boundedToolText, boundedValue, normalizeAnalytics } from "./entry.js";

test("legacy sign-in links hand older builds to Axle's own sign-in page", async () => {
  const requested =
    "https://auth.axle.llc/v1/clerk/desktop?mode=external&intent=signup&redirect_uri=axle%3A%2F%2Fapp%2Fclerk-callback&state=state_1234567890123456";
  const response = await worker.fetch(new Request(requested), {});
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://auth.axle.llc");
  assert.equal(location.pathname, "/v1/auth/desktop");
  assert.equal(location.searchParams.get("mode"), "external");
  assert.equal(location.searchParams.get("intent"), "signup");
  assert.equal(location.searchParams.get("redirect_uri"), "axle://app/clerk-callback");
  assert.equal(location.searchParams.get("state"), "state_1234567890123456");
});

test("legacy sign-in never renders a third-party frame", async () => {
  const response = await worker.fetch(
    new Request("https://auth.axle.llc/v1/clerk/desktop"),
    {},
  );
  assert.equal(response.status, 302);
  assert.equal(await response.text(), "");
});

test("bounds large tool payloads before returning them to model context", () => {
  const shaped = boundedValue({
    message: "x".repeat(20_000),
    items: Array.from({ length: 100 }, (_, index) => index),
  });
  assert.equal(typeof shaped, "object");
  assert.ok(shaped.message.length < 20_000);
  assert.ok(shaped.items.length < 100);

  const text = boundedToolText(JSON.stringify({ payload: "x".repeat(80_000) }));
  assert.ok(text.length < 45_000);
  assert.match(text, /truncated/u);
});

test("upgrades legacy analytics rows with the new counters", () => {
  const analytics = normalizeAnalytics(
    {
      userId: "old-user",
      prompts: 2,
      modelCalls: 3,
      models: { "gpt-test": 3 },
    },
    "user_123",
  );
  assert.equal(analytics.userId, "user_123");
  assert.equal(analytics.prompts, 2);
  assert.equal(analytics.modelCalls, 3);
  assert.equal(analytics.modelRequests, 0);
  assert.equal(analytics.agentCalls, 0);
  assert.equal(analytics.pluginAuthorizations, 0);
  assert.equal(analytics.pluginUses, 0);
  assert.deepEqual(analytics.models, { "gpt-test": 3 });
});
