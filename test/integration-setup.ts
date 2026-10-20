import { execSync } from 'node:child_process';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';

/**
 * Shared setup for integration specs (run via `npm run test:integration`
 * with CALLIOPE_TEST_DB set — see .env.example).
 *
 * The suite is SKIPPED entirely unless CALLIOPE_TEST_DB is present, so it
 * never fails on machines without a database — EXCEPT on CI: a green
 * build that silently tested nothing is a false signal, so CI=true
 * without CALLIOPE_TEST_DB fails loudly at module load. When enabled:
 * migrations apply once per process (idempotent via `prisma migrate
 * deploy`), and every spec truncates the tables it touches in
 * beforeEach. Never point these at a database you care about.
 */
export const testDatabaseUrl = process.env.CALLIOPE_TEST_DB;

// The AuthGuardModule wiring (sharedAuthGuard) validates its JWKS URL at
// module-evaluation time; the integration suite stubs the provider, so
// any well-formed localhost URL does. This module is imported before
// app.module in every integration spec, so the default is in place
// before the module graph evaluates.
process.env.CERBERUS_JWKS_URL ??= 'http://localhost:3000/.well-known/jwks.json';

// CI hazard guard: never let CI pass with the integration suite
// silently skipped — that hides broken migrations and red specs behind
// a green checkmark.
if (process.env.CI === 'true' && !testDatabaseUrl) {
  throw new Error(
    'CI=true requires CALLIOPE_TEST_DB — refusing to silently skip the integration suite',
  );
}

if (testDatabaseUrl && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = testDatabaseUrl;
}

let prisma: PrismaService | undefined;
let migrationsApplied = false;

export function integrationPrisma(): PrismaService {
  if (!prisma) {
    if (!testDatabaseUrl) {
      throw new Error(
        'Integration tests require CALLIOPE_TEST_DB — see .env.example',
      );
    }
    prisma = new PrismaService();
  }
  return prisma;
}

export function applyMigrations(): void {
  if (migrationsApplied || !testDatabaseUrl) {
    return;
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  });
  migrationsApplied = true;
}

export async function truncateAll(): Promise<void> {
  await integrationPrisma().$executeRawUnsafe(
    'TRUNCATE TABLE "idempotency_keys", "_ArticleToTag", articles, tags, categories, authors, blogs CASCADE',
  );
}

/** Call from each spec's afterAll so Jest can exit cleanly. */
export async function closeIntegrationPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
