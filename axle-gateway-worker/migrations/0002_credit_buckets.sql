-- Three credit buckets on the hosted provider.
--
-- `balance` keeps its old name but becomes the FREE bucket: it is renewed
-- (set back to the daily allowance) on each new UTC day rather than added to,
-- so unused free credits never roll over.
-- `plan_balance` is the monthly allowance an active paid plan grants; it is
-- set by the plan, never accumulated.
-- `paid_balance` holds purchased credits, which persist until spent.
--
-- `reference` on the audit trail is the payment-provider event id; the unique
-- partial index makes redelivered webhook events no-ops at the storage layer.

ALTER TABLE axle_credits ADD COLUMN plan_balance REAL NOT NULL DEFAULT 0;
ALTER TABLE axle_credits ADD COLUMN paid_balance REAL NOT NULL DEFAULT 0;
ALTER TABLE axle_credits ADD COLUMN plan_month TEXT;

ALTER TABLE axle_credit_ledger ADD COLUMN reference TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS axle_credit_ledger_reference_idx
  ON axle_credit_ledger(reference) WHERE reference IS NOT NULL;
