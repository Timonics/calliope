#!/bin/sh
# Container entrypoint: apply migrations, then exec the server.
# `prisma migrate deploy` is idempotent — a no-op when the database is
# already at the latest migration, so restarts are cheap. Requires
# DATABASE_URL (validated at boot by the app config too).
set -e

echo "[entrypoint] applying migrations..."
npx --no-install prisma migrate deploy

exec "$@"
