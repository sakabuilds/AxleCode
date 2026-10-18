# Axle Gateway

The hosted provider behind `axle --provider axle`. It is an OpenAI-compatible
endpoint that authenticates an `AXLE_API_KEY`, meters the turn in Axle credits,
and forwards to a single upstream provider key that Axle owns — so every user
gets working models without configuring a vendor key of their own.

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/v1/models` | `GET` | The six Axle models, their plans, and credit rates (the desktop picker) |
| `/v1/credits` | `GET` | Current balance; renews the free daily grant |
| `/v1/usage` | `GET` | Recent grants and spends behind the balance |
| `/v1/chat/completions` | `POST` | Metered chat completion |
| `/v1/internal/credits` | `POST` | Purchase/plan-grant application (internal token) |
| `/healthz` | `GET` | Liveness |

## Credits

100 credits == $0.50, so one credit is half a cent ($1 == 200 credits). A
balance is split into three buckets, spent in this order:

1. **Free** — 100 credits per UTC day, granted on the first request of the
   day. The bucket **renews**: a new day sets it back to 100, so unused free
   credits never roll over.
2. **Plan** — the monthly allowance an active paid plan grants (Pro 2,000 /
   Pro+ 4,000 / Ultra 10,000). The bucket is set by the plan, never
   accumulated.
3. **Paid** — credits the user bought (from $5). They persist until spent.

`POST /v1/internal/credits` (authorized by `INTERNAL_API_TOKEN`) is how the
account API applies purchases and plan grants after Bachs confirms a payment:
`{ user_id, amount, bucket: "paid" | "plan", reference }`, where `reference`
is the payment event id — a redelivered webhook can never double-credit.

## Models

The six models ship under their real names. `plan` marks which plans may use
them: `free` models are open to every account, `paid` models require an active
paid plan (Pro, Pro+, or Ultra) — the gateway asks the account API
(`ACCOUNT_API_URL` with `INTERNAL_API_TOKEN`), caches the answer for five
minutes, and fails open when billing is unreachable so an outage can never
lock a paying user out.

| Model | Upstream (NVIDIA NIM) | Plan | Credits / 1M input | Credits / 1M output |
| --- | --- | --- | --- | --- |
| Google Gemma 4 | `google/gemma-4-31b-it` | free | 25 | 100 |
| Meta Muse Glimmer | `meta/muse-glimmer-30b` | free | 15 | 60 |
| Nemotron 3.5 Lightning | `nvidia/nemotron-3.5-lightning-30b-a3b` | free | 12 | 50 |
| GLM 5.3 Flash | `z-ai/glm-5.3-flash` | paid | 30 | 120 |
| GLM 5.3 | `z-ai/glm-5.3` | paid | 150 | 600 |
| Nemotron 3 Super | `nvidia/nemotron-3-super-120b-a12b` | paid | 75 | 300 |

Rates are each model's real upstream rate plus a ~20% Axle margin, converted
at 200 credits per dollar. Rates and upstream ids live in `src/pricing.js`;
they are data, so the catalog can be re-pointed without touching the gateway
logic.

### How a turn is metered

1. The request's `Authorization: Bearer <key>` is resolved into a user id.
2. The daily grant is renewed (once per UTC day).
3. The maximum possible cost of the turn is **reserved** up front, so a
   streamed response can never be free. If the balance is short, the request
   is refused with `402` and `error.code = "axle_insufficient_credits"`.
4. After the upstream reports `usage`, the difference between the reservation
   and the real cost is refunded. Streaming responses carry the same guarantee
   because the gateway asks the upstream for `stream_options.include_usage` and
   settles when the usage chunk arrives.

## Deploy

```sh
cd axle-gateway-worker
wrangler d1 create axle-credits          # paste the id into wrangler.toml
wrangler d1 execute axle-credits --file=migrations/0001_credits.sql --remote
wrangler d1 execute axle-credits --file=migrations/0002_credit_buckets.sql --remote
wrangler secret put UPSTREAM_API_KEY     # the shared upstream key Axle owns
wrangler secret put INTERNAL_API_TOKEN   # shared with the account API
wrangler secret put ACCOUNT_API_URL     # e.g. https://axle-account.axle-download-worker.workers.dev
wrangler deploy
```

`UPSTREAM_BASE_URL` defaults to NVIDIA NIM
(`https://integrate.api.nvidia.com/v1`), the endpoint the Axle models are
served from; point it at any OpenAI-compatible endpoint to re-host. This
deployment lives at
`https://axle-gateway.axle-download-worker.workers.dev`, which is the default
`--provider axle` base URL, so the desktop app reaches it with no configuration.

## Identity

`Authorization: Bearer axl_...` is resolved against the account database the
auth worker owns (`ACCOUNTS_DB`), so the balance follows the user's Axle account
and revoking a key stops it on the next request. Any other bearer token is
hashed into a stable id instead, which is what self-hosted deployments use.

Users mint keys from the desktop app under **Settings → Account → API keys**.

## Tests

```sh
npm test         # unit tests: node --test src/*.test.js
npm run self-test  # end-to-end: boots the gateway and drives the real engine
```

See `TESTING.md` for the manual curl and CLI walkthrough.
