# Clawbada Manual Contract Audit

Date: 2026-03-06

Scope:
- `contracts/`
- Manual review focused on loss-of-funds and irreversible asset-state risks
- Pashov parallelized agent scan (DEEP mode: 4 vector-scan + 1 adversarial reasoning)
- Cyfrin solskill checklist
- Trail of Bits token-integration-analyzer (5-phase structured analysis)
- quillai-network audit skills (reentrancy, DoS/griefing, external-call-safety, input-arithmetic-safety, state-invariant-detection)
- Archethect Map-Hunt-Attack methodology (manual application)

Reviewed contracts:
- `BattleArena.sol`
- `BattleVRF.sol`
- `BreedingLab.sol`
- `ClawToken.sol`
- `EvolutionLab.sol`
- `Faucet.sol`
- `LobsterNFT.sol`
- `Marketplace.sol`
- `MiningPool.sol`
- `RepairShop.sol`
- `TeamManager.sol`
- `Treasury.sol`

## Current-State Severity Summary

| ID | Severity | Status | Contract | Title |
|----|----------|--------|----------|-------|
| **P-01** | **High** | **Fixed** | **MiningPool** | **Missing team.active check allows simultaneous battle+mining, potential fund lock** |
| H-01 | High | Partially mitigated | BattleArena | Battle settlement trusted resolver before verified moves |
| **S-01** | **High** | **Fixed** | **Faucet/ClawToken** | **Faucet CLAW minting competes with MiningPool for MAX_SUPPLY headroom** |
| **S-02** | **Medium** | **Fixed** | **BattleArena** | **No neutral resolver-independent unwind for Active battles** |
| **P-02** | **Medium** | **Fixed** | **BattleArena** | **Reveal-timeout griefing leaks opponent's move data for free counter-play** |
| **P-03** | **Medium** | **Fixed** | **BreedingLab** | **Deterministic breeding randomness enables legend sniping via smart contract** |
| **P-04** | **Medium** | **Fixed** | **BattleArena** | **Anti-grief timeout counter bypass via cooperate-every-other-round** |
| **S-03** | **Low** | **Fixed** | **BattleResolver** | **_cappedRatio division by zero if armor reaches 0 (library hardening)** |
| **S-04** | **Medium** | **Fixed** | **BreedingLab** | **Generation uint8 overflow at gen 255 gives opaque panic** |
| **S-05** | **Low** | **Fixed** | **LobsterNFT** | **burn() trusts BURNER_ROLE without caller-side ownership check (role-trust NatSpec)** |
| **P-05** | **Low** | **Fixed** | **BattleArena** | **uint8 overflow in _applyDamage can revert settlement** |
| M-02 | Medium | **Fixed** | MiningPool | Expedition claim could permanently lock teams on MAX_SUPPLY exhaustion |
| **S-06** | **Low** | **Fixed** | **BreedingLab** | **Breeding cost precision loss documented (negligible at 18 decimals)** |
| **S-07** | **Low** | **Fixed** | **Faucet** | **setEligibleBatch max batch size (500)** |
| L-01 | Low | **Fixed** (superseded by P-03) | BreedingLab | On-chain randomness for DNA/legend rolls |
| L-02 | Low | **Fixed** (superseded by P-02) | BattleArena | Active timeout wipes legitimate commits from non-timed-out player |
| **F-01** | **Medium** | **Fixed** | **BreedingLab/LobsterNFT** | **Expired breed requests permanently consume breed counts with no recovery** |
| **F-02** | **Low** | **Fixed** | **BattleArena** | **revealMoves permits early reveals before both commits — information leak** |
| **F-03** | **Low** | **Fixed** | **BattleArena** | **No on-chain max round enforcement in advanceRound** |
| L-04 | Low | **Fixed** (by F-06) | MiningPool | No expedition cancellation mechanism |
| **F-06** | **Low** | **Fixed** | **MiningPool** | **Admin expedition release for key-loss recovery** |
| L-05 | Low | Open | Faucet | Missing ReentrancyGuard on claim functions |
| C-04 | Low | Open | test/ | No invariant or stateful fuzz tests |
| C-05 | Low | Open | Multiple (7 contracts) | DEFAULT_ADMIN_ROLE is a god key — no renouncement/timelock/multisig |
| I-01 | Info | Open | Marketplace | Self-purchase allowed (wash trading) |
| I-02 | Info | Open | BattleArena | Redundant teamInBattle clear in settle |
| I-03 | Info | Open | Multiple | approve() should use forceApprove() |
| I-04 | Info | Open | Multiple | Bare transfer/transferFrom without SafeERC20 |
| I-05 | Info | Open | TeamManager | disbandTeam does not re-verify ownership |
| C-01 | Info | Open | All contracts | Missing @custom:security-contact NatSpec |
| C-02 | Info | Open | 7 contracts | Use ReentrancyGuardTransient for gas savings |
| C-03 | Info | Open | All contracts | Custom error names lack contract prefix |
| C-06 | Info | Open | Configure.s.sol | Deployment scripts grant admin roles without timelock |

## Findings

### H-01: Battle settlement trusted the resolver before any verified move transcript existed

Severity: High

Affected files:
- `contracts/BattleArena.sol`
- `contracts/BattleVRF.sol`
- `contracts/script/Configure.s.sol`

Status:
- Partially mitigated on 2026-03-06.

Summary:

**Original issue (pre-hardening):**
- Once both players revealed teams, `BattleArena` entered `Active` phase in `revealTeam()` and allowed `settle()` to execute even if no round had been fully committed and revealed on-chain.
- That let `RESOLVER_ROLE` redirect escrowed stake and assign arbitrary damage before any verified move transcript existed.
- The deployment script (`Configure.s.sol`) granted `MATCHMAKER_ROLE` and `RESOLVER_ROLE` directly to the deployer address.

**Current state (post-hardening):**
- The contract has been patched so `settle()` reverts unless at least one round has been fully revealed on-chain.
- `Configure.s.sol` now grants operational roles to dedicated addresses loaded from environment variables. On mainnet, these must differ from deployer and from each other (see Hardening section below).
- `BattleVRF` still exists but is not consumed by `BattleArena`, so there is still no on-chain randomness binding.
- `advanceRound()` remains resolver-controlled — the resolver still controls round progression and outcome determination after the first verified round.

Evidence:
- `revealTeam()` moves the battle into `Active` once both teams are revealed: `contracts/BattleArena.sol`
- The patched contract now tracks `lastVerifiedRound` and only makes settlement available after both move reveals for a round have been posted on-chain: `contracts/BattleArena.sol`
- `settle()` now reverts with `SettlementRequiresVerifiedRound` if no verified round exists: `contracts/BattleArena.sol`
- `advanceRound()` remains resolver-controlled, which means the resolver still controls round progression and final outcome after the first verified round: `contracts/BattleArena.sol`
- `BattleVRF` stores beacon values, but `BattleArena` never reads from it: `contracts/BattleVRF.sol:37-74`
- *(Pre-hardening)* The deployment script granted `MATCHMAKER_ROLE` and `RESOLVER_ROLE` directly to `deployer`: `contracts/script/Configure.s.sol:139-149`. This has been remediated — see Hardening section.

