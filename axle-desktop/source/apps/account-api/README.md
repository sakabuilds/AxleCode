# Axle account API

This service owns the application-specific account/profile/device/usage tables in Neon Postgres.
The API verifies Clerk JWTs, with a legacy Neon Auth configuration fallback, and never receives the
database connection string from a browser.

Required environment variables:

- `NEON_DATABASE_URL` (or `DATABASE_URL`) — server-only Neon Postgres connection string.
- `CLERK_ISSUER`; `CLERK_JWKS_URL` and `CLERK_AUDIENCE` are optional.

Existing deployments can instead supply all three legacy variables: `NEON_AUTH_JWKS_URL`,
`NEON_AUTH_ISSUER`, and `NEON_AUTH_AUDIENCE`.

Optional: `HOST`, `PORT`, and `AXLE_ACCOUNT_CORS_ORIGIN`.

Run locally with `pnpm --filter @axle/account-api dev`. The service automatically loads the gitignored
`apps/account-api/.env.local` file; use a development database connection for local verification.
The first startup applies `migrations/002_rebrand_axle.sql` (renames legacy
pre-rebrand `rivet_account_*`/`sparky_account_*` tables and indexes in place,
no-op on fresh databases) followed by `migrations/001_account.sql`, both
idempotently.

Device identifiers and session identifiers retain their original account owner. A conflicting or
revoked device registration returns HTTP 409 without returning the existing record. Repeated
registration by its active owner updates that record and preserves omitted metadata. An atomic
session upsert rejects a revoked or differently owned session with HTTP 401 before any protected
account route runs; ordinary traffic cannot clear a revocation marker. No schema migration is needed
for these checks.

The service does not yet expose device/session revocation endpoints or synchronize identity-provider
revocations. Database session revocation applies when the verified token includes `sid`, `sessionId`,
or `session_id`; legacy verified tokens without a session claim still rely on JWT validation and
expiry. Device registration is inventory, not an authorization entitlement, and devices are not yet
bound to account sessions.

Usage events remain authenticated, client-reported telemetry. Their SQL aggregation is atomic and
deduplicates `(user_id, event_id)`, but token counts and costs are not authoritative billing values.
No credit ledger, payment integration, or execution entitlement is implemented here.

Focused verification from the monorepo directory:

```sh
vp test run apps/account-api/src/handler.test.ts apps/account-api/src/config.test.ts
```

The ownership tests exercise the real UPSERT predicates with in-process SQLite, adapting only
PostgreSQL's `now()` spelling. They cover cross-account conflicts, repeated registration, revoked
requests across all protected routes, and active sessions without requiring credentials or a server.
Live Neon/PostgreSQL behavior and real Clerk/Neon JWT verification require a configured test
deployment and are not covered by this suite.
