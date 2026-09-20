# Admin Roles Runbook (C-05 / C-06)

Operational policy for the privileged roles in Clawbada's smart contracts. This runbook closes prior-audit items **C-05** (DEFAULT_ADMIN_ROLE god key — no renouncement, timelock, or multisig enforcement) and **C-06** (Configure.s.sol grants admin roles to deployer without timelock) as policy rather than contract changes.

The contracts are intentionally non-upgradeable. The only governance lever is the AccessControl role grants. This document defines who must hold each role on mainnet, how grants are made, and the expected response SLAs.

## TL;DR

| Role | Holder type (mainnet) | Rotation cadence | Critical action SLA |
|------|----------------------|------------------|---------------------|
| `DEFAULT_ADMIN_ROLE` (every contract) | **Multisig** (3-of-5 minimum) | Immutable; rotate signers | Dispute resolution: 24h |
| `SEASON_ADMIN_ROLE` (MiningPool) | **Multisig** | Immutable | Mid-season action: explicit proposal + delay |
| `BOOST_ADMIN_ROLE` (MiningPool) | **Hot service wallet** | Quarterly + on suspicion | Weekly boost post: before the 10-day epoch TTL lapses |
| `RESOLVER_ROLE` (BattleArena) | **Hot service wallet** | Quarterly + on suspicion | Settle: <60s |
| `MATCHMAKER_ROLE` (BattleArena) | **Hot service wallet** | Quarterly + on suspicion | Match: <60s |
| `OPERATOR_ROLE` (BattleVRF) | **Hot relayer wallet** | Quarterly | Beacon push: per drand round |
| `ELIGIBILITY_ROLE` (Faucet) | **Hot service wallet** | Faucet lifetime only | Claim eligibility: <5s |
| `MINTER_ROLE` (ClawToken) | **MiningPool only** (persistent) | Never | n/a |
| `MINTER_ROLE` / `BURNER_ROLE` / `EVOLVER_ROLE` / `DAMAGE_ROLE` / `LOCKER_ROLE` / `BREED_ROLE` (LobsterNFT) | **Game contracts only** (per Configure.s.sol) | Never | n/a |
| `ACTIVITY_ROLE` (TeamManager) | **MiningPool + BattleArena only** | Never | n/a |

## Why a multisig matters

Most attacks against well-audited contracts route through compromised privileged keys. The Phase 1–3 audit campaign identified several classes of damage that DEFAULT_ADMIN_ROLE compromise enables:

- **C-05 god key**: DEFAULT_ADMIN_ROLE on every contract can grant or revoke any role. Compromise on ClawToken = grant MINTER_ROLE to attacker = mint up to remaining cap. Compromise on BattleArena = adminResolveDispute attacker-favorable. Compromise on TeamManager = unlock any team.
- **M-02 SEASON_ADMIN drain**: setBaseReward(remaining_budget) consumes the season pool in one expedition.
- **F-01/F-02 faucet sybil**: ELIGIBILITY_ROLE can mark arbitrary wallets eligible. Sybil farm = drain the 70M faucet pre-mint.
- **Resolver compromise post-H-01**: 5-min challenge window mitigates blast radius (player veto), but admin tiebreaker is still required for disputed battles.

A 3-of-5 multisig with documented signers eliminates all single-key compromise paths above.

## DEFAULT_ADMIN_ROLE policy

### Required holder (mainnet)

A 3-of-5 (or stricter) multisig contract on Base. Recommended: Safe (formerly Gnosis Safe) deployed on Base mainnet, with signers across distinct hardware wallets and geographic locations.

### Grants this role
Granted at deploy via `Configure.s.sol` to the deployer EOA.

**Before mainnet launch, run the handoff (step 3, after Deploy + Configure).** It performs the COMPLETE deployer→governance migration in a scripted, asserted sequence — do NOT hand-roll the AccessControl grant/revoke loop, which historically left three authorities behind (ROLE-M1/M2/M3).

