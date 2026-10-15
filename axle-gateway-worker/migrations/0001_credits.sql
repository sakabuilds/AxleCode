-- Credits ledger for the Axle hosted provider.
--
-- `balance` is stored in Axle credits (100 credits == $0.50) and only ever
-- moves through the gateway's two guarded statements, so it can never go
-- negative and the daily grant lands at most once per UTC day.

CREATE TABLE IF NOT EXISTS axle_credits (
  user_id TEXT PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0,
  granted_on TEXT,
  updated_at BIGINT NOT NULL
);

-- Append-only audit trail behind the balance: one row per grant, spend, and
-- top-up, with the balance it produced.
CREATE TABLE IF NOT EXISTS axle_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS axle_credit_ledger_user_idx
  ON axle_credit_ledger(user_id, created_at DESC);
