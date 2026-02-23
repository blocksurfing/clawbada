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

# ── Build stage ──
FROM node:20-slim AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/web && npx next build

# ── Run stage ──
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy Next.js standalone output
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
