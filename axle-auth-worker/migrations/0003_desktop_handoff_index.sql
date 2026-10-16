-- Desktop sign-in hand-off: the poll fallback looks up the newest unconsumed
-- code for one sign-in state, so keep that lookup indexed instead of scanning.
CREATE INDEX IF NOT EXISTS axle_auth_codes_state_idx
  ON axle_auth_codes (state, created_at DESC)
  WHERE state IS NOT NULL;
