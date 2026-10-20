import {
  applyMigrations,
  closeIntegrationPrisma,
  integrationPrisma,
  testDatabaseUrl,
  TRUNCATED_TABLES,
} from './integration-setup';

/**
 * Drift sentinel: a new Prisma model that nobody added to the truncate
 * list in integration-setup.ts would leak rows between specs and make
 * failures order-dependent — exactly the kind of bug that hides for
 * weeks. This spec fails loudly when the public table list diverges
 * from TRUNCATED_TABLES.
 *
 * Runs only under the integration config (testMatch
 * *.integration-spec.ts). Without CALLIOPE_TEST_DB the suite skips like
 * every other integration spec — but it says so loudly, because a
 * skipped sentinel is precisely the silent-drift scenario it exists to
 * prevent.
 */

if (!testDatabaseUrl) {
  console.warn(
    '[truncate-drift] CALLIOPE_TEST_DB not set — table-drift check SKIPPED. ' +
      'The truncate list in integration-setup.ts is UNVERIFIED on this run.',
  );
}

const describeWithDb: typeof describe = testDatabaseUrl
  ? describe
  : describe.skip;

describeWithDb('truncateAll table list (drift sentinel)', () => {
  beforeAll(() => {
    applyMigrations();
  });

  afterAll(async () => {
    await closeIntegrationPrisma();
  });

  it('covers exactly the public tables of the migrated schema', async () => {
    const rows = await integrationPrisma().$queryRaw<
      Array<{ table_name: string }>
    >`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        -- Prisma's migration-history table: real, but must never be truncated.
        AND table_name <> '_prisma_migrations'`;
    const actual = rows.map((row) => row.table_name).sort();
    expect(actual).toEqual([...TRUNCATED_TABLES].sort());
  });
});
