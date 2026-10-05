# Admin Roles Runbook (C-05 / C-06)

Operational policy for the privileged roles in Clawbada's smart contracts. This runbook closes prior-audit items **C-05** (DEFAULT_ADMIN_ROLE god key — no renouncement, timelock, or multisig enforcement) and **C-06** (Configure.s.sol grants admin roles to deployer without timelock) as policy rather than contract changes.

The contracts are intentionally non-upgradeable. The only governance lever is the AccessControl role grants. This document defines who must hold each role on mainnet, how grants are made, and the expected response SLAs.

## TL;DR

| Role | Holder type (mainnet) | Rotation cadence | Critical action SLA |
|------|----------------------|------------------|---------------------|
| `DEFAULT_ADMIN_ROLE` (every contract) | **Multisig** (3-of-5 minimum) | Immutable; rotate signers | `resolveFrozen`: within 72 h of the freeze (target 24 h). Tuning (`proposeReviewWindow` / `enactReviewWindow`, D-E `proposeStakeFixedBps` / `enactStakeFixedBps`): 24 h timelock, announce before proposing |
| `SEASON_ADMIN_ROLE` (MiningPool) | **Multisig** | Immutable | Mid-season action: explicit proposal + delay |
| `BOOST_ADMIN_ROLE` (MiningPool) | **Hot service wallet** | Quarterly + on suspicion | Weekly boost post: before the 10-day epoch TTL lapses |
| `RESOLVER_ROLE` (BattleArena) | **Hot service wallet** | Quarterly + on suspicion | Settle: <60s |
| `GUARDIAN_ROLE` (BattleArena) | **Hot service wallet** (the engine watchdog) | Quarterly + on suspicion | Freeze: inside the review window (5 min / 30 min / 1 h) |
| `MATCHMAKER_ROLE` (BattleArena) | **Hot service wallet** | Quarterly + on suspicion | Match: <60s |
| `OPERATOR_ROLE` (BattleVRF) | **Hot relayer wallet** | Quarterly | Beacon push: per drand round |
| `ELIGIBILITY_ROLE` (Faucet) | **Hot service wallet** | Faucet lifetime only | Claim eligibility: <5s |
| `MINTER_ROLE` (GoldToken) | **MiningPool only** (persistent) | Never | n/a |
| `MINTER_ROLE` / `BURNER_ROLE` / `EVOLVER_ROLE` / `DAMAGE_ROLE` / `LOCKER_ROLE` / `BREED_ROLE` (LobsterNFT) | **Game contracts only** (per Configure.s.sol) | Never | n/a |
| `ACTIVITY_ROLE` (TeamManager) | **MiningPool + BattleArena only** | Never | n/a |

## Why a multisig matters

Most attacks against well-audited contracts route through compromised privileged keys. The Phase 1–3 audit campaign identified several classes of damage that DEFAULT_ADMIN_ROLE compromise enables:

- **C-05 god key**: DEFAULT_ADMIN_ROLE on every contract can grant or revoke any role. Compromise on GoldToken = grant MINTER_ROLE to attacker = mint up to remaining cap. Compromise on BattleArena = `resolveFrozen` attacker-favorable on any frozen battle, `withdrawReserve` drains the refund reserve. Compromise on TeamManager = unlock any team.
- **M-02 SEASON_ADMIN drain**: setBaseReward(remaining_budget) consumes the season pool in one expedition.
- **F-01/F-02 faucet sybil**: ELIGIBILITY_ROLE can mark arbitrary wallets eligible. Sybil farm = drain the 70M faucet pre-mint.
- **Resolver compromise**: the review window and the guardian's freeze contain it, but only the Safe can decide a frozen battle (`resolveFrozen`).

A 3-of-5 multisig with documented signers eliminates all single-key compromise paths above.

## DEFAULT_ADMIN_ROLE policy

### Required holder (mainnet)

