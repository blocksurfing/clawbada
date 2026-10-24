# Deploying the API (Cloud Run) and the web app (Vercel)

> Contracts, engine and indexer on Base Sepolia: `testnet-deploy.md` (the ordered runbook, not yet executed).

Both deploys run from a checkout on `main` (the engine worktree `Clawbada-engine` is used; any clean
checkout works). The API moved from Railway to Google Cloud Run on 2026-10-22 (the Railway breach).

## API → Cloud Run (`clawbada-api`, `us-east4`)

```
scripts/deploy-api.sh            # builds linux/amd64 on Cloud Build, pushes to Artifact Registry, rolls the service, checks /health
curl https://api.clawbada.com/health
```

- Everything about the service — the one-time setup, where configuration and secrets live, the load
  balancer behind `api.clawbada.com`, secret rotation, rollback, monitoring, the shutdown contract — is in
  **`docs/runbooks/cloud-run.md`**. A deploy only swaps the image; it never touches configuration.
- The container runs `packages/db/src/migrate.ts` before starting the API (the Dockerfile `CMD`). The
  Cloud SQL instance has no public address, so this is the only place migrations run in production.
  drizzle records applied migrations, so redeploys are no-ops until a new `packages/db/drizzle/*.sql` lands.
- Non-secret runtime variables are the committed `docker/cloud-run.api.env.yaml` (`CHAIN_ENV`,
  `BASE_SEPOLIA_RPC_URL`, `MATCHMAKER_ADDRESS` — a placeholder until the matchmaker contract is deployed —,
  `AUTH_DOMAINS`, `TRUST_PROXY` + `TRUST_PROXY_HOPS`, the practice flags, `DB_POOL_MAX`). Guest sessions (the
  Dojo without a wallet) are on by default; `GUEST_SESSIONS_ENABLED=false` switches them off and
  `PRACTICE_MAX_LIVE` (default 500) caps live practice battles — see `docs/runbooks/battle-session.md`.

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
  `NEXT_PUBLIC_PRACTICE_PRESETS=true` (Shell sample lobsters; the Dojo's review presets are dev-only since
  2026-10-24 regardless). `NEXT_PUBLIC_*` values are baked in at build
  time — change them, then redeploy.
- Pushes to `main` do NOT deploy production (Ignored Build Step); the CLI deploy is
  the production path.
