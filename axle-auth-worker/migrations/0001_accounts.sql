-- Axle account store (Tier 2) -- SQLite dialect, applied with `wrangler d1 execute`.
--
-- Timestamps are ISO-8601 UTC strings so the desktop client can read them
-- without a date parser that understands Postgres types.

CREATE TABLE IF NOT EXISTS axle_users (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);

-- Case-insensitive uniqueness: OAuth providers report varying casing.
CREATE UNIQUE INDEX IF NOT EXISTS axle_users_email_idx
  ON axle_users (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS axle_identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT,
  login TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS axle_identities_user_idx
  ON axle_identities (user_id);

CREATE TABLE IF NOT EXISTS axle_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  method TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS axle_sessions_user_idx
  ON axle_sessions (user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS axle_devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT,
  device_type TEXT NOT NULL DEFAULT 'unknown',
  platform TEXT,
  os_version TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS axle_devices_user_idx
  ON axle_devices (user_id, last_seen_at DESC);

-- Single-use handoff codes: the sign-in frame receives one, the desktop host
-- redeems it for the session token. Keeps the JWT out of the redirect URL.
CREATE TABLE IF NOT EXISTS axle_auth_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  state TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

-- In-flight provider authorization requests. D1 rather than KV so a callback
-- landing on a different isolate still finds its PKCE verifier and state.
CREATE TABLE IF NOT EXISTS axle_oauth_requests (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT,
  redirect_uri TEXT NOT NULL,
  return_to TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
