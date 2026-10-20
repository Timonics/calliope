# calliope API (v1)

Multi-tenant headless content API. All paths below are relative to the
service root (no global prefix; versions live in the path, e.g.
`http://localhost:3002/v1/...`). Machine-readable contract:
[`openapi.yaml`](./openapi.yaml).

## Authentication

Every route except `GET /v1/health` and the `@Public()` read routes
requires a cerberus-issued JWT:

```
Authorization: Bearer <token>
```

Tokens are verified locally against the cerberus JWKS (RS256); the
expected `iss`/`aud` come from `CERBERUS_ISSUER`/`CERBERUS_AUDIENCE`
(defaults: `cerberus` / `cerberus-clients`). All **write** routes
(`POST`/`PATCH`/`DELETE`) additionally require the **`content:write`**
scope (`authorization.scope.insufficient` → 401 otherwise).

The tenant is always the token's `org` claim (`Blog.tenantId`); callers
can only ever see and touch their own organization's blogs. A
management caller addressing another tenant's blog gets
`blog.forbidden` (403) — they are authenticated, so the existence leak
is acceptable; an anonymous caller gets `blog.not_found` (404).

### Optional-auth upgrade on read routes

The read routes (`GET` article list/detail, authors/categories/tags
lists) are `@Public()`: without a Bearer token they serve the **public
view** (published-only, whitelist projections). When a valid Bearer
token **is** presented on the same route, it upgrades to the
**management view** — tenancy is enforced and the full record set is
returned. An invalid/expired token still 401s (`authorization.token.invalid`).

## Endpoints

| Method & path | Auth | Notes |
|---|---|---|
| `GET /v1/health` | public | liveness probe → `{status:"ok"}` |
| `POST /v1/blogs` | token + `content:write` | create blog (tenant = caller org) |
| `GET /v1/blogs` | token | list own blogs (envelope) |
| `GET /v1/blogs/:blogId` | token | fetch one blog |
| `POST /v1/blogs/:blogId/authors` | write | |
| `GET /v1/blogs/:blogId/authors` | optional | envelope; public items = id/name/bio/avatarUrl |
| `PATCH/DELETE /v1/blogs/:blogId/authors/:authorId` | write | PATCH: `null` clears bio/avatarUrl |
| `POST /v1/blogs/:blogId/categories` | write | |
| `GET /v1/blogs/:blogId/categories` | optional | envelope; public items = id/name/slug/description |
| `PATCH/DELETE /v1/blogs/:blogId/categories/:categoryId` | write | delete 409 while articles reference it |
| `POST /v1/blogs/:blogId/tags` | write | |
| `GET /v1/blogs/:blogId/tags` | optional | envelope; public items = id/name/slug |
| `PATCH/DELETE /v1/blogs/:blogId/tags/:tagId` | write | |
| `POST /v1/blogs/:blogId/articles` | write | **idempotent** — see below |
| `GET /v1/blogs/:blogId/articles` | optional | envelope; `status/authorId/categoryId/tagId/q` filters, `q` ≤ 300 chars |
| `GET /v1/blogs/:blogId/articles/:idOrSlug` | optional | UUID → management by id; otherwise public slug lookup; `?include=related` |
| `GET /v1/blogs/:blogId/articles/:articleId/related` | token | curated related set, original order |
| `PATCH /v1/blogs/:blogId/articles/:articleId` | write | nullable clearing, optimistic locking |
| `DELETE /v1/blogs/:blogId/articles/:articleId` | write | 204 |

## Response shapes

- **Single resource** routes return the bare JSON resource (201 on
  create, 200 otherwise; deletes return 204 empty).
- **List** routes return the envelope:

```json
{ "data": [ ... ], "meta": { "total": 42, "page": 1, "pageSize": 20 } }
```

Pagination params: `page` (1-based, default 1, **max 10_000**) and
`pageSize` (default 20, **max 100**). `total` is the filtered row count.

- The **public article projection** strips everything internal:
  `blogId`, foreign keys, `status`, `relatedArticleIds`, `version`,
  `createdAt`/`updatedAt`. Public taxonomy/author list items are
  whitelisted likewise (see table above).

## Errors

Every error body is `{ "code", "message" }` (plus an optional
`meta` object with client-safe context):

| HTTP | code(s) |
|---|---|
| 400 | `http.validation.failed`, `*.validation` |
| 401 | `authentication.token.missing`, `authorization.token.invalid`, `authorization.token.expired`, `authorization.scope.insufficient`, `authorization.principal.missing` |
| 403 | `*.forbidden` (e.g. `blog.forbidden` — cross-tenant) |
| 404 | `*.not_found` |
| 409 | `*.conflict` (slug collisions, archived-is-terminal, FK-in-use deletes, optimistic-lock failures) |

Status is derived from the code: exact match first, then the suffix
table (`*.not_found`→404, `*.conflict`→409, `*.validation`→400,
`*.forbidden`→403), then a prefix table; anything unmapped is a logged
500 rendered as `{code:"internal.error"}`. 401s carry
`WWW-Authenticate: Bearer`.

## Article status machine

`DRAFT` ↔ `PUBLISHED` → `ARCHIVED`.

- `ARCHIVED` is **terminal** — any transition out of it is 409
  `article.conflict`.
- `publishedAt` is set on the **first** transition into `PUBLISHED` and
  never cleared (unpublishing keeps the original first-publish date).
- The public view only ever shows `PUBLISHED`.

## Article content

`content` is a JSON block list: 1–200 blocks of
`{ "type": string(1–200), "data": object(≤100 keys) }`. Unknown block
types are allowed (editor-agnostic shape validation only).

## Nullable fields & PATCH semantics

`excerpt`, `coverImageUrl`, `categoryId` (article); `bio`, `avatarUrl`
(author); `description` (category) accept explicit `null` to **clear**
the column. An absent field keeps the current value (`undefined` ≠
`null` through the zod DTOs).

## Idempotent article create

`POST /v1/blogs/:blogId/articles` supports two client-controlled
idempotency mechanisms (either works, both compose):

1. **Client-supplied `id`** (UUID) in the body — used verbatim as the
   article id with upsert-on-conflict semantics: replaying the same
   create returns the existing article with **200** instead of erroring.
2. **`Idempotency-Key` request header** — the first create stores
   `(key, blogId, endpoint) → articleId` for **24h**; a replay within the
   window returns the stored article with **200**.

A fresh create answers **201**. Both paths run in one transaction with
the unique constraints as the concurrency backstop, so a retried create
can never produce a duplicate.

## Optimistic locking (article update)

Every article carries a `version` counter (management responses only),
incremented on each update. A client that passes `If-Match: <version>`
(or a `version` body field) gets 409 `article.conflict` when the row has
moved underneath them. Absent precondition = last-write-wins.

## `?include=related`

`GET .../articles/:slug?include=related` expands the curated
`relatedArticleIds` set inline: published related articles only, in the
original editor-curated order; ids that no longer resolve are skipped
silently. The management counterpart
(`GET .../articles/:articleId/related`) is not status-filtered.