A 3-of-5 (or stricter) multisig contract on Base. Recommended: Safe (formerly Gnosis Safe) deployed on Base mainnet, with signers across distinct hardware wallets and geographic locations.

### Grants this role
Granted at deploy via `Configure.s.sol` to the deployer EOA.

**Before mainnet launch, run the handoff (step 3, after Deploy + Configure).** It performs the COMPLETE deployer→governance migration in a scripted, asserted sequence — do NOT hand-roll the AccessControl grant/revoke loop, which historically left three authorities behind (ROLE-M1/M2/M3).

The handoff is **two phases with a proof of control between them** (audit 2026-09 D-11). The contracts are not upgradeable and `DEFAULT_ADMIN_ROLE` is the admin of every role, so handing it to an address nobody controls — a typo, or a Safe address copied from another chain where it has no code — is permanent: frozen battles could never be decided by the Safe (only the 72 h `expireFrozen` would remain), no season after the first could start, no hot key could ever be rotated. The deployer therefore gives nothing up until the Safe has proved, on this chain, that it can sign.

```
export GOVERNANCE_SAFE=<safe> ELIGIBILITY_OPERATOR=<service wallet>   # plus the deploy-time address vars

# 0. Configure really finished (reads the chain; no --broadcast, no private key)
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "configured()"

# 1. Phase 1 — the deployer GRANTS; it keeps its own roles
forge script contracts/script/Handoff.s.sol --rpc-url base --broadcast
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "proposed()"

# 2. Proof of control — a Safe transaction: Treasury.acceptOwnership()

# 3. Phase 2 — refuses to run without step 2; the deployer renounces everything
forge script contracts/script/Handoff.s.sol --rpc-url base --broadcast --sig "finalize()"
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "finalized()"

# 4. Refund reserve — Safe transactions from the treasury allocation (see "Refund reserve" below):
#    GoldToken.approve(BattleArena, 2_000_000e18); BattleArena.fundReserve(2_000_000e18)
forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "reserveFunded()"
```

**The handoff is complete only when `finalized()` passes; the launch is ready only when `reserveFunded()` passes too** (the default `VerifyDeployment.s.sol` entry point, `run()`, checks both). Until then the deployer still governs; do not announce otherwise, and do not open the game to the public between phase 1 and the final check (in that window the deploy key still owns Treasury and could redirect or overwrite the pending transfer — D-24; `finalize()` detects that and refuses). Afterwards, retire `DEPLOYER_PRIVATE_KEY`.

What each phase does:
1. **Phase 1 (`run()`)** — refuses to start unless Configure finished (D-23). Grants `SEASON_ADMIN_ROLE` (MiningPool) and `DEFAULT_ADMIN_ROLE` on all 7 AccessControl contracts to the Safe; moves `ELIGIBILITY_ROLE` (Faucet) to the operational service wallet; proposes **Treasury ownership** via `Ownable2Step.transferOwnership(safe)`. `SEASON_ADMIN` and `ELIGIBILITY` are NOT `DEFAULT_ADMIN_ROLE` and are not moved by a DEFAULT_ADMIN grant loop. ⚠️ **Treasury is `Ownable2Step`, NOT AccessControl** — a grant/revoke loop is a no-op on it.
2. **The Safe calls `Treasury.acceptOwnership()`.** Only the Safe can, so this is the proof. It also completes the Treasury transfer.
3. **Phase 2 (`finalize()`)** — requires `Treasury.owner() == safe` and that the Safe already holds every governance role, then the deployer renounces `SEASON_ADMIN_ROLE` and `DEFAULT_ADMIN_ROLE` everywhere. Hot roles (`MATCHMAKER`, `RESOLVER`, `GUARDIAN`, `BOOST_ADMIN`, VRF `OPERATOR`) are not governance and are not touched: they stay with their own keys.

