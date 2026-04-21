# Clawbada Adversarial Audit Campaign

Start date: 2026-04-15
Plan file: `~/.claude/plans/hidden-sleeping-backus.md`
Cross-references: [`2026-03-06-manual-contract-audit.md`](./2026-03-06-manual-contract-audit.md)

## Scope

Adversarial pass over every Solidity contract under `contracts/`, organized as:
- **Phase 0** — foundation (static analysis, Foundry profiles, N-01 fix)
- **Phase 1** — sprint on value-flow core (BattleArena, BattleResolver, MiningPool, Treasury)
- **Phase 2** — per-contract passes on remaining 9 contracts
- **Phase 3** — cross-contract invariants + 3 parallel Codex red-team passes
- **Phase 4** — production hardening (CI integration, multisig runbook, close prior audit items)

Per-contract attack loop (executed for each contract): read pass → static pass → invariant authoring → fuzz authoring → local run → Codex red-team pre-fix → iterate → Codex red-team post-fix → commit.

## H-01 trust model decision (locked)

Per user decision 2026-04-16: keep operator-trust on `RESOLVER_ROLE`, add a 5-minute challenge window. Implementation in BattleArena's Phase 1 sprint pass:
- New phase `BattlePhase.AwaitingFinalize` between `Active` and `Settled`
- `settle()` records proposed outcome + `payoutDeadline = block.timestamp + 5 minutes`, no transfers yet
- `disputeBattle(battleId, signedDisagreement)` — either player can freeze payout
- `finalizeBattle(battleId)` — permissionless after deadline if undisputed; performs transfers + `_applyDamage`
- `adminResolveDispute(battleId, winner)` — DEFAULT_ADMIN_ROLE only, for disputed cases

Trust NatSpec update: "resolver proposes, 5-minute player veto, admin final tiebreak."

## Tooling

- **Foundry profiles** (`foundry.toml`):
  - `default` — 256 fuzz runs (fast iteration)
  - `ci` — 10k fuzz runs, invariants 500×100, `fail_on_revert=false`
  - `deep` — 50k fuzz runs (seed `0xc1a88ada` for reproducibility), invariants 2000×200
- **Slither** 0.11.5 — `slither.config.json` at repo root, filters `lib/`, `contracts/test/`, `contracts/script/`. Canonical invocation: `slither contracts/`
- **Aderyn** 0.1.9 — no config file format in this version. Canonical invocation:
  ```bash
  aderyn . --src contracts --path-excludes lib,contracts/test,contracts/script --stdout
  ```
- **Codex CLI** 0.117.0 — authenticated; runtime ready. Red-team passes via `codex:codex-rescue` subagent with prompts following `codex:gpt-5-4-prompting` guidance.

## Findings table

| ID | Severity | Status | Contract | Title |
|----|----------|--------|----------|-------|
| **H-01** | High | **Mitigated via challenge window** | BattleArena | Resolver-trusted settlement (from 2026-03-06 audit) |
| **N-01** | Low | **Fixed** | BattleArena | `_handleActiveTimeout` advances `currentRound` past `MAX_ROUNDS` |
| **N-02** | Medium | **Fixed** | BattleArena | `_handleActiveTimeout` forgets to refresh `lastProgressAt` — griefer can force cheap `emergencyWithdraw` cancel |
| **R-01** | Low | Documented (NatSpec) | BattleResolver | `classMult` outside {800,1000,1250} silently zeroes damage (caller contract) |
| **R-02** | Low | Documented (NatSpec) | BattleResolver | Out-of-spec `purity` / `vrfRoll` inflate or overflow damage (caller contract) |
| **R-03** | Info | **Fixed** (hardened) | BattleResolver | `_cappedRatio` overflows for extreme `atk > type(uint256).max / 1000` |
| **R-04** | Low | Documented (NatSpec) | BattleResolver | `calculateSpecialDamage` trusts caller-supplied `basePower` (caller contract) |
| **R-05** | Low | Documented (NatSpec) | BattleResolver | `scaleStats` trusts caller-supplied `base` stat magnitudes (caller contract) |
| **R-06** | Medium | **Fixed** (capped) | BattleResolver | `enhancedProcChance` returns > 10_000 BPS at purity > 19 (semantic contract break) |
| **R-07** | Low | Documented (NatSpec) | BattleResolver | `critChance` overflows for huge `critStat` (caller contract) |
| **M-01** | Medium | **Fixed** | MiningPool | ACTIVITY_ROLE compromise + team disband leaves expedition permanently stuck |
| **M-02** | Medium | Documented (C-05 instance) | MiningPool | Compromised SEASON_ADMIN can redirect full remaining season budget via `setBaseReward` |
| **T-03** | Low | **Fixed** | Treasury | `processFee` accepts amounts below `BPS_DENOMINATOR`, adversarial chunking can skew 85/15 split |
| **T-04** | Low | **Fixed** | Treasury | `setDevWallet(address(this))` traps the 15% leg inside Treasury (no accumulation invariant violated) |
| **T-05** | Low | **Fixed** | Marketplace | Dust listings pass price > 0 check but produce Treasury-rejected fees (T-03 knock-on) |
| **B-01** | High | **Fixed** | BreedingLab | Off-by-one in finalize/cancel time gates lets anyone grief every breed at exact targetBlock |
| **B-02** | Medium | **Fixed** | BreedingLab | Contract requesters can veto unfavorable offspring via `onERC1155Received` and farm rare rolls via cancel-refund |
| **B-03** | Medium | **Fixed** | BreedingLab | Bare `catch {}` silently burns requests on protocol-side mint failures (role revoke) |
| **T-01** | Info | Documented | Tooling | Aderyn 0.1.9 incompatible with OZ v5 `evm_version = 'prague'` |
| **T-02** | Info | Test migration landed | Tests | Test suite did not compile against the hardening fix-pass |

## Findings

### N-01: `_handleActiveTimeout` advances `currentRound` past `MAX_ROUNDS`

Severity: Low (state-machine integrity, not fund loss)

Status: **Fixed** in `contracts/BattleArena.sol` at the `_handleActiveTimeout` fall-through (was line ~648). Regression tests in `contracts/test/fuzz/FuzzBattleArena.t.sol`.

