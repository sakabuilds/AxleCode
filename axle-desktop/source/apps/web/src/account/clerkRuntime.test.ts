import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  claimClerkDesktopSignIn,
  clerkProviderAuthUrl,
  fetchSignInProviders,
} from "./clerkRuntime";

const STATE = "state_1234567890123456";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claimClerkDesktopSignIn", () => {
  it("returns the session the browser sign-in produced", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            status: "signed-in",
            token: "session-token",
            sessionId: "ses_1",
            state: STATE,
            user: { id: "usr_1", email: "person@axle.test" },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await claimClerkDesktopSignIn(STATE)).toEqual({
      token: "session-token",
      sessionId: "ses_1",
      state: STATE,
      user: { id: "usr_1", email: "person@axle.test" },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v1/auth/desktop/claim");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ state: STATE });
  });

  it("treats a pending sign-in as nothing to apply yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "pending" }), { status: 200 })),
    );
    expect(await claimClerkDesktopSignIn(STATE)).toBeNull();
  });

  it("never throws while the browser flow is still running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await claimClerkDesktopSignIn(STATE)).toBeNull();
  });

  it("ignores a rejected claim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 })),
    );
    expect(await claimClerkDesktopSignIn(STATE)).toBeNull();
  });

  it("ignores a signed-in response without a usable session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "signed-in", token: 7 }), { status: 200 }),
      ),
    );
    expect(await claimClerkDesktopSignIn(STATE)).toBeNull();
  });
});

describe("clerkProviderAuthUrl", () => {
  it("starts the chosen provider directly with the desktop callback", () => {
    vi.stubGlobal("window", { location: { protocol: "axle:", host: "app" } });

    const url = new URL(clerkProviderAuthUrl(STATE, "github"));

    expect(url.pathname).toBe("/v1/auth/start");
    expect(url.searchParams.get("provider")).toBe("github");
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("redirect_uri")).toBe("axle://app/clerk-callback");
  });
});

describe("fetchSignInProviders", () => {
  it("returns the providers the worker can complete", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            providers: [
              { id: "google", label: "Google" },
              { id: "github", label: "GitHub" },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchSignInProviders()).toEqual([
      { id: "google", label: "Google" },
      { id: "github", label: "GitHub" },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/auth/providers");
  });

  it("drops malformed provider entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ providers: [{ id: "google", label: "Google" }, { id: 7 }, null] }),
            { status: 200 },
          ),
      ),
    );

    expect(await fetchSignInProviders()).toEqual([{ id: "google", label: "Google" }]);
  });

  it("returns nothing when the worker is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    expect(await fetchSignInProviders()).toEqual([]);
  });
});
