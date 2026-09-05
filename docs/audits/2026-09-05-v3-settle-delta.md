# BattleArena V3 settle delta — surface note (2026-09-05)

**Plain-language summary.** Battles are now played off-chain, turn by turn, over WebSocket. The
contract no longer sees any move data: it only escrows the stakes, binds the two teams, and pays
out a result the resolver proposes. This change makes the contract *smaller* — roughly 200 lines
of the audited per-round commit/reveal machinery are gone — and adds three things: a settlement
that carries two commitments to the off-chain battle, a draw payout, and a hard time limit on the
Active phase so a dead server can never trap a stake.

Scope: `contracts/BattleArena.sol` only. `BattleResolver.sol` keeps a now-unused `MAX_ROUNDS`
constant (V2 remnant; flagged in code, removed with the S2 replay port).

## What was removed (V2 on-chain round loop)

| Removed | Was |
|---|---|
| `commitMoves`, `revealMoves`, `advanceRound` | per-round move commit/reveal + resolver advance |
| `COMMIT_WINDOW`, `REVEAL_WINDOW`, `AUTO_FORFEIT_THRESHOLD`, `MAX_ROUNDS` | round timing / cap |
| struct fields `currentRound`, `lastVerifiedRound`, `consecutiveTimeoutsA/B`, `roundCommitA/B`, `roundRevealedA/B`, `proposedWinnerDamage`, `proposedLoserDamage` | round state |
| events `RoundStarted`, `MoveCommitted`, `MoveRevealed` | round telemetry |
| errors `SettlementRequiresVerifiedRound`, `BothCommitsRequired`, `BothRevealsRequired`, `MaxRoundsReached`, `AlreadyRevealed` | round guards |
| `_handleActiveTimeout` (timeout ladder) and `_forfeitAsLoss` | per-round forfeit paths |

Findings that referenced this code and are now **moot by construction**: BA-H1 (reveal-withhold
as cheap exit), BA-M1's Active-phase half (late commit), N-01 (round cap on the timeout path),
N-02 (`lastProgressAt` refresh on timeout-driven advance), P-02/P-04 (reveal withhold, cumulative
timeout counters), F-02/F-03 (both-commits-before-reveal, `MAX_ROUNDS`). Their tests were deleted
rather than rewritten because the attack surface no longer exists.

## What was added

### `settle(battleId, winner, finalStateHash, turnLogHash, damageA, damageB)` — `RESOLVER_ROLE`
- `winner ∈ {playerA, playerB, address(0)}`; `address(0)` is a **draw**.
- `finalStateHash` = keccak of the canonical final battle state; `turnLogHash` = keccak over
  `{battleId, VRF seed, arena layout, roster, ordered turn log}`. Both must be non-zero
  (`InvalidSettlementHash`) so a dispute always has something to check against — S1: admin review
  from the persisted turn log; S2: `BattleResolver.replay()`.
- Damage arrays are keyed by **player slot** (A/B), not winner/loser, because a draw has no winner.
- Reverts `PhaseTimedOut` after `ACTIVE_WINDOW` (see below): a late settle cannot race the
  permissionless cancel.
- **No `signature` parameter.** The design docs describe `(…, signature)`; the `RESOLVER_ROLE`
  transaction signature *is* the authentication, and an extra in-calldata signature from the same
  key adds nothing. Deliberate deviation, recorded in NatSpec and CLAUDE.md.
- Event `BattleProposed(battleId, proposedWinner, payoutDeadline, finalStateHash, turnLogHash)`.

### `adminResolveDispute(battleId, winner, finalStateHash, turnLogHash, damageA, damageB)` — admin
- Same winner rule (draw allowed) and hash rule.
- BA-M2 extended: the disputer prevails (bond refunded) if the admin changes the winner, **either**
  damage array, **or either hash**. Admin's hashes are stored so the settled battle records the
  outcome that actually paid.

### Draw payout (`_executePayout`, `winner == address(0)`)
- Both players receive `stake + antiGrief` in full. **No protocol fee**, no burn, no dev share.
- Repair damage still applied to both teams; both teams released; `BattleSettled(id, 0, 0, 0)`.
- CEI preserved: phase set to `Settled` before any transfer; all entrypoints `nonReentrant`.

### `ACTIVE_WINDOW = 3 hours`
- `revealTeams` sets `phaseDeadline = now + ACTIVE_WINDOW` (100 turns × 60 s shot clock ≈ 100 min,
  plus settle latency slack).
- `handleTimeout` in Active after the deadline → `_cancelBattle(StaleBattle)`: mutual refund
  incl. anti-grief. **A server failure never costs a player their stake.**
- `emergencyWithdraw` (participant, 24 h after reveal) kept as a belt-and-braces exit; it is
  now mostly redundant.

## Trust / risk notes

- **Resolver authority is unchanged in kind, narrower in shape.** It could always propose any
  winner inside the H-01 window; it can now also propose a draw. Every proposal is still bonded-
  disputable and admin-overridable, and now carries two hashes the disputer can hold it to.
- **Draw as an evasion tool?** A losing player cannot force a draw: only the resolver proposes,
  and a wrong draw is disputable like a wrong winner. A *colluding resolver* proposing draws to
  refund a friend is the same trust assumption as proposing a wrong winner (already accepted in
  S1's server-authoritative model), with strictly less upside (no pot, only fee avoidance).
- **`ACTIVE_WINDOW` race.** A settle that lands after the deadline reverts; a loser could call
  `handleTimeout` at deadline+1 to convert a loss into a cancel. The window is ~2× the theoretical
  maximum battle, so this requires a resolver outage of ≥ 1 hour after a full-length battle; the
  session runbook tracks `settling` latency and alarms well inside the window.
- **Hash semantics are off-chain.** The contract checks only non-zero and equality on dispute; it
  does not (and in S1 cannot) verify that a hash matches a real battle. The turn log persisted by
  the session manager is the evidence; S2 replay makes it verifiable on-chain.
- **Token conservation** now has an exact invariant (`invariant_arenaBalanceEqualsEscrow`): the
  arena holds precisely the owed escrow (deposits of non-terminal battles + disputed bonds) at all
  times across wins, draws, forfeits, cancels and disputes.

## Verification

- `forge test`: 880 passed / 0 failed (24 V2 round tests deleted, 24 V3 tests added: settle from
  Active without rounds, hashes stored/emitted, zero-hash reverts, `ACTIVE_WINDOW` boundary/late
  settle/timeout cancel, draw refund conservation and events, draw↔win disputes both directions,
  hash-only dispute refunds bond, unchanged proposal slashes bond, player-slot damage keying, TM-01
  under the V3 timeout path).
- Fuzz: `testFuzz_settle_damageNeverExceeds100` (win + draw), `testFuzz_settle_draw_isConservative_atEveryBracket`,
  `testFuzz_activeWindow_lateSettleReverts_timeoutRefunds`.
- Invariants: I-5 winner-or-draw, I-6 complete proposal (hashes present), **I-7 exact conservation**;
  handler now settles/resolves to alice / bob / draw and exercises both bond routes.
- Slither `--fail-medium`: clean (informational `block-timestamp` notes only, pre-existing).
- ABI regenerated (`bun run extract-abis`); no V2 function or event names remain.
