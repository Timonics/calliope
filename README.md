# calliope

Multi-tenant headless article/content API. The newest service in the
**timonics** workspace; trusts cerberus-issued JWTs (RS256, JWKS-verified).

## Run locally

```bash
docker compose up -d        # Postgres 16 on :5435, database `calliope`
cp .env.example .env        # then adjust if needed
npm install
npm run prisma:migrate      # create schema + generate client
npm run start:dev           # http://localhost:3002
```

Health check: `GET http://localhost:3002/v1/health` → `{"status":"ok"}`.
Everything else requires a cerberus-issued bearer token.

## Tests

```bash
npm run test                # unit
CALLIOPE_TEST_DB=postgres://postgres:postgres@localhost:5435/calliope \
  npm run test:integration  # DB-backed (skipped without the variable)
```

Note: on CI (`CI=true`) the integration suite FAILS LOUDLY when
`CALLIOPE_TEST_DB` is unset — a green run that tested nothing is a false
signal.

## Conventions

- Single resources are returned **bare** (`POST/PATCH/GET` one resource →
  the JSON resource itself). **List** endpoints always return an envelope:
  `{ "data": [...], "meta": { "total", "page", "pageSize" } }`, with
  `page` (1-based, ≤ 10_000) and `pageSize` (≤ 100) query params.
- Errors are `{ "code": "...", "message": "..." }` (see
  `src/shared/interfaces/http/domain-error.filter.ts`).
- Env is read via `src/shared/infrastructure/config.ts`: missing required
  vars throw loudly; the only defaults are `PORT` and the cerberus
  issuer/audience convention values (documented in that file).

## Documentation

- [`docs/API.md`](docs/API.md) — auth, endpoints, envelopes, error
  catalogue, status enum + transitions, `?include=related`, the
  optional-auth upgrade behavior, idempotency.
- [`docs/openapi.yaml`](docs/openapi.yaml) — OpenAPI 3.1 spec for all v1
  endpoints (validate with `npx @redocly/cli lint docs/openapi.yaml`).
