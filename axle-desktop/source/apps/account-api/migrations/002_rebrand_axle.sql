-- One-time rebrand migration: pre-rebrand installations created these tables
-- under brand-prefixed names (`rivet_account_*` from the previous release line,
-- `sparky_account_*` before that). Rename them in place (data included) so
-- upgraded databases keep profiles, devices, sessions, and usage history.
--
-- The `rivet`/`sparky` identifiers below are intentionally preserved legacy
-- names, ordered newest first so the most recent data wins when more than one
-- legacy table somehow exists.
-- This file must run before 001_account.sql so the CREATE TABLE IF NOT EXISTS
-- statements there never seed empty `axle_account_*` twins next to populated
-- pre-rebrand tables.

DO $$
DECLARE
  pair RECORD;
BEGIN
  FOR pair IN
    SELECT * FROM (
      VALUES
        ('rivet_account_profiles', 'axle_account_profiles', 1),
        ('sparky_account_profiles', 'axle_account_profiles', 2),
        ('rivet_account_devices', 'axle_account_devices', 1),
        ('sparky_account_devices', 'axle_account_devices', 2),
        ('rivet_account_sessions', 'axle_account_sessions', 1),
        ('sparky_account_sessions', 'axle_account_sessions', 2),
        ('rivet_account_usage_events', 'axle_account_usage_events', 1),
        ('sparky_account_usage_events', 'axle_account_usage_events', 2),
        ('rivet_account_usage_daily', 'axle_account_usage_daily', 1),
        ('sparky_account_usage_daily', 'axle_account_usage_daily', 2),
        ('rivet_account_usage_models', 'axle_account_usage_models', 1),
        ('sparky_account_usage_models', 'axle_account_usage_models', 2),
        ('rivet_account_stats', 'axle_account_stats', 1),
        ('sparky_account_stats', 'axle_account_stats', 2)
    ) AS tables (legacy_name, axle_name, priority)
    ORDER BY priority
  LOOP
    IF to_regclass(pair.legacy_name) IS NOT NULL
      AND to_regclass(pair.axle_name) IS NULL THEN
      EXECUTE format('ALTER TABLE %I RENAME TO %I', pair.legacy_name, pair.axle_name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  pair RECORD;
BEGIN
  FOR pair IN
    SELECT * FROM (
      VALUES
        ('rivet_account_devices_user_idx', 'axle_account_devices_user_idx', 1),
        ('sparky_account_devices_user_idx', 'axle_account_devices_user_idx', 2),
        ('rivet_account_sessions_user_idx', 'axle_account_sessions_user_idx', 1),
        ('sparky_account_sessions_user_idx', 'axle_account_sessions_user_idx', 2),
        ('rivet_account_usage_events_user_idx', 'axle_account_usage_events_user_idx', 1),
        ('sparky_account_usage_events_user_idx', 'axle_account_usage_events_user_idx', 2)
    ) AS indexes (legacy_name, axle_name, priority)
    ORDER BY priority
  LOOP
    IF to_regclass(pair.legacy_name) IS NOT NULL
      AND to_regclass(pair.axle_name) IS NULL THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', pair.legacy_name, pair.axle_name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  pair RECORD;
  legacy_constraint TEXT;
BEGIN
  FOR pair IN
    SELECT * FROM (
      VALUES
        ('axle_account_profiles', 'rivet_account_profiles_pkey', 'sparky_account_profiles_pkey', 'axle_account_profiles_pkey'),
        ('axle_account_devices', 'rivet_account_devices_pkey', 'sparky_account_devices_pkey', 'axle_account_devices_pkey'),
        ('axle_account_sessions', 'rivet_account_sessions_pkey', 'sparky_account_sessions_pkey', 'axle_account_sessions_pkey'),
        ('axle_account_usage_events', 'rivet_account_usage_events_pkey', 'sparky_account_usage_events_pkey', 'axle_account_usage_events_pkey'),
        ('axle_account_usage_daily', 'rivet_account_usage_daily_pkey', 'sparky_account_usage_daily_pkey', 'axle_account_usage_daily_pkey'),
        ('axle_account_usage_models', 'rivet_account_usage_models_pkey', 'sparky_account_usage_models_pkey', 'axle_account_usage_models_pkey'),
        ('axle_account_stats', 'rivet_account_stats_pkey', 'sparky_account_stats_pkey', 'axle_account_stats_pkey')
    ) AS constraints (table_name, newest_name, older_name, axle_name)
  LOOP
    IF to_regclass(pair.table_name) IS NULL THEN
      CONTINUE;
    END IF;
    SELECT COALESCE(
      (
        SELECT conname FROM pg_constraint
        WHERE conrelid = to_regclass(pair.table_name) AND conname = pair.newest_name
      ),
      (
        SELECT conname FROM pg_constraint
        WHERE conrelid = to_regclass(pair.table_name) AND conname = pair.older_name
      )
    ) INTO legacy_constraint;
    IF legacy_constraint IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = pair.axle_name
          AND conrelid = to_regclass(pair.table_name)
      ) THEN
      EXECUTE format(
        'ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
        pair.table_name, legacy_constraint, pair.axle_name
      );
    END IF;
  END LOOP;
END $$;
