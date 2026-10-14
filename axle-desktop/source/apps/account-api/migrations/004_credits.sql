-- Credit accounts, ledger, and atomic job settlement for the cloud control plane.
-- Job lifecycle accounting runs inside the same PostgreSQL transaction as the
-- state change that triggers it: `axle_cloud_command_atomic` wraps the base
-- command from 003_cloud_jobs.sql and adjusts credits before returning.

CREATE TABLE IF NOT EXISTS axle_credit_accounts (
  user_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  grant_month TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS axle_credit_ledger (
  entry_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('monthly_grant', 'reservation', 'settlement', 'adjustment')),
  amount BIGINT NOT NULL,
  job_id TEXT,
  idempotency_key TEXT NOT NULL,
  note JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS axle_credit_ledger_user ON axle_credit_ledger(user_id, entry_id DESC);

ALTER TABLE axle_cloud_jobs ADD COLUMN IF NOT EXISTS billing JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE axle_cloud_jobs ADD COLUMN IF NOT EXISTS reserved_credits BIGINT NOT NULL DEFAULT 0;
ALTER TABLE axle_cloud_jobs ADD COLUMN IF NOT EXISTS settled_credits BIGINT;
ALTER TABLE axle_cloud_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
-- Applies a signed credit delta exactly once per idempotency key. The guarded
-- UPDATE is the authoritative balance check: concurrent reservations serialize
-- on the account row, and any overdraft rolls back the caller's transaction.
CREATE OR REPLACE FUNCTION axle_credit_apply(p_user TEXT, p_amount BIGINT, p_kind TEXT,
  p_job TEXT, p_key TEXT, p_note JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
  IF p_amount = 0 THEN RETURN false; END IF;
  UPDATE axle_credit_accounts SET balance = balance + p_amount, updated_at = clock_timestamp()
  WHERE user_id = p_user AND balance + p_amount >= 0;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM axle_credit_accounts WHERE user_id = p_user)
      THEN RAISE EXCEPTION 'AXLE_CLOUD:insufficient_credits';
      ELSE RAISE EXCEPTION 'AXLE_CLOUD:credit_account_missing'; END IF;
  END IF;
  INSERT INTO axle_credit_ledger(user_id, kind, amount, job_id, idempotency_key, note)
  VALUES(p_user, p_kind, p_amount, p_job, p_key, p_note)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    -- The key was already applied in an earlier request: undo this attempt.
    UPDATE axle_credit_accounts SET balance = balance - p_amount WHERE user_id = p_user;
    RETURN false;
  END IF;
  RETURN true;
END $$;

-- Creates the account on first touch and applies the plan's monthly grant once
-- per calendar month (idempotent under replay and concurrency).
CREATE OR REPLACE FUNCTION axle_credit_ensure(p_user TEXT, p_plan TEXT, p_monthly BIGINT,
  p_month TEXT) RETURNS axle_credit_accounts
LANGUAGE plpgsql AS $$
DECLARE acc axle_credit_accounts;
BEGIN
  INSERT INTO axle_credit_accounts(user_id, plan_id) VALUES(p_user, p_plan)
  ON CONFLICT (user_id) DO UPDATE SET plan_id = excluded.plan_id, updated_at = clock_timestamp()
  RETURNING * INTO acc;
  IF p_monthly > 0 AND acc.grant_month IS DISTINCT FROM p_month THEN
    IF axle_credit_apply(p_user, p_monthly, 'monthly_grant', NULL, 'grant:' || p_month,
        jsonb_build_object('month', p_month, 'amount', p_monthly)) THEN
      UPDATE axle_credit_accounts SET grant_month = p_month, updated_at = clock_timestamp()
      WHERE user_id = p_user RETURNING * INTO acc;
    END IF;
  END IF;
  RETURN acc;
END $$;

-- Charge policy: wall-clock worker time from the first claim to the terminal
-- state, rounded up to whole minutes, capped by the reservation. Jobs cancelled
-- before any worker claimed them are released in full (charge 0).
CREATE OR REPLACE FUNCTION axle_credit_settle(p_job axle_cloud_jobs, p_at TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_rate BIGINT;
  v_charge BIGINT := 0;
BEGIN
  IF p_job.settled_credits IS NOT NULL OR p_job.reserved_credits <= 0 THEN
    RETURN p_job.settled_credits;
  END IF;
  v_rate := coalesce((p_job.billing->>'creditsPerMinute')::BIGINT, 0);
  IF p_job.started_at IS NOT NULL AND v_rate > 0 THEN
    v_charge := least(p_job.reserved_credits,
      ceil(greatest(0, extract(epoch FROM (least(p_at, p_job.deadline_at) - p_job.started_at))) / 60)::BIGINT * v_rate);
  END IF;
  PERFORM axle_credit_apply(p_job.user_id, p_job.reserved_credits - v_charge, 'settlement',
    p_job.job_id, 'job:' || p_job.job_id || ':settle',
    jsonb_build_object('reservedCredits', p_job.reserved_credits, 'chargedCredits', v_charge));
  UPDATE axle_cloud_jobs SET settled_credits = v_charge WHERE job_id = p_job.job_id;
  RETURN v_charge;
END $$;
-- Control-plane entry point: billing operations are served directly; job
-- operations delegate to the base command and then reconcile credits inside the
-- same statement, which is one transaction with the Neon HTTP driver.
CREATE OR REPLACE FUNCTION axle_cloud_command_atomic(p_operation TEXT, a JSONB) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  acc axle_credit_accounts;
  entries JSONB;
  result JSONB;
  j axle_cloud_jobs;
  v_reserve BIGINT := 0;
  v_rate BIGINT := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_operation = 'billing' THEN
    SELECT * INTO acc FROM axle_credit_ensure(a->>'userId', coalesce(a->>'planId', 'operator'),
      coalesce((a->>'monthlyCredits')::BIGINT, 0), to_char(v_now, 'YYYY-MM'));
    SELECT coalesce(jsonb_agg(jsonb_build_object('entryId', e.entry_id, 'kind', e.kind,
      'amount', e.amount, 'jobId', e.job_id, 'note', e.note, 'createdAt', e.created_at)
      ORDER BY e.entry_id DESC), '[]'::JSONB) INTO entries
    FROM (SELECT * FROM axle_credit_ledger WHERE user_id = a->>'userId'
      ORDER BY entry_id DESC LIMIT 50) e;
    RETURN jsonb_build_object('account', jsonb_build_object('planId', acc.plan_id,
      'balance', acc.balance, 'updatedAt', acc.updated_at), 'entries', entries);
  END IF;

  IF p_operation = 'grant' THEN
    IF (a->>'amount')::BIGINT <= 0 THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_amount'; END IF;
    SELECT * INTO acc FROM axle_credit_ensure(a->>'userId', coalesce(a->>'planId', 'operator'),
      coalesce((a->>'monthlyCredits')::BIGINT, 0), to_char(v_now, 'YYYY-MM'));
    PERFORM axle_credit_apply(a->>'userId', (a->>'amount')::BIGINT, 'adjustment', NULL,
      'grant:' || (a->>'entryId'), coalesce(a->'note', '{}'::JSONB));
    SELECT * INTO acc FROM axle_credit_accounts WHERE user_id = a->>'userId';
    RETURN jsonb_build_object('planId', acc.plan_id, 'balance', acc.balance);
  END IF;

  IF p_operation = 'create' THEN
    v_rate := coalesce((a->>'creditsPerMinute')::BIGINT, 0);
    IF v_rate > 0 THEN
      v_reserve := ceil((a->'limits'->>'maxDurationSeconds')::NUMERIC / 60)::BIGINT * v_rate;
      SELECT * INTO acc FROM axle_credit_ensure(a->>'userId', coalesce(a->>'planId', 'operator'),
        coalesce((a->>'monthlyCredits')::BIGINT, 0), to_char(v_now, 'YYYY-MM'));
      IF acc.balance < v_reserve THEN RAISE EXCEPTION 'AXLE_CLOUD:insufficient_credits'; END IF;
    END IF;
    result := axle_cloud_command(p_operation, a);
    IF v_reserve > 0 AND (result->>'created')::BOOLEAN THEN
      UPDATE axle_cloud_jobs SET billing = jsonb_build_object('creditsPerMinute', v_rate),
        reserved_credits = v_reserve WHERE job_id = result->'job'->>'jobId';
      PERFORM axle_credit_apply(a->>'userId', -v_reserve, 'reservation',
        result->'job'->>'jobId', 'job:' || (result->'job'->>'jobId') || ':reserve',
        jsonb_build_object('creditsPerMinute', v_rate));
    END IF;
    RETURN result;
  END IF;

  result := axle_cloud_command(p_operation, a);

  -- The first claim starts the metered window for settlement.
  IF p_operation = 'claim' AND result IS DISTINCT FROM 'null'::JSONB THEN
    UPDATE axle_cloud_jobs SET started_at = coalesce(started_at, clock_timestamp())
    WHERE job_id = result->'job'->>'jobId';
  END IF;

  IF p_operation IN ('update', 'cancel') THEN
    SELECT * INTO j FROM axle_cloud_jobs WHERE job_id = a->>'jobId'
      AND state IN ('completed', 'failed', 'cancelled', 'interrupted')
      AND reserved_credits > 0 AND settled_credits IS NULL;
    IF FOUND THEN PERFORM axle_credit_settle(j, clock_timestamp()); END IF;
  END IF;

  IF p_operation = 'recover' THEN
    FOR j IN SELECT * FROM axle_cloud_jobs WHERE environment_id = a->>'environmentId'
      AND state IN ('completed', 'failed', 'cancelled', 'interrupted')
      AND reserved_credits > 0 AND settled_credits IS NULL
    LOOP
      PERFORM axle_credit_settle(j, clock_timestamp());
    END LOOP;
  END IF;

  RETURN result;
END $$;