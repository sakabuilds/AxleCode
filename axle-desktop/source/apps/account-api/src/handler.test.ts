// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import { MongoClient, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { startMongoMemoryServer } from "./mongoTestServer.ts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AccountPrincipal } from "./auth.ts";
import { createAccountDatabase, type AccountSnapshot } from "./database.ts";
import { createAccountRequestHandler } from "./handler.ts";

interface DeviceRow {
  _id: string;
  userId: string;
  label: string | null;
  platform: string | null;
  revokedAt: Date | null;
  lastSeenAt: Date;
}

interface SessionRow {
  _id: string;
  userId: string;
  revokedAt: Date | null;
  lastSeenAt: Date;
  expiresAt: Date | null;
}

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
  let server: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let database: ReturnType<typeof createAccountDatabase>;
  let principal: AccountPrincipal;
  let handle: ReturnType<typeof createAccountRequestHandler>;
  const getAccount = vi.fn(async () => snapshot);
  const updateProfile = vi.fn(async () => {});
  const recordUsageEvent = vi.fn(async () => true);

  beforeAll(async () => {
    server = await startMongoMemoryServer();
    client = new MongoClient(server.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // A real MongoDB exercises the actual conditional upserts and ownership
    // predicates; only mocked collaborators keep the routes deterministic.
    db = client.db("axle");
    await db.dropDatabase();
    database = createAccountDatabase({
      mongodbUri: server.getUri(),
      authJwksUrl: "https://auth.invalid/jwks",
      authIssuer: "https://auth.invalid",
      authAudience: null,
      authProvider: "clerk",
      corsOrigin: "https://app.invalid",
      host: "127.0.0.1",
      port: 8788,
    });
    await database.migrate();
    principal = { userId: "user-a", sessionId: "session-a" };
    handle = createAccountRequestHandler({
      database: { ...database, getAccount, updateProfile, recordUsageEvent },
      authenticate: async () => principal,
      corsOrigin: "https://app.invalid",
    });
  });

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
      await db.collection<DeviceRow>("axle_account_devices").findOne({ _id: "device-b" }),
    ).toMatchObject({
      userId: "user-b",
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
    const devices = await db.collection<DeviceRow>("axle_account_devices").find({}).toArray();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      _id: "device-a",
      userId: "user-a",
      label: "Work laptop",
      platform: "linux",
      revokedAt: null,
    });
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(getAccount).toHaveBeenLastCalledWith("user-a");
  });

  it("does not reactivate a revoked device during registration", async () => {
    await database.upsertDevice("user-a", { deviceId: "device-a", label: "Laptop" });
    await db
      .collection<DeviceRow>("axle_account_devices")
      .updateOne(
        { _id: "device-a" },
        { $set: { revokedAt: new Date("2026-02-01"), lastSeenAt: new Date("2026-01-01") } },
      );
    const response = await request("/v1/account/devices", "POST", {
      deviceId: "device-a",
      label: "Changed",
    });

    expect(response.status).toBe(409);
    const stored = await db
      .collection<DeviceRow>("axle_account_devices")
      .findOne({ _id: "device-a" });
    expect(stored).toMatchObject({ label: "Laptop" });
    expect((stored?.revokedAt as Date)?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect((stored?.lastSeenAt as Date)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
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
    await db
      .collection<SessionRow>("axle_account_sessions")
      .updateOne(
        { _id: "session-a" },
        { $set: { revokedAt: new Date("2026-02-01"), lastSeenAt: new Date("2026-01-01") } },
      );
    const response = await request(path, method, body);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(getAccount).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
    expect(await db.collection<DeviceRow>("axle_account_devices").countDocuments()).toBe(0);
    const stored = await db
      .collection<SessionRow>("axle_account_sessions")
      .findOne({ _id: "session-a" });
    expect((stored?.revokedAt as Date)?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect((stored?.lastSeenAt as Date)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects a differently owned session identifier without transferring it", async () => {
    await database.touchSession({ userId: "user-b", sessionId: "session-a" });
    const response = await request("/v1/account");

    expect(response.status).toBe(401);
    expect(getAccount).not.toHaveBeenCalled();
    expect(
      await db.collection<SessionRow>("axle_account_sessions").findOne({ _id: "session-a" }),
    ).toMatchObject({
      userId: "user-b",
    });
  });

  it("keeps an active same-owner session usable and records updated verified claims", async () => {
    expect((await request("/v1/account")).status).toBe(200);
    principal = { ...principal, expiresAt: new Date("2027-01-01T00:00:00Z") };
    expect((await request("/v1/account")).status).toBe(200);
    const sessions = await db.collection<SessionRow>("axle_account_sessions").find({}).toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ userId: "user-a", revokedAt: null });
    expect((sessions[0]?.expiresAt as Date)?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(getAccount).toHaveBeenCalledTimes(2);
  });

  it("preserves authentication compatibility for verified tokens without a session claim", async () => {
    principal = { userId: "user-a" };
    expect((await request("/v1/account")).status).toBe(200);
    expect(await db.collection<SessionRow>("axle_account_sessions").countDocuments()).toBe(0);
  });
});
