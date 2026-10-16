-- Axle API keys for the hosted provider (`--provider axle`).
--
-- The plaintext key is shown to the user exactly once, at creation. Only the
-- SHA-256 of the full key is stored, so a database read cannot be replayed
-- against the gateway. `prefix` is the public half kept for display, which is
-- what lets the desktop list "axl_9f2c1a4b...7d3e" without holding a secret.

CREATE TABLE IF NOT EXISTS axle_api_keys (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

-- The gateway authenticates by hash, so this lookup is on the hot path.
CREATE UNIQUE INDEX IF NOT EXISTS axle_api_keys_hash_idx
  ON axle_api_keys (token_hash);

CREATE INDEX IF NOT EXISTS axle_api_keys_user_idx
  ON axle_api_keys (user_id, created_at DESC);
