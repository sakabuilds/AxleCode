import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedToolText,
  boundedValue,
  clerkDesktopHtml,
  clerkInitialMode,
  decodeClerkFrontendApi,
  normalizeAnalytics,
} from "./entry.js";

function publishableKeyFor(domain) {
  return `pk_test_${Buffer.from(`${domain}$`, "utf8").toString("base64url")}`;
}

test("decodes the Clerk frontend API from a publishable key", () => {
  const key = publishableKeyFor("clerk.axle.example");
  assert.equal(decodeClerkFrontendApi(key), "clerk.axle.example");
  assert.equal(decodeClerkFrontendApi("not-a-clerk-key"), null);
});

test("isolated Clerk page contains only the public key and frame protocol", () => {
  const key = publishableKeyFor("clerk.axle.example");
  const html = clerkDesktopHtml({ CLERK_PUBLISHABLE_KEY: key });
  assert.ok(html);
  assert.match(html, /axle-clerk-frame/u);
  assert.match(html, /clerk\.browser\.js/u);
  assert.match(html, /oauthFlow:\s*externalMode\s*\?\s*"redirect"\s*:\s*"popup"/u);
  assert.match(html, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(html, /secret[_-]?key/iu);
});

test("external Clerk page uses a browser-owned redirect and one-time app handoff", () => {
  const key = publishableKeyFor("clerk.axle.example");
  const url = new URL(
    "https://auth.axle.llc/v1/clerk/desktop?mode=external&redirect_uri=axle%3A%2F%2Fapp%2Fclerk-callback&state=state_1234567890123456",
  );
  const html = clerkDesktopHtml({ CLERK_PUBLISHABLE_KEY: key }, url);
  assert.match(html, /oauthFlow:\s*externalMode\s*\?\s*"redirect"\s*:\s*"popup"/u);
  assert.match(html, /forceRedirectUrl/u);
  assert.match(html, /v1\/clerk\/bridge/u);
  assert.match(html, /axle:\/\/app\/clerk-callback/u);
});

test("maps an account-creation intent onto the initial Clerk component", () => {
  assert.equal(clerkInitialMode(new URL("https://auth.axle.llc/v1/clerk/desktop")), "signin");
  for (const intent of ["signup", "sign-up", "create", "register"]) {
    const url = new URL(`https://auth.axle.llc/v1/clerk/desktop?intent=${intent}`);
    assert.equal(clerkInitialMode(url), "signup", `intent=${intent}`);
  }
  assert.equal(clerkInitialMode(null), "signin");
});

test("sign-up intent mounts the Clerk sign-up component and offers a switch", () => {
  const key = publishableKeyFor("clerk.axle.example");
  const url = new URL("https://auth.axle.llc/v1/clerk/desktop?intent=signup");
  const html = clerkDesktopHtml({ CLERK_PUBLISHABLE_KEY: key }, url);
  assert.ok(html);
  assert.match(html, /mountSignUp/u);
  assert.match(html, /unmountSignUp/u);
  assert.match(html, /Axle sign up/u);
  assert.match(html, /Already have an account\? Sign in/u);
});

test("default Clerk page keeps sign-in first but still exposes account creation", () => {
  const key = publishableKeyFor("clerk.axle.example");
  const html = clerkDesktopHtml({ CLERK_PUBLISHABLE_KEY: key });
  assert.ok(html);
  assert.match(html, /mountSignIn/u);
  assert.match(html, /New to Axle\? Create an account/u);
  assert.match(html, /routing:\s*"virtual"/u);
});

test("external sign-up keeps the one-time app handoff", () => {
  const key = publishableKeyFor("clerk.axle.example");
  const url = new URL(
    "https://auth.axle.llc/v1/clerk/desktop?mode=external&intent=signup&redirect_uri=axle%3A%2F%2Fapp%2Fclerk-callback&state=state_1234567890123456",
  );
  const html = clerkDesktopHtml({ CLERK_PUBLISHABLE_KEY: key }, url);
  assert.match(html, /mountSignUp/u);
  assert.match(html, /forceRedirectUrl/u);
  assert.match(html, /v1\/clerk\/bridge/u);
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