Impact:
- Before the patch, a compromised or malicious resolver could settle an active battle in favor of either player and route the loser's staked `CLAW` to the preferred winner before any verified gameplay occurred.
- That concrete early-settlement path is now blocked.
- Remaining risk: after at least one verified round exists, the resolver still supplies `winner` and damage arrays, so the battle system is still operator-trusted rather than trustless.

Exploit outline for the original issue:
1. Matchmaker creates a battle for two users.
2. Both users deposit stake plus anti-grief collateral.
3. Both users reveal valid teams, transitioning the battle to `Active`.
4. Before any meaningful move transcript is enforced on-chain, the resolver calls `settle()` with an arbitrary `winner` and arbitrary damage arrays.
5. The contract pays the winner from combined escrow and mutates lobster damage accordingly.

Mitigation applied:
- Added settlement gating so `settle()` cannot execute until at least one round has been fully revealed on-chain.
- Added regression tests proving early settlement now reverts and preserves escrow/damage state.

Remaining recommendation:
- If the battle system is intended to be trustless, move outcome verification on-chain:
  - bind settlement to the committed/revealed move transcript,
  - bind randomness to `BattleVRF`,
  - enforce round sequencing and terminal conditions before payout,
  - compute damage from verified state instead of accepting it as calldata.
- If the battle system is intentionally operator-trusted, make that trust assumption explicit in product and contract documentation, and do not market escrowed battles as trust-minimized.

### I-04: All IERC20 interactions use bare transfer/transferFrom — no SafeERC20

Severity: Informational (downgraded from Medium — token is project-owned OZ ERC20, not arbitrary)

Status: Open

Affected files:
- `contracts/Treasury.sol:92,99`
- `contracts/Marketplace.sol:128,137`
- `contracts/BreedingLab.sol:85`
- `contracts/EvolutionLab.sol:74`
- `contracts/RepairShop.sol:73`
- `contracts/BattleArena.sol:209,388,389,503,506,529,531`

Summary:
Every contract that moves $CLAW uses `IERC20.transfer()` / `IERC20.transferFrom()` without checking return values and without using OpenZeppelin's `SafeERC20` wrapper. OZ v5.5.0 provides `SafeERC20.safeTransfer()` and `safeTransferFrom()` specifically for this purpose.

While the concrete token (`ClawToken`) inherits OZ `ERC20` which always reverts on failure (making bare calls safe in practice), several contracts reference the token as `IERC20` rather than `ClawToken`. This means:
1. The compiler does not enforce that the token at that address is a reverting ERC20.
2. If the token address were ever pointed at a non-standard ERC20 (e.g., USDT-style that returns false instead of reverting), transfers would silently fail, leading to direct loss of funds.

The same contracts also use bare `approve()` — OZ recommends `forceApprove()` to handle tokens that require approval to be set to 0 before changing (not an issue with ClawToken, but a best-practice deviation).

Recommendation:
- Add `using SafeERC20 for IERC20;` to all contracts that interact with `clawToken`.
- Replace all `.transfer()` → `.safeTransfer()`, `.transferFrom()` → `.safeTransferFrom()`, `.approve()` → `.forceApprove()`.
- This is a minimal diff (~2 lines per contract) with meaningful defensive value.

---

### M-02: MiningPool expedition claim can permanently lock teams if ClawToken MAX_SUPPLY is reached

Severity: Medium

Status: **Fixed** on 2026-03-06

Affected files:
- `contracts/MiningPool.sol:166-167,208`
- `contracts/ClawToken.sol:44-48`

**Original issue (pre-fix):**
When `startExpedition()` was called, the reward was reserved against the season's local budget (`season.totalMinted += reward`) but the actual `clawToken.mint()` happened later in `claimExpedition()`. The season budget tracked only per-season allocation and did NOT verify against `ClawToken.MAX_SUPPLY`.

If the global `ClawToken.totalSupply()` reached `MAX_SUPPLY` (1B) before a claim was executed — due to concurrent mints from Faucet, other seasons, or other MINTER_ROLE holders — the `mint()` call would revert with `ExceedsMaxSupply`. This made the expedition permanently unclaimable, and since `claimExpedition` was the only code path that called `teamManager.setTeamActive(teamId, false)`, the team's 3 lobsters would remain locked forever.

Impact:
- Permanent asset lockup (3 lobsters stuck in a team that can never be released).
- Reserved budget consumed but tokens never minted — season budget wasted.

**Current state (post-fix):**
`startExpedition()` now mints the reward into MiningPool escrow (`clawToken.mint(address(this), reward)`) at expedition start. If `MAX_SUPPLY` headroom is insufficient, `startExpedition()` reverts immediately — the team never becomes active and no expedition is created. `claimExpedition()` now transfers the escrowed reward (`clawToken.transfer(msg.sender, expedition.reward)`) instead of minting. Once an expedition starts, its reward is guaranteed claimable regardless of later global supply changes.

4 regression tests added to `test/MiningPool.t.sol`:
- `test_startExpeditionRevertsWhenMaxSupplyInsufficient` — verifies clean revert with no stuck team state
- `test_claimSucceedsEvenWhenGlobalSupplyLaterExhausted` — verifies escrowed claim survives later supply exhaustion
- `test_startExpeditionEscrowsCorrectAmount` — verifies pool balance increases by reward on start
- `test_claimReducesPoolBalance` — verifies pool balance decreases by reward on claim

---

### L-04: MiningPool has no expedition cancellation mechanism

Severity: Low (downgraded from Medium — the primary failure path (M-02 supply exhaustion) has been fixed; remaining risk is limited to key-loss scenarios)

Status: **Fixed** (by F-06 — `adminReleaseExpedition()` added)

Affected files:
- `contracts/MiningPool.sol`

Summary:
There was no way to cancel an in-progress expedition. The only exit path was `claimExpedition()`, which requires the expedition duration to elapse. No admin override existed to release a team from a stuck expedition.

**Fix:** Added `adminReleaseExpedition()` gated to `DEFAULT_ADMIN_ROLE`, callable only after `EXPEDITION_DURATION + ADMIN_RELEASE_GRACE` (4h + 7 days). Releases the team, marks expedition claimed, and **burns** the escrowed reward (admin cannot extract funds). See F-06 for details.

---

### L-05: Faucet claim functions missing ReentrancyGuard

Severity: Low (downgraded from Medium — CEI is respected, no duplicate claim possible; callback can only reorder claimClaw earlier than intended, not extract extra tokens)

Status: Open

Affected files:
- `contracts/Faucet.sol:84-98,102-113`

Summary:
`Faucet` does not inherit `ReentrancyGuard`, and neither `claimLobsters()` nor `claimClaw()` has a `nonReentrant` modifier.

