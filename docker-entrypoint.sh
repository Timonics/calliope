#!/bin/sh
# Container entrypoint: apply migrations, then exec the server.
# `prisma migrate deploy` is idempotent — a no-op when the database is
# already at the latest migration, so restarts are cheap. Requires
# DATABASE_URL (validated at boot by the app config too).
#
# The prisma CLI is invoked directly (`node …/prisma/build/index.js`),
# NOT via npx: npx shells out to npm, and npm's error-log directory
# (/app/.npm/_logs) is not writable for the non-runtime user — npm
# failures used to be swallowed by "Log files were not written" errors,
# hiding the real migration error (deploy-debug nightmare).
set -e

if [ -z "$DATABASE_URL" ]; then
  echo '[entrypoint] DATABASE_URL is not set — cannot apply migrations.' >&2
  exit 1
fi

echo '[entrypoint] applying migrations...'
node node_modules/prisma/build/index.js migrate deploy

exec "$@"