Affected files:
- `contracts/BattleArena.sol` — `_handleActiveTimeout`
- `contracts/test/fuzz/FuzzBattleArena.t.sol` — 2 new regression tests + `_playRound` + `_playToFinalRound_*` helpers

Summary:

The F-03 hardening (see `2026-03-06-manual-contract-audit.md`) added a `MAX_ROUNDS` cap to `advanceRound()` but missed the neighboring path in `_handleActiveTimeout()`. When a timeout happened during round `MAX_ROUNDS` and neither early-return condition fired, the fall-through unconditionally incremented `b.currentRound` to 8.

Two reachable fall-through paths at round 7:
1. One side missed a commit with `consecutiveTimeouts < AUTO_FORFEIT_THRESHOLD` → used to stretch to round 8
2. Both committed and both revealed but deadline elapsed without the resolver calling `settle()` → used to silently "advance" to round 8

Severity rationale:
- No fund loss: stakes are still gated by phase transitions
- State-machine integrity: external observers (UI, indexers, replay tools) assume `currentRound <= MAX_ROUNDS`; the violation could manifest as UI confusion, wrong off-chain replay, or subtle downstream invariant breaks
- Sets precedent for "neighboring bug" misses — motivates the campaign's "second Codex pass on every fix" pattern

Fix (option b — preferred per plan):
At the final round, instead of incrementing:
- If one side missed its commit, force-forfeit that side (stronger version of `AUTO_FORFEIT_THRESHOLD`: the final round gives no second chance)
- If both reveals landed but the deadline elapsed, revert with `MaxRoundsReached` (battle is settlement territory; the resolver should call `settle()`)

Regression tests:
- `test_N01_handleTimeout_at_maxRounds_bothRevealed_reverts` — asserts `MaxRoundsReached` revert
- `test_N01_handleTimeout_at_maxRounds_oneMissedCommit_forfeits` — asserts forfeit path (`phase == Cancelled`)
- Both assert `currentRound <= MAX_ROUNDS` after the call (the core invariant)

Pre-fix both tests failed (the first with `8 > 7`, the second with a round-8 advance). Post-fix both pass. Full suite: 677/677.

Discovery: planning-session contract exploration, 2026-04-16. Fixed: 2026-04-17.

### N-02: `_handleActiveTimeout` forgets to refresh `lastProgressAt`

Severity: Medium (griefing path — denies protocol fee and forces cancel)

Status: **Fixed** 2026-04-18. Regression test `test_N02_handleActiveTimeout_refreshesLastProgressAt` in `contracts/test/fuzz/FuzzBattleArena.t.sol`.

Affected files:
- `contracts/BattleArena.sol` — fall-through at the end of `_handleActiveTimeout`

Summary:

`lastProgressAt` gates `emergencyWithdraw`: after `EMERGENCY_WITHDRAW_DELAY` (24h) of no progress since `lastProgressAt`, either participant can cancel the battle for a full refund (both stakes + anti-grief back to both sides). `lastProgressAt` is written in two "normal" progress paths:
1. `revealTeam` when the second team is revealed and phase → Active (line 325)
2. `advanceRound` on clean round progression (line 398)

But the **timeout-driven** round advance in `_handleActiveTimeout` (line 667, the N-01-neighbor fall-through) incremented `currentRound` without touching `lastProgressAt`. So a griefer could time out every round — letting the timeout handler walk the round counter up while `lastProgressAt` stayed frozen at the initial `revealTeam` timestamp. 24 hours after the first reveal, either side could call `emergencyWithdraw` and cancel a battle that had been actively progressing via timeouts — escaping a losing position without paying the 10% protocol fee, and denying the opponent their pending win.

Discovery: Codex red-team pre-fix pass, 2026-04-18. This is exactly the "neighboring bug near N-01's fix" class the campaign's second-pass step was designed to catch.

Fix (1 line):
```solidity
// In _handleActiveTimeout fall-through, after b.currentRound++:
b.lastProgressAt = block.timestamp;
```

Regression test: drives a battle into Active phase round 2, exercises the fall-through (Bob commits, Alice times out, below AUTO_FORFEIT_THRESHOLD), asserts `b.lastProgressAt` strictly increases post-timeout.

Codex red-team pre-fix pass (2026-04-18) also cleared the following as non-bugs under current state:
- `currentRound` cap (only two increment sites, both now guarded)
- `teamInBattle` ↔ phase consistency post-terminal
- `disputeBattle` evidence blob not a log-storage DOS (block gas limit bounds it; only emitted, not stored)
- Fee-accounting allowance race between settle/finalize — Treasury pulls from msg.sender, no reachable third-party drain
- Stale `consecutiveTimeouts` counters after settle — persist but never read post-Active
- `_executePayout` reentrancy — `nonReentrant` + CEI preserved
- `_applyDamage` arithmetic — uint256 widen then cap-at-100
- Team-lock callback race on `revealTeam` — NFT/TeamManager have no callbacks today
- AwaitingFinalize + admin AWOL — matches documented open risk

### T-01: Aderyn 0.1.9 incompatible with OZ v5 `evm_version = 'prague'`

Severity: Info (tooling)

Status: Documented — working around via Slither-only static analysis for now.

Summary:

Aderyn 0.1.9 bundles `cyfrin-foundry-config-0.2.1`, which panics on `evm_version = 'prague'`. `lib/openzeppelin-contracts/foundry.toml` sets prague (current OZ v5 default). Even when we patch that line down to `cancun` to get past the config parser, Aderyn's embedded Solc invocation can't resolve `mcopy` because it runs against the patched evm_version instead of picking up our project's cancun setting properly.

Workaround evaluated:
- `sed` patch OZ's foundry.toml → works for the config parser but then `mcopy` (a cancun-added opcode) fails to compile. Gave up.
- Upgrade path: `cargo search aderyn` shows 0.1.9 as latest on crates.io. Newer releases (0.x+ via Cyfrin direct) may ship binaries with a fixed config parser — not investigated in Phase 0.

Consequence:

Slither (0.11.5) carries the Phase 0 static-analysis baseline alone. Aderyn is deferred until a compatible version ships or until Phase 3/4, when we can revisit installation.

### T-02: Test suite did not compile against the hardening fix-pass

Severity: Info (test migration, not a production issue)

Status: Migration landed (commit `b3dbc2d`).