The handoff is **two phases with a proof of control between them** (audit 2026-09 D-11). The contracts are not upgradeable and `DEFAULT_ADMIN_ROLE` is the admin of every role, so handing it to an address nobody controls — a typo, or a Safe address copied from another chain where it has no code — is permanent: disputed battles could never be resolved, no season after the first could start, no hot key could ever be rotated. The deployer therefore gives nothing up until the Safe has proved, on this chain, that it can sign.

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
```

**The handoff is complete only when the last command passes.** Until then the deployer still governs; do not announce otherwise, and do not open the game to the public between phase 1 and the final check (in that window the deploy key still owns Treasury and could redirect or overwrite the pending transfer — D-24; `finalize()` detects that and refuses). Afterwards, retire `DEPLOYER_PRIVATE_KEY`.

What each phase does:
1. **Phase 1 (`run()`)** — refuses to start unless Configure finished (D-23). Grants `SEASON_ADMIN_ROLE` (MiningPool) and `DEFAULT_ADMIN_ROLE` on all 7 AccessControl contracts to the Safe; moves `ELIGIBILITY_ROLE` (Faucet) to the operational service wallet; proposes **Treasury ownership** via `Ownable2Step.transferOwnership(safe)`. `SEASON_ADMIN` and `ELIGIBILITY` are NOT `DEFAULT_ADMIN_ROLE` and are not moved by a DEFAULT_ADMIN grant loop. ⚠️ **Treasury is `Ownable2Step`, NOT AccessControl** — a grant/revoke loop is a no-op on it.
2. **The Safe calls `Treasury.acceptOwnership()`.** Only the Safe can, so this is the proof. It also completes the Treasury transfer.
3. **Phase 2 (`finalize()`)** — requires `Treasury.owner() == safe` and that the Safe already holds every governance role, then the deployer renounces `SEASON_ADMIN_ROLE` and `DEFAULT_ADMIN_ROLE` everywhere.

On mainnet both phases also require `GOVERNANCE_SAFE` to be a deployed Safe on this chain (`getThreshold()` / `getOwners()` answer) with a signer threshold of at least `MIN_SAFE_THRESHOLD` (default **3**, matching the 3-of-5 policy above; lowering it is an explicit choice, and 1 is never accepted).

**If phase 1 named the wrong address:** nothing is lost. `forge script contracts/script/Handoff.s.sol --rpc-url base --broadcast --sig "retract(address)" <wrong address>` strips it, then fix `GOVERNANCE_SAFE` and run phase 1 again. This is only possible before phase 2.

**Why the separate verify script:** `forge script --broadcast` is not atomic, and the asserts at the end of a broadcasting script run against forge's local *simulation*, not against what landed. The last transaction of `Configure.s.sol` is the one that takes ClawToken `MINTER_ROLE` back off the deploy key; if it is dropped, a raw env-var key can mint the entire unminted supply (~705M), and nothing in the broadcasting scripts would notice. `VerifyDeployment.s.sol` sends nothing, so everything it reads is real chain state. If `configured()` reports the lingering `MINTER_ROLE`, re-send with `forge script contracts/script/Configure.s.sol ... --resume`, or revoke it by hand from the deployer, before phase 1.

Regression-tested in `contracts/test/GovernanceHandoff.t.sol` (the library) and `contracts/test/DeployScripts.t.sol` (the real Deploy → Configure → Handoff scripts, end to end).

Post-launch verification — `VerifyDeployment.s.sol --sig "finalized()"` asserts all of this; anyone can re-run it, since it needs only public addresses:
- `hasRole(DEFAULT_ADMIN_ROLE, deployer) == false` **and `== true` for the Safe** on ClawToken, LobsterNFT, TeamManager, MiningPool, BattleArena, BattleVRF, Faucet.
- `MiningPool.hasRole(SEASON_ADMIN_ROLE, deployer) == false` (`true` for the Safe); `Faucet.hasRole(ELIGIBILITY_ROLE, deployer) == false` (`true` for the operator).
- **`ClawToken.hasRole(MINTER_ROLE, deployer) == false`** and `== true` for MiningPool.
- Every hot role (`MATCHMAKER`, `RESOLVER`, BattleVRF `OPERATOR`, `BOOST_ADMIN`) is held by its env address and **not** by the deployer; the LobsterNFT / TeamManager contract roles are held by the contracts listed below and not by the deployer. (Handoff leaves hot roles in place — they are service roles, not governance roles.)
- Treasury: `owner() == safe`, `pendingOwner() == address(0)`, `devWallet() == DEV_WALLET`, all 5 game contracts authorized.
- `currentSeason >= 1`; while the faucet is open, its balance plus `totalClawClaimed` covers the 70M pre-mint.

### Key separation (mainnet, enforced by `DeployHelpers._loadEnv`)

Every hot key — `MATCHMAKER_ADDRESS`, `RESOLVER_ADDRESS`, `VRF_OPERATOR_ADDRESS`, `BOOST_ADMIN_ADDRESS`, `ELIGIBILITY_OPERATOR` — must differ from the deployer and from every other hot key, and `GOVERNANCE_SAFE`, `TREASURY_RESERVE_ADDRESS` and `LP_RECIPIENT` must not be any of them (D-26). The blast-radius analysis in this runbook treats each key on its own; that only holds while one compromise yields one role. The server enforces the same: with `CHAIN_ENV=mainnet` the engine refuses to start unless `MATCHMAKER_PRIVATE_KEY`, `RESOLVER_PRIVATE_KEY` and `BOOST_ADMIN_PRIVATE_KEY` are each set and all different from one another and from `OPERATOR_PRIVATE_KEY` — the `OPERATOR_PRIVATE_KEY` fallback exists for testnet and local chains only.

`LP_RECIPIENT` (required on mainnet, must differ from the deployer) receives the 125M LP allocation at genesis, so the deploy key never holds 12.5% of supply at rest (D-24). Use the account that will seed the Uniswap V3 pool — a Safe, or a hardware wallet used for nothing else.

### Critical-action SLAs

| Action | SLA | Notes |
|--------|-----|-------|
| BattleArena `adminResolveDispute` | **24h from dispute event** | Disputed battles freeze stakes pending admin resolution. No emergency-cancel exists by design — H-01's veto guarantee depends on admin tiebreaker. |
| Treasury `setDevWallet` | **48h proposal + 24h delay** | Use a Safe transaction with comment + scheduling. Never single-step. |
| Treasury `setAuthorized` | **48h proposal** | Adding a new fee-emitting contract requires audit review. |
| Any `grantRole` post-deploy | **48h proposal** | New role grants are exception, not routine. |

If admin liveness lapses past 48h on a disputed battle, surface to community/governance: the trapped stakes become a public coordination problem.

## SEASON_ADMIN_ROLE policy

`MiningPool.setBaseReward(uint256)` lets the holder set the per-expedition reward to any value up to the remaining season budget. M-02 documented that a compromised holder can drain the entire remaining budget into one expedition.

### Required holder (mainnet)

Same multisig as DEFAULT_ADMIN_ROLE, OR a separate multisig with a tighter time-lock. The two roles can be co-located.

### Mid-season changes

Avoid `setBaseReward` calls outside the published season-rotation cadence. If reward tuning is required mid-season, post the proposal publicly 48h in advance. Players time their expeditions around expected reward; surprise changes erode trust.

The weekly battle-rank boost post (`setTeamBoosts` / `activateBoostEpoch`) is **not** a SEASON_ADMIN action and is exempt from this cadence: it is a routine, bounded server write under `BOOST_ADMIN_ROLE` (see below). The boost multiplies each team's own reward by at most 1.5× and is paid from the same season budget through the glide, so it can never move `baseReward` itself.

### Season rotation
`startSeason(totalEmission, baseReward)` is called once per season. The transition closes the previous season's budget; if `getSeasonUnspent()` is non-zero, the leftover is implicitly retired (not rolled forward). Document the rationale for the chosen `totalEmission` in the season-rotation Safe transaction.

## RESOLVER_ROLE / MATCHMAKER_ROLE policy

Both are **hot service wallets** (server-side keys for the off-chain combat engine and matchmaker). Compromise blast radius:

- **MATCHMAKER**: create any battle — any two addresses, any of the three stakes, any (truthful) Powers. It cannot deposit on a user's behalf, but consent on-chain is a bare `deposit(battleId)`: the player never states the stake, opponent or opponent Power they agreed to (D-08). Off-chain containment: the API only builds deposit calldata for a battle that IS the match it made for the caller (same players, the stake of the bracket they queued for, the recorded Powers), never surfaces a battle it did not make as "your match", and labels such a battle with its real bracket. **An agent that builds its own transactions has none of this protection** — the agent guide tells it to check. Binding consent in the contract (`deposit(battleId, expectedStake, maxOpponentPower)`) is an open design item.
- **RESOLVER post-H-01**: propose any winner / damage. Players have a veto via `disputeBattle` for the length of the dispute window (5 min Low / 30 min Mid / 1 h High); the admin decides disputed battles. **The veto only works if the player knows a result was proposed** — `settle()` is valid the moment teams are revealed, so a thief can propose while the real battle is still being played, and the Low window can run out before it ends (D-06). What the honest stack does about it:
  - the **API** pushes `settlement_alert` to both players of a battle it is still running (repeated every 20 s, and on reconnect), exposes `settlement.rogue` on `GET /combat/:battleId`, and serves `POST /combat/:battleId/dispute`; the web app shows a warning with a dispute button;
  - the **indexer** keeps the on-chain proposal in its own columns and never overwrites the server's record of the battle;
  - the **engine**'s settle job no longer treats "already past Active" as success without comparing the result, and the finalize watcher refuses to finalize a result that is not provably ours;
  - all three log **`rogue_settlement_proposal`** at error/fatal level. **Page on it.** Procedure: `docs/runbooks/battle-session.md`.
  Limits, stated plainly: `finalizeBattle` is permissionless, so refusing to finalize does not stop the thief finalizing; if no player disputes in time the payout is final. A bond-free admin/guardian freeze and a per-address dispute cap that cannot silence an honest player (D-05) are open design items.
- **RESOLVER and battle randomness (D-01)**: the resolver commits each battle's seed secret in `revealTeams` and discloses it in `settle`. It cannot choose the seed (the drand round it is mixed with does not exist yet at commit time), but it can decline to settle a battle whose seed it dislikes, which refunds both players at `ACTIVE_WINDOW`. `BATTLE_SEED_SECRET` is a second secret of the same class as this key: a leak lets the holder foresee every roll of live battles. Rotate it with the key.

### Rotation
Rotate quarterly or on any suspicion of compromise. Rotation procedure:

1. Generate new key in HSM or hardware wallet.
2. From the multisig (DEFAULT_ADMIN_ROLE on BattleArena), call `grantRole(ROLE, newAddress)`.
3. Update the off-chain service to use the new key.
4. From the multisig, call `revokeRole(ROLE, oldAddress)`.
5. Confirm on-chain via Etherscan / Base block explorer.

### Detection signals
Surface alerts on:
- Settlement proposed with damage arrays exceeding bounded ranges
- Settlements creating losers with damage < 20 (loser_damage by spec is 20-40 VRF)
- Battle creation rate exceeding sustained baseline by 5x
- Settlements where the `winner` address has not appeared in the matchmaker's recent queue

## BOOST_ADMIN_ROLE (MiningPool) policy

Posts the weekly battle-rank mining boost table (S1, locked 2026-09-02): the server ranks every team that played the qualification floor of battles on one ladder by rating, converts percentile to `boostBps` (+10% → +50%, cap `MAX_BOOST_BPS = 5,000`), and the holder writes it on-chain.

### What the holder does each week
1. `setTeamBoosts(nextEpoch, entries[])` in batches of at most `MAX_BOOST_BATCH = 200` rows `(teamId, bps, power)` — staged for `currentBoostEpoch + 1`, invisible to `startExpedition` until activated. (True since audit D-09: the table is keyed by epoch. Before that fix one slot per team was shared, so staging silently zeroed every re-posted team's live boost until activation.) Check a staged table with `getTeamBoostAt(nextEpoch, teamId)` before activating; `getTeamBoost(teamId)` reads the live epoch.
2. `activateBoostEpoch(nextEpoch)` — one tx flips the whole table. Any team not re-posted drops to 0 automatically (the lapse rule needs no clearing writes).
3. Corrections during the live epoch (e.g. after a dispute resolution changes a result) use `setTeamBoosts(currentEpoch, …)` — amending the live table is allowed, activating it twice is not.

### Required holder (mainnet)
A **hot service wallet** — the same class as `MATCHMAKER_ROLE` / `RESOLVER_ROLE`, never the governance Safe. `Configure.s.sol` grants it to `BOOST_ADMIN_ADDRESS` (required and must differ from the deployer on mainnet; falls back to the deployer on testnet). `Handoff.s.sol` does **not** touch it: a weekly post from a multisig would miss the cadence.

### Compromise blast radius
Bounded by construction:
- Every entry is capped at +50% of that team's own reward and stamped with the team's Power; a team whose Power changed earns nothing from a stale entry.
- Total spend is bounded by the season budget: boosted expeditions are credited as extra demand in the daily glide, so an inflated table compresses `baseReward` for everyone rather than minting past the budget. `SeasonBudgetExhausted` and the 705M lifetime cap still bind on the boosted amount.
- The key cannot mint, cannot touch `baseReward`, stakes, or NFTs.
- **Fail-safe**: a live epoch pays only for `BOOST_EPOCH_TTL = 10 days` after activation. If the server (or the key) goes silent, every boost falls to 0 on its own.
- Every write is evented (`TeamBoostSet`, `BoostEpochActivated`) and the ladder is published off-chain, so a divergence is publicly checkable.

### Rotation
Same procedure as RESOLVER/MATCHMAKER (grant new → switch service → revoke old, from the multisig holding `DEFAULT_ADMIN_ROLE` on MiningPool).

### Detection signals
Surface alerts on:
- `TeamBoostSet` for a team with no settled battles in the earning epoch, or with `bps` that does not match the published ladder row
- A live epoch amended more than a handful of times, or amended for teams outside the published dispute list
- No `BoostEpochActivated` for > 8 days (the server's own overdue alarm fires here; the on-chain TTL is 10 days)
- Boosted `ExpeditionStarted` events (`boostBps > 0`) from a team absent from the ladder

## OPERATOR_ROLE (BattleVRF) policy

Currently dead code in the post-H-01 settle path (drand integration is forward-compat for S2+). Document the operator key the same way as RESOLVER even though no live consumer exists, so the migration to trustless settle in S2 doesn't require a separate runbook.

S1 trust assumption: operator submits drand beacons honestly; on-chain BLS verification is S2+.

## ELIGIBILITY_ROLE (Faucet) policy

Lifetime: 6 days 23 hours after launch (per `closeTime`), then permanently mute (no on-chain eligibility checks possible after closure). During the active window the holder marks wallets eligible via off-chain verification (wallet age ≥ 7 days, ≥ 3 prior tx history before the 7-day mark, ≥ 0.001 ETH balance).

### Compromise blast radius
A compromised key can mark arbitrary wallets eligible. Each eligible wallet can claim 5 soulbound lobsters + 7,000 CLAW. Worst case, both hard-bounded on-chain: the 70M CLAW pre-mint drained, and `MAX_FAUCET_LOBSTERS` = 50,000 lobsters minted (10,000 wallets × 5 — the population the drip is sized for).

The lobster bound matters more than it looks (audit D-02): a faucet lobster mines the 705M pool with no stake, the daily glide splits a fixed budget across demand, and minted lobsters outlive a key rotation — there is no pause and no miner blacklist. Before the cap the key could mint an unlimited sybil mining fleet; with it the worst case is the sybil taking the whole faucet population's share, which is what the faucet was always allowed to hand out.

### Defenses
- The faucet's pre-mint is exactly 70M (one-shot) and faucet lobsters are capped at 50,000 for the contract's lifetime (`FaucetLobsterCapReached`). Drain past either is impossible.
- Alert on the `EligibilitySet` rate: 500 wallets per transaction means a stolen key can use the whole cap in 20 transactions. Rotate on the first unexplained batch.
- Soulbound lobsters cannot be consolidated to a single wallet for resale, blunting the economic value of a sybil farm.
- **Faucet lobsters cannot be ground (D-10).** A claim is two-step: `claimLobsters` commits it (flag set, cap counted), and the five lobsters are rolled from `blockhash(request block + 2)` by the permissionless `finalizeClaim`. Before this, every input to the roll was known to the claimer before signing, so any wallet could compute its lobsters for upcoming blocks and claim in a good one, and an account with code (a smart wallet, or an EOA delegated under EIP-7702) could revert on a bad roll for free. The old mitigation — "only whitelist EOAs" — never worked: smart wallets are legitimate users. The engine's `FaucetFinalizeWatcher` finalizes every claim a couple of blocks after it is made (`FAUCET_FINALIZE_POLL_MS`, default 4 s). If it is down nothing is lost: an expired claim is re-armed to a new block (`rearmClaim`), and a wallet can finish its own claim through `POST /api/faucet/finalize-lobsters`. Residual, stated plainly: a contract claimer can still veto the mint in its receiver hook, but that keeps it on the same block hash until the hash ages out (256 blocks, or about 4.5 h where the EIP-2935 history contract exists) — hours per attempt instead of nothing per block.
- F-01/F-02 (already documented): operational items for off-chain eligibility scoring (wallet age + tx history + behavioral signals). Production deploys should add an oracle hook (Gitcoin Passport or equivalent) for stronger sybil resistance.

## MINTER_ROLE / NFT-side roles policy

| Role | Granted to | Why |
|------|-----------|-----|
| ClawToken `MINTER_ROLE` | MiningPool **only** (persistent) | Mining emission. The faucet's 70M pre-mint uses an ephemeral grant-mint-revoke pattern in `Configure.s.sol`. |
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

This sequence closes C-06 (deployer-as-admin without timelock) at deploy time.

## Incident response

If you suspect a privileged key is compromised:

1. **Hot service keys (RESOLVER/MATCHMAKER/OPERATOR/ELIGIBILITY/BOOST_ADMIN)**: rotate immediately via the multisig. No paging required — bounded blast radius. For BOOST_ADMIN, also re-post the current epoch's table from the new key if the compromised key amended it.
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
