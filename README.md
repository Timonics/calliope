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
npm run test:integration    # DB-backed; requires CALLIOPE_TEST_DB set
```

## Conventions

- No success envelope — controllers return bare JSON resources.
- Errors are `{ "code": "...", "message": "..." }` (see
  `src/shared/interfaces/http/domain-error.filter.ts`).
- Env is read via `src/shared/infrastructure/config.ts`: missing required
  vars throw loudly; no silent defaults.