On mainnet both phases also require `GOVERNANCE_SAFE` to be a deployed Safe on this chain (`getThreshold()` / `getOwners()` answer) with a signer threshold of at least `MIN_SAFE_THRESHOLD` (default **3**, matching the 3-of-5 policy above; lowering it is an explicit choice, and 1 is never accepted).

**If phase 1 named the wrong address:** nothing is lost. `forge script contracts/script/Handoff.s.sol --rpc-url base --broadcast --sig "retract(address)" <wrong address>` strips it, then fix `GOVERNANCE_SAFE` and run phase 1 again. This is only possible before phase 2.

**Why the separate verify script:** `forge script --broadcast` is not atomic, and the asserts at the end of a broadcasting script run against forge's local *simulation*, not against what landed. The last transaction of `Configure.s.sol` is the one that takes GoldToken `MINTER_ROLE` back off the deploy key; if it is dropped, a raw env-var key can mint the entire unminted supply (~705M), and nothing in the broadcasting scripts would notice. `VerifyDeployment.s.sol` sends nothing, so everything it reads is real chain state. If `configured()` reports the lingering `MINTER_ROLE`, re-send with `forge script contracts/script/Configure.s.sol ... --resume`, or revoke it by hand from the deployer, before phase 1.

Regression-tested in `contracts/test/GovernanceHandoff.t.sol` (the library) and `contracts/test/DeployScripts.t.sol` (the real Deploy → Configure → Handoff scripts, end to end).

Post-launch verification — `VerifyDeployment.s.sol --sig "finalized()"` asserts all of this; anyone can re-run it, since it needs only public addresses:
- `hasRole(DEFAULT_ADMIN_ROLE, deployer) == false` **and `== true` for the Safe** on GoldToken, LobsterNFT, TeamManager, MiningPool, BattleArena, BattleVRF, Faucet.
- `MiningPool.hasRole(SEASON_ADMIN_ROLE, deployer) == false` (`true` for the Safe); `Faucet.hasRole(ELIGIBILITY_ROLE, deployer) == false` (`true` for the operator).
- **`GoldToken.hasRole(MINTER_ROLE, deployer) == false`** and `== true` for MiningPool.
- Every hot role (`MATCHMAKER`, `RESOLVER`, `GUARDIAN`, BattleVRF `OPERATOR`, `BOOST_ADMIN`) is held by its env address and **not** by the deployer — in particular the retired deploy key holds no `GUARDIAN_ROLE`, and the Safe holds `DEFAULT_ADMIN_ROLE` on BattleArena (it alone can `resolveFrozen`); the LobsterNFT / TeamManager contract roles are held by the contracts listed below and not by the deployer. (Handoff leaves hot roles in place — they are service roles, not governance roles.)
- Treasury: `owner() == safe`, `pendingOwner() == address(0)`, `devWallet() == DEV_WALLET`, all 5 game contracts authorized.
- `currentSeason >= 1`; while the faucet is open, its balance plus `totalGoldClaimed` covers the 70M pre-mint.
- `--sig "reserveFunded()"`: `BattleArena.refundReserve() >= 2,000,000 GOLD` (`REFUND_RESERVE_TARGET` in `DeployHelpers.s.sol`).

### Key separation (mainnet, enforced by `DeployHelpers._loadEnv`)

Every hot key — `MATCHMAKER_ADDRESS`, `RESOLVER_ADDRESS`, `VRF_OPERATOR_ADDRESS`, `BOOST_ADMIN_ADDRESS`, `GUARDIAN_ADDRESS`, `ELIGIBILITY_OPERATOR` — must differ from the deployer and from every other hot key, and `GOVERNANCE_SAFE`, `TREASURY_RESERVE_ADDRESS` and `LP_RECIPIENT` must not be any of them (D-26). The blast-radius analysis in this runbook treats each key on its own; that only holds while one compromise yields one role. The server enforces the same: with `CHAIN_ENV=mainnet` the engine refuses to start unless `MATCHMAKER_PRIVATE_KEY`, `RESOLVER_PRIVATE_KEY`, `BOOST_ADMIN_PRIVATE_KEY` and `GUARDIAN_PRIVATE_KEY` are each set and all different from one another and from `OPERATOR_PRIVATE_KEY` — the `OPERATOR_PRIVATE_KEY` fallback exists for testnet and local chains only.

