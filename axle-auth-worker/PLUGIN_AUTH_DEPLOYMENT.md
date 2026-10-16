# Axle plugin auth worker

This Worker owns persistent per-installation plugin authorization for Axle Desktop. Composio is not used. GitHub keeps Axle's existing native desktop OAuth flow; Gmail, Outlook, Slack, Jira, Notion, Sentry, and Figma use their provider OAuth flows directly through this Worker. Axle account sign-in is not required to create a plugin session or connect a provider; each provider still requires its own authorization.

The desktop renderer receives an opaque, encrypted Axle plugin-session token. When no Axle account session exists, the Worker issues an anonymous session scoped to a stable, random installation ID; session creation and validation are stateless and do not use Cloudflare KV. Provider access/refresh tokens remain encrypted at rest in Cloudflare KV and are never returned to the renderer.

The Worker also hosts `/v1/auth/desktop`, the Axle-owned sign-in surface used by Axle Desktop. Older builds that still request the retired `/v1/clerk/desktop` are redirected there.

## Public client IDs

OAuth client IDs are public values. Put them in `wrangler.toml` under `[vars]`; Wrangler injects them into the Worker deployment:

- `GITHUB_CLIENT_ID`
- `GOOGLE_CLIENT_ID` (desktop sign-in; separate from `GMAIL_CLIENT_ID`, which stays bound to the Gmail plugin)
- `GMAIL_CLIENT_ID`
- `OUTLOOK_CLIENT_ID`
- `SLACK_CLIENT_ID`
- `JIRA_CLIENT_ID`
- `NOTION_CLIENT_ID`
- `SENTRY_CLIENT_ID`
- `FIGMA_CLIENT_ID`
- `CLERK_PUBLISHABLE_KEY`
- `PUBLIC_BASE_URL`, normally `https://auth.axle.llc`

Do not put provider client secrets in `wrangler.toml`, Vite variables, the desktop installer, or source control.

Create a KV namespace and configure the `PLUGIN_STORE` binding in `wrangler.toml`.

## Worker secrets

Install provider client secrets directly into the Cloudflare Worker:

```sh
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GMAIL_CLIENT_SECRET
wrangler secret put OUTLOOK_CLIENT_SECRET
wrangler secret put SLACK_CLIENT_SECRET
wrangler secret put JIRA_CLIENT_SECRET
wrangler secret put NOTION_CLIENT_SECRET
wrangler secret put SENTRY_CLIENT_SECRET
wrangler secret put FIGMA_CLIENT_SECRET
wrangler secret put CLERK_SECRET_KEY
wrangler secret put PLUGIN_TOKEN_ENCRYPTION_KEY
wrangler secret put ANALYTICS_ADMIN_TOKEN
```

`PLUGIN_TOKEN_ENCRYPTION_KEY` must be a base64url-encoded 32-byte random value. It protects provider credentials persisted in `PLUGIN_STORE` and encrypts the stateless desktop session tokens.
`CLERK_SECRET_KEY` is used only by the Worker to mint a fresh short-lived Clerk session JWT from the saved Clerk session when the desktop app relaunches. The encrypted plugin-session token is retained in the desktop app's local profile for 30 days; logout clears that local token. The Clerk secret key is never returned to the desktop renderer.

## OAuth callbacks

Configure each provider application to allow the callback on the deployed Worker origin:

```text
Google sign-in: https://axle-auth.axle-download-worker.workers.dev/v1/auth/callback/google
Gmail:   https://auth.axle.llc/v1/plugins/gmail/callback
Outlook: https://auth.axle.llc/v1/plugins/outlook/callback
Slack:   https://auth.axle.llc/v1/plugins/slack/callback
Jira:    https://auth.axle.llc/v1/plugins/jira/callback
Notion:  https://auth.axle.llc/v1/plugins/notion/callback
Sentry:  https://auth.axle.llc/v1/plugins/sentry/callback
Figma:   https://auth.axle.llc/v1/plugins/figma/callback
```

Google is the desktop sign-in provider, and Google requires an exact redirect
URI match. The URI must be `${PUBLIC_BASE_URL}/v1/auth/callback/google` for the
deployment, so registering it under an `OAuth client` of type **Web
application** is mandatory — adding the origin under *Authorized JavaScript
origins* is not enough. Until it is registered, `/v1/auth/start?provider=google`
reaches Google and comes back with `redirect_uri_mismatch`. `/v1/auth/providers`
only reports `google` once both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
are set.

GitHub intentionally stays on Axle's existing desktop OAuth flow. Its OAuth App should allow the loopback callback:

```text
http://127.0.0.1/github/oauth/callback
```

The desktop chooses a random loopback port at runtime and imports the resulting GitHub credential into the Worker without exposing it to renderer JavaScript.

## Clerk application

Create one Clerk application for Axle and enable the sign-in methods you want. Copy its Publishable Key into `CLERK_PUBLISHABLE_KEY`.

In **Clerk Dashboard → Sessions → Customize session token**, add:

```json
{
  "aud": "axle-relay"
}
```

For the separate account API, configure the same Clerk application:

```sh
CLERK_ISSUER=https://<your-clerk-frontend-api-domain>
CLERK_JWKS_URL=https://<your-clerk-frontend-api-domain>/.well-known/jwks.json
CLERK_AUDIENCE=axle-relay
```

The relay currently keeps its historical `NEON_AUTH_*` variable names. Point those variables at Clerk:

```sh
NEON_AUTH_JWKS_URL=https://<your-clerk-frontend-api-domain>/.well-known/jwks.json
NEON_AUTH_ISSUER=https://<your-clerk-frontend-api-domain>
NEON_AUTH_AUDIENCE=axle-relay
```

## Desktop configuration

Source builds need only the Worker origin:

```sh
VITE_AXLE_PLUGIN_WORKER_URL=https://auth.axle.llc
AXLE_PLUGIN_WORKER_URL=https://auth.axle.llc
```

The provider client IDs do not need to be exposed to the Electron renderer because the Worker constructs the provider authorization URLs. They are public, but keeping them in Worker vars gives one authoritative deployment configuration and avoids duplicating OAuth config in the installer.

Release builds should keep:

- `AXLE_PLUGIN_WORKER_URL` → deployed Worker origin
- `AXLE_GITHUB_CLIENT_ID` → Axle GitHub OAuth app client ID
- `AXLE_GITHUB_AUTH_BROKER_URL` → GitHub auth broker URL when it differs from the plugin Worker

## Analytics

The Worker keeps privacy-safe per-Clerk-user counters in KV for signup/last-seen time, prompts, model calls/requests, agent calls, plugin authorization requests, successful plugin uses, and aggregate model/provider/plugin/action dimensions.

It does not store prompt text, responses, attachments, file paths, tool payloads, provider tokens, or conversation content.

## Deploy

From `axle-auth-worker`:

```sh
npm test
npx wrangler deploy --name axle-auth
```

After deployment, verify `/health`, Clerk sign-in, every provider OAuth callback, disconnect/reconnect behavior, GitHub credential import/refresh, agent authorization-card cancellation, and one read plus one permitted write action for each plugin.
