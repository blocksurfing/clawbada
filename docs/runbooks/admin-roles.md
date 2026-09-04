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

**Before mainnet launch, run `Handoff.s.sol` (step 3, after Deploy + Configure).** It performs the COMPLETE deployer→governance migration in one scripted, asserted sequence — do NOT hand-roll the AccessControl grant/revoke loop, which historically left three authorities behind (ROLE-M1/M2/M3):

```
GOVERNANCE_SAFE=<safe> ELIGIBILITY_OPERATOR=<service wallet> \
  forge script contracts/script/Handoff.s.sol --rpc-url base --broadcast
```

`Handoff.s.sol` migrates, in order:
1. `SEASON_ADMIN_ROLE` (MiningPool) and `ELIGIBILITY_ROLE` (Faucet) off the deployer — **these are NOT `DEFAULT_ADMIN_ROLE` and are not moved by a DEFAULT_ADMIN grant loop.** SEASON_ADMIN → the Safe; ELIGIBILITY → the operational service wallet.
2. `DEFAULT_ADMIN_ROLE` on all 7 AccessControl contracts → the Safe, then revokes the deployer (grant-before-revoke, so admin control is never lost mid-sequence).
3. **Treasury ownership** via `Ownable2Step.transferOwnership(safe)`. ⚠️ **Treasury is `Ownable2Step`, NOT AccessControl** — the grant/revoke loop is a no-op on it. The script proposes the transfer; **the Safe MUST then call `Treasury.acceptOwnership()`** to complete it. Until it does, the deployer retains Treasury ownership (so a mistyped Safe can never strand fee routing).

The script asserts the deployer holds **none** of the migrated roles afterward and that `Treasury.pendingOwner() == safe` (ROLE-I1: no silent gaps). Regression-tested in `contracts/test/GovernanceHandoff.t.sol`.

Post-launch verification checklist (run from the Safe / a read call):
- `hasRole(DEFAULT_ADMIN_ROLE, deployer) == false` on ClawToken, LobsterNFT, TeamManager, MiningPool, BattleArena, BattleVRF, Faucet.
- `MiningPool.hasRole(SEASON_ADMIN_ROLE, deployer) == false`; `Faucet.hasRole(ELIGIBILITY_ROLE, deployer) == false`.
- `MiningPool.hasRole(BOOST_ADMIN_ROLE, deployer) == false` and `== true` for `BOOST_ADMIN_ADDRESS` (granted by `Configure.s.sol`; Handoff leaves it in place — it is a service role, not a governance role).
- `Treasury.owner() == safe` (after `acceptOwnership()`); `Treasury.pendingOwner() == address(0)`.

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

- **MATCHMAKER**: spam-create battles. Bounded by gas; cannot deposit on user's behalf.
- **RESOLVER post-H-01**: propose any winner / damage. Players have 5-min veto via `disputeBattle`. Admin tiebreaks disputed battles.

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
1. `setTeamBoosts(nextEpoch, entries[])` in batches of at most `MAX_BOOST_BATCH = 200` rows `(teamId, bps, power)` — staged for `currentBoostEpoch + 1`, invisible to `startExpedition` until activated.
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
A compromised key can mark arbitrary wallets eligible. Each eligible wallet can claim 5 soulbound lobsters + 7,000 CLAW. Worst case: 70M CLAW pre-mint drained over the faucet's lifetime if no rate limit is added.

### Defenses
- The faucet's pre-mint is exactly 70M (one-shot). Drain past that is impossible.
- Soulbound lobsters cannot be consolidated to a single wallet for resale, blunting the economic value of a sybil farm.
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

1. Run `Configure.s.sol` with deployer as admin → all roles granted to the right contracts.
2. Verify on Base block explorer.
3. **Transfer DEFAULT_ADMIN_ROLE on every contract** to the production multisig.
4. **Revoke deployer** from DEFAULT_ADMIN_ROLE on every contract (called from the multisig, post-grant).
5. Log the multisig address publicly so anyone can verify governance.

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
