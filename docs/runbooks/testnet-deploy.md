# Testnet deploy runbook — Base Sepolia, end to end

Written 2026-10-06 (M9). This is the ordered procedure for the FIRST deployment of the contracts to Base Sepolia and for standing the engine and indexer up against it. Nothing here has been run against Sepolia yet; every step is rehearsed by `bun run e2e` on a local Anvil with the same scripts (see `local-e2e.md`). The deploy itself is a separate decision — do not start at step 3 without it.

The same sequence, with the Safe in the deployer's place from step 8 on, is the mainnet launch (`admin-roles.md` → "Configure.s.sol — deployer ephemeral role").

## 0. The keys and who holds what

| Env var (address) | Env var (key) | Loaded by | Role |
|---|---|---|---|
| `DEPLOYER_ADDRESS` (from the deployment JSON) | `DEPLOYER_PRIVATE_KEY` | forge scripts only | Deploys, configures, opens (testnet); hands off and renounces everything |
| `DEV_WALLET` | — | Treasury | The 15 % fee leg. Must differ from the deployer on mainnet |
| `MATCHMAKER_ADDRESS` | `MATCHMAKER_PRIVATE_KEY` | API (address), engine (key) | `createBattle` |
| `RESOLVER_ADDRESS` | `RESOLVER_PRIVATE_KEY` | engine | `revealTeams`, `settle`, `accuseRevealFailure` |
| `GUARDIAN_ADDRESS` | `GUARDIAN_PRIVATE_KEY` | engine | `freeze`; `PauseSwitch.pause` |
| `BOOST_ADMIN_ADDRESS` | `BOOST_ADMIN_PRIVATE_KEY` | engine | weekly boost table |
| `VRF_OPERATOR_ADDRESS` | (`OPERATOR_PRIVATE_KEY`) | engine | drand beacon pushes — the operator key |
| `ELIGIBILITY_OPERATOR` | `ELIGIBILITY_PRIVATE_KEY` | `packages/chain/scripts/faucet-allowlist.ts` only | faucet eligibility (M10) |
| `GOVERNANCE_SAFE` | (the Safe) | Handoff | everything, after the handoff |
| `TREASURY_RESERVE_ADDRESS`, `LP_RECIPIENT` | — | GoldToken genesis | the 100 M reserve and the 125 M LP allocation |

**The key-consistency rule.** Every `*_ADDRESS` given to `Configure.s.sol` must be the address of the matching `*_PRIVATE_KEY` the engine loads. Off mainnet the engine falls back to `OPERATOR_PRIVATE_KEY` for any role key that is unset — so if Configure was given a separate `RESOLVER_ADDRESS` but the engine has no `RESOLVER_PRIVATE_KEY`, the engine signs with the operator key, which does not hold the role, and every `revealTeams` reverts. The guardian's preflight catches that one at boot (`guardian_preflight_failed`); the others show up as reverts in `operator_jobs`. On mainnet the engine refuses to start without all four role keys (D-26).

Testnet simplification that `bun run e2e` uses and that is fine for a first Sepolia deploy: one deployer key for every role except the guardian (`GUARDIAN_ADDRESS` set to a second key), `ELIGIBILITY_OPERATOR` a third. Every other `*_ADDRESS` unset → the deploy scripts fall back to the deployer, and the engine's `OPERATOR_PRIVATE_KEY` = the deployer key.