`LP_RECIPIENT` (required on mainnet, must differ from the deployer) receives the 125M LP allocation at genesis, so the deploy key never holds 12.5% of supply at rest (D-24). Use the account that will seed the Uniswap V3 pool — a Safe, or a hardware wallet used for nothing else.

### Critical-action SLAs

| Action | SLA | Notes |
|--------|-----|-------|
| BattleArena `resolveFrozen` | **24h target, 72h hard limit from `BattleFrozen`** | Past `FREEZE_LONG_STOP` (72 h) anyone can `expireFrozen`: both players are refunded and 2 × stake is burned from the refund reserve. See "Frozen battles" below. |
| Treasury `setDevWallet` | **48h proposal + 24h delay** | Use a Safe transaction with comment + scheduling. Never single-step. |
| Treasury `setAuthorized` | **48h proposal** | Adding a new fee-emitting contract requires audit review. |
| Any `grantRole` post-deploy | **48h proposal** | New role grants are exception, not routine. |

If the Safe cannot reach quorum on a frozen battle, nothing is trapped: at 72 h `expireFrozen` refunds both players. Every expiry costs the reserve 2 × stake, so treat one as an incident and top the reserve back up.

## SEASON_ADMIN_ROLE policy

`MiningPool.setBaseReward(uint256)` lets the holder set the per-expedition reward to any value up to the remaining season budget. M-02 documented that a compromised holder can drain the entire remaining budget into one expedition.

### Required holder (mainnet)

Same multisig as DEFAULT_ADMIN_ROLE, OR a separate multisig with a tighter time-lock. The two roles can be co-located.

### Mid-season changes

Avoid `setBaseReward` calls outside the published season-rotation cadence. If reward tuning is required mid-season, post the proposal publicly 48h in advance. Players time their expeditions around expected reward; surprise changes erode trust. Since D-19 the glide re-pegs hourly, so an override only sets the point the glide moves from: a value above the launch reward snaps back to launch at the next hour's first touch, and any value is re-pegged ±30% an hour from there.

The weekly battle-rank boost post (`setTeamBoosts` / `activateBoostEpoch`) is **not** a SEASON_ADMIN action and is exempt from this cadence: it is a routine, bounded server write under `BOOST_ADMIN_ROLE` (see below). The boost multiplies each team's own reward by at most 1.5× and is paid from the same season budget through the glide, so it can never move `baseReward` itself.

### Season rotation
`startSeason(totalEmission, baseReward)` is called once per season. The transition closes the previous season's budget; if `getSeasonUnspent()` is non-zero, the leftover is implicitly retired (not rolled forward). Document the rationale for the chosen `totalEmission` in the season-rotation Safe transaction.

## RESOLVER_ROLE / MATCHMAKER_ROLE / GUARDIAN_ROLE policy

Both are **hot service wallets** (server-side keys for the off-chain combat engine and matchmaker). Compromise blast radius:

- **MATCHMAKER**: create any battle — any two addresses, any of the three stakes, any (truthful) Powers. It cannot deposit on a user's behalf, and consent is bound on-chain (D-08): `deposit(battleId, expectedStake, maxOpponentPower, commitHash)` reverts `ConsentMismatch` unless the battle's stake is the one the player states and the opponent's Power is within the player's limit.
- **RESOLVER**: propose any winner / damage / forfeiter. Damage is applied and both teams are released inside `settle()`; only the money waits, for the per-bracket review window (5 min Low / 30 min Mid / 1 h High). There are no player disputes (removed 2026-10-01). The containment is the **guardian**: the engine watchdog replays every settled battle from its turn log during the window and freezes any result it cannot reproduce. A result nobody freezes is paid by the permissionless `finalizeBattle` once the window closes. Wrong repair damage from a bad result is made whole off-chain by the treasury.
  - all services log **`rogue_settlement_proposal`** at error/fatal level when an on-chain result is not the server's own. **Page on it.** Procedure: `docs/runbooks/battle-session.md`.
