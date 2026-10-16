# Testing the Axle gateway yourself

Everything here runs locally with **no Cloudflare account, no database, and no
upstream API key**. The gateway uses an in-memory credits ledger and a stubbed
upstream that returns fixed content (12 prompt + 4 completion tokens), so the
credit math is exact and repeatable.

Balances live in memory, so they reset every time the gateway restarts.

## 1. One-command check

```sh
cd axle-gateway-worker
npm run self-test
```

Boots the real worker and asserts the catalog, the 100-credit daily grant, the
per-model charge math, the 402 gate, 401/400 handling, per-user isolation — and,
when a built `axle` binary exists, drives a real turn through the engine. Point
it at a specific binary with `AXLE_BIN=/path/to/axle npm run self-test`.

## 2. Run the gateway and poke it by hand

```sh
cd axle-gateway-worker
npm run gateway:local          # PORT=8791 by default
```

In another terminal:

```sh
# The five models and their credit rates
curl -s http://127.0.0.1:8791/v1/models

# Free daily balance for a key (any string is a valid key locally)
curl -s -H 'Authorization: Bearer demo_key' http://127.0.0.1:8791/v1/credits

# A metered turn — watch the x-axle-credits-* response headers
curl -s -D - -H 'Authorization: Bearer demo_key' -H 'Content-Type: application/json' \
  -d '{"model":"axle-320b","messages":[{"role":"user","content":"hi"}]}' \
  http://127.0.0.1:8791/v1/chat/completions

# A streamed turn (settles from the upstream usage chunk)
curl -s -N -H 'Authorization: Bearer demo_key' -H 'Content-Type: application/json' \
  -d '{"model":"axle-20b","stream":true,"messages":[{"role":"user","content":"hi"}]}' \
  http://127.0.0.1:8791/v1/chat/completions

# Out of credits: this reserves more than the balance and returns 402
curl -s -o - -w '\nHTTP %{http_code}\n' -H 'Authorization: Bearer demo_key' -H 'Content-Type: application/json' \
  -d '{"model":"axle-552b","max_tokens":100000,"messages":[{"role":"user","content":"hi"}]}' \
  http://127.0.0.1:8791/v1/chat/completions
```

## 3. Run the real engine against it

Build the runtime once from the repo root, then point it at the local gateway:

```sh
cargo build --release -p axle_cli

AXLE_BASE_URL=http://127.0.0.1:8791/v1 AXLE_API_KEY=demo_key \
  ./target/release/axle --provider axle --model axle-20b --text-only -p "say hi"
```

Swap `--text-only` for a normal prompt to run a full agent turn, and try
`--model axle-552b` to watch a smarter (more expensive) model drain credits
faster. `--api-key <key>` works too, and wins over `AXLE_API_KEY`.

## 4. Run the desktop app against it

In **Settings > Models**, use the **Axle** provider row: paste any key into the
key field and set the base URL to `http://127.0.0.1:8791/v1`. The picker then
lists the five Axle models.

This path needs a working desktop build. If `pnpm install` has not completed,
the app will not build yet — the CLI in step 3 exercises the same runtime code
without the desktop shell.

## What is stubbed

| Piece | Local | Production |
| --- | --- | --- |
| Credits store | in-memory (`MemoryCreditsStore`) | D1 (`CREDITS_DB` binding) |
| Upstream provider | stub returning fixed usage | `UPSTREAM_BASE_URL` + `UPSTREAM_API_KEY` secret |
| Auth | any bearer string becomes a user id | Axle account key / signed token |

To run a real upstream instead of the stub, deploy normally (see `README.md`) or
set `UPSTREAM_API_KEY` and start the worker with `wrangler dev`.
