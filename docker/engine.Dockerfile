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

RUN bun install --frozen-lockfile

# ── Run stage ──
FROM oven/bun:1

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
EXPOSE 3002

CMD ["bun", "run", "--filter", "@clawbada/engine", "start"]
