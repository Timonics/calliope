/**
 * Database seed — placeholder. The v1 blogging API is fully driven
 * over HTTP; there is no seed data yet. This hook exists so
 * `npx prisma db seed` (and `npm run db:seed`) already has a home.
 * Never seed tenants you care about from here.
 */
async function main(): Promise<void> {
  // no-op
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
