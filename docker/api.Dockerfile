FROM oven/bun:1 AS deps

WORKDIR /app

# Copy root workspace config + lockfile
COPY package.json bun.lock ./
COPY tsconfig.base.json ./

# Copy all workspace package.json files for dependency resolution
COPY apps/api/package.json apps/api/
COPY apps/engine/package.json apps/engine/
COPY apps/indexer/package.json apps/indexer/
COPY apps/web/package.json apps/web/
COPY packages/asset-gen/package.json packages/asset-gen/
COPY packages/chain/package.json packages/chain/
COPY packages/db/package.json packages/db/
COPY packages/game-logic/package.json packages/game-logic/
COPY packages/logger/package.json packages/logger/

RUN bun install --frozen-lockfile

# ── Run stage ──
FROM oven/bun:1

WORKDIR /app

# Copy node_modules (includes workspace symlinks)
COPY --from=deps /app/node_modules ./node_modules
# Copy all source (workspace packages + apps)
COPY . .
# Re-link workspace packages after copy
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 3001

# Apply pending drizzle migrations, then start. Railway's Postgres has no public
# proxy, so the container is the one place that can reach it; drizzle records
# applied migrations, so this is idempotent on every deploy (single replica).
CMD ["sh", "-c", "bun run --filter @clawbada/db migrate && exec bun run apps/api/src/index.ts"]
