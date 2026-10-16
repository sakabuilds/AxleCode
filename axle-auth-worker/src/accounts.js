/**
 * D1 access for the Axle account store (Tier 2).
 *
 * Identity rule: one row in `axle_users` per human, one row per external
 * account in `axle_identities`. Signing in with a second provider reuses the
 * existing user when the verified email already matches, so a GitHub and a
 * Google login resolve to the same account.
 */

import { randomToken, sha256 } from "./shared.js";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const AUTH_CODE_TTL_SECONDS = 5 * 60;
export const OAUTH_REQUEST_TTL_SECONDS = 10 * 60;

export function nowIso() {
  return new Date().toISOString();
}

export function isoPlusSeconds(seconds) {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function isExpired(value) {
  const parsed = Date.parse(value ?? "");
  return !Number.isFinite(parsed) || parsed <= Date.now();
}

function newUserId() {
  return `usr_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function readUser(db, userId) {
  return db
    .prepare(
      "SELECT user_id, email, email_verified, display_name, avatar_url, created_at, updated_at, last_seen_at FROM axle_users WHERE user_id = ?",
    )
    .bind(userId)
    .first();
}

export async function listIdentities(db, userId) {
  const result = await db
    .prepare("SELECT provider, login, email, created_at, last_used_at FROM axle_identities WHERE user_id = ? ORDER BY provider")
    .bind(userId)
    .all();
  return result.results ?? [];
}

async function findIdentity(db, provider, providerUserId) {
  return db
    .prepare("SELECT provider, provider_user_id, user_id FROM axle_identities WHERE provider = ? AND provider_user_id = ?")
    .bind(provider, providerUserId)
    .first();
}

async function findUserByEmail(db, email) {
  if (!email) return null;
  return db.prepare("SELECT user_id FROM axle_users WHERE lower(email) = lower(?)").bind(email).first();
}

/**
 * Resolve an external profile to an Axle user, creating the account on first
 * sight. Returns the user id plus whether this call created the account.
 */
export async function upsertUserFromIdentity(db, profile) {
  const { provider, providerUserId, email, emailVerified, displayName, avatarUrl, login } = profile;
  const now = nowIso();
  const existingIdentity = await findIdentity(db, provider, providerUserId);

  if (existingIdentity) {
    const statements = [
      db
        .prepare("UPDATE axle_identities SET email = ?, login = ?, avatar_url = ?, last_used_at = ? WHERE provider = ? AND provider_user_id = ?")
        .bind(email ?? null, login ?? null, avatarUrl ?? null, now, provider, providerUserId),
      db
        .prepare(
          "UPDATE axle_users SET email = COALESCE(email, ?), email_verified = MAX(email_verified, ?), display_name = COALESCE(display_name, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = ?, last_seen_at = ? WHERE user_id = ?",
        )
        .bind(email ?? null, emailVerified ? 1 : 0, displayName ?? null, avatarUrl ?? null, now, now, existingIdentity.user_id),
    ];
    await db.batch(statements);
    return { userId: existingIdentity.user_id, created: false };
  }

  // Reuse an existing account when the provider vouches for the same email.
  const matched = emailVerified ? await findUserByEmail(db, email) : null;
  const userId = matched?.user_id ?? newUserId();
  const statements = [];
  if (!matched) {
    statements.push(
      db
        .prepare(
          "INSERT INTO axle_users (user_id, email, email_verified, display_name, avatar_url, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(userId, email ?? null, emailVerified ? 1 : 0, displayName ?? null, avatarUrl ?? null, now, now, now),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO axle_identities (provider, provider_user_id, user_id, email, login, avatar_url, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(provider, providerUserId, userId, email ?? null, login ?? null, avatarUrl ?? null, now, now),
  );
  await db.batch(statements);
  return { userId, created: !matched };
}

export async function createSession(db, { userId, method, deviceId = null }) {
  const sessionId = `ses_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = nowIso();
  await db
    .prepare(
      "INSERT INTO axle_sessions (session_id, user_id, device_id, method, issued_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(sessionId, userId, deviceId, method, now, isoPlusSeconds(SESSION_TTL_SECONDS), now)
    .run();
  return { sessionId, expiresAt: isoPlusSeconds(SESSION_TTL_SECONDS) };
}

export async function readSession(db, sessionId) {
  const row = await db
    .prepare("SELECT session_id, user_id, revoked_at, expires_at FROM axle_sessions WHERE session_id = ?")
    .bind(sessionId)
    .first();
  if (!row || row.revoked_at || isExpired(row.expires_at)) return null;
  return row;
}

export async function touchSession(db, sessionId) {
  await db
    .prepare("UPDATE axle_sessions SET last_seen_at = ? WHERE session_id = ?")
    .bind(nowIso(), sessionId)
    .run();
}

export async function revokeSession(db, sessionId) {
  await db
    .prepare("UPDATE axle_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL")
    .bind(nowIso(), sessionId)
    .run();
}

export async function createAuthCode(db, { userId, sessionId, state }) {
  const code = crypto.randomUUID().replaceAll("-", "");
  await db
    .prepare("INSERT INTO axle_auth_codes (code, user_id, session_id, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(code, userId, sessionId, state ?? null, nowIso(), isoPlusSeconds(AUTH_CODE_TTL_SECONDS))
    .run();
  return code;
}

/** Single-use redemption; a replayed code returns null on the second attempt. */
export async function consumeAuthCode(db, code) {
  const row = await db
    .prepare("SELECT code, user_id, session_id, state, expires_at, consumed_at FROM axle_auth_codes WHERE code = ?")
    .bind(code)
    .first();
  if (!row || row.consumed_at || isExpired(row.expires_at)) return null;
  const claim = await db
    .prepare("UPDATE axle_auth_codes SET consumed_at = ? WHERE code = ? AND consumed_at IS NULL")
    .bind(nowIso(), code)
    .run();
  if ((claim.meta?.changes ?? 0) === 0) return null;
  return row;
}

/**
 * Single-use redemption of the newest pending hand-off for one desktop sign-in
 * state. Desktop clients poll this so the return trip works even when the OS
 * cannot hand the custom-scheme callback back to the app; whichever path
 * (deep link or poll) arrives first wins and the other one finds nothing.
 */
export async function consumeAuthCodeByState(db, state) {
  const row = await db
    .prepare(
      "SELECT code, user_id, session_id, state, expires_at, consumed_at FROM axle_auth_codes WHERE state = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .bind(state)
    .first();
  if (!row || row.consumed_at || isExpired(row.expires_at)) return null;
  const claim = await db
    .prepare("UPDATE axle_auth_codes SET consumed_at = ? WHERE code = ? AND consumed_at IS NULL")
    .bind(nowIso(), row.code)
    .run();
  if ((claim.meta?.changes ?? 0) === 0) return null;
  return row;
}

export async function saveOAuthRequest(db, { state, provider, codeVerifier, redirectUri, returnTo }) {
  // REPLACE rather than INSERT: `state` is the primary key, and a retried or
  // restarted flow can legitimately reuse one. The newest attempt wins.
  await db
    .prepare(
      "INSERT OR REPLACE INTO axle_oauth_requests (state, provider, code_verifier, redirect_uri, return_to, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(state, provider, codeVerifier ?? null, redirectUri, returnTo ?? null, nowIso(), isoPlusSeconds(OAUTH_REQUEST_TTL_SECONDS))
    .run();
}

export async function consumeOAuthRequest(db, state) {
  const row = await db
    .prepare("SELECT state, provider, code_verifier, redirect_uri, return_to, expires_at, consumed_at FROM axle_oauth_requests WHERE state = ?")
    .bind(state)
    .first();
  if (!row || row.consumed_at || isExpired(row.expires_at)) return null;
  const claim = await db
    .prepare("UPDATE axle_oauth_requests SET consumed_at = ? WHERE state = ? AND consumed_at IS NULL")
    .bind(nowIso(), state)
    .run();
  if ((claim.meta?.changes ?? 0) === 0) return null;
  return row;
}

export async function upsertDevice(db, { deviceId, userId, label, deviceType, platform, appVersion }) {
  const now = nowIso();
  await db
    .prepare(
      "INSERT INTO axle_devices (device_id, user_id, label, device_type, platform, app_version, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET user_id = excluded.user_id, last_seen_at = excluded.last_seen_at, label = COALESCE(excluded.label, axle_devices.label), app_version = COALESCE(excluded.app_version, axle_devices.app_version)",
    )
    .bind(deviceId, userId, label ?? null, deviceType ?? "unknown", platform ?? null, appVersion ?? null, now, now)
    .run();
}

export async function listSessions(db, userId) {
  const result = await db
    .prepare("SELECT session_id, device_id, method, issued_at, expires_at, last_seen_at, revoked_at FROM axle_sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 50")
    .bind(userId)
    .all();
  return result.results ?? [];
}

export async function updateProfile(db, userId, { displayName }) {
  const trimmed = typeof displayName === "string" ? displayName.trim() : "";
  await db
    .prepare("UPDATE axle_users SET display_name = ?, updated_at = ? WHERE user_id = ?")
    .bind(trimmed.length > 0 ? trimmed.slice(0, 120) : null, nowIso(), userId)
    .run();
}

/** Revoke one of this user's own sessions. Returns false when it is not theirs. */
export async function revokeOwnSession(db, userId, sessionId) {
  const result = await db
    .prepare("UPDATE axle_sessions SET revoked_at = ? WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(nowIso(), sessionId, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function countIdentities(db, userId) {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM axle_identities WHERE user_id = ?")
    .bind(userId)
    .first();
  return Number(row?.count ?? 0);
}

/**
 * Attach an external profile to an existing Axle user.
 * Refuses when the provider account already belongs to somebody else, so a
 * second Axle account can never absorb another person's GitHub or Google login.
 */
export async function linkIdentityToUser(db, userId, profile) {
  const { provider, providerUserId, email, login, avatarUrl } = profile;
  const existing = await findIdentity(db, provider, providerUserId);
  if (existing && existing.user_id !== userId) {
    return { ok: false, reason: "identity_taken" };
  }
  if (existing) return { ok: true, alreadyLinked: true };
  const now = nowIso();
  await db
    .prepare(
      "INSERT INTO axle_identities (provider, provider_user_id, user_id, email, login, avatar_url, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(provider, providerUserId, userId, email ?? null, login ?? null, avatarUrl ?? null, now, now)
    .run();
  return { ok: true, alreadyLinked: false };
}

/**
 * Detach a provider. Refuses to remove the last identity, which would leave the
 * account unreachable.
 */
export async function unlinkIdentity(db, userId, provider) {
  // Check linkage before the last-identity rule so the caller can tell
  // "you never connected this" apart from "this is your only way in".
  const existing = await db
    .prepare("SELECT provider FROM axle_identities WHERE provider = ? AND user_id = ?")
    .bind(provider, userId)
    .first();
  if (!existing) return { ok: false, reason: "not_linked" };
  if ((await countIdentities(db, userId)) <= 1) return { ok: false, reason: "last_identity" };
  const result = await db
    .prepare("DELETE FROM axle_identities WHERE provider = ? AND user_id = ?")
    .bind(provider, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0 ? { ok: true } : { ok: false, reason: "not_linked" };
}

// ---------------------------------------------------------------------------
// Axle API keys (the hosted provider's credential)
// ---------------------------------------------------------------------------

const API_KEY_PREFIX = "axl";
const API_KEY_SECRET_BYTES = 32;

/**
 * A key is `axl_<12 hex>_<43 base64url>`: the middle segment is the display
 * prefix, the last segment is the secret. Only the whole string hashes to a
 * value the gateway can match, so leaking the prefix leaks nothing.
 */
export async function mintApiKey() {
  const prefix = [...crypto.getRandomValues(new Uint8Array(6))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const secret = randomToken(API_KEY_SECRET_BYTES);
  const key = `${API_KEY_PREFIX}_${prefix}_${secret}`;
  return { key, prefix, hash: await sha256(key) };
}

export async function createApiKey(db, { userId, name }) {
  const { key, prefix, hash } = await mintApiKey();
  const keyId = `key_${crypto.randomUUID().replaceAll("-", "")}`;
  const trimmed = typeof name === "string" ? name.trim() : "";
  await db
    .prepare(
      "INSERT INTO axle_api_keys (key_id, user_id, name, prefix, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(keyId, userId, trimmed.length > 0 ? trimmed.slice(0, 60) : null, prefix, hash, nowIso())
    .run();
  return { keyId, key, prefix };
}

export async function listApiKeys(db, userId) {
  const result = await db
    .prepare(
      "SELECT key_id, name, prefix, created_at, last_used_at, revoked_at FROM axle_api_keys WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .bind(userId)
    .all();
  return result.results ?? [];
}

/** Revoke one of this user's own keys. Returns false when it is not theirs. */
export async function revokeApiKey(db, userId, keyId) {
  const result = await db
    .prepare(
      "UPDATE axle_api_keys SET revoked_at = ? WHERE key_id = ? AND user_id = ? AND revoked_at IS NULL",
    )
    .bind(nowIso(), keyId, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Resolve a presented key to its owner. Used by the gateway, which binds the
 * same database: a revoked key stops working everywhere the moment it is
 * revoked, rather than only where the key was issued.
 */
export async function findApiKeyOwner(db, hash) {
  return db
    .prepare(
      "SELECT key_id, user_id, revoked_at FROM axle_api_keys WHERE token_hash = ?",
    )
    .bind(hash)
    .first();
}
