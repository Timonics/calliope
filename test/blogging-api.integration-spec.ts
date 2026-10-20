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
 * routes, same as an invalid token would produce). The double also
 * honors `x-test-scopes: none` → empty scope list, to exercise the
 * ScopesGuard. Anonymous public calls simply omit the header —
 * @Public() routes never consult the provider.
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

interface TagRef {
  id: string;
  name: string;
  slug: string;
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
  tags?: TagRef[];
  content?: unknown;
  author?: Record<string, unknown>;
  category?: Record<string, unknown> | null;
  related?: Array<Record<string, unknown>>;
}

interface ErrorDto {
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

const describeWithDb: typeof describe = testDatabaseUrl
  ? describe
  : describe.skip;

const ORG_A = randomUUID();
const ORG_B = randomUUID();

const principalFor = (orgId: string, scopes: string[] = ['content:write']) => ({
  subjectId: randomUUID(),
  orgId,
  role: 'OWNER' as const,
  scopes,
  tokenType: 'user' as const,
  expiresAt: new Date(Date.now() + 3600_000),
});

const headerValue = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const CONTENT = [{ type: 'paragraph', data: { text: 'Hello world' } }];

describeWithDb('Blogging API lifecycle', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  const asOrgA = (req: request.Test): request.Test =>
    req.set('x-test-org', ORG_A);
  const asOrgB = (req: request.Test): request.Test =>
    req.set('x-test-org', ORG_B);
  /** Authenticated as org A but with an EMPTY scope list. */
  const asScopeless = (req: request.Test): request.Test =>
    req.set('x-test-org', ORG_A).set('x-test-scopes', 'none');

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
            const scopes =
              headerValue(req.headers['x-test-scopes']) === 'none'
                ? []
                : ['content:write'];
            return Promise.resolve(principalFor(org, scopes));
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

  // -------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------

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

  const createCategory = async (
    blogId: string,
    name: string,
  ): Promise<CategoryDto> => {
    const res = await asOrgA(
      request(server).post(`/v1/blogs/${blogId}/categories`).send({ name }),
    ).expect(201);
    return res.body as CategoryDto;
  };

  const createTag = async (blogId: string, name: string): Promise<TagDto> => {
    const res = await asOrgA(
      request(server).post(`/v1/blogs/${blogId}/tags`).send({ name }),
    ).expect(201);
    return res.body as TagDto;
  };

  const createArticle = async (
    blogId: string,
    body: Record<string, unknown>,
  ): Promise<ArticleDto> => {
    const res = await asOrgA(
      request(server).post(`/v1/blogs/${blogId}/articles`).send(body),
    ).expect(201);
    return res.body as ArticleDto;
  };

  const publishArticle = async (
    blogId: string,
    articleId: string,
  ): Promise<ArticleDto> => {
    const res = await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blogId}/articles/${articleId}`)
        .send({ status: 'PUBLISHED' }),
    ).expect(200);
    return res.body as ArticleDto;
  };

  const managementList = async (
    blogId: string,
    query = '',
  ): Promise<ListEnvelope<ArticleDto>> => {
    const res = await asOrgA(
      request(server).get(`/v1/blogs/${blogId}/articles${query}`),
    ).expect(200);
    return res.body as ListEnvelope<ArticleDto>;
  };

  const articleIds = (envelope: ListEnvelope<ArticleDto>): string[] =>
    envelope.data.map((a) => a.id).sort();

  // -------------------------------------------------------------------
  // lifecycle (split into focused tests)
  // -------------------------------------------------------------------

  it('provisions a blog with a slugified, tenant-scoped identity', async () => {
    const blogRes = await asOrgA(
      request(server).post('/v1/blogs').send({ name: 'Engineering' }),
    ).expect(201);
    const blog = blogRes.body as BlogDto;
    expect(blog.slug).toBe('engineering');
    expect(blog.tenantId).toBe(ORG_A);
  });

  it('creates the content scaffold and hides drafts from the public list', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    await createCategory(blog.id, 'Distributed Systems');
    const tagA = await createTag(blog.id, 'Postgres');
    const tagB = await createTag(blog.id, 'NestJS');

    const article1 = await createArticle(blog.id, {
      title: 'First post',
      content: CONTENT,
      authorId: author.id,
      tagIds: [tagA.id],
    });
    expect(article1.status).toBe('DRAFT');
    expect(article1.slug).toBe('first-post');

    await createArticle(blog.id, {
      title: 'Second post',
      content: CONTENT,
      authorId: author.id,
      tagIds: [tagA.id, tagB.id],
      relatedArticleIds: [article1.id],
    });

    // Drafts are invisible to the public list.
    const publicList = (
      await request(server).get(`/v1/blogs/${blog.id}/articles`).expect(200)
    ).body as ListEnvelope<ArticleDto>;
    expect(publicList.data).toHaveLength(0);
    expect(publicList.meta.total).toBe(0);
  });

  it('publishes and serves public reads with the public projection', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const article1 = await createArticle(blog.id, {
      title: 'First post',
      content: CONTENT,
      authorId: author.id,
    });
    const article2 = await createArticle(blog.id, {
      title: 'Second post',
      content: CONTENT,
      authorId: author.id,
      relatedArticleIds: [article1.id],
    });

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

  // -------------------------------------------------------------------
  // tenancy & domain rules (pre-existing)
  // -------------------------------------------------------------------

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

  // -------------------------------------------------------------------
  // tag replace-set
  // -------------------------------------------------------------------

  it('replaces the article tag set wholesale on PATCH', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const tagA = await createTag(blog.id, 'Postgres');
    const tagB = await createTag(blog.id, 'NestJS');
    const tagC = await createTag(blog.id, 'GraphQL');

    const article = await createArticle(blog.id, {
      title: 'Tagged',
      content: CONTENT,
      authorId: author.id,
      tagIds: [tagA.id, tagB.id],
    });
    // Tag order on the wire is name-asc (ARTICLE_INCLUDE), so compare sets.
    expect(article.tags?.map((t) => t.id).sort()).toEqual(
      [tagA.id, tagB.id].sort(),
    );

    const replaced = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/articles/${article.id}`)
          .send({ tagIds: [tagC.id] }),
      ).expect(200)
    ).body as ArticleDto;
    expect(replaced.tags?.map((t) => t.id)).toEqual([tagC.id]);

    // Re-GET (management view) shows exactly the replacement set.
    const refetched = (
      await asOrgA(
        request(server).get(`/v1/blogs/${blog.id}/articles/${article.id}`),
      ).expect(200)
    ).body as ArticleDto;
    expect(refetched.tags?.map((t) => t.id)).toEqual([tagC.id]);
  });

  // -------------------------------------------------------------------
  // public include=related
  // -------------------------------------------------------------------

  it('public include=related: curated order kept, unpublished/dangling ids skipped', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const article1 = await createArticle(blog.id, {
      title: 'First post',
      content: CONTENT,
      authorId: author.id,
    });
    const article2 = await createArticle(blog.id, {
      title: 'Second post',
      content: CONTENT,
      authorId: author.id,
    });
    // Third article only exists to become a dangling curated id.
    const temp = await createArticle(blog.id, {
      title: 'Temp post',
      content: CONTENT,
      authorId: author.id,
    });

    await publishArticle(blog.id, article1.id);
    await publishArticle(blog.id, article2.id);

    // Curate: [article1, temp]; then delete temp → dangling id.
    await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blog.id}/articles/${article2.id}`)
        .send({ relatedArticleIds: [article1.id, temp.id] }),
    ).expect(200);
    await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/articles/${temp.id}`),
    ).expect(204);

    const detail = (
      await request(server)
        .get(`/v1/blogs/${blog.id}/articles/second-post?include=related`)
        .expect(200)
    ).body as ArticleDto;
    expect(detail.related?.map((a) => a.id as string)).toEqual([article1.id]);
  });

  // -------------------------------------------------------------------
  // 401 smoke on every protected route
  // -------------------------------------------------------------------

  it('401-smokes every protected write route without a principal', async () => {
    const blogId = randomUUID();
    const resourceId = randomUUID();

    const routes: Array<[string, string]> = [
      ['POST', '/v1/blogs'],
      ['POST', `/v1/blogs/${blogId}/articles`],
      ['PATCH', `/v1/blogs/${blogId}/articles/${resourceId}`],
      ['DELETE', `/v1/blogs/${blogId}/articles/${resourceId}`],
      ['GET', `/v1/blogs/${blogId}/articles/${resourceId}/related`],
      ['POST', `/v1/blogs/${blogId}/authors`],
      ['PATCH', `/v1/blogs/${blogId}/authors/${resourceId}`],
      ['DELETE', `/v1/blogs/${blogId}/authors/${resourceId}`],
      ['POST', `/v1/blogs/${blogId}/categories`],
      ['PATCH', `/v1/blogs/${blogId}/categories/${resourceId}`],
      ['DELETE', `/v1/blogs/${blogId}/categories/${resourceId}`],
      ['POST', `/v1/blogs/${blogId}/tags`],
      ['PATCH', `/v1/blogs/${blogId}/tags/${resourceId}`],
      ['DELETE', `/v1/blogs/${blogId}/tags/${resourceId}`],
    ];

    const call = (method: string, url: string): request.Test => {
      const agent = request(server);
      switch (method) {
        case 'POST':
          return agent.post(url).send({ name: 'x' });
        case 'PATCH':
          return agent.patch(url).send({ name: 'x' });
        case 'DELETE':
          return agent.delete(url);
        default:
          return agent.get(url);
      }
    };

    for (const [method, url] of routes) {
      const res = await call(method, url);
      // The route label rides along so a failure names the broken route.
      expect([`${method} ${url}`, res.status]).toEqual([
        `${method} ${url}`,
        401,
      ]);
      expect([`${method} ${url}`, (res.body as ErrorDto).code]).toEqual([
        `${method} ${url}`,
        'authorization.token.invalid',
      ]);
    }
  });

  // -------------------------------------------------------------------
  // filter matrix
  // -------------------------------------------------------------------

  it('filter matrix: status/author/category/tag/q on management; public ignores status', async () => {
    const blog = await provisionBlog();
    const author1 = await createAuthor(blog.id, 'Author One');
    const author2 = await createAuthor(blog.id, 'Author Two');
    const category1 = await createCategory(blog.id, 'Cat One');
    const category2 = await createCategory(blog.id, 'Cat Two');
    const tag1 = await createTag(blog.id, 'Tag One');
    const tag2 = await createTag(blog.id, 'Tag Two');

    const alpha = await createArticle(blog.id, {
      title: 'Alpha Post',
      excerpt: 'about alpha things',
      content: CONTENT,
      authorId: author1.id,
      categoryId: category1.id,
      tagIds: [tag1.id],
      status: 'PUBLISHED',
    });
    const beta = await createArticle(blog.id, {
      title: 'Beta Post',
      excerpt: 'beta excerpt here',
      content: CONTENT,
      authorId: author2.id,
      categoryId: category2.id,
      tagIds: [tag2.id],
    });
    const gamma = await createArticle(blog.id, {
      title: 'Gamma',
      excerpt: 'contains 100% literal',
      content: CONTENT,
      authorId: author1.id,
      categoryId: category2.id,
      tagIds: [tag1.id, tag2.id],
      status: 'PUBLISHED',
    });

    // status (management-only dimension).
    expect(articleIds(await managementList(blog.id, '?status=DRAFT'))).toEqual([
      beta.id,
    ]);
    expect(
      articleIds(await managementList(blog.id, '?status=PUBLISHED')),
    ).toEqual([alpha.id, gamma.id].sort());

    // authorId / categoryId / tagId.
    expect(
      articleIds(await managementList(blog.id, `?authorId=${author1.id}`)),
    ).toEqual([alpha.id, gamma.id].sort());
    expect(
      articleIds(await managementList(blog.id, `?categoryId=${category2.id}`)),
    ).toEqual([beta.id, gamma.id].sort());
    expect(
      articleIds(await managementList(blog.id, `?tagId=${tag1.id}`)),
    ).toEqual([alpha.id, gamma.id].sort());

    // q: case-insensitive, matches the excerpt (not just the title).
    const byUpper = await managementList(
      blog.id,
      `?q=${encodeURIComponent('THINGS')}`,
    );
    expect(articleIds(byUpper)).toEqual([alpha.id]);
    const byExcerpt = await managementList(
      blog.id,
      `?q=${encodeURIComponent('BETA EXCERPT')}`,
    );
    expect(articleIds(byExcerpt)).toEqual([beta.id]);

    // q: literal '%' — matches only the row actually containing a
    // percent sign (no ILIKE any-run blowout) …
    const pct = await managementList(
      blog.id,
      `?q=${encodeURIComponent('100%')}`,
    );
    expect(articleIds(pct)).toEqual([gamma.id]);
    const lonePct = await managementList(
      blog.id,
      `?q=${encodeURIComponent('%')}`,
    );
    expect(articleIds(lonePct)).toEqual([gamma.id]);
    // … and a '%'-suffixed term that matches nothing returns none.
    const noHit = await managementList(
      blog.id,
      `?q=${encodeURIComponent('zzz%')}`,
    );
    expect(noHit.meta.total).toBe(0);
    expect(noHit.data).toHaveLength(0);

    // Public list: the status filter is silently IGNORED (everything
    // there is PUBLISHED by construction).
    const publicFiltered = (
      await request(server)
        .get(`/v1/blogs/${blog.id}/articles?status=DRAFT`)
        .expect(200)
    ).body as ListEnvelope<ArticleDto>;
    expect(publicFiltered.meta.total).toBe(2); // alpha + gamma, not beta
  });

  // -------------------------------------------------------------------
  // pagination edges
  // -------------------------------------------------------------------

  it('pagination: page slicing + meta echo, out-of-range, invalid input', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const ids: string[] = [];
    for (const title of ['One', 'Two', 'Three']) {
      const article = await createArticle(blog.id, {
        title,
        content: CONTENT,
        authorId: author.id,
      });
      ids.push(article.id);
    }

    // page=2&pageSize=1 slices a single row and echoes the meta.
    const page2 = await managementList(blog.id, '?page=2&pageSize=1');
    expect(page2.meta).toEqual({ total: 3, page: 2, pageSize: 1 });
    expect(page2.data).toHaveLength(1);
    const page1 = await managementList(blog.id, '?page=1&pageSize=1');
    const page3 = await managementList(blog.id, '?page=3&pageSize=1');
    expect(new Set([page1, page2, page3].map((p) => p.data[0]?.id))).toEqual(
      new Set(ids),
    );

    // Beyond the range: empty page, honest total.
    const beyond = await managementList(blog.id, '?page=9&pageSize=2');
    expect(beyond.data).toHaveLength(0);
    expect(beyond.meta).toEqual({ total: 3, page: 9, pageSize: 2 });

    // Invalid input → 400 http.validation.failed (never a 500).
    for (const query of ['?page=0', '?pageSize=101', '?page=abc']) {
      const res = await asOrgA(
        request(server).get(`/v1/blogs/${blog.id}/articles${query}`),
      ).expect(400);
      expect((res.body as ErrorDto).code).toBe('http.validation.failed');
    }

    // The blogs list paginates the same way.
    await provisionBlog(); // second blog in org A
    const blogsPage2 = (
      await asOrgA(request(server).get('/v1/blogs?page=2&pageSize=1')).expect(
        200,
      )
    ).body as ListEnvelope<BlogDto>;
    expect(blogsPage2.meta).toEqual({ total: 2, page: 2, pageSize: 1 });
    expect(blogsPage2.data).toHaveLength(1);
    const blogsPage3 = (
      await asOrgA(request(server).get('/v1/blogs?page=3&pageSize=1')).expect(
        200,
      )
    ).body as ListEnvelope<BlogDto>;
    expect(blogsPage3.data).toHaveLength(0);
    expect(blogsPage3.meta.total).toBe(2);
  });

  // -------------------------------------------------------------------
  // delete conflicts
  // -------------------------------------------------------------------

  it('author delete conflicts while articles reference them, then succeeds', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const article = await createArticle(blog.id, {
      title: 'Authored',
      content: CONTENT,
      authorId: author.id,
    });

    const conflict = await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/authors/${author.id}`),
    ).expect(409);
    expect((conflict.body as ErrorDto).code).toBe('author.conflict');
    expect((conflict.body as ErrorDto).meta).toEqual({ articleCount: 1 });

    // Deleting the article unblocks the author delete.
    await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/articles/${article.id}`),
    ).expect(204);
    await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/authors/${author.id}`),
    ).expect(204);
  });

  it('category delete conflicts while articles reference them, then succeeds', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const category = await createCategory(blog.id, 'Distributed Systems');
    const article = await createArticle(blog.id, {
      title: 'Categorized',
      content: CONTENT,
      authorId: author.id,
      categoryId: category.id,
    });

    const conflict = await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/categories/${category.id}`),
    ).expect(409);
    expect((conflict.body as ErrorDto).code).toBe('category.conflict');
    expect((conflict.body as ErrorDto).meta).toEqual({ articleCount: 1 });

    // Deleting the referencing article unblocks the category delete.
    await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/articles/${article.id}`),
    ).expect(204);
    await asOrgA(
      request(server).delete(`/v1/blogs/${blog.id}/categories/${category.id}`),
    ).expect(204);
  });

  // -------------------------------------------------------------------
  // slug lifecycle
  // -------------------------------------------------------------------

  it('slug e2e: auto-suffix on duplicate title, rename collision 409, title rename keeps slug', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');

    const first = await createArticle(blog.id, {
      title: 'First post',
      content: CONTENT,
      authorId: author.id,
    });
    expect(first.slug).toBe('first-post');

    const second = await createArticle(blog.id, {
      title: 'First post',
      content: CONTENT,
      authorId: author.id,
    });
    expect(second.slug).toBe('first-post-2');

    // Renaming article1 onto article2's slug is a 409, not a silent suffix.
    const conflict = await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blog.id}/articles/${first.id}`)
        .send({ slug: 'first-post-2' }),
    ).expect(409);
    expect((conflict.body as ErrorDto).code).toBe('article.conflict');

    // A title-only rename leaves the slug alone (slugs are URLs: stability
    // beats cleverness).
    const renamed = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blog.id}/articles/${first.id}`)
          .send({ title: 'Renamed entirely' }),
      ).expect(200)
    ).body as ArticleDto;
    expect(renamed.slug).toBe('first-post');

    // The old slug still resolves publicly under the new title.
    await publishArticle(blog.id, first.id);
    await request(server)
      .get(`/v1/blogs/${blog.id}/articles/first-post`)
      .expect(200)
      .expect((res: request.Response) => {
        expect((res.body as ArticleDto).title).toBe('Renamed entirely');
      });
  });

  // -------------------------------------------------------------------
  // public projection snapshot
  // -------------------------------------------------------------------

  it('public projection serves exactly the whitelisted key set', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const category = await createCategory(blog.id, 'Distributed Systems');
    const tag = await createTag(blog.id, 'Postgres');
    const article = await createArticle(blog.id, {
      title: 'Projected',
      excerpt: 'a teaser',
      coverImageUrl: 'https://example.com/cover.png',
      content: CONTENT,
      authorId: author.id,
      categoryId: category.id,
      tagIds: [tag.id],
    });
    await publishArticle(blog.id, article.id);

    const ARTICLE_KEYS = [
      'author',
      'category',
      'content',
      'coverImageUrl',
      'excerpt',
      'id',
      'publishedAt',
      'slug',
      'tags',
      'title',
    ];
    const AUTHOR_KEYS = ['avatarUrl', 'bio', 'id', 'name'];
    const TAXONOMY_KEYS = ['id', 'name', 'slug'];

    const sortedKeys = (value: object): string[] => Object.keys(value).sort();

    const listItem = (
      (
        await request(server)
          .get(`/v1/blogs/${blog.id}/articles?page=1&pageSize=1`)
          .expect(200)
      ).body as ListEnvelope<Record<string, unknown>>
    ).data[0];
    expect(sortedKeys(listItem ?? {})).toEqual(ARTICLE_KEYS);

    const detail = (
      await request(server)
        .get(`/v1/blogs/${blog.id}/articles/projected`)
        .expect(200)
    ).body as Record<string, unknown>;
    expect(sortedKeys(detail)).toEqual(ARTICLE_KEYS);
    expect(sortedKeys(detail.author ?? {})).toEqual(AUTHOR_KEYS);
    expect(sortedKeys(detail.category ?? {})).toEqual(TAXONOMY_KEYS);
    expect(sortedKeys((detail.tags as unknown[])[0] as object)).toEqual(
      TAXONOMY_KEYS,
    );

    // include=related adds exactly one key; nested articles are plain
    // public projections (no recursive `related`).
    await createArticle(blog.id, {
      title: 'Other',
      content: CONTENT,
      authorId: author.id,
      status: 'PUBLISHED',
      relatedArticleIds: [article.id],
    });
    const withRelated = (
      await request(server)
        .get(`/v1/blogs/${blog.id}/articles/other?include=related`)
        .expect(200)
    ).body as Record<string, unknown>;
    expect(sortedKeys(withRelated)).toEqual(
      [...ARTICLE_KEYS, 'related'].sort(),
    );
    const nested = (withRelated.related as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(sortedKeys(nested)).toEqual(ARTICLE_KEYS);

    // Nothing internal leaks anywhere in the serialized detail.
    const serialized = JSON.stringify(withRelated);
    for (const forbidden of [
      'blogId',
      'authorId',
      'categoryId',
      'status',
      'relatedArticleIds',
      'version',
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });

  // -------------------------------------------------------------------
  // ScopesGuard
  // -------------------------------------------------------------------

  it('ScopesGuard rejects a principal without content:write (403)', async () => {
    const res = await asScopeless(
      request(server).post('/v1/blogs').send({ name: 'No scopes' }),
    ).expect(403);
    expect((res.body as ErrorDto).code).toBe('authorization.scope.missing');
  });

  // -------------------------------------------------------------------
  // envelopes & projections for the taxonomy lists (pre-existing)
  // -------------------------------------------------------------------

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

  // -------------------------------------------------------------------
  // nullable clearing (pre-existing, extended with a re-GET)
  // -------------------------------------------------------------------

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
    const article = (
      await asOrgA(
        request(server).post(`/v1/blogs/${blog.id}/articles`).send({
          title: 'Nullable fields',
          content: CONTENT,
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

    // The clear is persisted, not just echoed.
    const refetched = (
      await asOrgA(
        request(server).get(`/v1/blogs/${blog.id}/articles/${article.id}`),
      ).expect(200)
    ).body as ArticleDto;
    expect(refetched.excerpt).toBeNull();
    expect(refetched.categoryId).toBeNull();
    expect(refetched.coverImageUrl).toBeNull();

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

  // -------------------------------------------------------------------
  // idempotent create (pre-existing, extended with a renamed replay)
  // -------------------------------------------------------------------

  it('create is idempotent via client-supplied id and Idempotency-Key', async () => {
    const blog = await provisionBlog();
    const author = await createAuthor(blog.id, 'Ada Lovelace');
    const content = [{ type: 'paragraph', data: { text: 'idem' } }];

    // Client-supplied id: replay returns the existing article with 200 —
    // even when the replay carries a DIFFERENT title, the stored row wins.
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
        title: 'Renamed by the replay',
        content,
        authorId: author.id,
      }),
    ).expect(200);
    expect((replay.body as ArticleDto).id).toBe(clientId);
    expect((replay.body as ArticleDto).title).toBe('Idempotent');

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

  // -------------------------------------------------------------------
  // q search / locking / category FK (pre-existing)
  // -------------------------------------------------------------------

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
