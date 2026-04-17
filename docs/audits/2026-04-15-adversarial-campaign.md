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
| **N-01** | Low | Open | BattleArena | `_handleActiveTimeout` advances `currentRound` past `MAX_ROUNDS` |

## Findings

### N-01: `_handleActiveTimeout` advances `currentRound` past `MAX_ROUNDS`

Severity: Low (state-machine integrity, not fund loss)

Status: Open — fix queued for Phase 0 step 6.

Affected files:
- `contracts/BattleArena.sol` (line ~648 — verify before fix; contract may have shifted)

Summary:

The F-03 hardening (see `2026-03-06-manual-contract-audit.md`) added a `MAX_ROUNDS` cap to `advanceRound()` at line ~352 but missed the neighboring path in `_handleActiveTimeout()` at line ~648. When a player times out during the `Active` phase, `_handleActiveTimeout()` increments `b.currentRound++` unconditionally. The forfeit-after-3-consecutive-timeouts mechanism still bounds total escalation, but the round counter can exceed the documented maximum during the window before forfeit triggers. This breaks the state machine's documented round-bound invariant.

Severity rationale:
- No fund loss: stakes are still gated by phase transitions and the forfeit path
- State-machine integrity: external observers (UI, indexers, replay tools) that assume `currentRound <= MAX_ROUNDS` may misbehave
- Sets precedent for similar "neighboring bug" misses elsewhere — motivates the campaign's "second Codex pass on every fix" pattern

Fix options (user picks at execution time):

(a) Add the same guard pattern as `advanceRound()`:
```solidity
if (b.currentRound >= MAX_ROUNDS) {
    // either revert, or transition to a settle path
}
b.currentRound++;
```

(b) **Preferred** — force-forfeit the timed-out side instead of advancing the round. Eliminates the round-stretch path entirely and aligns with the spirit of the forfeit-after-3 rule (a player who times out at round 7 is forfeiting; no need to advance to round 8).

Regression test:

Add to `contracts/test/fuzz/FuzzBattleArena.t.sol` — call `handleTimeout()` repeatedly past round 7 and assert `currentRound <= MAX_ROUNDS`. Test must FAIL on current code (proves the bug) and PASS after fix.

Discovery: planning-session contract exploration, 2026-04-16.

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
