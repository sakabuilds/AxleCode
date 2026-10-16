# Axle Gateway

The hosted provider behind `axle --provider axle`. It is an OpenAI-compatible
endpoint that authenticates an `AXLE_API_KEY`, meters the turn in Axle credits,
and forwards to a single upstream provider key that Axle owns — so every user
gets working models without configuring a vendor key of their own.

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/v1/models` | `GET` | The four Axle models and their credit rates (the desktop picker) |
| `/v1/credits` | `GET` | Current balance; applies the free daily grant |
| `/v1/chat/completions` | `POST` | Metered chat completion |
| `/healthz` | `GET` | Liveness |

## Credits

100 credits == $0.50, so one credit is half a cent. Every user receives **100
credits ($0.50) per UTC day** for free, granted on their first request of the
day. Top-ups add to the same balance; there is no separate "paid" bucket.

The four models are priced by tier, so an Axle-552b turn drains a day's free
credits far faster than an Axle-20b turn:

| Model | Tier | Credits / 1M input | Credits / 1M output |
| --- | --- | --- | --- |
| `axle-20b` | 1 | 40 | 160 |
| `axle-55b` | 2 | 60 | 240 |
| `axle-320b` | 3 | 150 | 600 |
| `axle-552b` | 4 | 300 | 1200 |

Rates and upstream model ids live in `src/pricing.js`; the upstream ids point
at NVIDIA NIM (`https://integrate.api.nvidia.com/v1`) and are data, so the
catalog can be re-pointed without touching the gateway logic.

### How a turn is metered

1. The request's `Authorization: Bearer <key>` is hashed into a stable user id.
2. The daily grant is applied (once per UTC day).
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
wrangler secret put UPSTREAM_API_KEY     # the shared upstream key Axle owns
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
