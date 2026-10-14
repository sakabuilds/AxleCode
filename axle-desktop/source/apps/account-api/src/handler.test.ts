// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeSqlite from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AccountPrincipal } from "./auth.ts";
import { createAccountDatabase, type AccountSnapshot } from "./database.ts";
import { createAccountRequestHandler } from "./handler.ts";

const { neonMock } = vi.hoisted(() => ({ neonMock: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({ neon: neonMock }));

const snapshot: AccountSnapshot = {
  profile: {
    userId: "user-a",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  stats: {
    totalTurns: 0,
    totalThreads: 0,
    totalInputTokens: 0,
    totalCachedInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningOutputTokens: 0,
    totalTokens: 0,
    totalToolUses: 0,
    totalCostUsd: "0",
    mostUsedProvider: null,
    mostUsedModel: null,
    lastActiveAt: null,
  },
  devices: [],
  sessions: [],
};

describe("account ownership and session authorization", () => {
  let sqlite: NodeSqlite.DatabaseSync;
  let database: ReturnType<typeof createAccountDatabase>;
  let principal: AccountPrincipal;
  let handle: ReturnType<typeof createAccountRequestHandler>;
  const getAccount = vi.fn(async () => snapshot);
  const updateProfile = vi.fn(async () => {});
  const recordUsageEvent = vi.fn(async () => true);

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new NodeSqlite.DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE axle_account_profiles (user_id TEXT PRIMARY KEY);
      CREATE TABLE axle_account_stats (user_id TEXT PRIMARY KEY);
      CREATE TABLE axle_account_devices (
        device_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT, device_type TEXT,
        platform TEXT, os_version TEXT, app_version TEXT, browser TEXT,
        last_seen_at TEXT, revoked_at TEXT
      );
      CREATE TABLE axle_account_sessions (
        session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, issued_at TEXT,
        expires_at TEXT, last_seen_at TEXT, revoked_at TEXT
      );
    `);
    // SQLite exercises the real conditional UPSERT/RETURNING statements without
    // credentials. Only PostgreSQL's now() spelling is adapted; ownership and
    // revocation predicates run unchanged against persisted rows.
    const query = Object.assign(
      async (strings: TemplateStringsArray, ...values: NodeSqlite.SQLInputValue[]) =>
        sqlite
          .prepare(strings.join("?").replace(/\bnow\(\)/giu, "CURRENT_TIMESTAMP"))
          .all(...values),
      { transaction: (queries: ReadonlyArray<Promise<unknown>>) => Promise.all(queries) },
    );
    neonMock.mockReturnValue(query);
    database = createAccountDatabase({
      databaseUrl: "postgresql://unused.invalid/test",
      authJwksUrl: "https://auth.invalid/jwks",
      authIssuer: "https://auth.invalid",
      authAudience: null,
      authProvider: "clerk",
      corsOrigin: "https://app.invalid",
      host: "127.0.0.1",
      port: 8788,
    });
    principal = { userId: "user-a", sessionId: "session-a" };
    handle = createAccountRequestHandler({
      database: { ...database, getAccount, updateProfile, recordUsageEvent },
      authenticate: async () => principal,
      corsOrigin: "https://app.invalid",
    });
  });

  afterEach(() => sqlite.close());

  function request(path: string, method = "GET", body?: unknown) {
    return handle(
      new Request(`https://account.invalid${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  it("rejects a cross-user device claim without moving ownership or exposing retained metadata", async () => {
    await database.upsertDevice("user-b", {
      deviceId: "device-b",
      label: "Private workstation",
      platform: "private-platform",
    });
    const response = await request("/v1/account/devices", "POST", { deviceId: "device-b" });

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toMatchObject({ error: "device_registration_conflict" });
    expect(JSON.stringify(payload)).not.toContain("Private workstation");
    expect(JSON.stringify(payload)).not.toContain("user-b");
    expect(getAccount).not.toHaveBeenCalled();
    expect(
      sqlite.prepare("SELECT user_id, label, platform FROM axle_account_devices").get(),
    ).toEqual({
      user_id: "user-b",
      label: "Private workstation",
      platform: "private-platform",
    });
  });

  it("allows repeat updates by the same owner and preserves omitted device metadata", async () => {
    await database.upsertDevice("user-a", {
      deviceId: "device-a",
      label: "Laptop",
      platform: "linux",
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request("/v1/account/devices", "POST", {
        deviceId: "device-a",
        label: "Work laptop",
      });
      expect(response.status).toBe(200);
    }
    expect(
      sqlite.prepare("SELECT user_id, label, platform, revoked_at FROM axle_account_devices").all(),
    ).toEqual([{ user_id: "user-a", label: "Work laptop", platform: "linux", revoked_at: null }]);
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(getAccount).toHaveBeenLastCalledWith("user-a");
  });

  it("does not reactivate a revoked device during registration", async () => {
    await database.upsertDevice("user-a", { deviceId: "device-a", label: "Laptop" });
    sqlite.exec(
      "UPDATE axle_account_devices SET revoked_at = '2026-02-01', last_seen_at = '2026-01-01'",
    );
    const response = await request("/v1/account/devices", "POST", {
      deviceId: "device-a",
      label: "Changed",
    });

    expect(response.status).toBe(409);
    expect(
      sqlite.prepare("SELECT label, revoked_at, last_seen_at FROM axle_account_devices").get(),
    ).toEqual({
      label: "Laptop",
      revoked_at: "2026-02-01",
      last_seen_at: "2026-01-01",
    });
    expect(getAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["/v1/account", "GET", undefined],
    ["/v1/account/profile", "PATCH", { displayName: "Changed" }],
    ["/v1/account/devices", "POST", { deviceId: "new-device" }],
    [
      "/v1/account/usage-events",
      "POST",
      { eventId: "event", model: "model", occurredAt: "2026-01-01T00:00:00Z" },
    ],
  ])("denies a revoked session before protected route %s", async (path, method, body) => {
    await database.touchSession(principal);
    sqlite.exec(
      "UPDATE axle_account_sessions SET revoked_at = '2026-02-01', last_seen_at = '2026-01-01'",
    );
    const response = await request(path, method, body);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(getAccount).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM axle_account_devices").get()).toEqual({
      count: 0,
    });
    expect(
      sqlite.prepare("SELECT revoked_at, last_seen_at FROM axle_account_sessions").get(),
    ).toEqual({
      revoked_at: "2026-02-01",
      last_seen_at: "2026-01-01",
    });
  });

  it("rejects a differently owned session identifier without transferring it", async () => {
    await database.touchSession({ userId: "user-b", sessionId: "session-a" });
    const response = await request("/v1/account");

    expect(response.status).toBe(401);
    expect(getAccount).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT user_id FROM axle_account_sessions").get()).toEqual({
      user_id: "user-b",
    });
  });

  it("keeps an active same-owner session usable and records updated verified claims", async () => {
    expect((await request("/v1/account")).status).toBe(200);
    principal = { ...principal, expiresAt: new Date("2027-01-01T00:00:00Z") };
    expect((await request("/v1/account")).status).toBe(200);
    expect(
      sqlite.prepare("SELECT user_id, expires_at, revoked_at FROM axle_account_sessions").all(),
    ).toEqual([{ user_id: "user-a", expires_at: "2027-01-01T00:00:00.000Z", revoked_at: null }]);
    expect(getAccount).toHaveBeenCalledTimes(2);
  });

  it("preserves authentication compatibility for verified tokens without a session claim", async () => {
    principal = { userId: "user-a" };
    expect((await request("/v1/account")).status).toBe(200);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM axle_account_sessions").get()).toEqual({
      count: 0,
    });
  });
});