Generate keys with `cast wallet new`. Fund: the deployer with ~0.2 ETH (13 contracts + configuration), the guardian and operator with ~0.05 ETH each (Sepolia faucets: https://docs.base.org/base-chain/tools/network-faucets).

## 1. Prerequisites

- A clean checkout of `main` with `forge build` green and `bun install` done.
- `.env` at the repo root with: `DEPLOYER_PRIVATE_KEY`, `DEV_WALLET`, `GUARDIAN_ADDRESS`, `BOOST_ADMIN_ADDRESS` (or unset → deployer), `BASE_SEPOLIA_RPC_URL` (Alchemy/QuickNode; the public RPC rate-limits `--verify`), `BASESCAN_API_KEY`, `ELIGIBILITY_OPERATOR`.
- `foundry.toml` has the `base_sepolia` RPC alias (note the underscore; the deployment JSON and `sync-deploy` use `base-sepolia` with a hyphen).
- Railway: the API service exists (`deploy.md`); the engine and indexer services do NOT yet — step 7 creates them.

## 2. Dry run the scripts against Anvil

```
bun run e2e -- --api-port 3011 --anvil-port 8555
```

This runs Deploy → Configure → `VerifyDeployment configured()` → Open → `VerifyDeployment opened()` with the repo's scripts, then plays a whole battle and the freeze drill. Green here means the scripts are consistent with the contracts.

## 3. Deploy

```
forge script contracts/script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify --slow
bun run sync-deploy base-sepolia
```

- Deploys 13 contracts (PauseSwitch first, BattleArena last) and writes `deployments/base-sepolia.json` (addresses, `chainId`, `deployer`, `timestamp`, **`blockNumber`** — the indexer's cold-start block). The file is gitignored; copy it somewhere safe.
- `sync-deploy` writes every `*_ADDRESS`, `CHAIN_ENV=testnet` and `INDEXER_START_BLOCK` into `.env`.
- If `--verify` fails for some contracts (public RPC rate limit, Basescan hiccup): `bash contracts/script/verify.sh base-sepolia` re-verifies all 13 with the right constructor arguments.
- The faucet is deployed **closed** (`closeTime = 0`) and no season exists yet: nothing can mine or claim until step 8.

## 4. Configure

```
forge script contracts/script/Configure.s.sol --rpc-url base_sepolia --broadcast --slow
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base_sepolia --sig "configured()"
```

Configure grants every role (contract roles, the hot roles to their `*_ADDRESS`, `PAUSER_ROLE` to the guardian, `ELIGIBILITY_ROLE` to the deployer), wires the Treasury, pre-mints the faucet's 70 M GOLD, and — off mainnet, when the deployer holds the treasury allocation — funds the 2 M GOLD refund reserve. It does NOT start a season (D-G).

`configured()` reads the chain (no key, no broadcast; same `*_ADDRESS` env) and refuses to pass if the deploy key still holds `MINTER_ROLE`, a hot role sits on the wrong address, the protocol is paused, or the faucet lacks its pre-mint. Fix and re-run until it passes.

## 5. Keep the records

Commit nothing with addresses to a public branch before launch, but record: the deployment JSON, the Basescan links, the block number, the key→role table above with the actual addresses. `VerifyDeployment` needs only public addresses, so anyone can re-run it later.

## 6. The API on Railway

Set the service variables (`deploy.md` lists the existing ones) and add the 13 `*_ADDRESS` values, `MATCHMAKER_ADDRESS` (the real one now, not the placeholder), `BASE_SEPOLIA_RPC_URL`, `BATTLE_SEED_SECRET` (shared with the engine — generate once: `openssl rand -hex 32`), `AUTH_DOMAINS`. Redeploy (`npx @railway/cli up -d -s clawbada-api`). `GET /api/auth/params` must now return the arena address under `contracts.battleArena`.

## 7. The engine and the indexer on Railway (new services)

Both run from the same repo with `docker/engine.Dockerfile` / `docker/indexer.Dockerfile` (same shape as the API's; `.railwayignore` applies). Variables:

| Service | Variables |
|---|---|
| indexer | `DATABASE_URL`, `CHAIN_ENV=testnet`, `BASE_SEPOLIA_RPC_URL`, the 13 `*_ADDRESS`, **`INDEXER_START_BLOCK`** (from the deployment JSON; without it the indexer starts at the current block and never sees `SeasonStarted`) |
| engine | the indexer's set plus `OPERATOR_PRIVATE_KEY`, `GUARDIAN_PRIVATE_KEY`, `BATTLE_SEED_SECRET` (= the API's), `DRAND_CHAIN_URL` (default: the public drand), optional `RESOLVER_PRIVATE_KEY` / `MATCHMAKER_PRIVATE_KEY` / `BOOST_ADMIN_PRIVATE_KEY` when those roles have their own keys (then their `*_ADDRESS` must have been given to Configure — the key-consistency rule) |

Boot order: indexer (wait for `Clawbada Indexer ready`), engine (`Clawbada Engine ready`; the guardian preflight logs `guardian_preflight_ok`), then the API. Until step 8 the engine logs `season_not_started` once an hour — expected.

## 8. Allowlist the first wallets (M10)

```
bun run faucet-allowlist --file wallets.txt --skip-age          # dry run: verdicts
bun run faucet-allowlist --file wallets.txt --skip-age --send   # grant (ELIGIBILITY_PRIVATE_KEY)
```

`--skip-age` on the testnet (Basescan history is not worth the API key there). On mainnet drop it and set `BASESCAN_API_KEY`. Before the handoff the deployer holds `ELIGIBILITY_ROLE`, so `ELIGIBILITY_PRIVATE_KEY` = the deployer key here; after the handoff it is the eligibility operator's key and nothing else runs with it.

## 9. Rehearse the handoff (optional on the testnet, mandatory before mainnet)

With a Sepolia Safe as `GOVERNANCE_SAFE` and `ELIGIBILITY_OPERATOR` set:

```
forge script contracts/script/Handoff.s.sol --rpc-url base_sepolia --broadcast
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base_sepolia --sig "proposed()"
   (Safe) Treasury.acceptOwnership()
forge script contracts/script/Handoff.s.sol --rpc-url base_sepolia --broadcast --sig "finalize()"
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base_sepolia --sig "finalized()"
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base_sepolia --sig "reserveFunded()"
```

After this the deployer governs nothing: step 10 must then be done by the Safe (`safeCalls()`), exactly as on mainnet.

## 10. Open the game

Before the handoff (testnet, deployer still admin):

```
forge script contracts/script/Open.s.sol --rpc-url base_sepolia --broadcast --slow
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base_sepolia --sig "opened()"
```

After the handoff (mainnet, or a rehearsed testnet):

```
forge script contracts/script/Open.s.sol --rpc-url base_sepolia --sig "safeCalls()"   # prints the two Safe transactions
   (Safe) Faucet.setCloseTime(now + 7 days)   then   MiningPool.startSeason(352_500_000e18, 1_250e18)
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base_sepolia --sig "opened()"
```

`opened()` checks season 1 is running and the faucet closes within the next 7 days. Then set `BOOST_EPOCH_ANCHOR_TS` on the API, engine and indexer to the season's `startTime` (`cast call $MINING_POOL_ADDRESS "seasons(uint256)" 1`, or let the services fall back to the indexed `SeasonStarted`) and restart them. The faucet closes by itself; on day 8 the Safe calls `Faucet.burnUnclaimed()` (announced in advance).

## 11. Smoke test with the agent kit (closes A14)

From a machine with two funded, allowlisted wallets:

```
API_URL=https://clawbada-api-production.up.railway.app bun run scripts/e2e/... (the kit's Sepolia mode — see scripts/e2e/README.md once it lands)
```

Until the kit has a Sepolia mode, the manual version: claim through `POST /api/faucet/claim-lobsters` + `claim-gold`, evolve three lobsters, create a team, `POST /api/game/combat/queue` from both wallets, deposit with `teamId + salt`, and watch the engine's reveal watcher land `revealTeams` inside the 60 s window on a real chain — that is the A14 check. Then play the battle over WebSocket and confirm `finalizeBattle` after the Low bracket's 5-minute review.

## Rollback

There is none and none is needed on the testnet: a bad deployment is abandoned and redeployed from step 3 (new addresses, new JSON, `sync-deploy` again, Railway variables again). Keep the old JSON for the record.
