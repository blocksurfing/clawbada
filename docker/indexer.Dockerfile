FROM oven/bun:1 AS deps

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

RUN bun install --frozen-lockfile

# ── Run stage ──
FROM oven/bun:1

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Re-link workspace packages after the source copy (same fix as api.Dockerfile, 2026-04-07)
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 3003

CMD ["bun", "run", "--filter", "@clawbada/indexer", "start"]
