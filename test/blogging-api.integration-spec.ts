import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuardError, PrincipalProvider } from '@timonics/auth-guard';
import {
  applyMigrations,
  closeIntegrationPrisma,
  testDatabaseUrl,
  truncateAll,
} from './integration-setup';
import { AppModule } from '../src/app.module';
import {
  OPTIONAL_PRINCIPAL_RESOLVER,
  OptionalPrincipalResolver,
} from '../src/blogging/application/optional-auth';
import { ZodValidationPipe } from '../src/shared/interfaces/http/zod-validation.pipe';

/**
 * End-to-end blogging lifecycle over real Postgres with the REAL global
 * guards running. Auth is stubbed one level below them: the package's
 * `PrincipalProvider` token is replaced with a test double that mints a
 * principal from the `x-test-org` header (no header → 401 on protected
 * routes, same as an invalid token would produce). Anonymous public
 * calls simply omit the header — @Public() routes never consult the
 * provider.
 *
 * Skipped unless CALLIOPE_TEST_DB is set (CI without it fails loudly —
 * see integration-setup.ts).
 */

interface ListEnvelope<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number };
}

interface BlogDto {
  id: string;
  tenantId: string;
  slug: string;
}

interface AuthorDto {
  id: string;
  name: string;
  bio?: string | null;
  avatarUrl?: string | null;
  blogId?: string;
  createdAt?: string;
}

interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  blogId?: string;
  createdAt?: string;
}

interface TagDto {
  id: string;
  name: string;
  slug: string;
  blogId?: string;
  createdAt?: string;
}

interface ArticleDto {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  categoryId?: string | null;
  status?: string;
  version?: number;
  publishedAt?: string | null;
}

interface ErrorDto {
  code: string;
  message: string;
}

const describeWithDb: typeof describe = testDatabaseUrl
  ? describe
  : describe.skip;

const ORG_A = randomUUID();
const ORG_B = randomUUID();

const principalFor = (orgId: string) => ({
  subjectId: randomUUID(),
  orgId,
  role: 'OWNER' as const,
  scopes: ['content:write'],
  tokenType: 'user' as const,
  expiresAt: new Date(Date.now() + 3600_000),
});

const headerValue = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

