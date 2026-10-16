-- Control plane only. Workers never receive database credentials.
CREATE TABLE IF NOT EXISTS axle_cloud_jobs (
  job_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input JSONB NOT NULL,
  limits JSONB NOT NULL,
  environment_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'provisioning', 'running',
    'waiting_for_approval', 'waiting_for_input', 'finalizing', 'completed', 'failed', 'cancelled', 'interrupted')),
  generation INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  pending_request JSONB,
  pending_response JSONB,
  result JSONB,
  failure_code TEXT,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, command_id)
);
CREATE INDEX IF NOT EXISTS axle_cloud_jobs_owner ON axle_cloud_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS axle_cloud_jobs_queue ON axle_cloud_jobs(environment_id, created_at)
  WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS axle_cloud_jobs_expiry ON axle_cloud_jobs(environment_id, lease_expires_at)
  WHERE state IN ('provisioning', 'running', 'waiting_for_approval', 'waiting_for_input', 'finalizing');

CREATE TABLE IF NOT EXISTS axle_cloud_job_events (
  job_id TEXT NOT NULL REFERENCES axle_cloud_jobs(job_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, sequence)
);
CREATE TABLE IF NOT EXISTS axle_cloud_job_commands (
  job_id TEXT NOT NULL REFERENCES axle_cloud_jobs(job_id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  PRIMARY KEY (job_id, command_id)
);

-- Explicit public projection: lease capabilities and account identity are never returned to clients.
CREATE OR REPLACE FUNCTION axle_cloud_job_view(j axle_cloud_jobs) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'jobId', j.job_id, 'state', j.state, 'input', j.input, 'limits', j.limits,
    'generation', j.generation, 'createdAt', j.created_at, 'updatedAt', j.updated_at,
    'deadlineAt', j.deadline_at, 'cancelRequestedAt', j.cancel_requested_at,
    'pendingRequest', j.pending_request, 'result', j.result, 'failureCode', j.failure_code,
    'lastSequence', j.last_sequence)
$$;

CREATE OR REPLACE FUNCTION axle_cloud_emit(p_job_id TEXT, p_kind TEXT, p_payload JSONB) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_sequence INTEGER;
BEGIN
  -- Every caller holds the job row lock. State mutation and its event commit together.
  UPDATE axle_cloud_jobs SET last_sequence = last_sequence + 1, updated_at = clock_timestamp()
  WHERE job_id = p_job_id AND (
    last_sequence < (limits->>'maxEvents')::INTEGER OR (
      last_sequence < (limits->>'maxEvents')::INTEGER + 3 AND (
        p_kind = 'cancellation' OR (p_kind = 'state' AND p_payload->>'state' IN
          ('finalizing', 'completed', 'failed', 'cancelled', 'interrupted'))
      )
    )
  ) RETURNING last_sequence INTO v_sequence;
  IF v_sequence IS NULL THEN RAISE EXCEPTION 'AXLE_CLOUD:event_limit_exceeded'; END IF;
  INSERT INTO axle_cloud_job_events(job_id, sequence, kind, payload)
  VALUES (p_job_id, v_sequence, p_kind, p_payload);
END $$;