`claimLobsters()` mints 5 ERC-1155 tokens in a loop (line 94). Each `lobsterNFT.mint()` triggers `_mint()` → `_update()` → OZ's `_doSafeTransferAcceptanceCheck()`, which calls `onERC1155Received` on the recipient if it's a contract. This creates a reentrancy callback after each mint.

While CEI is respected (`hasClaimedLobsters[msg.sender] = true` at line 90, before mints), a reentrant call from the `onERC1155Received` callback could call `claimClaw()` mid-loop — `hasClaimedLobsters` is already true and `hasClaimedClaw` is still false, so the CLAW claim would succeed. This is functionally harmless (the user would have claimed both anyway), but it violates the intended ordering (lobsters first, CLAW second after all 5 mints) and means `totalLobstersClaimed` (updated at line 97, after the loop) would be stale during the CLAW claim.

More importantly, the absence of `ReentrancyGuard` on a contract that makes external calls to other contracts (which themselves make external calls) is a deviation from OZ best practices and leaves the door open for future issues if the contract is extended.

Recommendation:
- Add `ReentrancyGuard` to Faucet and apply `nonReentrant` to both claim functions.

---

### L-01: BreedingLab uses on-chain randomness (prevrandao + timestamp) for DNA generation and legend rolls

Severity: Low

Status: **Fixed** (superseded by P-03)

Affected files:
- `contracts/BreedingLab.sol`
- `contracts/Faucet.sol:127`

Summary:
Originally, offspring DNA, class inheritance, and legend rolls used `block.prevrandao` + `block.timestamp` as the randomness seed, which was manipulable by a colluding sequencer.

**Fix:** P-03 rewrote BreedingLab as a 2-step `requestBreed`/`finalizeBreed` flow using future-block `blockhash()` entropy (unknown at request time). Same-block randomness sniping is no longer possible. Faucet DNA still uses `prevrandao` but is explicitly acceptable (soulbound, non-transferable NFTs).

---

### L-02: BattleArena _handleActiveTimeout wipes legitimate commits from non-timed-out player

Severity: Low

Status: **Fixed** (superseded by P-02 — reveal withhold now causes immediate forfeit, so the round-state reset path for reveal timeouts is no longer reachable)

Affected files:
- `contracts/BattleArena.sol:614-621`

Summary:
When a timeout occurs during the Active phase and the forfeit threshold isn't reached, `_handleActiveTimeout` resets ALL round state (lines 616-620):
```solidity
b.roundCommitA = bytes32(0);
b.roundCommitB = bytes32(0);
b.roundRevealedA = false;
b.roundRevealedB = false;
```

This wipes any legitimate commit from the non-timed-out player, forcing them to re-submit (and pay gas again) on the next round attempt. A griefer could intentionally time out 2 rounds (staying below the 3-round forfeit threshold) to waste their opponent's gas, then play normally.

The economic impact is small (gas on Base is cheap), but it's a minor griefing vector.

Recommendation:
- Consider preserving the non-timed-out player's commit across the reset, or counting all timeouts (not just consecutive) toward forfeit.

---

### I-05: TeamManager disbandTeam does not re-verify lobster ownership

Severity: Informational (downgraded from Low — role-trust dependency, not a direct bug)

Status: Open

Affected files:
- `contracts/TeamManager.sol:101-129`

Summary:
`disbandTeam()` unlocks all 3 lobsters without verifying the caller still owns them. Normally this is safe because locked lobsters can't be transferred. However, if any `LOCKER_ROLE` holder (TeamManager is one, but BattleArena could potentially also unlock via `setTeamActive`) externally unlocks a lobster, it could be transferred to a new owner. Then when the original team owner calls `disbandTeam()`, the lobster gets unlocked for the new owner — but the new owner never locked it, so this is a no-op in practice. The main risk is stale `_lobsterToTeam` mappings causing confusion.

This is a role-trust issue — it requires a LOCKER_ROLE holder to behave incorrectly.

---

### I-01: Marketplace allows self-purchases (wash trading vector)

Severity: Informational

Affected files:
- `contracts/Marketplace.sol:113-143`

Summary:
`buyLobster()` does not check `msg.sender != listing.seller`. A seller can buy their own listing, paying the 2.5% fee to generate artificial trading volume. This is economically irrational (net loss of 2.5%) but could be used to manipulate perceived marketplace activity for social proof.

---

### I-02: BattleArena _releaseTeam redundantly clears teamInBattle

Severity: Informational

Affected files:
- `contracts/BattleArena.sol:374-375,489-492`

Summary:
In `settle()`, `teamInBattle[b.teamIdA] = false` and `teamInBattle[b.teamIdB] = false` are set at lines 374-375, then `_releaseTeam()` sets them to false again at line 490. Functionally harmless but wastes ~200 gas per settlement on redundant SSTOREs.

---

### I-03: Marketplace approve-processFee pattern is correct but could use forceApprove

Severity: Informational

Affected files:
- `contracts/Marketplace.sol:132`
- `contracts/BreedingLab.sol:88`
- `contracts/EvolutionLab.sol:77`
- `contracts/RepairShop.sol:76`
- `contracts/BattleArena.sol:384,524`

Summary:
Multiple contracts call `clawToken.approve(address(treasury), amount)` before `treasury.processFee(amount)`. Since `processFee` always consumes the full approved amount via `transferFrom`, no residual approval remains. However, OZ v5.5.0 recommends `forceApprove()` (from SafeERC20) over bare `approve()` to handle tokens that revert on non-zero-to-non-zero approval changes. Not a risk with ClawToken specifically, but a best-practice alignment opportunity when adopting SafeERC20 per M-01.

## Pashov Audit Skill Findings (Parallelized Agent Scan)

Scan mode: **DEEP** (4 vector-scan agents + adversarial reasoning agent, run in parallel)

Scope: 17 in-scope `.sol` files (12 contracts, 2 libraries, 3 deployment scripts). Each vector-scan agent analyzed the full codebase against ~40 attack vectors (160 total vectors scanned). The adversarial reasoning agent performed free-form exploitation analysis.

Findings are deduplicated across agents by root cause, keeping the highest-confidence version.

### P-01: MiningPool.startExpedition does not check team.active — simultaneous battle+mining with potential permanent fund lock

Severity: High

Confidence: [100] (found by 2 of 5 agents independently)

Status: **Fixed** (2026-03-07) — Added `TeamIsActive` error and `team.active` check before `_teamToExpedition` check. 2 regression tests added.

Affected files:
- `contracts/MiningPool.sol:147-192` (startExpedition)
- `contracts/BattleArena.sol` (settle → setTeamActive(false))
- `contracts/TeamManager.sol` (disbandTeam)

Summary:
`startExpedition()` checks `_teamToExpedition[teamId] != 0` to prevent double-mining but never checks `team.active`. A team currently in battle (`team.active = true`, set by BattleArena) can simultaneously start a mining expedition. This breaks the intended single-activity constraint and creates a compound exploit:

1. Team enters battle → `setTeamActive(teamId, true)`
2. Team starts expedition → succeeds (no `team.active` check)
3. Battle settles → `setTeamActive(teamId, false)` — team appears inactive despite ongoing expedition
4. Player calls `disbandTeam(teamId)` → succeeds because `team.active == false`
5. Team is deleted, lobsters unlocked
6. `claimExpedition()` → calls `teamManager.setTeamActive(teamId, false)` → reverts with `TeamDoesNotExist`
7. Minted reward tokens (already in MiningPool escrow) are permanently locked

Impact:
- Permanent $CLAW token lock in MiningPool contract (minted at expedition start, unclaimable)
- Simultaneous battle + mining = double-dipping on rewards (economic exploit even without the lock path)
- Note: the reverse (mine first, then battle) is correctly blocked — `_validateTeamForBattle` checks `team.active`

Fix:
```diff
+ if (team.active) revert TeamIsActive(teamId);
  if (_teamToExpedition[teamId] != 0) revert TeamAlreadyMining(teamId);
```

---

### P-02: Reveal-timeout griefing in BattleArena leaks opponent's move data for free counter-play

Severity: Medium

Confidence: [100]

Status: **Fixed** (2026-03-07) — Reveal withhold now causes immediate forfeit (no retry). 1 regression test added.

Affected files:
- `contracts/BattleArena.sol:576-622` (_handleActiveTimeout)

Summary:
When both players commit moves but only one reveals, `_handleActiveTimeout` increments the non-revealer's consecutive timeout counter but resets all round state (both commits and reveals cleared). The revealer's `moveData` was already emitted via the `MoveRevealed` event, giving the non-revealer two free rounds of perfect information about the opponent's strategy before being forced to forfeit on the third consecutive timeout.

Attack path:
1. Both players commit moves
2. Player A reveals (moveData emitted in `MoveRevealed` event)
3. Player B does NOT reveal → timeout fires
4. B's `consecutiveTimeoutsB` incremented to 1 (below forfeit threshold of 3)
5. Round state reset — A's reveal is wiped, A must re-commit
6. B now knows A's move from the emitted event and can counter
7. B can repeat this once more (counter = 2) before the third timeout triggers forfeit

This compounds with P-04 (timeout counter bypass): if B cooperates on the replayed round, `advanceRound` resets `consecutiveTimeoutsB` to 0, allowing B to repeat the info leak indefinitely.

This supersedes and concretizes L-02.

Fix:
Force immediate forfeit on first reveal withhold (one strike for info leak), or preserve the honest player's commit across the reset so the non-revealer gains no information advantage.

---

### P-03: Deterministic breeding randomness enables legend sniping via smart contract

Severity: Medium

Confidence: [95]

Status: **Fixed** (2026-03-07) — Rewritten to 2-step `requestBreed`/`finalizeBreed` commit-reveal flow.

Affected files:
- `contracts/BreedingLab.sol` (full rewrite)
- `test/BreedingLab.t.sol` (full rewrite)
- `test/BoundaryTests.t.sol` (updated breeding calls)

Summary:
The original offspring DNA seed was computed from `keccak256(block.prevrandao, parentA, parentB, msg.sender, block.timestamp)` — all values known within the same transaction. An attacker could deploy a "legend sniper" contract that simulates the DNA generation and reverts if unfavorable, guaranteeing legends for ~$0.33 in gas.

Fix applied:
BreedingLab rewritten from single-step `breed()` to 2-step commit-reveal:

1. **`requestBreed(parentA, parentB)`** — validates parents, charges fee, caches parent DNA/generations in a `BreedRequest` struct, increments breed counts, sets cooldowns. Returns `requestId`. Target block = `block.number + 2`.
2. **`finalizeBreed(requestId)`** — callable by **anyone** after the target block. Uses `blockhash(req.targetBlock)` as entropy, which is unknown at request time. Offspring minted to the original requester. Must finalize within 256 blocks (EVM blockhash lookback) or request expires.

Anti-sniping defenses:
- **Blockhash entropy**: unknown at request time, defeats simulation-based sniping
- **Anyone can finalize**: prevents selective revert — if requester doesn't finalize, someone else will
- **Fee committed at request time**: no refund on expiry, prevents free retry loops
- **Breed count consumed at request**: even if not finalized, the breed slot is used
- **Parent DNA cached in request**: handles parent transfers/burns between request and finalize

Tests: 45 BreedingLab tests (8 P-03-specific + 2 S-04 generation overflow). 61 BoundaryTests (1 S-03 armor-zero). 32 Faucet tests (2 S-07 batch size). 510/510 total suite green.

---

### P-04: Anti-grief timeout counter bypass allows indefinite battle griefing without forfeit

Severity: Medium

Confidence: [90]

Status: **Fixed** (2026-03-07) — `advanceRound()` no longer resets timeout counters; they are cumulative. 1 regression test added.

Affected files:
- `contracts/BattleArena.sol:340-341` (advanceRound resets counters)
- `contracts/BattleArena.sol:576-622` (_handleActiveTimeout)

Summary:
The `consecutiveTimeoutsA/B` counters auto-forfeit a player after 3 consecutive timeouts, but `advanceRound()` (lines 340-341) resets both counters to zero whenever a round completes. An adversarial player can exploit this cycle:

1. Timeout on round N → counter = 1
2. Cooperate on round N replay → `advanceRound` resets counter to 0
3. Timeout on round N+1 → counter = 1
4. Cooperate on round N+1 replay → counter reset to 0
5. Repeat indefinitely

The counter never reaches the forfeit threshold of 3. The attacker wastes the opponent's gas and time across unlimited rounds without ever losing their anti-grief deposit. Combined with P-02, this enables unlimited rounds of free information about the opponent's strategy.

Fix:
Use cumulative (total) timeout counts instead of consecutive, or do not reset the offending player's counter on `advanceRound`:
```diff
  function advanceRound(uint256 battleId) external onlyRole(RESOLVER_ROLE) {
      ...
      b.currentRound++;
-     b.consecutiveTimeoutsA = 0;
-     b.consecutiveTimeoutsB = 0;
      ...
  }
```

---

### P-05: uint8 overflow in BattleArena._applyDamage can revert settlement

Severity: Low

Confidence: [75] (found by 3 of 5 agents independently)

Status: **Fixed** (2026-03-07) — Arithmetic widened to uint256 intermediate before cap. 1 regression test added.

Affected files:
- `contracts/BattleArena.sol:484-485` (_applyDamage)

Summary:
`uint8 newDamage = currentDamage + damages[i]` performs checked uint8 arithmetic in Solidity 0.8+. If the sum exceeds 255 (e.g., `currentDamage=79` + `damages[i]=200`), the transaction reverts before the `if (newDamage > 100) newDamage = 100` cap can apply. The cap logic is defeated by the overflow.

