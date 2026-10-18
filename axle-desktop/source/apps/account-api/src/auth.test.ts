// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AccountAuthenticationError, createAccountAuthenticator } from "./auth.ts";
import { readAccountApiConfig } from "./config.ts";

const config = readAccountApiConfig({
  MONGODB_URI: "mongodb+srv://user:password@example.mongodb.net/axle",
  CLERK_ISSUER: "https://auth.example.test",
  CLERK_JWKS_URL: "https://auth.example.test/.well-known/jwks.json",
});

function structuredToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "test-key" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({ sub: "usr_probe", iss: config.authIssuer }),
  ).toString("base64url");
  return `${header}.${payload}.AAAA`;
}

describe("account authentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the JWKS through the provided service-binding fetcher", async () => {
    const bindingFetch = vi.fn(async () => new Response("{}", { status: 502 }));
    const globalFetch = vi.fn(async () => {
      throw new Error("global fetch must not be used when a binding fetcher is provided");
    });
    vi.stubGlobal("fetch", globalFetch);
    const authenticate = createAccountAuthenticator(config, bindingFetch);
    const request = new Request("https://api.example.test/v1/cloud/state", {
      headers: { authorization: `Bearer ${structuredToken()}` },
    });

    await expect(authenticate(request)).rejects.toBeInstanceOf(AccountAuthenticationError);
    expect(bindingFetch).toHaveBeenCalledTimes(1);
    const [url] = bindingFetch.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://auth.example.test/.well-known/jwks.json");
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