- **GUARDIAN** (the engine watchdog, `GUARDIAN_PRIVATE_KEY` / `GUARDIAN_ADDRESS`): can do exactly one thing — `freeze(battleId)` a battle in review (`AwaitingFinalize`, before its `payoutDeadline`). It moves no money and cannot pick a winner. Blast radius of a stolen guardian key: it can freeze every result in review; each freeze then waits for the Safe (or the 72 h expiry, which refunds both players and burns 2 × stake from the refund reserve). Rotate on the first unexplained `BattleFrozen`. The guardian is the check on the resolver, so the two must never share a key (enforced by the deploy scripts and the engine on mainnet). The Safe can also freeze (it holds `DEFAULT_ADMIN_ROLE`).
- **RESOLVER and battle randomness (D-01)**: the resolver commits each battle's seed secret in `revealTeams` and discloses it in `settle`. It cannot choose the seed (the drand round it is mixed with does not exist yet at commit time), but it can decline to settle a battle whose seed it dislikes, which refunds both players at `ACTIVE_WINDOW`. `BATTLE_SEED_SECRET` is a second secret of the same class as this key: a leak lets the holder foresee every roll of live battles. Rotate it with the key.

### Rotation
Rotate quarterly or on any suspicion of compromise. Rotation procedure:

1. Generate new key in HSM or hardware wallet.
2. From the multisig (DEFAULT_ADMIN_ROLE on BattleArena), call `grantRole(ROLE, newAddress)`.
3. Update the off-chain service to use the new key.
4. From the multisig, call `revokeRole(ROLE, oldAddress)`.
5. Confirm on-chain via Etherscan / Base block explorer.

### Frozen battles (Safe procedure)

A `BattleFrozen(battleId, by)` event means the watchdog could not reproduce a result. The stakes and anti-grief deposits stay in escrow; the lobsters were already released at settle.

1. Replay the battle from its turn log (`docs/runbooks/battle-session.md`) and decide the correct result.
2. **Within 72 h of the freeze**, from the Safe: `BattleArena.resolveFrozen(battleId, winner, forfeiter, refundBoth)`.
   - Decided result: `winner` = the real winner, `forfeiter` = `address(0)`, or the loser if the battle really ended by resignation / three timeouts (their 5 % deposit is slashed). Pays exactly like `finalizeBattle`.
   - Cannot be decided (log missing, server bug): `refundBoth = true` — both players get stake + 5 % back, no fee.
3. If the Safe has not acted by `frozenAt + 72 h`, **anyone** may call `expireFrozen(battleId)`: both players get stake + 5 % back and 2 × stake is burned from the refund reserve (if the reserve is short, the held stakes are returned and nothing is burned). Top the reserve back up afterwards.

### Refund reserve

`BattleArena.refundReserve` pays `expireFrozen` refunds so the held stakes can be burned — a frozen battle governance ignores costs the protocol, not the players. Target: **2,000,000 GOLD** (`REFUND_RESERVE_TARGET`), funded **by the Safe from the treasury allocation right after the handoff**: `GoldToken.approve(BattleArena, 2_000_000e18)` then `BattleArena.fundReserve(2_000_000e18)` (anyone can fund; only `DEFAULT_ADMIN_ROLE` can `withdrawReserve`). Confirm with `VerifyDeployment.s.sol --sig "reserveFunded()"`. Off mainnet `Configure.s.sol` funds it from the deployer when the deployer holds the treasury allocation (the testnet fallback), so e2e runs with the same reserve. Re-check after every `FrozenExpired` with a non-zero burn.