Summary:

At Phase 0 start, the working tree contained ~330 lines of uncommitted contract hardening (the fix-pass for the prior audit's F-01/F-03/P-01/P-03/MED-01 items). Test files had not been migrated to match the new APIs:

- `BreedingLab.breed()` was rewritten as `requestBreed()` + `finalizeBreed()` (P-03 commit-reveal randomness). Callers `FuzzBreedingLab.t.sol` (6 sites) and `InvariantProtocol.t.sol` (1 site) still called the old single-call API → compile failure.
- `BattleArena.settle()` now requires `lastVerifiedRound > 0`. `test_settle_stake_accounting` and `test_applyDamage_overflow_caps_at_100` did not run a commit-reveal round before `settle()` → new `SettlementRequiresVerifiedRound` revert.
- `MiningPool.TeamAlreadyMining` error renamed to `TeamIsActive`. `test_team_already_mining_reverts` selector was stale.

Migration (now committed):
- `_breed` helper wraps `requestBreed + vm.roll(FINALIZE_MIN_BLOCKS+1) + finalizeBreed`
- `InvariantProtocol` breed handler uses nested try/catch across the two steps
- New `_playRound` helper in `FuzzBattleArena` drives a full commit+reveal for one round; added before `settle()` in two tests
- Error selector rename in `FuzzMiningPool`

Result: 675 → 677 tests passing (2 N-01 regression tests added in Phase 0).

## Static analysis baseline (2026-04-17)

### Slither 0.11.5 — 113 findings across 13 detector categories

Run: `slither contracts/` (root `slither.config.json` filters `lib/`, `contracts/test/`, `contracts/script/`). Full log at `/tmp/slither-baseline.log` — not committed (regenerable).

Summary by category:

| Detector | Count | Triage |
|----------|-------|--------|
| `immutable-states` | ~24 | Gas optimization — token/contract addresses set in constructor. Real. Per-contract passes will address. |
| `unchecked-transfer` | 16 | Overlaps with prior audit `I-04` (open). SafeERC20 migration queued. Every CLAW transfer/transferFrom ignores return value. |
| `weak-prng` | 10 | `BreedingLab`: false positive — P-03 future-block entropy is commit-reveal, Slither can't see that. `Faucet`: weaker but soulbound + small quantity; accepted risk. |
| `timestamp` | ~8 | `block.timestamp` comparisons for game timing. Expected pattern; false positive for this use case. |
| `naming-convention` | 5 | Uppercase array constants (`STAKE_BRACKETS`, `TIER_WEIGHTS`, etc.). Semantic constants — intentional. |
| `reentrancy-no-eth` | 5 | TeamManager + BattleArena + Marketplace do external calls before state update. All paths are behind `nonReentrant`; exposure only if an ERC-777-style callback hook exists on CLAW/NFT (not applicable here). Worth re-examining in per-contract pass. |
| `divide-before-multiply` | 1 | BreedingLab cost formula. Addressed by prior audit `S-06` as documented negligible precision loss at 18 decimals. |
| `incorrect-equality` | 3 | `== 0` for sentinel checks (BattleArena phase, BreedingLab lastBreed). Defensible idiom — mapping defaults to 0. |
| `reentrancy-events`, `reentrancy-benign`, `uninitialized-local`, `unused-return`, `calls-loop` | 1 each | Deferred to per-contract passes. |

Notable for Phase 1 sprint (BattleArena, BattleResolver, MiningPool, Treasury):
- **unchecked-transfer**: 6 in BattleArena alone (deposit, settle, cancel, forfeit). SafeERC20 migration during BattleArena pass.
- **reentrancy-no-eth** in BattleArena.deposit and BattleArena.revealTeam — re-check during pass.
- **immutable-states** — 5 BattleArena fields, 3 MiningPool fields: tidy during pass.

### Aderyn 0.1.9 — deferred

See T-01. Not blocking.

## Phase 0 — done

All six planning steps completed:
1. Tools verified (Slither 0.11.5, Aderyn 0.1.9 installed but blocked on T-01, Codex 0.117.0 authenticated, forge 1.5.1)
2. Codex runtime confirmed (direct mode, ready on first call)
3. `foundry.toml`: `ci` and `deep` profiles added, invariant blocks on all three profiles
4. Slither baseline captured and categorized; Aderyn deferred per T-01
5. Campaign tracker (this file) created, cross-referenced to `2026-03-06-manual-contract-audit.md`
6. N-01 fixed with 2 regression tests; T-02 test migration landed

Next: Phase 1 sprint — BattleArena per-contract attack loop.

## Per-contract notes

Populated as each contract is audited.

### BattleArena.sol — Phase 1 in progress

**Read pass (2026-04-17)**. Top attack angles identified:

- **A. Resolver omnipotence** (→ H-01 mitigation) — `settle()` trusted `winner` + `damage[]` calldata with only a `lastVerifiedRound > 0` gate. A compromised resolver could declare either player winner and apply arbitrary damage.
- **B. Settlement enabled after 1 round** — `lastVerifiedRound > 0` gate means rounds 2-7 are not required for settlement. Intended but worth an invariant that at least one round's moves were revealed on-chain.
- **C. `_handleActiveTimeout` cumulative-counter bypass** — a griefer can time out 2 of every 3 rounds without hitting AUTO_FORFEIT_THRESHOLD. Post-N-01 bounded by MAX_ROUNDS, so worst case ~14 timeouts over 7 rounds.
- **D. `emergencyWithdraw` starvation** — `lastProgressAt` only updates on `advanceRound`; a malicious resolver could advance every 23h59m to block the 24h emergency exit. H-01's challenge window partially addresses this (stakes can't be seized, only delayed).
- **E. Team-lock race on `revealTeam`** — `setTeamActive(true)` called before phase→Active (Slither flagged as cross-function reentrancy candidate). Non-exploitable with current NFT/ERC20 (no callbacks).
- **F. Consent-less `createBattle`** — matchmaker can create battles for arbitrary pairs. Benign (unwilling player can't be harmed), but bounded by MATCHMAKER_ROLE trust.

**H-01 challenge window implementation (2026-04-17)**.

- Added `BattlePhase.AwaitingFinalize` between `Active` and `Settled`.
- Added `DISPUTE_WINDOW = 5 minutes` constant.
- Added `Battle` struct fields: `proposedWinner`, `proposedWinnerDamage`, `proposedLoserDamage`, `payoutDeadline`, `disputed`.
- Refactored `settle()` (RESOLVER_ROLE): records the proposed outcome + transitions to `AwaitingFinalize` + sets `payoutDeadline`. No transfers, no damage, no team release. Emits `BattleProposed(battleId, proposedWinner, payoutDeadline)`.
- New `disputeBattle(battleId, bytes evidence)`: either participant, within DISPUTE_WINDOW. Sets `disputed=true`. Evidence is emitted, not verified on-chain. Reverts: `DisputeWindowClosed`, `AlreadyDisputed`, `NotBattleParticipant`.
- New `finalizeBattle(battleId)`: permissionless, after `payoutDeadline`, if `!disputed`. Executes the payout. Reverts: `DisputeWindowOpen`, `BattleIsDisputed`.
- New `adminResolveDispute(battleId, winner, winnerDmg, loserDmg)`: `DEFAULT_ADMIN_ROLE` only, for disputed battles. Admin can override the resolver's winner AND damage arrays. Reverts: `NotDisputed`, `InvalidWinner`. Emits `BattleAdminResolved(battleId, winner)`.
- `handleTimeout`: extended to cover `AwaitingFinalize`. Undisputed + deadline elapsed = permissionless auto-finalize. Disputed = revert `DisputedBattleRequiresAdmin` (admin must use `adminResolveDispute`).
- `_executePayout` extracted from old `settle()`: handles the actual transfers + damage + team release. Called by both `finalizeBattle` and `adminResolveDispute`.
- Trust NatSpec rewritten to document the new flow.

**Open risk documented in NatSpec**: if admin is AWOL while a battle is disputed, stakes stay escrowed indefinitely. A future "long-dispute auto-cancel" (e.g., 7 days → refund both, treat as MutualTimeout) can mitigate; admin liveness is the S1 assumption.

**Test coverage added**:
- 12 H-01 tests (`test_H01_*`) in `FuzzBattleArena.t.sol`: happy-path finalize, settle side-effect checks, early finalize, late dispute, non-participant dispute, double dispute, finalize-on-disputed, admin override, admin-without-dispute, admin invalid-winner, handleTimeout auto-finalize, handleTimeout-disputed revert.
- Existing tests migrated for the two-step flow: 11 in `test/BattleArena.t.sol`, 2 in `test/BoundaryTests.t.sol`, 2 in `contracts/test/fuzz/FuzzBattleArena.t.sol`. Added helper `_settleAndFinalize`.

**Suite state**: 689/689 passing (677 before H-01 + 12 new H-01 tests).

**Invariants landed (2026-04-18, task 15)** — `contracts/test/invariant/InvariantBattleArena.t.sol` with a dedicated `BattleArenaHandler` at `contracts/test/invariant/handlers/BattleArenaHandler.sol`:

- **I-1 `invariant_currentRoundBounded`** — `currentRound <= MAX_ROUNDS` across every tracked battle. Direct continuous-regression guard for N-01.
- **I-2 `invariant_lastVerifiedRoundLeCurrentRound`** — `lastVerifiedRound <= currentRound`. Ensures the settlement-gating counter never overtakes the round counter.
- **I-3 `invariant_escrowCoversActiveBattles`** — arena CLAW balance ≥ sum of deposited stake+antigrief across all non-terminal battles. Catches any leak path that drains escrow without transitioning the phase.
- **I-4 `invariant_teamInBattleMatchesPhase`** — terminal battles have released `teamInBattle[teamId]` for both teams. Catches leaked team locks.
- **I-5 `invariant_winnerIsParticipant`** — whenever `b.winner != address(0)`, it's a battle participant. Any path that writes a non-participant winner trips this.
- **I-6 `invariant_awaitingFinalizeHasProposal`** — battles in AwaitingFinalize always have a valid `proposedWinner` and non-zero `payoutDeadline`. Protects the H-01 flow against writes that land a battle in the veto window without a usable proposal.

Handler restricts `targetSelector` to only the `handler_*` entry points (13 total) so the fuzzer can't re-invoke the inherited `BaseSetup.setUp()` and orphan the ghost arrays.

**Adversarial fuzz tests landed (2026-04-18, task 16)** — 5 new tests in `FuzzBattleArena.t.sol`:

- `testFuzz_disputeWindow_boundaryInside_accepted` — fuzzes `block.timestamp` across `[now, payoutDeadline]`; asserts dispute is accepted at the boundary (<=).
- `testFuzz_disputeWindow_pastDeadline_rejected` — fuzzes `payoutDeadline + [1s .. 365d]`; asserts `DisputeWindowClosed`.
- `testFuzz_commitHash_wrongRound_revealFails` — fuzz-commits a hash bound to the wrong round; asserts reveal fails with `InvalidCommitHash`. Prevents precommit/replay across rounds.
- `test_attack_emergencyWithdraw_blockedByResolverAdvance` — demonstrates attack angle D: a resolver calling `advanceRound` just under `EMERGENCY_WITHDRAW_DELAY` (24h) indefinitely blocks `emergencyWithdraw`. Starvation ends at `MAX_ROUNDS` (advanceRound then reverts). Documents the trust-model gap; post-H-01 the player has `disputeBattle` as recourse once settlement is proposed, but the Active-phase gap remains in the trust NatSpec.
- `testFuzz_consecutiveTimeoutCounter_monotonic` — fuzzes the number of successive commit-only-from-B timeouts; asserts `consecutiveTimeoutsA` strictly increases on each timeout until the forfeit threshold.

**Deep profile run (task 17)** — in progress 2026-04-18. Invoked as `FOUNDRY_PROFILE=deep forge test --match-path 'contracts/test/{fuzz,invariant}/*BattleArena*'` (50k fuzz runs, 2000 invariant runs × depth 200, seed-pinned `0xc1a88ada`). Results will be appended here.

**Remaining for Phase 1**:
- Codex red-team pass on BattleArena (task 18).
- Triage + post-fix second Codex pass (task 19).

### BattleResolver.sol — Phase 1 done 2026-04-18

Pure math library (241 LOC, all `internal pure`). Currently consumed only by the off-chain battle engine; `BattleArena` stores externally-computed damage arrays rather than recomputing them on-chain. Attack surface is therefore the caller-boundary more than the library itself.

**Read pass**: identified precision/overflow edge cases, input-domain abuse (classMult, purity, vrfRoll), and the `_cappedRatio` extreme-atk overflow. Existing fuzz suite already covered 17 angles (damage bounds, crit monotonicity, class advantage graph, anti-symmetry, legend bonus, crit chance, purity scaling, etc.).

**New fuzz tests (task 23, 7 added)**:
- `test_tournament_graph_four_four_two` — every class has exactly 4 adv / 4 disadv / 2 neutral matchups
- `testFuzz_scaleStats_tier_monotonic` — tier progression is weak-monotonic across all 5 stats
- `testFuzz_hp_battle_scale_at_base_tier` — confirms HP × 5 scaling at tier 0 non-legend
- `testFuzz_ratio_cap_clamps_extreme_attacks` — atk/armor pairs past 2.2× cap produce identical damage
- `testFuzz_purity_above_spec_scales_predictably` — documents that library does NOT bound purity (caller responsibility)
- `testFuzz_deriveRandom_deterministic` / `testFuzz_deriveRandom_saltSensitivity` — hash determinism + salt sensitivity
- `testFuzz_cappedRatio_overflowGuard` — R-03 regression

**Deep profile (task 24)**: 23/23 passing at 50k fuzz runs each, 3.2s.

**Codex red-team pre-fix pass (task 25, 2026-04-18)**: 3 findings, all caller-boundary:
- R-01 (Low): `classMult` outside {800, 1000, 1250} silently zeroes damage. No runtime check.
- R-02 (Low): out-of-spec `purity` or `vrfRoll` inflate damage or overflow.
- R-03 (Info): `_cappedRatio` still overflows on `atk > type(uint256).max / MULT_DENOM` — S-03 hardened the `armor == 0` path but not the absurd-atk path.

**Response**:
- **R-03 fixed** via short-circuit: `if (atk > type(uint256).max / MULT_DENOM) return STAT_RATIO_CAP;` before the multiply. Regression test `testFuzz_cappedRatio_overflowGuard` asserts huge-atk damage equals past-cap damage.
- **R-01 and R-02 documented** in a new "CALLER-BOUNDARY CONTRACT" NatSpec block at the top of the library. Runtime guards not added: library is currently off-chain-only, `BattleArena` stores externally-computed damage arrays. If `BattleResolver` is ever imported for on-chain verification, callers MUST enforce classMult ∈ {800, 1000, 1250}, purity ≤ 6, and vrfRoll ∈ [VRF_MIN, VRF_MAX] before calling. An alternative hardening (adding runtime `require` guards to the three damage functions) was considered but rejected for S1 scope — it forces every caller to route through the library's specific error selectors even for off-chain-computed paths that already validate upstream.

**Codex post-fix pass (task 26, 2026-04-18)**: verdict on R-03 fix: **correct-but-incomplete** — threshold is off-by-one correct, no new bugs, but it's a saturating approximation (returns cap for `atk > uint256.max / MULT_DENOM` with extreme armor even when the true ratio would be below cap). Acceptable: in-spec stats never approach that regime; documented in NatSpec.

**Second-pass findings** (4 additional caller-boundary issues):
- **R-04 (Low, NatSpec)**: `calculateSpecialDamage` trusts caller-supplied `basePower`. Must be from `getSpecialBasePower()`. Documented.
- **R-05 (Low, NatSpec)**: `scaleStats` trusts caller-supplied `base` stat magnitudes. Must be from `getBaseStats()`. Documented.
- **R-06 (Medium, FIXED)**: `enhancedProcChance` returns BPS above 10_000 when purity > 19 (e.g., 128_000 at purity=255). Callers using the result against a 0..9999 roll get unconditional procs. Fix: cap result at 10_000 BPS inside the function. Regression test `testFuzz_enhancedProcChance_capped_at_100pct` + `test_enhancedProcChance_capAtHighPurity` cover the cap. This is a *real* semantic contract bug (probability must be ≤ 100%), hence the cap rather than NatSpec-only.
- **R-07 (Low, NatSpec)**: `critChance` numerator `critStat * 10_000` overflows for huge `critStat`. Spec stats cap at ~270 post-scale; documented as caller contract.

**Final verdict on BattleResolver (Codex post-fix)**: the R-03 change fixes the `_cappedRatio` overflow panic; R-06 fix preserves the BPS-is-probability contract. Library is clean for its stated off-chain-only usage with the documented caller contract. Not fully clean as a generic permissive primitive — but explicitly documented as such.

### MiningPool.sol — Phase 1 in progress 2026-04-20

297-LOC contract managing seasonal emissions: fixed per-expedition rewards (`baseReward × TIER_WEIGHTS[tier]`), `totalMinted` ledger capped at `totalEmission`, 4-hour expeditions, 60-day seasons, and an admin-only emergency release (F-06) for stuck expeditions.

**Read pass (task 27)** — key attack angles identified:
- **A. Season rollover**: `startSeason` resets `totalMinted` to 0. Unclaimed expeditions from prior seasons stay in escrow and remain claimable (tested).
- **B. Tier-gate at start-only**: once started, reward + tier are locked in the expedition struct; lobster evolution mid-expedition can't retroactively affect the tier gate.
- **C. Admin release vs user claim race**: both set `claimed = true`. Admin can only release after `EXPEDITION_DURATION + 7d` grace; user can claim any time after `EXPEDITION_DURATION`. If user doesn't claim within 7 days, admin can burn the reward. This is F-06 design tradeoff — documents a trust-based grief vector.
- **D. `setBaseReward` admin lever**: admin can change baseReward mid-season; affects future expeditions only (locked at start for in-flight). In a compromised-admin scenario, this is a favoritism vector (raise reward, let crony start, lower back) — bounded by per-season budget cap.
- **E. CLAW supply exhaustion at start**: `clawToken.mint` at expedition start (not at claim) — reverts `ExceedsMaxSupply` loudly rather than silently locking teams. This is the M-02 fix.
- **F. Budget-exhaustion dust**: per-season `totalMinted` can approach but never exceed `totalEmission`; residual dust surfaced via `getSeasonUnspent`, not a bug.

**Slither scoped triage (task 28)**:
- `unchecked-transfer` at line 221 (overlaps prior I-04 SafeERC20 work).
- `reentrancy-no-eth` on `startExpedition.clawToken.mint` before `_teamToExpedition[teamId] = expId`. False positive: `startExpedition` is `nonReentrant`, and `clawToken` has no callbacks.
- `calls-loop` on `lobsterNFT.getEvolutionTier` inside the 3-iteration tier-gate loop. Bounded, not a DoS.
- `timestamp` comparisons: all legitimate for time-gated mechanics.

No new actionable findings from Slither.

**New invariants landed (task 29)** — `contracts/test/invariant/InvariantMiningPool.t.sol` with handler at `contracts/test/invariant/handlers/MiningPoolHandler.sol`:
- **I-1 `invariant_seasonBudgetCap`** — for every season ever started, `totalMinted <= totalEmission`. `SeasonBudgetExhausted` enforces at write time; invariant confirms under arbitrary sequences.
- **I-2 `invariant_escrowMatchesUnclaimedRewards`** — `clawToken.balanceOf(MiningPool) == sum(reward over unclaimed expeditions)`. Strongest invariant: catches lost escrow, double-mint, or burn-before-clear in `adminReleaseExpedition`.
- **I-3 `invariant_seasonMonotonic`** — `currentSeason` is non-decreasing across handler sequences. Trivially true today; regression guard for future admin functions.
- **I-4 `invariant_rewardIsTierWeightMultiple`** — every expedition's reward is a multiple of its tier weight ∈ {1, 3, 10, 25} and non-zero. Breaks if reward math ever drifts to fractional logic.
- **I-5 `invariant_teamExpeditionLinkConsistent`** — unclaimed expedition implies `_teamToExpedition[teamId] == expId` AND `teamManager.isTeamActive(teamId) == true`.

Handler `targetSelector`-restricts to 6 `handler_*` entrypoints to prevent the fuzzer from calling inherited `BaseSetup.setUp()` mid-run.

**New adversarial fuzz tests (task 30)** — 9 added to `FuzzMiningPool.t.sol`:
- `test_adminRelease_happyPath` — F-06 feature test (previously untested!): after grace, burns reward, unlocks team.
- `testFuzz_adminRelease_beforeGrace_reverts` — any warp `< EXPEDITION_DURATION + 7d` reverts.
- `test_adminRelease_afterUserClaim_reverts` — user-first wins the race.
- `test_claim_afterAdminRelease_reverts` — admin-first wins the race; user can't claim burned reward.
- `test_adminRelease_onlyDefaultAdmin` — access control enforcement.
- `test_season_rollover_preservesUnclaimedExpeditions` — unclaimed S1 expedition still claimable in S2.
- `test_season_budgetIsolation` — S2's `totalMinted` starts at 0; S1 accounting unchanged.
- `testFuzz_startSeason_beforePriorEnds_reverts` — `SeasonStillActive` at every timestamp strictly before the 60-day mark.
- `testFuzz_setBaseReward_doesNotAffectInflight` — in-flight reward locked across arbitrary new baseReward values.

**Deep profile run (task 31, 2026-04-20)**: 24/24 passing. Invariants run 2M handler calls each (2000 runs × depth 200 with seed `0xc1a88ada`); fuzz tests run 50k × 19. Total wall-clock 145s.

**Codex red-team pre-fix pass (task 32, 2026-04-20)** — 2 Medium findings:

### M-01: ACTIVITY_ROLE compromise + team disband permanently locks an expedition

Severity: Medium (defense-in-depth — requires ACTIVITY_ROLE compromise, but outcome is permanent fund lock)

Status: **Fixed** 2026-04-20 (guard `setTeamActive` with `teamExists` in both `claimExpedition` and `adminReleaseExpedition`).

Sequence:
1. User calls `startExpedition`; MiningPool records `_teamToExpedition[teamId] = expId` and calls `teamManager.setTeamActive(teamId, true)`.
2. Compromised `ACTIVITY_ROLE` on TeamManager calls `setTeamActive(teamId, false)` directly. MiningPool's `_teamToExpedition` is unchanged.
3. Team owner calls `TeamManager.disbandTeam(teamId)` — TeamManager only checks `team.active == false`, so disband succeeds and deletes the team record.
4. Later, `claimExpedition` or `adminReleaseExpedition` reaches `teamManager.setTeamActive(expedition.teamId, false)` → reverts `TeamDoesNotExist`.
5. Pre-fix: the whole tx rolls back including `expedition.claimed = true` and the `_teamToExpedition` clear. Escrowed CLAW is permanently stuck; no path reaches terminal state.

Impact: permanent CLAW lockup and permanently non-terminal expedition state if ACTIVITY_ROLE is ever compromised (or if a future admin action accidentally revokes the team while an expedition is live). The season budget also stays consumed — it can't roll over because `totalMinted` isn't refunded.

Fix (both paths):
```solidity
if (teamManager.teamExists(expedition.teamId)) {
    teamManager.setTeamActive(expedition.teamId, false);
}
```

Regression tests: `test_M01_claim_toleratesDeletedTeam`, `test_M01_adminRelease_toleratesDeletedTeam`. Both drive alice-as-compromised-ACTIVITY_ROLE to force-unlock + disband the team mid-expedition, then assert the terminal path still delivers reward / burns as expected.

Not a fix to the root cause (TeamManager allows disband of teams with external attached state). The deeper fix lives in TeamManager or a cross-contract registry — deferred; adding that now would create a cyclic `MiningPool ↔ TeamManager` dependency. MiningPool-side resilience is the cheap, correct defense.

### M-02: SEASON_ADMIN can redirect 100% of remaining season budget to a chosen team

Severity: Medium (trust-boundary)

Status: Documented as a concrete instance of the prior audit's open **C-05** ("admin god-key, no multisig / timelock"). No runtime fix.

Sequence:
1. Let `R = totalEmission - totalMinted` (remaining budget).
2. Compromised SEASON_ADMIN sets `baseReward = R`.
3. Tier weight for Base is 1, so any team can start a Base expedition with `reward = R × 1 = R`.
4. The `totalMinted + reward > totalEmission` check allows exact equality, so the expedition consumes the full remainder in one shot.
5. 4 hours later, the owner claims the entire season's remaining emissions.

Impact: SEASON_ADMIN is not just "tune rewards" — it's "instantly allocate the entire remaining season budget to yourself or cronies." Bounded by the per-season budget cap (not global supply).

Mitigation strategy: this is addressed by the C-05 work (multisig + timelock on admin roles) planned for Phase 4 rather than runtime enforcement here. Adding a cap on `setBaseReward` delta (e.g., ±2× per call) would harden it further but breaks legitimate tuning (e.g., if Season 1 data suggests a 5× increase, admin currently needs one call). The S1 stance: trust SEASON_ADMIN as multisig-operated; document the blast radius.

Deploy-day runbook item (task C-05 follow-up): `SEASON_ADMIN_ROLE` must be held by the same multisig as `DEFAULT_ADMIN_ROLE`, with explicit governance review for any mid-season `setBaseReward` call that would exceed `2 × current baseReward`.

**Cleared by Codex pass (not bugs)**:
- Budget-cap precision — no bypass; zero-reward expeditions impossible (`baseReward > 0` enforced).
- Season-end boundary — consistent at `startTime + 60 days`.
- Escrow-drain / insufficient-balance drift — OZ ERC20 reverts on insufficient balance for both `transfer` and `burn`.
- Multi-season carry-over — clean isolation.
- `team.active` race at start — no reentrancy window with current CLAW (no hooks).
- Tier gate timing — start-only snapshot is correct (reward/tier locked in struct).
- Terminal path `_teamToExpedition` cleanup — correct in honest flows (with M-01 fix, resilient to compromised-role paths).

**Codex post-fix pass (task 33, 2026-04-20)**: verdict on M-01 fix: **correct**. Confirmed `teamExists` is a view with no side effects; deleted-team path is semantically correct (no stale `active` bit to clean up because `disbandTeam` deletes the entire record); the guard doesn't mask legitimate failures (missing ACTIVITY_ROLE still reverts when the team exists); no new divergence between `_teamToExpedition` and `team.active`. Start-path (`startExpedition`) doesn't need the same guard — team lifecycle is atomic within a non-reentrant call. Final verdict: "`MiningPool.sol` looks clean in the reviewed post-M-01 scope."

No new findings from the post-fix pass.

### Treasury.sol — Phase 1 done 2026-04-20

104-LOC fee splitter. `processFee(amount)` pulls via `transferFrom`, burns 85% via `clawToken.burn`, forwards 15% to `devWallet`. Atomic pull-split-burn — no token accumulation. Owner (Ownable2Step) can update devWallet and toggle authorized callers.

**Read pass**: fee-split math under small amounts, `setClawToken` one-time setup, `setDevWallet` race, authorization revocation DoS, reentrancy paths (nonReentrant guard active), `devWallet = address(this)` self-routing.

**Slither**: 2 `unchecked-transfer` findings on `transferFrom`/`transfer` — false positives (OZ ERC20 reverts on failure). Overlaps prior I-04.

**New tests (10 added to `FuzzTreasury.t.sol`)**: zero-delta single/multi-call invariants, setDevWallet routing, setAuthorized revoke, Ownable2Step 2-step flow, max-supply math, 2 T-03 regressions, 2 T-04 regressions.

**Deep profile**: 14/14 passing at 50k fuzz runs, 6s.

**Codex pre-fix findings** (2 Low):

- **T-03** (Fixed): `processFee` accepted amounts below `BPS_DENOMINATOR`, letting an adversarial caller chunk a fee total into tiny pieces that all round the burn leg to 0 and send 100% to dev. Fix: `require(amount >= BPS_DENOMINATOR)` — minimum 10_000 wei (1e-14 CLAW), far below any realistic in-protocol fee.

- **T-04** (Fixed): `setDevWallet(address(this))` would transfer the 15% leg to Treasury itself (an OZ ERC20 self-transfer no-op in balance terms), silently accumulating inside Treasury with no sweep path. Fix: reject at both constructor and `setDevWallet`.

**Codex post-fix pass**: verdict T-03 `correct-but-incomplete` because of a Marketplace knock-on regression (fixed as T-05 below in the same commit); T-04 `correct`, no edge cases; no further findings.

### T-05: Marketplace dust listings unbuyable post-T-03 (knock-on)

Severity: Low (caller alignment with Treasury T-03)

Status: **Fixed** 2026-04-20.

Under T-03, Marketplace listings cheap enough to produce a fee in `[1, 9_999]` (i.e., prices in `[40, 399_999]` at the 2.5% fee rate) landed in a broken state: the listing was valid at creation but `buyLobster` would revert `AmountBelowMinimum` on the subsequent `treasury.processFee(fee)` call.

Fix: `Marketplace.MIN_LISTING_PRICE = 400_000` enforced at both `listLobster` and `updatePrice` via `PriceBelowMinimum(price, minimum)` error. Derivation: `price × FEE_BPS / BPS_DENOMINATOR >= Treasury.BPS_DENOMINATOR → price >= 400_000`. At 18-decimal CLAW this is 4 × 10^-13 CLAW, well below any realistic listing.

**Listing state**: pre-fix, dust listings could be created but not bought — stuck with escrowed NFT. Post-fix, they're rejected at creation. No existing listings are affected at launch (repo has no deployed state).

Regression tests: `test_boundary_marketplace_dustPriceList_reverts` (BoundaryTests), `test_boundary_marketplaceLowPriceZeroFee_rejected` (retargeted from prior success expectation), `testFuzz_price_update_belowMin_reverts` (FuzzMarketplace).

### BreedingLab.sol — Phase 2 done 2026-04-21

390-LOC 2-step breeding: `requestBreed` charges fee, increments breed counts, sets cooldown, stores request with `targetBlock = block.number + 2`. `finalizeBreed` (permissionless after targetBlock) uses `blockhash(targetBlock)` as entropy to generate offspring DNA. `cancelExpiredRequest` (permissionless after 256-block lookback) refunds breed counts.

**Read pass (task 39)**: checked randomness, cost formula precision at high generations, cooldown gaming, burn-mid-flow handling, allele ordering determinism, hardcoded vs public `BREED_MULTIPLIERS`.

**Slither (task 40)**: 6 weak-prng flags (all false positives — P-03 commit-reveal), divide-before-multiply (S-06 documented), uninitialized-local false positive. No new actionable findings.

**New fuzz tests (task 41)** — 12 added to `FuzzBreedingLab.t.sol` covering the 2-step flow: permissionless finalize mints to requester, finalize-beforeTarget/afterExpiry/double, cancel-expired-restores-counts, cancel-beforeTarget/notExpired/afterFinalize, cancel-with-burned-parent-tolerates, offspring-class-from-parents (fuzz), offspring-legend-bit-valid, cost-no-overflow-at-high-gen.

**Deep profile (task 42)**: 23/23 passing at 50k fuzz runs each, 18s.

**Codex red-team pre-fix pass (task 43, 2026-04-21)** — 2 real findings:

### B-01: Off-by-one in finalize/cancel time gates

Severity: High (system-wide griefing vector)

Status: **Fixed** 2026-04-21.

At `block.number == targetBlock`, `blockhash(targetBlock)` returns 0 (current block has no completed hash). Pre-fix, both entrypoints used `if (block.number < req.targetBlock) revert TooEarlyToFinalize`. At exactly `targetBlock`:
- `finalizeBreed`: time gate passes (`<` is false), blockhash = 0 → reverts `RequestExpired`. User can't finalize.
- `cancelExpiredRequest`: time gate passes, blockhash check `!= 0` fails (hash is 0) → cancel proceeds and burns the request.

Impact: any outsider (grief bot) can race to cancel every breed request at the user's targetBlock. Fee is already burned via Treasury; user loses it. A persistent griefer effectively disables breeding protocol-wide.

Fix (1 line each, both entrypoints): `<` → `<=`. The valid window shifts to `targetBlock + 1 .. targetBlock + 256` for finalize, `targetBlock + 257+` for cancel. At `targetBlock` both revert TooEarlyToFinalize.

Regression tests: `test_B01_cancel_atExactTargetBlock_reverts`, `test_B01_finalize_atExactTargetBlock_reverts`, `test_B01_finalize_atTargetPlusOne_succeeds`.

### B-02: Contract requesters can veto unfavorable offspring via `onERC1155Received` hook

Severity: Medium (scarcity/anti-sniping bypass)

Status: **Fixed** 2026-04-21.

Sequence:
1. Attacker deploys a contract with a conditionally-reverting `onERC1155Received` (e.g., "revert if offspring DNA lacks legend bit").
2. Contract calls `requestBreed`.
3. Someone calls `finalizeBreed`. It computes DNA + calls `lobsterNFT.mintWithGeneration(requester, ...)`. OZ ERC-1155 `_mint` invokes `onERC1155Received` on the contract requester. Hook reverts.
4. Whole finalize tx reverts; `req.finalized = true` rolls back.
5. Attacker waits 256 blocks. Calls `cancelExpiredRequest` — breed counts are refunded.
6. Fee is burned but breed count is recoverable. Attacker farms legends/high-purity rolls at ~fee per attempt instead of ~fee per breed-slot.

Weakens the 5-breed-per-lobster scarcity gate. Legend farming becomes cheap in CLAW terms.

Fix: wrap the mint in `try { } catch { }` in `finalizeBreed`. `req.finalized = true` is committed before the mint, so a rejected mint still consumes the request. Attack becomes -EV (fee burned, breed count burned, no offspring). Emits `LobsterBredRejected(requestId, offspringDna, cost)` for off-chain visibility.

Regression test: `test_B02_contractRequester_cannotVetoAndRefund` — drives a `MaliciousRequester` contract with a hook that rejects only offspring mints (operator == BreedingLab). Asserts offspring mint returns 0, request is finalized, `cancelExpiredRequest` reverts RequestAlreadyFinalized, and breed counts are NOT refunded.

### B-03: Bare `catch {}` silently burns requests on protocol-side mint failures

Severity: Medium (fail-open on role misconfiguration)

Status: **Fixed** 2026-04-21.

Codex post-fix pass flagged a knock-on: the B-02 `catch {}` is a blanket catch that absorbs ANY mint revert, including legitimate protocol failures like `AccessControlUnauthorizedAccount` (BreedingLab lost MINTER_ROLE). In that case, the user's fee + breed count get silently burned with no offspring, and no way to retry after role restoration.

Fix: pre-flight MINTER_ROLE check BEFORE committing `req.finalized = true`:
```solidity
if (!lobsterNFT.hasRole(lobsterNFT.MINTER_ROLE(), address(this))) {
    revert NotAuthorizedToMint();
}
```
Now: role missing → revert loudly (no state change, user can retry). Role present but recipient hook reverts (B-02 case) → try/catch consumes request as intended. New error `NotAuthorizedToMint()`.

Regression test: `test_B03_missingMinterRole_revertsBeforeConsuming` — admin revokes MINTER_ROLE, finalize reverts `NotAuthorizedToMint`, request is NOT consumed, admin regrants, finalize succeeds.

**Codex post-fix verdict on all three**: "ship with caveats" → "ship" after B-03 landed. B-01 correct, B-02 correct, B-03 covers the bare-catch surface.

**Cleared**: off-by-one in finalize vs cancel boundary (confirmed correct at targetBlock+1, +256, +257); cost formula overflow unreachable; concurrent-transfer race clean; parent burn mid-flow handled; allele ordering deterministic via strict `<` in bubble sort; class inheritance unbiased; no other `blockhash(future)` usage in the codebase.

### LobsterNFT.sol — pending Phase 2

### EvolutionLab.sol — pending Phase 2

### Marketplace.sol — pending Phase 2

### Faucet.sol — pending Phase 2

### RepairShop.sol — pending Phase 2

### TeamManager.sol — pending Phase 2

### BattleVRF.sol — pending Phase 2

### ClawToken.sol — pending Phase 2

## Codex red-team logs

Each contract pass produces two Codex transcripts (pre-fix and post-fix). Logged here as added.

## Open questions

- **H-01 challenge window length**: 5 minutes default. Low-stake battles (2,500 $CLAW) may warrant a shorter window (60s) — calibrate during Phase 1 BattleArena sprint pass.
- **Slither baseline noise**: first run will likely produce many access-control / uninitialized-state warnings on custom patterns. Triage before logging in tracker.
