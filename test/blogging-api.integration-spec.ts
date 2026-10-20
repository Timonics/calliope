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
 * Skipped unless CALLIOPE_TEST_DB is set.
 */
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

describeWithDb('Blogging API lifecycle', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  const asOrgA = (req: request.Test): request.Test =>
    req.set('x-test-org', ORG_A);
  const asOrgB = (req: request.Test): request.Test =>
    req.set('x-test-org', ORG_B);

  beforeAll(async () => {
    process.env.CERBERUS_JWKS_URL ??=
      'http://localhost:3000/.well-known/jwks.json';
    applyMigrations();

    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    const { OPTIONAL_PRINCIPAL_RESOLVER } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../src/blogging/application/optional-auth') as typeof import('../src/blogging/application/optional-auth');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrincipalProvider)
      .useFactory({
        factory: () => ({
          resolvePrincipal: (req: { headers: Record<string, unknown> }) => {
            const org = req.headers['x-test-org'];
            if (!org) {
              throw new AuthGuardError(
                'authorization.token.invalid',
                401,
                'Missing test principal',
              );
            }
            return Promise.resolve(principalFor(String(org)));
          },
        }),
      })
      // The @Public() read routes upgrade to a management view via this
      // resolver when a valid Bearer token is presented; the test double
      // keys off the same x-test-org header (absent → anonymous view).
      .overrideProvider(OPTIONAL_PRINCIPAL_RESOLVER)
      .useFactory({
        factory: () => ({
          resolve: (req: { headers: Record<string, unknown> }) => {
            const org = req.headers['x-test-org'];
            return Promise.resolve(org ? principalFor(String(org)) : undefined);
          },
        }),
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

  it('runs the full lifecycle: provision → content → publish → public reads → tenancy', async () => {
    // 1. Provision a blog in org A.
    const blogRes = await asOrgA(
      request(server).post('/v1/blogs').send({ name: 'Engineering' }),
    ).expect(201);
    const blogId: string = blogRes.body.id;
    expect(blogRes.body.slug).toBe('engineering');
    expect(blogRes.body.tenantId).toBe(ORG_A);

    // 2. Author, category, tags.
    const author = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blogId}/authors`)
          .send({ name: 'Ada Lovelace' }),
      ).expect(201)
    ).body;
    const category = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blogId}/categories`)
          .send({ name: 'Distributed Systems' }),
      ).expect(201)
    ).body;
    const tagA = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blogId}/tags`)
          .send({ name: 'Postgres' }),
      ).expect(201)
    ).body;
    const tagB = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blogId}/tags`)
          .send({ name: 'NestJS' }),
      ).expect(201)
    ).body;

    const content = [{ type: 'paragraph', data: { text: 'Hello world' } }];

    // 3. Draft articles, article2 curated to relate to article1.
    const article1 = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blogId}/articles`)
          .send({
            title: 'First post',
            content,
            authorId: author.id,
            categoryId: category.id,
            tagIds: [tagA.id],
          }),
      ).expect(201)
    ).body;
    expect(article1.status).toBe('DRAFT');
    expect(article1.slug).toBe('first-post');

    const article2 = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blogId}/articles`)
          .send({
            title: 'Second post',
            content,
            authorId: author.id,
            tagIds: [tagA.id, tagB.id],
            relatedArticleIds: [article1.id],
          }),
      ).expect(201)
    ).body;

    // 4. Public list hides drafts.
    await request(server)
      .get(`/v1/blogs/${blogId}/articles`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveLength(0);
      });

    // 5. Publish article1.
    const published = (
      await asOrgA(
        request(server)
          .patch(`/v1/blogs/${blogId}/articles/${article1.id}`)
          .send({ status: 'PUBLISHED' }),
      ).expect(200)
    ).body;
    expect(published.status).toBe('PUBLISHED');
    expect(new Date(published.publishedAt)).toBeInstanceOf(Date);

    // 6. Public reads: list, slug fetch, include=related.
    await request(server)
      .get(`/v1/blogs/${blogId}/articles`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.meta.total).toBe(1);
      });

    await request(server)
      .get(`/v1/blogs/${blogId}/articles/first-post`)
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe('First post');
        expect(res.body.status).toBeUndefined(); // public projection
      });

    // article2 is still a DRAFT — public slug lookup must 404 (drafts are
    // not public, and ids/slugs of unpublished content get no signal).
    await request(server)
      .get(`/v1/blogs/${blogId}/articles/second-post?include=related`)
      .expect(404)
      .expect((res) => expect(res.body.code).toBe('article.not_found'));

    // Management related-resolution works and preserves order.
    const related = (
      await asOrgA(
        request(server).get(
          `/v1/blogs/${blogId}/articles/${article2.id}/related`,
        ),
      ).expect(200)
    ).body;
    expect(related.map((a: { id: string }) => a.id)).toEqual([article1.id]);
  });

  it('enforces tenancy and domain rules', async () => {
    const blogRes = await asOrgA(
      request(server).post('/v1/blogs').send({ name: 'Acme' }),
    ).expect(201);
    const blogId: string = blogRes.body.id;

    const author = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blogId}/authors`)
          .send({ name: 'Tenant Author' }),
      ).expect(201)
    ).body;

    const article = (
      await asOrgA(
        request(server)
          .post(`/v1/blogs/${blogId}/articles`)
          .send({
            title: 'Owned by A',
            authorId: author.id,
            content: [{ type: 'paragraph', data: {} }],
          }),
      ).expect(201)
    ).body;

    // Cross-tenant access → 403, not 404 (caller IS authenticated).
    const forbidden = await asOrgB(
      request(server).get(`/v1/blogs/${blogId}/articles`),
    ).expect(403);
    expect(forbidden.body.code).toBe('blog.forbidden');

    // Unknown blog → 404 for both public and management callers.
    const missing = randomUUID();
    await request(server)
      .get(`/v1/blogs/${missing}/articles`)
      .expect(404)
      .expect((res) => expect(res.body.code).toBe('blog.not_found'));
    await asOrgA(request(server).get(`/v1/blogs/${missing}`)).expect(404);

    // Explicit slug collision → 409.
    const conflict = await asOrgA(
      request(server)
        .post(`/v1/blogs/${blogId}/articles`)
        .send({
          title: 'Different title',
          slug: 'owned-by-a',
          authorId: author.id,
          content: [{ type: 'paragraph', data: {} }],
        }),
    ).expect(409);
    expect(conflict.body.code).toBe('article.conflict');

    // Self-reference in relatedArticleIds → 400.
    await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blogId}/articles/${article.id}`)
        .send({ relatedArticleIds: [article.id] }),
    )
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('article.validation'));

    // ARCHIVED is terminal.
    await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blogId}/articles/${article.id}`)
        .send({ status: 'ARCHIVED' }),
    ).expect(200);
    await asOrgA(
      request(server)
        .patch(`/v1/blogs/${blogId}/articles/${article.id}`)
        .send({ status: 'PUBLISHED' }),
    )
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('article.conflict'));
  });

  it('rejects invalid content blocks at the boundary', async () => {
    const blogId = (
      await asOrgA(request(server).post('/v1/blogs').send({ name: 'Acme' }))
    ).body.id;

    await asOrgA(
      request(server)
        .post(`/v1/blogs/${blogId}/articles`)
        .send({ title: 'Bad', content: [] }),
    )
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('http.validation.failed'));
  });
});