### Detection signals
Surface alerts on:
- Any `BattleFrozen` (page the Safe signers), any `FrozenExpired`
- Settlement proposed with damage arrays exceeding bounded ranges
- Settlements creating losers with damage < 20 (loser_damage by spec is 20-40 VRF)
- Battle creation rate exceeding sustained baseline by 5x
- Settlements where the `winner` address has not appeared in the matchmaker's recent queue

## BOOST_ADMIN_ROLE (MiningPool) policy

Posts the weekly battle-rank mining boost table (S1, locked 2026-09-02): the server ranks every team that played the qualification floor of battles on one ladder by rating, converts percentile to `boostBps` (+10% → +50%, cap `MAX_BOOST_BPS = 5,000`), and the holder writes it on-chain.

### What the holder does each week
1. `setTeamBoosts(nextEpoch, entries[])` in batches of at most `MAX_BOOST_BATCH = 200` rows `(teamId, bps, power)` — staged for `currentBoostEpoch + 1`, invisible to `startExpedition` until activated. (True since audit D-09: the table is keyed by epoch. Before that fix one slot per team was shared, so staging silently zeroed every re-posted team's live boost until activation.) Check a staged table with `getTeamBoostAt(nextEpoch, teamId)` before activating; `getTeamBoost(teamId)` reads the live epoch.
2. `activateBoostEpoch(nextEpoch)` — one tx flips the whole table. Any team not re-posted drops to 0 automatically (the lapse rule needs no clearing writes).
3. Corrections during the live epoch (e.g. after `resolveFrozen` changes a result) use `setTeamBoosts(currentEpoch, …)` — amending the live table is allowed, activating it twice is not.

### Required holder (mainnet)
A **hot service wallet** — the same class as `MATCHMAKER_ROLE` / `RESOLVER_ROLE`, never the governance Safe. `Configure.s.sol` grants it to `BOOST_ADMIN_ADDRESS` (required and must differ from the deployer on mainnet; falls back to the deployer on testnet). `Handoff.s.sol` does **not** touch it: a weekly post from a multisig would miss the cadence.

### Compromise blast radius
Bounded by construction:
- Every entry is capped at +50% of that team's own reward and stamped with the team's Power; a team whose Power changed earns nothing from a stale entry.
- Total spend is bounded by the season budget: boosted expeditions are credited as extra demand in the hourly glide, so an inflated table compresses `baseReward` for everyone rather than minting past the budget. The D-19 spend ceiling bounds any single hour to twice its fair share of what is left, and `SeasonBudgetExhausted` and the 705M lifetime cap still bind on the boosted amount.
- The key cannot mint, cannot touch `baseReward`, stakes, or NFTs.
- **Fail-safe**: a live epoch pays only for `BOOST_EPOCH_TTL = 10 days` after activation. If the server (or the key) goes silent, every boost falls to 0 on its own.
- Every write is evented (`TeamBoostSet`, `BoostEpochActivated`) and the ladder is published off-chain, so a divergence is publicly checkable.

### Rotation
Same procedure as RESOLVER/MATCHMAKER (grant new → switch service → revoke old, from the multisig holding `DEFAULT_ADMIN_ROLE` on MiningPool).

### Detection signals
Surface alerts on:
- `TeamBoostSet` for a team with no settled battles in the earning epoch, or with `bps` that does not match the published ladder row
- A live epoch amended more than a handful of times, or amended for teams outside the published correction list
- No `BoostEpochActivated` for > 8 days (the server's own overdue alarm fires here; the on-chain TTL is 10 days)
- Boosted `ExpeditionStarted` events (`boostBps > 0`) from a team absent from the ladder

## OPERATOR_ROLE (BattleVRF) policy

Currently dead code in the post-H-01 settle path (drand integration is forward-compat for S2+). Document the operator key the same way as RESOLVER even though no live consumer exists, so the migration to trustless settle in S2 doesn't require a separate runbook.

S1 trust assumption: operator submits drand beacons honestly; on-chain BLS verification is S2+.

## ELIGIBILITY_ROLE (Faucet) policy

Lifetime: 6 days 23 hours after launch (per `closeTime`), then permanently mute (no on-chain eligibility checks possible after closure). During the active window the holder marks wallets eligible via off-chain verification (wallet age ≥ 7 days, ≥ 3 prior tx history before the 7-day mark, ≥ 0.001 ETH balance).

### Compromise blast radius
A compromised key can mark arbitrary wallets eligible. Each eligible wallet can claim 5 soulbound lobsters + 7,000 GOLD. Worst case, both hard-bounded on-chain: the 70M GOLD pre-mint drained, and `MAX_FAUCET_LOBSTERS` = 50,000 lobsters minted (10,000 wallets × 5 — the population the drip is sized for).

The lobster bound matters more than it looks (audit D-02): a faucet lobster mines the 705M pool with no stake, the hourly glide splits a fixed budget across demand, and minted lobsters outlive a key rotation — there is no pause and no miner blacklist. Before the cap the key could mint an unlimited sybil mining fleet; with it the worst case is the sybil taking the whole faucet population's share, which is what the faucet was always allowed to hand out.

### Defenses
- The faucet's pre-mint is exactly 70M (one-shot) and faucet lobsters are capped at 50,000 for the contract's lifetime (`FaucetLobsterCapReached`). Drain past either is impossible.
- Alert on the `EligibilitySet` rate: 500 wallets per transaction means a stolen key can use the whole cap in 20 transactions. Rotate on the first unexplained batch.
- Soulbound lobsters cannot be consolidated to a single wallet for resale, blunting the economic value of a sybil farm.
- **Faucet lobsters cannot be ground (D-10).** A claim is two-step: `claimLobsters` commits it (flag set, cap counted), and the five lobsters are rolled from `blockhash(request block + 2)` by the permissionless `finalizeClaim`. Before this, every input to the roll was known to the claimer before signing, so any wallet could compute its lobsters for upcoming blocks and claim in a good one, and an account with code (a smart wallet, or an EOA delegated under EIP-7702) could revert on a bad roll for free. The old mitigation — "only whitelist EOAs" — never worked: smart wallets are legitimate users. The engine's `FaucetFinalizeWatcher` finalizes every claim a couple of blocks after it is made (`FAUCET_FINALIZE_POLL_MS`, default 4 s). If it is down nothing is lost: an expired claim is re-armed to a new block (`rearmClaim`), and a wallet can finish its own claim through `POST /api/faucet/finalize-lobsters`. Residual, stated plainly: a contract claimer can still veto the mint in its receiver hook, but that keeps it on the same block hash until the hash ages out (256 blocks, or about 4.5 h where the EIP-2935 history contract exists) — hours per attempt instead of nothing per block.
- F-01/F-02 (already documented): operational items for off-chain eligibility scoring (wallet age + tx history + behavioral signals). Production deploys should add an oracle hook (Gitcoin Passport or equivalent) for stronger sybil resistance.

## MINTER_ROLE / NFT-side roles policy

| Role | Granted to | Why |
|------|-----------|-----|
| GoldToken `MINTER_ROLE` | MiningPool **only** (persistent) | Mining emission. The faucet's 70M pre-mint uses an ephemeral grant-mint-revoke pattern in `Configure.s.sol`. |
| LobsterNFT `MINTER_ROLE` | Faucet, BreedingLab | Faucet onboarding + breed offspring |
| LobsterNFT `BURNER_ROLE` | EvolutionLab | Burn 2 fuel lobsters per evolution |
| LobsterNFT `EVOLVER_ROLE` | EvolutionLab | Set evolution tier |
| LobsterNFT `DAMAGE_ROLE` | BattleArena, RepairShop | Apply battle damage / repair |
| LobsterNFT `LOCKER_ROLE` | TeamManager | Lock lobsters in teams |
| LobsterNFT `BREED_ROLE` | BreedingLab | Update breed counter |
| TeamManager `ACTIVITY_ROLE` | MiningPool, BattleArena | Mark team active for the duration of expeditions / battles |

**Never grant any of these post-deploy except via a documented contract-upgrade rotation** (e.g., redeploying RepairShop and migrating its DAMAGE_ROLE). The L-01 / M-01 / TM-01 fixes already mitigate role-compromise scenarios for the existing holders, but expanding the holder set requires fresh adversarial review.

## Configure.s.sol — deployer ephemeral role

`Configure.s.sol` runs as the deployer EOA and grants/revokes roles in sequence. The deployer holds DEFAULT_ADMIN_ROLE only during deploy. Mainnet launch sequence:

1. Run `Deploy.s.sol`, then `Configure.s.sol`, with the deployer as admin → all roles granted to the right contracts.
2. `VerifyDeployment.s.sol --sig "configured()"` against the chain, and check the addresses on the Base block explorer.
3. **Handoff phase 1** — the deployer grants `DEFAULT_ADMIN_ROLE` on every contract (and `SEASON_ADMIN_ROLE`) to the production multisig and proposes the Treasury transfer. See "Grants this role" above.
4. **The multisig calls `Treasury.acceptOwnership()`** — the proof that it can sign on this chain.
5. **Handoff phase 2** — the deployer renounces `DEFAULT_ADMIN_ROLE` on every contract. It cannot run before step 4.
6. `VerifyDeployment.s.sol --sig "finalized()"`, then log the multisig address publicly so anyone can verify governance (the verify script needs only public addresses).
7. **The multisig funds the refund reserve** (2M GOLD: `approve` + `BattleArena.fundReserve`), then `VerifyDeployment.s.sol --sig "reserveFunded()"`. Open the game only after this passes.

This sequence closes C-06 (deployer-as-admin without timelock) at deploy time.

## Incident response

**Never `Treasury.setAuthorized(BattleArena, false)` while battles are live.** Every decided payout routes its fee through the Treasury; once a result's review window has closed it can no longer be frozen, so de-authorising the arena strands those battles in review until it is re-authorised (review 2026-10-03 L1). `VerifyDeployment configured()` / `finalized()` assert the authorisation.

If you suspect a privileged key is compromised:

1. **Hot service keys (RESOLVER/MATCHMAKER/GUARDIAN/OPERATOR/ELIGIBILITY/BOOST_ADMIN)**: rotate immediately via the multisig. For GUARDIAN, also review every battle it froze and `resolveFrozen` the honest ones before the 72 h expiry. No paging required — bounded blast radius. For BOOST_ADMIN, also re-post the current epoch's table from the new key if the compromised key amended it.
2. **Multisig signer compromise**: signer remediation via the remaining quorum. Replace the compromised signer's key on the Safe before any further admin actions are queued.
3. **Multisig contract compromise** (full takeover): there is no on-chain emergency exit. Contracts are not upgradeable. Coordinate publicly: announce, halt off-chain services, document the affected contracts. The token cap, the season budget caps, and the soulbound flags all bound the worst case.

## Audit-trail discipline

- Every multisig transaction includes a comment with the proposal ID, audit reference (campaign + finding), and rationale.
- Role-grant transactions include the target contract's address and the grantee's role description.
- Every transaction is logged on-chain via AccessControl's `RoleGranted` / `RoleRevoked` events; cross-link to the Safe transaction in the comment.

---

**References**:
- `docs/audits/2026-03-06-manual-contract-audit.md` — original C-05 / C-06 definitions
- `docs/audits/2026-04-15-adversarial-campaign.md` — Phase 3 trust-boundary lens, C-05 dependency table
- `contracts/script/Configure.s.sol` — full role-grant matrix at deploy time
- `docs/audits/2026-09-03-boost-surface.md` — battle-rank boost surface: trust assumptions, invariants, Slither baseline
