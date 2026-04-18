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
| **N-01** | Low | **Fixed** | BattleArena | `_handleActiveTimeout` advances `currentRound` past `MAX_ROUNDS` |
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

### BattleArena.sol — pending Phase 1

### BattleResolver.sol — pending Phase 1

### MiningPool.sol — pending Phase 1

### Treasury.sol — pending Phase 1

### BreedingLab.sol — pending Phase 2

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
