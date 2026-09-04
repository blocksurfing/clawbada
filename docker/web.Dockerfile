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

# ── Build stage ──
# Built with bun, like CI's "Build Web" job: bun keeps each workspace's own dependencies
# under that workspace's node_modules (apps/web/node_modules holds lucide-react,
# @tanstack/react-query, @tailwindcss/postcss ...), so a node-only stage that received just
# the root node_modules could not resolve them. Re-running the frozen install after the
# source copy re-creates those per-workspace directories.
FROM oven/bun:1 AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun install --frozen-lockfile

ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --filter @clawbada/web build

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
