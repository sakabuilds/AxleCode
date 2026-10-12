import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const legacySessionToken = "legacy-session-token-with-enough-length";
const legacyInstallationId = "123e4567-e89b-42d3-a456-426614174000";
const freshSessionToken = "fresh-session-token-with-enough-length";

function installLocalStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  vi.stubGlobal("window", { localStorage: storage });
  return storage;
}

// Plugin sessions and installation ids are cached in module scope, so each test
// loads a fresh module instance instead of sharing accumulated state.
async function loadPluginApi() {
  vi.resetModules();
  const runtime = await import("../../lib/runtime");
  const api = await import("./pluginApi");
  return { api, runtime };
}

describe("plugin API pre-rebrand storage keys", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads a legacy session token and promotes it on the next write", async () => {
    const storage = installLocalStorage();
    storage.setItem("sparky.plugin-session.v1", legacySessionToken);
    const { api } = await loadPluginApi();

    expect(api.loadPluginSessionToken()).toBe(legacySessionToken);

    api.persistPluginSessionToken(legacySessionToken);
    expect(storage.getItem("axle.plugin-session.v1")).toBe(legacySessionToken);
    expect(storage.getItem("sparky.plugin-session.v1")).toBeNull();
  });

  it("prefers the newer rivet key over the older sparky key", async () => {
    const storage = installLocalStorage();
    storage.setItem("sparky.plugin-session.v1", "older-sparky-token-with-enough-length");
    storage.setItem("rivet.plugin-session.v1", "newer-rivet-token-with-enough-length");
    const { api } = await loadPluginApi();

    expect(api.loadPluginSessionToken()).toBe("newer-rivet-token-with-enough-length");

    api.persistPluginSessionToken("newer-rivet-token-with-enough-length");
    expect(storage.getItem("axle.plugin-session.v1")).toBe("newer-rivet-token-with-enough-length");
    expect(storage.getItem("rivet.plugin-session.v1")).toBeNull();
    expect(storage.getItem("sparky.plugin-session.v1")).toBeNull();
  });

  it("reuses a legacy installation id for an anonymous session", async () => {
    const storage = installLocalStorage();
    storage.setItem("sparky.plugin-installation-id.v1", legacyInstallationId.toUpperCase());
    const { api, runtime } = await loadPluginApi();
    runtime.__setPrimaryHttpRunnerForTests(async <A>() => ({ ready: true }) as A);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        sessionToken: freshSessionToken,
        user: { id: "guest-installation", email: null },
        anonymous: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createAnonymousPluginSession();

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      installationId: string;
    };
    expect(requestBody.installationId).toBe(legacyInstallationId);
    expect(storage.getItem("axle.plugin-installation-id.v1")).toBe(legacyInstallationId);
    expect(storage.getItem("sparky.plugin-installation-id.v1")).toBeNull();
  });

  it("reuses a rivet installation id and clears both legacy variants", async () => {
    const storage = installLocalStorage();
    storage.setItem("sparky.plugin-installation-id.v1", "11111111-1111-4111-8111-111111111111");
    storage.setItem("rivet.plugin-installation-id.v1", legacyInstallationId.toUpperCase());
    const { api, runtime } = await loadPluginApi();
    runtime.__setPrimaryHttpRunnerForTests(async <A>() => ({ ready: true }) as A);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        sessionToken: freshSessionToken,
        user: { id: "guest-installation", email: null },
        anonymous: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createAnonymousPluginSession();

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      installationId: string;
    };
    expect(requestBody.installationId).toBe(legacyInstallationId);
    expect(storage.getItem("axle.plugin-installation-id.v1")).toBe(legacyInstallationId);
    expect(storage.getItem("rivet.plugin-installation-id.v1")).toBeNull();
    expect(storage.getItem("sparky.plugin-installation-id.v1")).toBeNull();
  });
});