While `damages[i]` values are provided by the trusted RESOLVER_ROLE (game design specifies 5-40 range), the contract does not enforce bounds. A resolver bug sending `damages[i] > 155` for a lobster with `currentDamage >= 100` would permanently prevent settlement of that battle. Funds are recoverable via timeout → cancel, but the battle result is lost.

Fix:
```diff
- uint8 newDamage = currentDamage + damages[i];
- if (newDamage > 100) newDamage = 100;
+ uint16 raw = uint16(currentDamage) + uint16(damages[i]);
+ uint8 newDamage = raw > 100 ? 100 : uint8(raw);
```

---

## Community Audit Skill Findings

The following findings were identified by applying checklists from three community audit skills:
- **Cyfrin solskill** (Solidity development standards + invariant testing requirements)
- **Trail of Bits token-integration-analyzer** (24 weird ERC20 patterns, token safety)
- **Pashov solidity-auditor** (parallelized security scanning methodology)

### C-01: Missing `@custom:security-contact` NatSpec on all contracts

Source: Cyfrin solskill

Severity: Informational

Status: Open

Affected files: All 12 contracts in `contracts/`

Summary:
No contract includes the `@custom:security-contact` NatSpec annotation. This tag is indexed by security tools (e.g., Etherscan, OpenZeppelin Defender) and provides a responsible disclosure channel for white-hat researchers who discover vulnerabilities in deployed contracts.

Recommendation:
Add `/// @custom:security-contact security@clawbada.com` (or equivalent) to the contract-level NatSpec of every deployed contract.

---

### C-02: Use `ReentrancyGuardTransient` instead of `ReentrancyGuard` for gas savings

Source: Cyfrin solskill (OZ v5 best practices)

Severity: Informational (gas optimization)

Status: Open

Affected files:
- `contracts/Treasury.sol`
- `contracts/EvolutionLab.sol`
- `contracts/Marketplace.sol`
- `contracts/RepairShop.sol`
- `contracts/MiningPool.sol`
- `contracts/BreedingLab.sol`
- `contracts/BattleArena.sol`

Summary:
All 7 contracts using `ReentrancyGuard` import the classic storage-based version. OZ v5.5.0 (installed in this project at `lib/openzeppelin-contracts/contracts/utils/ReentrancyGuardTransient.sol`) provides `ReentrancyGuardTransient`, which uses EIP-1153 transient storage. This saves ~2,400 gas per `nonReentrant` call (avoids a cold SSTORE + warm SSTORE, replaced by TSTORE/TLOAD which are always 100 gas). Base supports EIP-1153 (Dencun upgrade).

Recommendation:
Replace `import {ReentrancyGuard}` with `import {ReentrancyGuardTransient}` and change the inheritance. This is a drop-in replacement — the `nonReentrant` modifier interface is identical.

---

### C-03: Custom error names lack contract prefix — collision risk in ABI decoding

Source: Cyfrin solskill (naming conventions)

Severity: Informational

Status: Open

Affected files: All contracts defining custom errors

Summary:
Cyfrin recommends the `ContractName__ErrorName` convention (e.g., `MiningPool__SeasonNotActive`) for custom errors. Current errors use bare names like `ZeroAddress`, `NotTeamOwner`, `LobsterIsLocked`, etc. The error `ZeroAddress()` is defined independently in 8 contracts — while Solidity distinguishes them by contract context, off-chain tools decoding raw error selectors can misattribute errors when multiple contracts share the same 4-byte selector.

Recommendation:
Prefix all custom errors with the contract name. This is a cosmetic/tooling improvement, not a security fix. Can be deferred to a future cleanup pass.

---

### C-04: No invariant or stateful fuzz tests

Source: Cyfrin solskill (testing requirements)

Severity: Low

Status: Open

Affected files: `test/` directory

Summary:
The test suite consists entirely of unit tests (specific scenario → expected outcome). No Foundry invariant tests (`function invariant_*`) or stateful fuzz campaigns exist. Key system invariants that should be tested under randomized sequences:

1. **ClawToken**: `totalSupply() <= MAX_SUPPLY` — always, regardless of mint/burn sequence
2. **MiningPool**: `season.totalMinted <= season.totalEmission` — budget cap never exceeded
3. **MiningPool**: escrow balance ≥ sum of unclaimed expedition rewards
4. **TeamManager**: a locked lobster is always on exactly one team; an unlocked lobster is on zero teams
5. **Marketplace**: escrow balance ≥ sum of active listing values
6. **BattleArena**: escrow balance ≥ sum of all Deposited/Active battle stakes + anti-grief deposits
7. **LobsterNFT**: soulbound lobsters never change owner (except mint and burn)

Recommendation:
Add Foundry invariant tests for the above properties. These catch edge cases that unit tests miss — particularly around interleaved operations across multiple users/contracts.

---

### C-05: `DEFAULT_ADMIN_ROLE` is a god key — no renouncement, timelock, or multisig enforcement

Source: Cyfrin solskill (admin privilege analysis) + Pashov (owner privilege scanning)

Severity: Low

Status: Open

Affected files:
- `contracts/ClawToken.sol:32`
- `contracts/LobsterNFT.sol:72`
- `contracts/MiningPool.sol:96`
- `contracts/TeamManager.sol:50`
- `contracts/Faucet.sol:56`
- `contracts/BattleArena.sol:149`
- `contracts/BattleVRF.sol:32`
- `contracts/script/Configure.s.sol` (grants operational roles from deployer)

Summary:
Seven contracts grant `DEFAULT_ADMIN_ROLE` to the deployer at construction. This role can:
- Grant `MINTER_ROLE` on ClawToken → mint up to MAX_SUPPLY to any address
- Grant `MINTER_ROLE` + `BURNER_ROLE` + `DAMAGE_ROLE` + `EVOLVER_ROLE` on LobsterNFT → mint/burn/modify any lobster
- Grant `ACTIVITY_ROLE` on TeamManager → lock/unlock any team
- Grant `MATCHMAKER_ROLE` + `RESOLVER_ROLE` on BattleArena → create battles and control outcomes
- Grant `SEASON_ADMIN_ROLE` on MiningPool → start seasons, change rewards

The H-01 hardening separated operational roles from deployer on mainnet, but `DEFAULT_ADMIN_ROLE` itself is never renounced — the deployer retains the ability to re-grant any role. There is no timelock or multisig enforcement at the contract level.

Per Cyfrin: "Admin must be a multisig from first deployment." Per Pashov: "Owner privilege escalation paths must be documented and mitigated."

Recommendation:
- **Pre-launch**: Transfer `DEFAULT_ADMIN_ROLE` to a Gnosis Safe multisig on all 7 contracts. Renounce it from the deployer EOA.
- **Alternatively**: Add `AccessManager` (OZ v5) as an intermediate with timelocked role grants, preventing instantaneous privilege escalation.
- **At minimum**: Document the trust assumption — users must trust the deployer EOA until admin is transferred.

---

### C-06: Deployment scripts grant admin roles to deployer without timelock

Source: Cyfrin solskill (deployment scripts as audit scope)

Severity: Informational

Status: Open

