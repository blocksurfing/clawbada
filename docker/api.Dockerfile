# Pinned: a deploy must never double as a Bun upgrade. Bump deliberately, and keep it in step with the Bun
# the web build uses (Vercel: 1.3.14) so `--frozen-lockfile` reads the same lockfile format.
ARG BUN_VERSION=1.3.14
FROM oven/bun:${BUN_VERSION} AS deps

WORKDIR /app

# Copy root workspace config + lockfile
COPY package.json bun.lock ./
COPY tsconfig.base.json ./

# Copy EVERY workspace package.json (bun refuses a pruned checkout that is missing a
# workspace another one depends on). Adding a workspace? Add it here in all four Dockerfiles.
COPY apps/api/package.json apps/api/
COPY apps/engine/package.json apps/engine/
COPY apps/indexer/package.json apps/indexer/
COPY apps/web/package.json apps/web/
COPY packages/asset-gen/package.json packages/asset-gen/
COPY packages/chain/package.json packages/chain/
COPY packages/db/package.json packages/db/
COPY packages/game-logic/package.json packages/game-logic/
COPY packages/logger/package.json packages/logger/
COPY scripts/e2e/package.json scripts/e2e/

RUN bun install --frozen-lockfile

# ── Run stage ──
FROM oven/bun:${BUN_VERSION}

WORKDIR /app

# Copy node_modules (includes workspace symlinks)
COPY --from=deps /app/node_modules ./node_modules
# Copy all source (workspace packages + apps) — see .dockerignore for what stays out
COPY . .
# Re-link workspace packages after copy (build time, as root)
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
# The oven/bun image ships an unprivileged `bun` user (uid/gid 1000). Everything above ran as root at build
# time; at run time the app only reads /app, so dropping privileges costs nothing.
USER bun
EXPOSE 3001

# Apply pending migrations through the shared DB client (works over the Cloud SQL unix socket), then exec the
# API so Bun is PID 1 and receives the platform's SIGTERM directly (apps/api/src/lib/shutdown.ts). drizzle
# records applied migrations, so this is idempotent on every start; single replica by design.
CMD ["sh", "-c", "bun run packages/db/src/migrate.ts && exec bun run apps/api/src/index.ts"]
