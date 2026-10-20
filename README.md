# calliope

Multi-tenant **headless article/content API** — the content service of the
**timonics** workspace. An org registers a blog (gets a blog UUID), plugs
any CMS into the API, and manages authors, categories, tags, and articles
(JSON block content) with draft/publish workflow. Anonymous visitors read
published content; nothing else.

- **Auth**: entirely delegated to [cerberus](https://github.com/Timonics/cerebrus)
  (the workspace identity service) via the published
  [`@timonics/auth-guard`](https://www.npmjs.com/package/@timonics/auth-guard)
  npm package — JWTs verified locally against the cerberus JWKS (RS256).
  Calliope has no users table, no login endpoint, no stored keys.
- **Tenancy**: the tenant is always the token's `org` claim (cerberus
  organization UUID), stored as `Blog.tenantId`. Every management query is
  scoped through a single choke point (`assertBlogAccess`): unknown blog →
  404, another org's blog → 403.

## Quickstart

```bash
docker compose up -d        # Postgres 16 on :5435, database `calliope`
cp .env.example .env        # then adjust if needed
npm install
npm run prisma:migrate      # apply schema + generate client
npm run start:dev           # http://localhost:3002
```

Health check: `GET http://localhost:3002/v1/health` → `{"status":"ok"}`
(the only route that needs no token).

Port note: `5435` is deliberate — 5432 hosts a local PostgreSQL, 5433 is
charon's, 5434 is cerberus's.

## Environment

| Variable             | Required | Default                        | Purpose                          |
| -------------------- | -------- | ------------------------------ | -------------------------------- |
| `DATABASE_URL`       | yes      | —                              | Postgres connection string     |
| `PORT`               | no       | `3002`                         | HTTP port                      |
| `CERBERUS_JWKS_URL`  | yes      | —                              | cerberus public JWKS endpoint  |
| `CERBERUS_ISSUER`    | no       | `cerberus`                     | expected `iss` claim           |
| `CERBERUS_AUDIENCE`  | no       | `cerberus-clients`             | expected `aud` claim           |

Config is read via `src/shared/infrastructure/config.ts` — missing
required vars throw at boot; there are no silent fallbacks.

## Architecture

NestJS 11 + Prisma 6 + zod v4, TypeScript strict. Layered bounded context
with DDD building blocks (inspired by charon/cerberus conventions):

```
src/
├── main.ts / app.module.ts     composition root; guards wired explicitly
│                               (applyGlobal: false — calliope's own
│                               DomainErrorFilter owns the error wire shape)
├── shared/
│   ├── kernel/                 DomainError (+ clientMeta vs server detail)
│   ├── infrastructure/         config, PrismaService
│   └── interfaces/http/        DomainErrorFilter ({code,message} + suffix
│                               status table), ZodValidationPipe
├── health/                     GET /v1/health (@Public)
└── blogging/                   the bounded context
    ├── domain/                 pure invariants — no Nest, no Prisma
    │   ├── article-status.ts       status machine + first-publish date
    │   ├── related-articles.ts     curation rules (same-blog/self/cap)
    │   └── slug.ts                 slug policy (generate/suffix/conflict)
    ├── application/          use-case services; PrismaService is the
    │                         persistence adapter; tenancy choke point
    └── interfaces/http/      thin controllers + zod DTOs
```

Key behaviors:

- **Reads double as management views**: `@Public()` read routes serve
  published content anonymously and upgrade to the full management view
  when a valid Bearer token is presented.
- **Public fetches key by slug; UUIDs are management-only** — anonymous
  UUID lookups get a flat 404 (no existence signal).
- **Idempotent creates**: pass a client-supplied `id` (or an
  `Idempotency-Key` header); replays return the existing article with 200.
- **Optimistic locking**: articles carry a `version`; conditional updates
  reject stale writers with 409.
- **Errors** are always `{ "code": "...", "message": "..." }`; status is
  derived from the code (`*.not_found` 404, `*.conflict` 409,
  `*.validation` 400, `*.forbidden` 403, auth codes 401).

## Scripts

| Command                  | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `npm run start:dev`      | watch-mode dev server                          |
| `npm run build` / `start:prod` | compile / run compiled output            |
| `npm run test`           | unit tests (jest, colocated `*.spec.ts`)       |
| `npm run test:integration` | DB-backed tests — needs `CALLIOPE_TEST_DB`   |
| `npm run lint` / `format`| eslint (type-checked) / prettier              |
| `npm run prisma:migrate` | `prisma migrate dev`                           |
| `npm run prisma:deploy`  | `prisma migrate deploy` (prod/CI)              |

On CI (`CI=true`) the integration suite **fails loudly** when
`CALLIOPE_TEST_DB` is unset — a green run that tested nothing is a false
signal.

## Testing

```bash
npm run test                # unit
CALLIOPE_TEST_DB=postgres://postgres:postgres@localhost:5435/calliope \
  npm run test:integration  # real Postgres; skipped without the variable
```

Integration tests run the real global guards; the principal is stubbed one
level below at the `PrincipalProvider` / optional-auth resolver tokens, so
guard ordering, tenancy enforcement, and the 401/403 paths are genuinely
exercised.

## Documentation

- [`docs/API.md`](docs/API.md) — auth, endpoints, envelopes, error
  catalogue, status enum + transitions, `?include=related`, the
  optional-auth upgrade behavior, idempotency.
- [`docs/openapi.yaml`](docs/openapi.yaml) — OpenAPI 3.1 spec for all v1
  endpoints (validate with `npx @redocly/cli lint docs/openapi.yaml`).

## Workspace context

| Service                                  | Role                                   |
| ---------------------------------------- | -------------------------------------- |
| [cerberus](https://github.com/Timonics/cerebrus) | identity/auth (issues the JWTs)  |
| [@timonics/auth-guard](https://www.npmjs.com/package/@timonics/auth-guard) | shared NestJS JWKS guard package |
| [charon](https://github.com/Timonics/charon)     | payments (tooling conventions)   |
| **calliope** (this repo)                 | content/articles                       |
