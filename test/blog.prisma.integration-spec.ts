import { randomUUID } from 'node:crypto';
import {
  applyMigrations,
  closeIntegrationPrisma,
  integrationPrisma,
  testDatabaseUrl,
  truncateAll,
} from './integration-setup';

/**
 * Skipped entirely unless CALLIOPE_TEST_DB is set — the suite must not
 * fail on machines without a reachable Postgres.
 */
const describeWithDb: typeof describe = testDatabaseUrl
  ? describe
  : describe.skip;

describeWithDb('Blog persistence (Prisma smoke)', () => {
  beforeAll(() => {
    applyMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeIntegrationPrisma();
  });

  it('creates and reads a blog keyed by (tenantId, slug)', async () => {
    const prisma = integrationPrisma();
    const tenantId = randomUUID();

    const created = await prisma.blog.create({
      data: {
        id: randomUUID(),
        tenantId,
        name: 'Engineering',
        slug: 'engineering',
      },
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeInstanceOf(Date);

    const found = await prisma.blog.findUnique({
      where: { tenantId_slug: { tenantId, slug: 'engineering' } },
    });
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe('Engineering');

    // Same slug under a different tenant is allowed (unique per tenant).
    const other = await prisma.blog.create({
      data: {
        id: randomUUID(),
        tenantId: randomUUID(),
        name: 'Engineering',
        slug: 'engineering',
      },
    });
    expect(other.id).not.toBe(created.id);
  });

  it('rejects a duplicate (tenantId, slug)', async () => {
    const prisma = integrationPrisma();
    const tenantId = randomUUID();
    await prisma.blog.create({
      data: { id: randomUUID(), tenantId, name: 'A', slug: 'dup' },
    });
    await expect(
      prisma.blog.create({
        data: { id: randomUUID(), tenantId, name: 'B', slug: 'dup' },
      }),
    ).rejects.toMatchObject({
      // Unique-constraint violation on the (tenantId, slug) index.
      code: 'P2002',
    });
  });
});