Affected files:
- `contracts/script/Configure.s.sol:131,164`

Summary:
`Configure.s.sol` grants `SEASON_ADMIN_ROLE` (line 131) and `ELIGIBILITY_ROLE` (line 164) to the deployer address. These roles allow the deployer to:
- Start new seasons and modify `baseReward` mid-season (SEASON_ADMIN_ROLE)
- Set wallet eligibility for faucet claims (ELIGIBILITY_ROLE)

While these are operational necessities, the Cyfrin checklist flags deployment scripts as part of the audit surface. The grants happen without timelock, and there is no post-deployment transfer of these roles to a multisig.

Recommendation:
- After initial configuration, transfer `SEASON_ADMIN_ROLE` and `ELIGIBILITY_ROLE` to a multisig or role-specific operational wallet, then revoke from deployer.
- This should be part of a post-deployment security checklist.

---

## Automated Scan Findings (2026-03-07)

Scan sources: Trail of Bits token-integration-analyzer, quillai-network audit skills (reentrancy, DoS/griefing, external-call-safety, input-arithmetic-safety, state-invariant-detection), Archethect Map-Hunt-Attack methodology (manual application — MCP tools unavailable).

Findings are deduplicated across agents by root cause. Items that overlap with existing findings (P-01–P-05, C-01–C-06, H-01, M-02) are noted as duplicates and not re-listed.

### S-01: Faucet CLAW minting competes with MiningPool for MAX_SUPPLY headroom without budget tracking

Severity: High

Confidence: Confirmed

Source: state-invariant-detection scan

Status: **Fixed** (2026-03-07) — Faucet now distributes pre-minted $CLAW via `transfer()` instead of `mint()`. 3 regression tests added.

Affected files:
- `contracts/Faucet.sol:109-114` (claimClaw → transfer from pre-funded balance)
- `contracts/script/Configure.s.sol:160-175` (pre-mints 70M $CLAW to Faucet during deployment)
- `contracts/script/DeployHelpers.s.sol:40` (FAUCET_CLAW_ALLOCATION constant)

**Original issue:**
The Faucet minted 7,000 $CLAW per eligible wallet via `clawToken.mint()`, drawing from the same `MAX_SUPPLY` (1B) headroom as MiningPool. Faucet mints were not tracked against any budget. With 10K wallets claiming, 70M $CLAW would be minted outside the mining emission schedule, eating into the 775M mining allocation.

**Fix applied:**
- `Faucet.claimClaw()` now uses `clawToken.transfer()` from the Faucet's pre-funded balance instead of `clawToken.mint()`.
- Added `InsufficientFaucetBalance` error for descriptive revert when balance is exhausted.
- Faucet no longer holds `MINTER_ROLE` on ClawToken.
- `Configure.s.sol` pre-mints `FAUCET_CLAW_ALLOCATION` (70M $CLAW) into the Faucet contract during deployment setup, then revokes the temporary MINTER_ROLE from deployer.
- Faucet allocation is explicitly carved from MAX_SUPPLY at deployment time, making the tokenomics auditable.
- Token allocation updated: mining 70.5% (705M), LP 12.5% (125M), treasury 10% (100M), faucet 7% (70M). Docs updated in ClawToken.sol, GAME_DESIGN_RATIONALE.md, and gitbook/tokenomics.md.

Tests added:
- `test_claimClawTransfersFromFaucetBalance` — verifies transfer from balance, totalSupply unchanged
- `test_claimClawRevertsWhenFaucetBalanceInsufficient` — verifies descriptive revert on empty faucet
- `test_faucetClaimDoesNotAffectMiningSupply` — verifies `remainingMintable()` unchanged after claim

---

### S-02: No neutral resolver-independent unwind for Active battles

Severity: Medium (downgraded from High — `handleTimeout()` is public and provides forfeit/cancel paths for most timeout scenarios)

Confidence: Likely

Source: Trail of Bits token-integration-analyzer + external-call-safety scan

Status: **Fixed** (2026-03-08) — Added `emergencyWithdraw()` with 24-hour delay. 7 regression tests added.

Affected files:
- `contracts/BattleArena.sol` (new `emergencyWithdraw()` function, `lastProgressAt` field, `StaleBattle` cancel reason)

**Original issue:**
If the resolver goes offline while a battle is in `Active` status and both players remain responsive, there is no neutral unwind path. `handleTimeout()` requires deadline expiry (which resets on each cycle), and `settle()` requires `RESOLVER_ROLE`. The timeout handler covers forfeit/cancel but not a neutral "draw with full refund."

**Fix applied:**
- Added `lastProgressAt` timestamp to Battle struct, updated when battle enters Active phase and on each `advanceRound()` call.
- Added `EMERGENCY_WITHDRAW_DELAY` constant (24 hours).
- Added `emergencyWithdraw(battleId)` — callable by either participant when the battle has been in Active phase for >24 hours without resolver progress. Performs a neutral cancel: both players get full stake + anti-grief refund, teams released, no winner declared, no damage applied.
- Added `StaleBattle` cancel reason to distinguish from normal timeouts.
- This is an operational fallback, not part of standard battle resolution. Normal battles complete in minutes; the 24-hour delay ensures this cannot be used to bypass the resolver during normal play.

Tests added:
- `test_emergencyWithdrawAfterDelay` — refund correctness
- `test_emergencyWithdrawBeforeDelayReverts` — timing guard
- `test_emergencyWithdrawByNonParticipantReverts` — access control
- `test_emergencyWithdrawReleasesTeams` — team state cleanup
- `test_emergencyWithdrawOnSettledBattleReverts` — phase guard
- `test_emergencyWithdrawResetsAfterAdvanceRound` — delay resets on resolver progress
- `test_emergencyWithdrawNotAvailableOnNonActiveBattle` — only Active phase

---

### S-03: BattleResolver _cappedRatio division by zero if armor reaches 0

Severity: Low (downgraded from Medium — BattleResolver is a library not called on-chain in the current battle flow; the resolver supplies damage via calldata in `settle()`)

Confidence: Possible

Source: external-call-safety scan

Status: **Fixed** (2026-03-07) — Added `if (armor == 0) return STAT_RATIO_CAP;` guard. 1 boundary test added.

Affected files:
- `contracts/libraries/BattleResolver.sol` (_cappedRatio function)
- `test/BoundaryTests.t.sol` (new test: `test_boundary_statRatioArmorZeroReturnsCap`)

Summary:
The `_cappedRatio` function divides by the `armor` parameter. If armor is 0, the division reverts with a Solidity panic.

Fix: Added `if (armor == 0) return STAT_RATIO_CAP;` as the first line of `_cappedRatio`. Returns the cap value (2.2×) when armor is 0, consistent with the function's capping behavior.

---

### S-04: BreedingLab generation field uint8 overflow at generation 255

Severity: Medium

Confidence: Confirmed

Source: Trail of Bits token-integration-analyzer + input-arithmetic-safety scan (found independently by both)

