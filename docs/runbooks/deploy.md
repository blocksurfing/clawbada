# Deploying the API (Railway) and the web app (Vercel)

Verified 2026-09-05. Both deploys run from a checkout on `main` (the engine worktree
`Clawbada-engine` was used; any clean checkout works).

## API → Railway (`clawbada-api`)

```
npx @railway/cli login                          # browser OAuth, once per machine
npx @railway/cli link -p 29948263-a214-46bf-8e51-80e2e4d544e6 -e production -s clawbada-api
npx @railway/cli up -d -s clawbada-api          # detached; Dockerfile = docker/api.Dockerfile
npx @railway/cli deployment list                # BUILDING → DEPLOYING → SUCCESS
npx @railway/cli logs -d -s clawbada-api        # runtime logs
curl https://clawbada-api-production.up.railway.app/health
```

- `.railwayignore` (tracked, root) filters the upload: the 2.5 GB Unity project,
  the gitignored WebGL artifact and local-only dirs stay home. Root-only entries
  are anchored with `/` — an unanchored `lib` would also drop `apps/api/src/lib`.
- The container runs `bun run --filter @clawbada/db migrate` before starting the
  API (see the Dockerfile `CMD`). The Railway Postgres has no public TCP proxy, so
  this is the only place migrations can run. drizzle records applied migrations,
  so redeploys are no-ops until a new `packages/db/drizzle/*.sql` lands.
- Required service variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
  `MATCHMAKER_ADDRESS` (0x-prefixed; a placeholder until the matchmaker contract is
  deployed), `CHAIN_ENV`, `BASE_SEPOLIA_RPC_URL`, `TRUST_PROXY=true`. Practice mode:
  `PRACTICE_ENABLED=true`, `PRACTICE_PRESETS=true` (preset rosters without on-chain
  lobsters), `BATTLE_SESSIONS_ENABLED=true`.

## Web → Vercel (`clawbada-web`)

```
# one-time per checkout: copy .vercel/project.json + vercel.json from the primary checkout
vercel deploy --yes            # preview (behind Vercel SSO)
vercel deploy --prod --yes     # production → https://clawbada-web.vercel.app
```

- Build the Unity WebGL player first (`BuildScript.BuildWebGL`, see
  `packages/battle-engine/README.md`); it lands in `apps/web/public/unity-build/`
  (gitignored) and ships because `.vercelignore` (tracked, root) replaces `.gitignore`
  for CLI uploads. Same anchoring rule as above.
- Production env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` (`wss://…/ws`),
  `NEXT_PUBLIC_PRACTICE_PRESETS=true`. `NEXT_PUBLIC_*` values are baked in at build
  time — change them, then redeploy.
- Pushes to `main` do NOT deploy production (Ignored Build Step); the CLI deploy is
  the production path.