-- A single statement is a transaction with the Neon HTTP driver. Locks are acquired
-- inside PostgreSQL, never across separate HTTP round trips.
CREATE OR REPLACE FUNCTION axle_cloud_command(p_operation TEXT, a JSONB) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  j axle_cloud_jobs;
  v_id TEXT;
  v_previous TEXT;
  v_next TEXT;
  v_hash TEXT;
  v_events JSONB;
  v_count INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_operation = 'create' THEN
    -- Serializes concurrent creates by an owner, including jobs in different environments.
    PERFORM pg_advisory_xact_lock(hashtextextended('axle-cloud-owner:' || (a->>'userId'), 0));
    v_now := clock_timestamp();
    SELECT * INTO j FROM axle_cloud_jobs WHERE user_id = a->>'userId' AND command_id = a->'input'->>'commandId';
    IF FOUND THEN
      IF j.input_hash <> a->>'inputHash' THEN RAISE EXCEPTION 'AXLE_CLOUD:idempotency_conflict'; END IF;
      RETURN jsonb_build_object('job', axle_cloud_job_view(j), 'created', false);
    END IF;
    SELECT count(*) INTO v_count FROM axle_cloud_jobs WHERE user_id = a->>'userId'
      AND state NOT IN ('completed', 'failed', 'cancelled', 'interrupted');
    IF v_count >= (a->>'maxActiveJobsPerUser')::INTEGER THEN RAISE EXCEPTION 'AXLE_CLOUD:capacity_exceeded'; END IF;
    INSERT INTO axle_cloud_jobs(job_id, user_id, command_id, input_hash, input, limits, environment_id, state, deadline_at)
    VALUES(a->>'jobId', a->>'userId', a->'input'->>'commandId', a->>'inputHash', a->'input', a->'limits',
      a->'input'->>'environmentId', 'queued', v_now + make_interval(secs => (a->'limits'->>'maxDurationSeconds')::INTEGER))
    RETURNING * INTO j;
    PERFORM axle_cloud_emit(j.job_id, 'state', jsonb_build_object('state', 'queued'));
    SELECT * INTO j FROM axle_cloud_jobs WHERE job_id = j.job_id;
    RETURN jsonb_build_object('job', axle_cloud_job_view(j), 'created', true);
  END IF;

  IF p_operation = 'list' THEN
    SELECT coalesce(jsonb_agg(axle_cloud_job_view(q) ORDER BY q.created_at DESC, q.job_id), '[]'::JSONB)
    INTO v_events FROM (
      SELECT * FROM axle_cloud_jobs WHERE user_id = a->>'userId'
      ORDER BY created_at DESC, job_id LIMIT 100
    ) q;
    RETURN jsonb_build_object('jobs', v_events);
  END IF;

  IF p_operation = 'claim' OR p_operation = 'recover' THEN
    -- Environment lock makes the concurrency cap atomic across independent API instances.
    PERFORM pg_advisory_xact_lock(hashtextextended('axle-cloud-environment:' || (a->>'environmentId'), 0));
    v_now := clock_timestamp();
    FOR j IN SELECT * FROM axle_cloud_jobs WHERE environment_id = a->>'environmentId'
      AND state NOT IN ('completed', 'failed', 'cancelled', 'interrupted')
      AND (deadline_at <= v_now OR lease_expires_at <= v_now)
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100
    LOOP
      -- Never silently replay arbitrary commands after a crash. Preserve the manifest
      -- and transcript in worker storage for explicit recovery/review.
      v_next := CASE WHEN j.cancel_requested_at IS NOT NULL THEN 'cancelled'
        WHEN j.deadline_at <= v_now THEN 'failed' ELSE 'interrupted' END;
      UPDATE axle_cloud_jobs SET state = v_next, lease_token = NULL, lease_expires_at = NULL,
        failure_code = CASE WHEN v_next = 'cancelled' THEN NULL
          WHEN j.deadline_at <= v_now THEN 'deadline_exceeded' ELSE 'lease_expired' END
      WHERE job_id = j.job_id;
      PERFORM axle_cloud_emit(j.job_id, 'state', jsonb_build_object('state', v_next,
        'reason', CASE WHEN j.deadline_at <= v_now THEN 'deadline_exceeded' ELSE 'lease_expired' END));
    END LOOP;
    IF p_operation = 'recover' THEN RETURN jsonb_build_object('recovered', true); END IF;
    SELECT count(*) INTO v_count FROM axle_cloud_jobs WHERE environment_id = a->>'environmentId'
      AND state IN ('provisioning', 'running', 'waiting_for_approval', 'waiting_for_input', 'finalizing');
    IF v_count >= (a->>'maxConcurrentJobs')::INTEGER THEN RETURN 'null'::JSONB; END IF;
    SELECT * INTO j FROM axle_cloud_jobs WHERE environment_id = a->>'environmentId'
      AND state = 'queued' AND deadline_at > v_now
      ORDER BY created_at, job_id FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN 'null'::JSONB; END IF;
    v_now := clock_timestamp();
    IF j.deadline_at <= v_now THEN RETURN 'null'::JSONB; END IF;
    UPDATE axle_cloud_jobs SET state = 'provisioning', generation = generation + 1,
      lease_owner = a->>'workerId', lease_token = a->>'leaseToken',
      lease_expires_at = least(deadline_at, v_now + make_interval(secs => (a->>'leaseSeconds')::INTEGER))
    WHERE job_id = j.job_id;
    PERFORM axle_cloud_emit(j.job_id, 'state', jsonb_build_object('state', 'provisioning', 'generation', j.generation + 1));
    SELECT * INTO j FROM axle_cloud_jobs WHERE job_id = j.job_id;
    RETURN jsonb_build_object('job', axle_cloud_job_view(j), 'leaseToken', j.lease_token,
      'leaseExpiresAt', j.lease_expires_at, 'response', j.pending_response);
  END IF;

  SELECT * INTO j FROM axle_cloud_jobs WHERE job_id = a->>'jobId' FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'AXLE_CLOUD:not_found'; END IF;
  IF p_operation IN ('get', 'events', 'cancel', 'respond') THEN
    IF j.user_id <> a->>'userId' THEN RAISE EXCEPTION 'AXLE_CLOUD:not_found'; END IF;
  ELSIF p_operation IN ('heartbeat', 'update') THEN
    -- Also fence by environment: workers authorized for one pool cannot act in another.
    IF j.environment_id <> a->>'environmentId' OR j.lease_owner <> a->>'workerId'
      OR j.lease_token IS NULL OR j.lease_token <> a->>'leaseToken'
      OR j.generation <> (a->>'generation')::INTEGER
    THEN RAISE EXCEPTION 'AXLE_CLOUD:lease_lost'; END IF;
    -- Terminal receipts remain replayable by the same worker capability only.
    -- This check never authorizes a new command after expiration/termination.
    IF p_operation = 'update' THEN
      SELECT input_hash INTO v_hash FROM axle_cloud_job_commands WHERE job_id = j.job_id AND command_id = a->>'commandId';
      IF FOUND THEN
        IF v_hash <> a->>'inputHash' THEN RAISE EXCEPTION 'AXLE_CLOUD:idempotency_conflict'; END IF;
        RETURN axle_cloud_job_view(j);
      END IF;
    END IF;
    IF j.lease_expires_at IS NULL OR j.lease_expires_at <= v_now OR j.deadline_at <= v_now
      THEN RAISE EXCEPTION 'AXLE_CLOUD:lease_lost'; END IF;
  ELSE RAISE EXCEPTION 'AXLE_CLOUD:invalid_operation';
  END IF;

  IF p_operation = 'get' THEN RETURN axle_cloud_job_view(j); END IF;
  IF p_operation = 'events' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('sequence', e.sequence, 'kind', e.kind,
      'payload', e.payload, 'createdAt', e.created_at) ORDER BY e.sequence), '[]'::JSONB) INTO v_events
    FROM (SELECT * FROM axle_cloud_job_events WHERE job_id = j.job_id
      AND sequence > (a->>'after')::INTEGER ORDER BY sequence LIMIT (a->>'limit')::INTEGER) e;
    RETURN jsonb_build_object('events', v_events, 'lastSequence', j.last_sequence);
  END IF;
  IF p_operation = 'cancel' THEN
    IF j.state NOT IN ('completed', 'failed', 'cancelled', 'interrupted') AND j.cancel_requested_at IS NULL THEN
      UPDATE axle_cloud_jobs SET cancel_requested_at = v_now,
        state = CASE WHEN state = 'queued' THEN 'cancelled' ELSE state END WHERE job_id = j.job_id;
      PERFORM axle_cloud_emit(j.job_id, 'cancellation', jsonb_build_object('requested', true));
      IF j.state = 'queued' THEN PERFORM axle_cloud_emit(j.job_id, 'state', jsonb_build_object('state', 'cancelled')); END IF;
    END IF;
  ELSIF p_operation = 'heartbeat' THEN
    UPDATE axle_cloud_jobs SET lease_expires_at = least(deadline_at,
      v_now + make_interval(secs => (a->>'leaseSeconds')::INTEGER)) WHERE job_id = j.job_id;
  ELSE
    SELECT input_hash INTO v_hash FROM axle_cloud_job_commands WHERE job_id = j.job_id AND command_id = a->>'commandId';
    IF FOUND THEN
      IF v_hash <> a->>'inputHash' THEN RAISE EXCEPTION 'AXLE_CLOUD:idempotency_conflict'; END IF;
      RETURN axle_cloud_job_view(j);
    END IF;
    IF p_operation = 'respond' THEN
      IF j.cancel_requested_at IS NOT NULL OR j.deadline_at <= v_now OR j.lease_expires_at <= v_now
        OR j.state NOT IN ('waiting_for_approval', 'waiting_for_input') OR j.pending_request IS NULL
        OR j.pending_request->>'requestId' <> a->>'requestId' OR j.pending_response IS NOT NULL
      THEN RAISE EXCEPTION 'AXLE_CLOUD:request_not_pending'; END IF;
      UPDATE axle_cloud_jobs SET pending_response = jsonb_build_object('requestId', a->>'requestId', 'payload', a->'payload')
      WHERE job_id = j.job_id;
      PERFORM axle_cloud_emit(j.job_id, 'response', jsonb_build_object('requestId', a->>'requestId'));
    ELSE
      v_next := coalesce(a->>'state', j.state);
      v_previous := j.state;
      IF (v_next = j.state AND NOT a ? 'event') OR
        (v_next = j.state AND j.state IN ('waiting_for_approval', 'waiting_for_input'))
        THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_transition'; END IF;
      IF j.state IN ('completed', 'failed', 'cancelled', 'interrupted')
        OR (j.cancel_requested_at IS NOT NULL AND v_next <> 'cancelled')
      THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_transition'; END IF;
      IF v_next <> j.state AND NOT (
        (j.state = 'provisioning' AND v_next IN ('running', 'failed', 'cancelled')) OR
        (j.state = 'running' AND v_next IN ('waiting_for_approval', 'waiting_for_input', 'finalizing', 'failed', 'cancelled')) OR
        (j.state IN ('waiting_for_approval', 'waiting_for_input') AND v_next IN ('running', 'failed', 'cancelled')) OR
        (j.state = 'finalizing' AND v_next IN ('completed', 'failed', 'cancelled'))
      ) THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_transition'; END IF;
      IF v_next = 'running' AND j.state IN ('waiting_for_approval', 'waiting_for_input') AND j.pending_response IS NULL
      THEN RAISE EXCEPTION 'AXLE_CLOUD:request_not_answered'; END IF;
      IF v_next IN ('waiting_for_approval', 'waiting_for_input') AND v_next <> j.state THEN
        -- Reserve one response and one resume event before exposing an approval.
        IF (j.last_sequence + 4 + CASE WHEN a ? 'event' THEN 1 ELSE 0 END) > (j.limits->>'maxEvents')::INTEGER
          THEN RAISE EXCEPTION 'AXLE_CLOUD:event_limit_exceeded'; END IF;
        IF (a->'pendingRequest' IS NULL OR a->'pendingRequest'->>'kind' <>
          CASE WHEN v_next = 'waiting_for_approval' THEN 'approval' ELSE 'input' END)
        THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_request'; END IF;
      ELSIF a ? 'pendingRequest' THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_request'; END IF;
      IF v_next = 'completed' AND (a->'result' IS NULL OR a->'result'->>'sourceRevision' <> j.input->>'sourceRevision')
      THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_result'; END IF;
      IF a ? 'result' AND v_next <> 'completed' THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_result'; END IF;
      IF v_next = 'failed' AND a->>'failureCode' IS NULL THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_failure'; END IF;
      IF a ? 'failureCode' AND v_next <> 'failed' THEN RAISE EXCEPTION 'AXLE_CLOUD:invalid_failure'; END IF;
      UPDATE axle_cloud_jobs SET state = v_next,
        pending_request = CASE WHEN a ? 'pendingRequest' THEN a->'pendingRequest'
          WHEN v_next <> j.state THEN NULL ELSE pending_request END,
        pending_response = CASE WHEN v_next <> j.state THEN NULL ELSE pending_response END,
        result = coalesce(a->'result', result), failure_code = a->>'failureCode',
        lease_expires_at = CASE WHEN v_next IN ('completed', 'failed', 'cancelled') THEN NULL ELSE lease_expires_at END
      WHERE job_id = j.job_id;
      IF v_next <> v_previous THEN PERFORM axle_cloud_emit(j.job_id, 'state', jsonb_build_object('state', v_next)); END IF;
      IF a ? 'event' THEN PERFORM axle_cloud_emit(j.job_id, 'runtime', a->'event'); END IF;
      IF a ? 'pendingRequest' THEN PERFORM axle_cloud_emit(j.job_id, 'request', a->'pendingRequest'); END IF;
    END IF;
    INSERT INTO axle_cloud_job_commands(job_id, command_id, input_hash) VALUES(j.job_id, a->>'commandId', a->>'inputHash');
  END IF;
  SELECT * INTO j FROM axle_cloud_jobs WHERE job_id = j.job_id;
  IF p_operation = 'heartbeat' THEN
    RETURN jsonb_build_object('job', axle_cloud_job_view(j), 'leaseToken', j.lease_token,
      'leaseExpiresAt', j.lease_expires_at, 'response', j.pending_response);
  END IF;
  RETURN axle_cloud_job_view(j);
END $$;