Status: **Fixed** (2026-03-07) — Added `MaxGenerationReached` error + check in `requestBreed()`. 2 tests added.

Affected files:
- `contracts/BreedingLab.sol` (`requestBreed` function)
- `test/BreedingLab.t.sol` (new tests: `test_maxGenerationReachedReverts`, `test_generation254CanBreed`)

Summary:
Offspring generation is computed as `max(parent_A_gen, parent_B_gen) + 1` and stored as `uint8` (0-255). At generation 255, the `+1` would overflow.

Fix: Added `MaxGenerationReached` error and explicit check `if (maxGen >= 255) revert MaxGenerationReached()` in `requestBreed()` before any cost computation. Check is in `requestBreed` (not `finalizeBreed`) because the breed cost computation itself can overflow at very high generations.

---

### S-05: LobsterNFT burn() trusts BURNER_ROLE without caller-side ownership check

Severity: Low (downgraded from Medium — same class of role-trust/governance risk as I-05 and C-05; current BURNER_ROLE holder validates ownership)

Confidence: Possible

Source: Trail of Bits token-integration-analyzer

Status: **Fixed** (2026-03-07) — Added NatSpec documenting BURNER_ROLE ownership requirements.

Affected files:
- `contracts/LobsterNFT.sol` (burn function NatSpec)

Summary:
`burn()` is gated to `BURNER_ROLE` and resolves the owner internally. It does not verify caller authorization from the owner. The current sole holder (EvolutionLab) validates ownership before calling burn.

Fix: Added `@dev` NatSpec to `burn()` documenting that BURNER_ROLE holders MUST verify ownership/authorization before calling. This makes the trust assumption explicit for future role grants.

---

### S-06: Breeding cost precision loss from compounding truncation

Severity: Low

Confidence: Confirmed

Source: input-arithmetic-safety scan

Status: **Fixed** (2026-03-07) — Documented as negligible; added precision boundary test.

Affected files:
- `contracts/BreedingLab.sol` (NatSpec comment on truncation)
- `test/BreedingLab.t.sol` (new test: `test_breedCostPrecisionAtHighGeneration`)

Summary:
The iterative `cost * 3 / 2` computation truncates at most 0.5 wei per step. On an 18-decimal token with costs ≥500e18, this error is negligible (< 1 part per 10^18 per generation). At gen 10, the computed cost is within 1 $CLAW of the theoretical value. Added NatSpec documenting the truncation behavior and a boundary test verifying gen-10 precision.

---

### S-07: Faucet setEligibleBatch unbounded loop

Severity: Low

Confidence: Confirmed

Source: DoS/griefing scan

Status: **Fixed** (2026-03-07) — Added `MAX_BATCH_SIZE = 500` constant and `BatchTooLarge` error. 2 tests added.

Affected files:
- `contracts/Faucet.sol` (setEligibleBatch function, MAX_BATCH_SIZE constant, BatchTooLarge error)
- `test/Faucet.t.sol` (new tests: `test_setEligibleBatchTooLargeReverts`, `test_setEligibleBatchAtMaxSizeSucceeds`)

Summary:
`setEligibleBatch` iterated over an unbounded array. Added `MAX_BATCH_SIZE = 500` and reverts with `BatchTooLarge(length, max)` if exceeded.

---

### ~~S-08~~: TeamManager getTeamsByOwner — REMOVED (false positive)

`getTeamsByOwner()` returns `_ownerTeams[owner]` directly (line 150) — no iteration. The scan agent's claim that it "iterates over all team IDs" was incorrect.

---

### Duplicate Findings (Already Covered)

The following were independently identified by scan agents but are duplicates of existing findings:

| Scan Finding | Duplicate Of | Note |
|---|---|---|
| Team active state cross-contract inconsistency | P-01 (Fixed) | state-invariant scan found the same MiningPool/BattleArena gap |
| Reveal withhold information leak | P-02 (Fixed) | reentrancy scan noted the same commit-reveal state reset issue |
| Commit-reveal on-chain randomness | P-03 / L-01 | multiple scans flagged prevrandao predictability |
| Bare transfer/transferFrom without SafeERC20 | I-04 | external-call scan + ToB scan both flagged |
| DEFAULT_ADMIN_ROLE centralization | C-05 | state-invariant scan flagged role concentration |
| Missing ReentrancyGuard on Faucet | L-05 | reentrancy scan confirmed existing finding |

## Notes

- All contracts were reviewed against OpenZeppelin Contracts v5.5.0 (installed at `lib/openzeppelin-contracts/`).
- The `ClawToken` inherits OZ `ERC20` + `ERC20Burnable` + `AccessControl` — standard and correct.
- `LobsterNFT._update()` correctly enforces soulbound and locked restrictions on transfers while allowing mints and burns to proceed. Soulbound lobsters being burnable is intentional (evolution fuel per design spec).
- `Treasury.sol` is clean: atomic pull-split-burn, `Ownable2Step` for safe ownership transfer, one-time token setup, authorized caller whitelist.
- `RepairShop.sol` is clean: CEI respected, correct tier-rate lookup, proper damage bounds checking.
- `EvolutionLab.sol` is clean: duplicate ID checks, tier validation, fuel ownership + lock checks, correct burn-before-upgrade ordering.
- Role configuration in `Configure.s.sol` is correctly separated after H-01 hardening — mainnet enforces distinct addresses for deployer/matchmaker/resolver/VRF operator.

## Validation

The following test suites were executed successfully with `FOUNDRY_OFFLINE=true`:
- `forge test --match-contract BattleArenaTest`
- `forge test --match-contract MiningPoolTest`
- `forge test --match-contract MarketplaceTest`

Additional targeted regression tests executed successfully after the patch:
- `forge test --match-test test_settleRevertsWithoutVerifiedMovesAndPreservesState`
- `forge test --match-test test_settleShouldRevertBeforeAnyMovesAreVerified`

Notes on testing:
- `forge test` without offline mode crashes in this environment due a Foundry/system-proxy bug on macOS.
- *(Pre-hardening note, now resolved)* The original `BattleArena` test suite encoded the trusted-resolver flow without negative tests for early settlement. 10 negative tests were added as part of the H-01 hardening (see below), covering settlement phase guards, access control, and the `lastVerifiedRound` gate.

## Hardening Applied (H-01 Follow-up)

Date: 2026-03-06

Three hardening measures applied as follow-up to the H-01 partial mitigation:

### 1. Configure.s.sol: Role separation + mainnet guards

**Files modified:** `contracts/script/DeployHelpers.s.sol`, `contracts/script/Configure.s.sol`

Previously, `Configure.s.sol` granted `MATCHMAKER_ROLE`, `RESOLVER_ROLE`, and VRF `OPERATOR_ROLE` directly to the deployer address ("god-key" pattern). This was acceptable for testnet but dangerous for mainnet — a single compromised key would control matchmaking, settlement, and VRF operations.

