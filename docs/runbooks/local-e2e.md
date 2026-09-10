# Local end-to-end run (Anvil + the whole stack)

`bun run e2e` boots a local chain and every service, then plays the whole game loop with two
scripted wallets and checks chain, database and client agree. It is the pre-testnet gate: if
it is green, the staked-battle path (queue → match → `createBattle` → deposit → commit →
resolver `revealTeams` → live session → `settle` → dispute window → `finalizeBattle` → indexer
parity), faucet onboarding, evolution through the API and a mining expedition all work
together.

## Prerequisites

- Foundry (`anvil`, `forge`) on `PATH`.
- Postgres reachable at `postgresql://clawbada:clawbada@127.0.0.1:5432/clawbada` (the
  `clawbada-pg` container under Colima). Override with `E2E_PG_ADMIN_URL`. Each run creates
  and drops its own database `clawbada_e2e_<timestamp>`.
- `bun install` once (the suite is the `@clawbada/e2e` workspace under `scripts/e2e`).
- No internet needed: drand is stubbed (`--live-drand` uses api.drand.sh).

## Run

```bash
bun run e2e                          # full run, ~5 min, tears everything down
bun run e2e -- --keep --verbose      # leave anvil/db/services up, echo service logs
bun run e2e -- --stake 10000         # Mid bracket (30 min dispute window, warped)
bun run e2e -- --anvil-port 8555 --api-port 3011
```

Exit codes: `0` pass · `1` assertions failed · `2` infra/setup failure · `3` a phase timed out.
Logs: `scripts/e2e/.runs/<timestamp>/{anvil,api,engine,indexer,forge-deploy,forge-configure}.log`.

## What it does

| Phase | Steps |
|---|---|
| infra | `anvil --chain-id 84532` (the monorepo's viem clients are hard-wired to Base Sepolia's id) → fresh DB + migrations → `Deploy.s.sol` + `Configure.s.sol` (Anvil key 0 = deployer and every operator role; addr 1 = dev wallet) → drand stub → indexer, engine, api as bun child processes |
| onboard | deployer allowlists both players on the Faucet → each claims 5 soulbound lobsters + 7,000 CLAW through the API → deployer mints 6 Base fuel lobsters and tops up 10,000 CLAW → 3 evolutions via `POST /api/game/evolution/evolve` → `teams/create` |
| battle | A and B queue (Low, 2,500) → engine `create_battle` → deposits → commits (client-side salt + `teamCommitHash`) → salts to `/reveal-team`; the engine's RevealWatcher submits `revealTeams` (latency measured against the 20 s window) → API claims the session; both agents play over WebSocket with the balanced bot policy → engine `settle_battle` → time warp past `payoutDeadline` → engine FinalizeWatcher `finalizeBattle` |
| mining | the winner's released team starts an Evolved expedition via the API, a claim before 4 h is refused, warp 4 h, claim via the API |
| assert | winner/loser CLAW deltas, 85 % burn / 15 % dev, damage on all six lobsters, teams released; DB `battles` / `battle_sessions` / `agents` / `operator_jobs` / `indexer_state` parity; services still up |

## Harness-only settings

These are set by the suite for its child processes and are NOT production configuration:
`TRUST_PROXY=true` (each scripted wallet sends its own `X-Forwarded-For`, so per-IP rate
limits apply per wallet), `DRAND_CHAIN_URL=<stub>`, `INDEXER_START_BLOCK=0`,
`BOOST_EPOCH_ANCHOR_TS=<season 1 start>`, `BATTLE_SESSION_POLL_MS=1000`, `BOT_THINK_MS=0`,
`FINALIZE_POLL_MS=2000`, `NODE_ENV=test` (JSON logs).

## Diagnostics

```sql
select battle_id, phase, status, winner, protocol_fee, settled_at from battles;
select id, status, vrf_round, turn from battle_sessions;
select job_type, status, attempts, last_error from operator_jobs;
select contract_name, last_processed_block from indexer_state;
```

`forge script` writes `deployments/base-sepolia.json` and `broadcast/` at the repo root; the
suite backs up any pre-existing deployment file, restores it and removes `broadcast/` on
teardown. Both paths are gitignored.

## Known limits

- One API instance (battle sessions are in-memory).
- All engine signers share Anvil key 0; the watchers are sequential, so nonce collisions are
  unlikely but possible under load (`nonce too low` in `engine.log`).
- No breeding (48 h cooldown) or marketplace steps in this run.
- The scripted player (`scripts/e2e/lib/agent.ts`) is the seed of the Phase 3 reference bot.
