# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# calliope production image.
#
# Multi-stage: full `npm ci` for the build, a production-only node_modules
# for the runtime, non-root user, built-in healthcheck. The entrypoint runs
# `prisma migrate deploy` (idempotent) against DATABASE_URL before the
# server starts, so a fresh container on a new database self-initializes.
#
# Build:  docker build -t calliope .
# Run:    docker run -p 3002:3002 -e DATABASE_URL=... -e CERBERUS_JWKS_URL=... calliope
# ---------------------------------------------------------------------------

FROM node:22-slim AS base
WORKDIR /app

# --- all dependencies (build + test tooling) --------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- compile -----------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate \
  && npm run build

# --- production dependencies only, WITH the generated prisma client -----------
# (prisma generate writes into node_modules — it must run in THIS stage,
# because the runtime copies node_modules from here, not from `build`.)
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate \
  && rm -rf prisma

# --- runtime -----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The base image bundles npm 10.9.x, which ships a vulnerable `sigstore`
# (CVE-2026-48815). The runtime never verifies package signatures, but
# image vulnerability scans still flag it. Upgrading the global npm
# replaces that tree — npm 11.21+/12 no longer depend on `sigstore` at
# all — so the flagged package leaves the image. Pinned, not @latest.
RUN npm install -g npm@12.2.2 \
  && npm --version

RUN groupadd --system calliope \
  && useradd --system --gid calliope --home-dir /app calliope

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER calliope
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