Changes:
- Added `matchmakerAddress`, `resolverAddress`, and `vrfOperatorAddress` fields to `DeployHelpers.s.sol`, loaded from `MATCHMAKER_ADDRESS`, `RESOLVER_ADDRESS`, and `VRF_OPERATOR_ADDRESS` environment variables.
- On testnet/local (chain IDs 31337, 84532): these fall back to `deployer` if the env var is not set, preserving existing developer workflow.
- On mainnet (chain ID 8453): all three are required — deployment reverts with a descriptive error if any is missing.
- On mainnet, pairwise inequality is enforced: no operational role address may equal `deployer` or any other operational role address (6 checks). This prevents the god-key pattern from being silently recreated by setting all env vars to the same EOA.
- `Configure.s.sol` now grants operational roles to the dedicated addresses instead of `deployer`.
- Admin roles (`SEASON_ADMIN_ROLE`, `ELIGIBILITY_ROLE`) remain on `deployer` as intended.

### 2. BattleArena.t.sol: 10 new negative tests

**File modified:** `test/BattleArena.t.sol`

Added 10 tests covering settle/advanceRound access control and phase guards:

| # | Test | What It Proves |
|---|------|---------------|
| 1 | `test_settleRevertsInDepositPhase` | Can't settle before teams revealed |
| 2 | `test_settleRevertsInTeamCommitPhase` | Can't settle during team commit |
| 3 | `test_settleRevertsInTeamRevealPhase` | Can't settle during team reveal |
| 4 | `test_settleByNonResolverReverts` | Only RESOLVER_ROLE can call settle |
| 5 | `test_settleWithInvalidWinnerReverts` | Winner must be playerA or playerB |
| 6 | `test_settleAfterPartialMoveRevealReverts` | One-side reveal doesn't set lastVerifiedRound |
| 7 | `test_settleWhenAlreadySettledReverts` | Can't settle same battle twice |
| 8 | `test_advanceRoundByNonResolverReverts` | Only RESOLVER_ROLE can advance rounds |
| 9 | `test_lastVerifiedRoundSetAfterBothReveals` | Asserts lastVerifiedRound == 1 after full round 1 |
| 10 | `test_settleSucceedsAfterOneVerifiedRound` | Boundary: settle works with exactly 1 verified round |

### 3. BattleArena.sol: Trust model NatSpec

**File modified:** `contracts/BattleArena.sol`

Added a NatSpec block at the contract level documenting the operator-trust assumption: the resolver supplies winner and damage arrays, settlement is gated to require at least one verified round, but the resolver controls outcome determination after that point. Includes guidance on what would need to change for trustless settlement.

## Audit Closeout (2026-03-07, updated with scan findings; 2026-03-09 F-* hardening pass)

Final validation: `FOUNDRY_OFFLINE=true forge test` — 523/523 passing across 15 test suites.

**Scan coverage**: 7 audit methodologies applied (manual review, Pashov DEEP scan, Cyfrin checklist, Trail of Bits token analyzer, 5 quillai-network vector scans, Archethect Map-Hunt-Attack). 6 duplicate findings confirmed cross-scan consistency. 1 false positive removed (S-08). 3 findings downgraded after code verification (S-02 High→Medium, S-03 Medium→Low, S-05 Medium→Low).

**2026-03-09 hardening pass**: Full re-read of all 14 contract files. 4 new findings (F-01 Medium, F-02/F-03/F-06 Low) identified and fixed with 13 regression tests. L-04 closed by F-06.

### Fixed Findings

| ID | Severity | Contract | Fix | Tests Added |
|----|----------|----------|-----|-------------|
| P-01 | High | MiningPool | Added `TeamIsActive` error + `team.active` guard in `startExpedition()` | 2 |
| P-02 | Medium | BattleArena | Reveal withhold triggers immediate forfeit (no retry) | 1 |
| P-04 | Medium | BattleArena | `advanceRound()` no longer resets timeout counters — cumulative | 1 |
| M-02 | Medium | MiningPool | Mint-to-escrow at expedition start; claim transfers from escrow | 4 |
| S-01 | High | Faucet/ClawToken | Pre-mint faucet allocation; `claimClaw()` uses `transfer()` not `mint()` | 3 |
| S-02 | Medium | BattleArena | Added `emergencyWithdraw()` with 24h delay + `lastProgressAt` tracking | 7 |
| P-03 | Medium | BreedingLab | 2-step `requestBreed`/`finalizeBreed` with blockhash entropy; anyone-can-finalize | 8 |
| P-05 | Low | BattleArena | `_applyDamage` arithmetic widened to `uint256` before cap | 1 |
| S-03 | Low | BattleResolver | Added `if (armor == 0) return STAT_RATIO_CAP;` guard in `_cappedRatio` | 1 |
| S-04 | Medium | BreedingLab | Added `MaxGenerationReached` error + check in `requestBreed()` | 2 |
| S-05 | Low | LobsterNFT | Added NatSpec to `burn()` documenting BURNER_ROLE ownership requirements | — |
| S-06 | Low | BreedingLab | Documented truncation as negligible (< 1 wei/step on 18-decimal token) | 1 |
| S-07 | Low | Faucet | Added `MAX_BATCH_SIZE = 500` + `BatchTooLarge` error | 2 |
| L-01 | Low | BreedingLab | Superseded by P-03 fix — breeding now uses commit-reveal | — |
| L-02 | Low | BattleArena | Superseded by P-02 fix — reveal withhold path no longer reachable | — |
| **F-01** | **Medium** | **BreedingLab/LobsterNFT** | **Added `cancelExpiredRequest()` + `decrementBreedCount()` — restores breed counts on expired requests** | **5** |
| **F-02** | **Low** | **BattleArena** | **Added both-commits-required guard in `revealMoves()` — prevents early reveal info leak** | **2** |
| **F-03** | **Low** | **BattleArena** | **Added `MAX_ROUNDS = 7` enforcement in `advanceRound()` — on-chain round cap** | **2** |
| **F-06** | **Low** | **MiningPool** | **Added `adminReleaseExpedition()` — key-loss recovery with 7-day grace + reward burn (fixes L-04)** | **4** |

### Partially Mitigated

| ID | Severity | Contract | State |
|----|----------|----------|-------|
| H-01 | High | BattleArena | Settlement gated to require verified round + role separation in deployment scripts + trust model NatSpec. Resolver remains operator-trusted for outcome determination. |

### Open (Low / Informational — No Code Changes Required Pre-Launch)

| ID | Severity | Contract | Note |
|----|----------|----------|------|
| L-05 | Low | Faucet | Add ReentrancyGuard to claim functions |
| C-04 | Low | test/ | Add invariant / stateful fuzz tests |
| C-05 | Low | Multiple | DEFAULT_ADMIN_ROLE renouncement / timelock / multisig |
| I-01–I-05 | Info | Various | Best-practice improvements (SafeERC20, wash trading guard, etc.) |
| C-01–C-03, C-06 | Info | Various | NatSpec, error naming, ReentrancyGuardTransient, deployment timelock |