describeWithDb('Blogging API lifecycle', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  const asOrgA = (req: request.Test): request.Test =>
    req.set('x-test-org', ORG_A);
  const asOrgB = (req: request.Test): request.Test =>
    req.set('x-test-org', ORG_B);

  beforeAll(async () => {
    applyMigrations();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrincipalProvider)
      .useFactory({
        factory: () => ({
          resolvePrincipal: (req: { headers: Record<string, unknown> }) => {
            const org = headerValue(req.headers['x-test-org']);
            if (!org) {
              throw new AuthGuardError(
                'authorization.token.invalid',
                401,
                'Missing test principal',
              );
            }
            return Promise.resolve(principalFor(org));
          },
        }),
      })
      // The @Public() read routes upgrade to a management view via this
      // resolver when a valid Bearer token is presented; the test double
      // keys off the same x-test-org header (absent → anonymous view).
      .overrideProvider(OPTIONAL_PRINCIPAL_RESOLVER)
      .useFactory({
        factory: () =>
          ({
            resolve: (req: { headers: Record<string, unknown> }) => {
              const org = headerValue(req.headers['x-test-org']);
              return Promise.resolve(org ? principalFor(org) : undefined);
            },
          }) satisfies OptionalPrincipalResolver,
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await app?.close();
    await closeIntegrationPrisma();
  });

  const provisionBlog = async (): Promise<BlogDto> => {
    const res = await asOrgA(
      request(server).post('/v1/blogs').send({ name: 'Engineering' }),
    ).expect(201);
    return res.body as BlogDto;
  };

  const createAuthor = async (
    blogId: string,
    name: string,
  ): Promise<AuthorDto> => {
    const res = await asOrgA(
      request(server).post(`/v1/blogs/${blogId}/authors`).send({ name }),
    ).expect(201);
    return res.body as AuthorDto;
  };

  it('runs the full lifecycle: provision → content → publish → public reads → tenancy', async () => {
    // 1. Provision a blog in org A.
    const blogRes = await asOrgA(
      request(server).post('/v1/blogs').send({ name: 'Engineering' }),
    ).expect(201);
    const blog = blogRes.body as BlogDto;
    expect(blog.slug).toBe('engineering');
    expect(blog.tenantId).toBe(ORG_A);

    // 2. Author, category, tags.
    const author = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/authors`)
          .send({ name: 'Ada Lovelace' }),
      ).expect(201)
    ).body as AuthorDto;
    const category = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/categories`)
          .send({ name: 'Distributed Systems' }),
      ).expect(201)
    ).body as CategoryDto;
    const tagA = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/tags`)
          .send({ name: 'Postgres' }),
      ).expect(201)
    ).body as TagDto;
    const tagB = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/tags`)
          .send({ name: 'NestJS' }),
      ).expect(201)
    ).body as TagDto;

    const content = [{ type: 'paragraph', data: { text: 'Hello world' } }];

    // 3. Draft articles, article2 curated to relate to article1.
    const article1 = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/articles`)
          .send({
            title: 'First post',
            content,
            authorId: author.id,
            categoryId: category.id,
            tagIds: [tagA.id],
          }),
      ).expect(201)
    ).body as ArticleDto;
    expect(article1.status).toBe('DRAFT');
    expect(article1.slug).toBe('first-post');

    const article2 = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/articles`)
          .send({
            title: 'Second post',
            content,
            authorId: author.id,
            tagIds: [tagA.id, tagB.id],
            relatedArticleIds: [article1.id],
          }),
      ).expect(201)
    ).body as ArticleDto;

    // 4. Public list hides drafts.
    const publicList = (
      await request(server).get(`/v1/blogs/${blog.id}/articles`).expect(200)
    ).body as ListEnvelope<ArticleDto>;
    expect(publicList.data).toHaveLength(0);
    expect(publicList.meta.total).toBe(0);

    // 5. Publish article1.
    const published = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/articles/${article1.id}`)
          .send({ status: 'PUBLISHED' }),
      ).expect(200)
    ).body as ArticleDto;
    expect(published.status).toBe('PUBLISHED');
    expect(new Date(published.publishedAt ?? '')).toBeInstanceOf(Date);
    expect(published.version).toBe(1); // any update bumps the version

    // 6. Public reads: list, slug fetch, include=related.
    const afterPublish = (
      await request(server).get(`/v1/blogs/${blog.id}/articles`).expect(200)
    ).body as ListEnvelope<ArticleDto>;
    expect(afterPublish.data).toHaveLength(1);
    expect(afterPublish.meta.total).toBe(1);

    await request(server)
      .get(`/v1/blogs/${blog.id}/articles/first-post`)
      .expect(200)
      .expect((res: request.Response) => {
        const body = res.body as ArticleDto;
        expect(body.title).toBe('First post');
        expect(body.status).toBeUndefined(); // public projection
        expect(body.version).toBeUndefined(); // version is management-only
      });

    // article2 is still a DRAFT — public slug lookup must 404 (drafts are
    // not public, and ids/slugs of unpublished content get no signal).
    await request(server)
      .get(`/v1/blogs/${blog.id}/articles/second-post?include=related`)
      .expect(404)
      .expect((res: request.Response) =>
        expect((res.body as ErrorDto).code).toBe('article.not_found'),
      );

    // Management related-resolution works and preserves order.
    const related = (
      await asOrgA(
        request(server).get(
          `/v1/blogs/${blog.id}/articles/${article2.id}/related`,
        ),
      ).expect(200)
    ).body as ArticleDto[];
    expect(related.map((a) => a.id)).toEqual([article1.id]);
  });

  it('enforces tenancy and domain rules', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Tenant Author');

    const article = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/articles`)
          .send({
            title: 'Owned by A',
            authorId: author.id,
            content: [{ type: 'paragraph', data: {} }],
          }),
      ).expect(201)
    ).body as ArticleDto;

    // Cross-tenant access → 403, not 404 (caller IS authenticated).
    const forbidden = await asOrgB(
      request(server).get(`/v1/blogs/${blog.id}/articles`),
    ).expect(403);
    expect((forbidden.body as ErrorDto).code).toBe('blog.forbidden');

    // Unknown blog → 404 for both public and management callers.
    const missing = randomUUID();
    await request(server)
      .get(`/v1/blogs/${missing}/articles`)
      .expect(404)
      .expect((res: request.Response) =>
        expect((res.body as ErrorDto).code).toBe('blog.not_found'),
      );
    await asOrgA(request(server).get(`/v1/blogs/${missing}`)).expect(404);

    // Explicit slug collision → 409.
    const conflict = await asOrgA(
      request(server)
        .post(`/v1/blogs/${blog.id}/articles`)
        .send({
          title: 'Different title',
          slug: 'owned-by-a',
          authorId: author.id,
          content: [{ type: 'paragraph', data: {} }],
        }),
    ).expect(409);
    expect((conflict.body as ErrorDto).code).toBe('article.conflict');

    // Self-reference in relatedArticleIds → 400.
    await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
        .send({ relatedArticleIds: [article.id] }),
    )
      .expect(400)
      .expect((res: request.Response) =>
        expect((res.body as ErrorDto).code).toBe('article.validation'),
      );

    // ARCHIVED is terminal.
    await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
        .send({ status: 'ARCHIVED' }),
    ).expect(200);
    await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
        .send({ status: 'PUBLISHED' }),
    )
      .expect(409)
      .expect((res: request.Response) =>
        expect((res.body as ErrorDto).code).toBe('article.conflict'),
      );
  });

  it('rejects invalid content blocks at the boundary', async () => {
    const blog = await provisionBlog();

    await asOrgA(
      request(server)
        .post(`/v1/blogs/${blog.id}/articles`)
        .send({ title: 'Bad', content: [] }),
    )
      .expect(400)
      .expect((res: request.Response) =>
        expect((res.body as ErrorDto).code).toBe('http.validation.failed'),
      );
  });

  it('serves authors/categories/tags lists as {data, meta} envelopes with a public whitelist projection', async () => {
    const blog = await provisionBlog();
    await createAuthor(blog.id, 'Ada Lovelace');
    const category = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/categories`)
          .send({ name: 'Distributed Systems' }),
      ).expect(201)
    ).body as CategoryDto;
    await asOrgA(
      request(server)
        .post(`/v1/blogs/${blog.id}/tags`)
        .send({ name: 'Postgres' }),
    ).expect(201);

    // Public (anonymous): envelope + whitelisted items only — no blogId,
    // no timestamps.
    const publicAuthors = (
      await request(server).get(`/v1/blogs/${blog.id}/authors`).expect(200)
    ).body as ListEnvelope<AuthorDto>;
    expect(publicAuthors.meta.total).toBe(1);
    expect(publicAuthors.data).toHaveLength(1);
    expect(publicAuthors.data[0]?.name).toBe('Ada Lovelace');
    expect(publicAuthors.data[0]?.blogId).toBeUndefined();
    expect(publicAuthors.data[0]?.createdAt).toBeUndefined();

    const publicCategories = (
      await request(server).get(`/v1/blogs/${blog.id}/categories`).expect(200)
    ).body as ListEnvelope<CategoryDto>;
    expect(publicCategories.meta.total).toBe(1);
    expect(publicCategories.data[0]?.slug).toBe(category.slug);
    expect(publicCategories.data[0]?.blogId).toBeUndefined();
    expect(publicCategories.data[0]?.createdAt).toBeUndefined();

    const publicTags = (
      await request(server)
        .get(`/v1/blogs/${blog.id}/tags?page=1&pageSize=10`)
        .expect(200)
    ).body as ListEnvelope<TagDto>;
    expect(publicTags.meta).toEqual({ total: 1, page: 1, pageSize: 10 });
    expect(publicTags.data[0]?.name).toBe('Postgres');
    expect(publicTags.data[0]?.blogId).toBeUndefined();

    // Management (token presented): envelope with full rows.
    const mgmtAuthors = (
      await asOrgA(request(server).get(`/v1/blogs/${blog.id}/authors`)).expect(
        200,
      )
    ).body as ListEnvelope<AuthorDto>;
    expect(mgmtAuthors.meta.total).toBe(1);
    expect(mgmtAuthors.data[0]?.blogId).toBe(blog.id);
  });

  it('PATCH clears nullable fields with explicit null and keeps them when absent', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const category = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/categories`)
          .send({ name: 'Distributed Systems' }),
      ).expect(201)
    ).body as CategoryDto;

    // Author bio / category description clear + keep.
    const bioCleared = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/authors/${author.id}`)
          .send({ bio: 'first programmer' }),
      ).expect(200)
    ).body as AuthorDto;
    expect(bioCleared.bio).toBe('first programmer');
    const bioKept = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/authors/${author.id}`)
          .send({ name: 'Ada L.' }),
      ).expect(200)
    ).body as AuthorDto;
    expect(bioKept.bio).toBe('first programmer'); // absent = keep
    const bioNull = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/authors/${author.id}`)
          .send({ bio: null }),
      ).expect(200)
    ).body as AuthorDto;
    expect(bioNull.bio).toBeNull(); // explicit null = clear

    const descCleared = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/categories/${category.id}`)
          .send({ description: 'about distributed systems' }),
      ).expect(200)
    ).body as CategoryDto;
    expect(descCleared.description).toBe('about distributed systems');
    const descNull = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/categories/${category.id}`)
          .send({ description: null }),
      ).expect(200)
    ).body as CategoryDto;
    expect(descNull.description).toBeNull();

    // Article excerpt / categoryId / coverImageUrl.
    const content = [{ type: 'paragraph', data: { text: 'x' } }];
    const article = (
      await asOrgA(
        request(server).post(`/v1/blogs/${blog.id}/articles`).send({
          title: 'Nullable fields',
          content,
          authorId: author.id,
          categoryId: category.id,
          excerpt: 'a teaser',
          coverImageUrl: 'https://example.com/cover.png',
        }),
      ).expect(201)
    ).body as ArticleDto;

    const cleared = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
          .send({ excerpt: null, categoryId: null, coverImageUrl: null }),
      ).expect(200)
    ).body as ArticleDto;
    expect(cleared.excerpt).toBeNull();
    expect(cleared.categoryId).toBeNull();
    expect(cleared.coverImageUrl).toBeNull();

    const kept = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
          .send({ title: 'Still nullable fields' }),
      ).expect(200)
    ).body as ArticleDto;
    expect(kept.excerpt).toBeNull(); // stays cleared (absent = keep)

    const setAgain = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
          .send({ excerpt: 'back', categoryId: category.id }),
      ).expect(200)
    ).body as ArticleDto;
    expect(setAgain.excerpt).toBe('back');
    expect(setAgain.categoryId).toBe(category.id);
  });

  it('create is idempotent via client-supplied id and Idempotency-Key', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const content = [{ type: 'paragraph', data: { text: 'idem' } }];

    // Client-supplied id: replay returns the existing article with 200.
    const clientId = randomUUID();
    const first = (
      await asOrgA(
        request(server).post(`/v1/blogs/${blog.id}/articles`).send({
          id: clientId,
          title: 'Idempotent',
          content,
          authorId: author.id,
        }),
      ).expect(201)
    ).body as ArticleDto;
    expect(first.id).toBe(clientId);

    const replay = await asOrgA(
      request(server).post(`/v1/blogs/${blog.id}/articles`).send({
        id: clientId,
        title: 'Idempotent',
        content,
        authorId: author.id,
      }),
    ).expect(200);
    expect((replay.body as ArticleDto).id).toBe(clientId);

    // Idempotency-Key header: replay within 24h returns the stored one.
    const key = `test-${randomUUID()}`;
    const keyed = await asOrgA(
      request(server)
        .post(`/v1/blogs/${blog.id}/articles`)
        .set('Idempotency-Key', key)
        .send({ title: 'Keyed', content, authorId: author.id }),
    );
    expect(keyed.status).toBe(201);
    const keyedReplay = await asOrgA(
      request(server)
        .post(`/v1/blogs/${blog.id}/articles`)
        .set('Idempotency-Key', key)
        .send({ title: 'Keyed', content, authorId: author.id }),
    ).expect(200);
    expect((keyedReplay.body as ArticleDto).id).toBe(
      (keyed.body as ArticleDto).id,
    );

    // Exactly two articles exist — no duplicates from the replays.
    const list = (
      await asOrgA(request(server).get(`/v1/blogs/${blog.id}/articles`)).expect(
        200,
      )
    ).body as ListEnvelope<ArticleDto>;
    expect(list.meta.total).toBe(2);
  });

  it('q search escapes ILIKE metacharacters', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const content = [{ type: 'paragraph', data: { text: 'x' } }];
    const publish = async (title: string): Promise<void> => {
      const created = (
        await asOrgA(
          request(server)
            .post(`/v1/blogs/${blog.id}/articles`)
            .send({ title, content, authorId: author.id, status: 'PUBLISHED' }),
        ).expect(201)
      ).body as ArticleDto;
      expect(created.status).toBe('PUBLISHED');
    };
    await publish('100% sure');
    await publish('my_post');
    await publish('plain title');

    // q="%" matches the literal percent only (escapes ILIKE's any-run
    // wildcard — unescaped it would match every title).
    const pct = (
      await request(server)
        .get(
          `/v1/blogs/${blog.id}/articles?q=${encodeURIComponent('100% sure')}`,
        )
        .expect(200)
    ).body as ListEnvelope<ArticleDto>;
    expect(pct.meta.total).toBe(1);
    expect(pct.data[0]?.title).toBe('100% sure');

    // q="_" matches the literal underscore only.
    const usc = (
      await request(server)
        .get(`/v1/blogs/${blog.id}/articles?q=${encodeURIComponent('my_post')}`)
        .expect(200)
    ).body as ListEnvelope<ArticleDto>;
    expect(usc.meta.total).toBe(1);
    expect(usc.data[0]?.title).toBe('my_post');

    // A term matching nothing → empty page with correct total.
    const none = (
      await request(server)
        .get(`/v1/blogs/${blog.id}/articles?q=zzz-no-match`)
        .expect(200)
    ).body as ListEnvelope<ArticleDto>;
    expect(none.meta.total).toBe(0);
    expect(none.data).toHaveLength(0);

    // Management search sees drafts too.
    await asOrgA(
      request(server).post(`/v1/blogs/${blog.id}/articles`).send({
        title: 'draft about 100% things',
        content,
        authorId: author.id,
      }),
    ).expect(201);
    const mgmt = (
      await asOrgA(
        request(server)
          .get(`/v1/blogs/${blog.id}/articles?q=${encodeURIComponent('100%')}`)
          .expect(200),
      )
    ).body as ListEnvelope<ArticleDto>;
    expect(mgmt.meta.total).toBe(2);
  });

  it('optimistic locking: version increments, stale If-Match → 409', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const article = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/articles`)
          .send({
            title: 'Locking',
            content: [{ type: 'paragraph', data: {} }],
            authorId: author.id,
          }),
      ).expect(201)
    ).body as ArticleDto;
    expect(article.version).toBe(0);

    const updated = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
          .set('If-Match', '0')
          .send({ title: 'Locking v1' }),
      ).expect(200)
    ).body as ArticleDto;
    expect(updated.version).toBe(1);
    expect(updated.title).toBe('Locking v1');

    // Stale precondition → 409.
    const stale = await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
        .set('If-Match', '0')
        .send({ title: 'Locking v2' }),
    ).expect(409);
    expect((stale.body as ErrorDto).code).toBe('article.conflict');

    // Body field variant works too.
    const viaBody = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
          .send({ version: 1, title: 'Locking v2' }),
      ).expect(200)
    ).body as ArticleDto;
    expect(viaBody.version).toBe(2);
  });

  it('category delete is restricted while articles reference it (friendly 409)', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const category = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blog.id}/categories`)
          .send({ name: 'Distributed Systems' }),
      ).expect(201)
    ).body as CategoryDto;
    await asOrgA(
      request(server)
        .post(`/v1/blogs/${blog.id}/articles`)
        .send({
          title: 'Categorized',
          content: [{ type: 'paragraph', data: {} }],
          authorId: author.id,
          categoryId: category.id,
        }),
    ).expect(201);

    const conflict = await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/categories/${category.id}`),
    ).expect(409);
    expect((conflict.body as ErrorDto).code).toBe('category.conflict');

    // Clearing the reference unblocks the delete.
    const article = (
      await asOrgA(
        request(server)
          .get(`/v1/blogs/${blog.id}/articles?q=Categorized`)
          .expect(200),
      )
    ).body as ListEnvelope<ArticleDto>;
    await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blog.id}/articles/${article.data[0]?.id ?? ''}`)
        .send({ categoryId: null }),
    ).expect(200);
    await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/categories/${category.id}`),
    ).expect(204);
  });
});
