# Load test (B-21): 50 users on the main read paths

`read-paths.js` is a [k6](https://grafana.com/docs/k6/latest/) script. Fifty virtual users each sign in
as one identity, read `GET /api/v1/me` once, then loop over the screens that identity opens:

| Screen    | Request                                                                 |
| --------- | ----------------------------------------------------------------------- |
| dashboard | `GET /api/v1/dashboards/:role` (the identity's first role that has one) |
| list      | `GET /api/v1/quotes?pageSize=25`                                        |
| detail    | `GET /api/v1/quotes/:quoteNumber` (a random quote the identity can see) |
| queue     | `GET /api/v1/queue/engineering`, `/queue/pricing` or `/approvals`       |
| board     | `GET /api/v1/quotes/board`                                              |

Each screen is followed by 1–3 s of think time. The script only reads: it never creates, decides or
uploads, so it is safe to run against the shared test environment.

## Pass criteria

The run **passes** when k6 exits 0, which means every threshold held:

- `http_req_duration p(95) < 400 ms` over all requests, and for each screen on its own;
- `http_req_failed rate < 1%` (any non-2xx/3xx response counts as failed);
- `checks rate > 99%` (each screen returned 200).

Run the full profile (1 min ramp to 50 VUs, **10 min at 50**, 30 s ramp down) against the **test**
App Service for the B-21 evidence. Record the k6 summary in `docs/security/hardening-report.md`.

## Install k6

k6 is a standalone binary, not an npm package. Install it from
<https://grafana.com/docs/k6/latest/set-up/install-k6/> (for example `winget install k6`,
`brew install k6`, or the Linux tarball from the GitHub releases page) and check `k6 version`.

## Run locally (AUTH_MODE=dev)

```bash
docker compose up -d db
pnpm db:migrate && pnpm db:seed --synthetic
# Raise the per-client rate limit for the run: all 50 VUs come from one IP (see "Rate limit" below).
RATE_LIMIT_MAX=100000 pnpm --filter @ccq/api dev

pnpm load:smoke                       # 2 VUs for 30 s: checks the script and the environment
pnpm load                             # the full 50-VU profile
DURATION=1m pnpm load                 # a shorter hold at 50 VUs
```

In dev mode the VUs use the synthetic personas (`x-dev-user` header): one per MVP role plus an
owner-scoped KAM, spread round-robin. Override with `PERSONAS=kam,eng-lead,pricing`.

## Run against the test environment (Entra)

The test App Service runs `AUTH_MODE=entra`, so supply access tokens for the CCQ API scope, one per
test user (ideally one per role, so each VU's screens match a real role):

```bash
BASE_URL=https://<ccq-test-app>.azurewebsites.net \
AUTH=bearer \
TOKENS="$TOKEN_KAM,$TOKEN_ENGLEAD,$TOKEN_PRICING,$TOKEN_APPROVER,$TOKEN_LEADERSHIP" \
k6 run tests/load/read-paths.js
```

Get a token with `az account get-access-token --scope api://<ccq-api-client-id>/access_as_user --query accessToken -o tsv`
signed in as each test user. That works only if the API registration pre-authorizes the Azure CLI
client; otherwise sign in to the test SPA as the user and copy the bearer token of any `/api/v1`
request from the browser's network panel. Tokens last about an hour, which covers the 11.5-minute
run. Never commit tokens; pass them through the environment only.

## Settings

| Variable                  | Default                 | Meaning                                    |
| ------------------------- | ----------------------- | ------------------------------------------ |
| `BASE_URL`                | `http://localhost:3000` | API origin                                 |
| `AUTH`                    | `dev`                   | `dev` (persona header) or `bearer`         |
| `PERSONAS`                | one per role            | dev mode persona keys, comma-separated     |
| `TOKENS`                  |                         | bearer mode access tokens, comma-separated |
| `PROFILE`                 | `load`                  | `load` or `smoke` (2 VUs, 30 s)            |
| `VUS`                     | `50`                    | peak virtual users                         |
| `DURATION`                | `10m`                   | hold time at the peak                      |
| `THINK_MIN` / `THINK_MAX` | `1` / `3`               | think time between screens, seconds        |

## Rate limit

`@fastify/rate-limit` allows `RATE_LIMIT_MAX` (300) requests per minute **per client IP**. One load
generator sends roughly 900 requests/min at 50 VUs, so against an environment with the default limit
the run fails on 429s. For the test run either raise `RATE_LIMIT_MAX` on the test App Service for
the duration, or run k6 from several machines. (The B-21 target is 300/min **per user**; keying the
limiter on the signed-in user is tracked as a B-21 finding.)

## Status

- 2026-10-26: scaffold. Validated with `k6 inspect`, a smoke run and a 1-minute hold at 50 VUs
  against a local API (dev mode, synthetic seed of 150 quotes): p95 298 ms, 0% failed.
  **Not yet run against the Azure test environment.**
