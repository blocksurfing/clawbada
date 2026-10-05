// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {BattleArenaHandler} from "./handlers/BattleArenaHandler.sol";
import {BattleArena} from "../../BattleArena.sol";
import {GoldToken} from "../../GoldToken.sol";
import {TeamManager} from "../../TeamManager.sol";
import {LobsterNFT} from "../../LobsterNFT.sol";

/// @dev Stateful invariant harness for BattleArena. The handler drives the full
///      deposit (+consent +commit) → atomic reveal / reveal-failure attribution → (off-chain
///      battle) → settle (win / draw / forfeit) → review → finalize | freeze → resolveFrozen |
///      expireFrozen, plus timeouts, emergency exits and the refund reserve. This contract only
///      reads state and asserts the cross-cutting properties.
contract InvariantBattleArena is Test {
    BattleArenaHandler internal handler;

    function setUp() public {
        handler = new BattleArenaHandler();
        targetContract(address(handler));

        // Restrict the fuzzer to handler_* entrypoints so it doesn't call the inherited
        // BaseSetup.setUp() (which would re-deploy contracts and orphan the battleIds[] ghost array).
        bytes4[] memory selectors = new bytes4[](18);
        selectors[0] = BattleArenaHandler.handler_createAndDeposit.selector;
        selectors[1] = BattleArenaHandler.handler_revealTeams.selector;
        selectors[2] = BattleArenaHandler.handler_settle.selector;
        selectors[3] = BattleArenaHandler.handler_finalize.selector;
        selectors[4] = BattleArenaHandler.handler_freeze.selector;
        selectors[5] = BattleArenaHandler.handler_resolveFrozen.selector;
        selectors[6] = BattleArenaHandler.handler_expireFrozen.selector;
        selectors[7] = BattleArenaHandler.handler_fundReserve.selector;
        selectors[8] = BattleArenaHandler.handler_withdrawReserve.selector;
        selectors[9] = BattleArenaHandler.handler_handleTimeout.selector;
        selectors[10] = BattleArenaHandler.handler_emergencyWithdraw.selector;
        selectors[11] = BattleArenaHandler.handler_warp.selector;
        selectors[12] = BattleArenaHandler.handler_evolvePoolLobster.selector;
        selectors[13] = BattleArenaHandler.handler_healPoolTeam.selector;
        selectors[14] = BattleArenaHandler.handler_openBattle.selector;
        selectors[15] = BattleArenaHandler.handler_accuseRevealFailure.selector;
        selectors[16] = BattleArenaHandler.handler_depositMismatch.selector;
        selectors[17] = BattleArenaHandler.handler_freezeByStranger.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _isLive(BattleArena.BattlePhase p) internal pure returns (bool) {
        return p != BattleArena.BattlePhase.Settled && p != BattleArena.BattlePhase.Cancelled
            && p != BattleArena.BattlePhase.None;
    }

    /// @dev Sum of stake + anti-grief for every deposited side of every non-terminal battle.
    function _owedEscrow(BattleArena arena) internal view returns (uint256 expected) {
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (!_isLive(b.phase)) continue;
            uint256 perPlayer = b.stakeAmount + b.stakeAmount * arena.ANTI_GRIEF_BPS() / arena.BPS_DENOMINATOR();
            if (b.depositA) expected += perPlayer;
            if (b.depositB) expected += perPlayer;
        }
    }

    // ─── I-7: exact token conservation ────────────────────────────
    //
    // The arena's GOLD balance is exactly the escrow it owes (stake + anti-grief for every
    // deposited side of a non-terminal battle — Frozen included) plus the refund reserve. No
    // token is ever stuck after a win, a draw, a forfeit, a cancel, a refund or an expiry, none
    // leaks out early, and the reserve and escrow never pay for each other.
    function invariant_arenaBalanceEqualsEscrow() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 owed = _owedEscrow(arena);
        assertEq(
            handler.getGold().balanceOf(address(arena)),
            owed + arena.refundReserve(),
            "arena GOLD balance != escrow + refundReserve"
        );
        assertEq(owed, handler.ghostEscrow(), "per-battle escrow != modelled escrow");
        assertEq(arena.refundReserve(), handler.ghostReserve(), "refundReserve != modelled reserve");
    }

    // ─── I-8: every payout matches the rules ──────────────────────
    //
    // The handler replays each successful money-moving call against an independent model of the
    // payout rules (decided / forfeit / draw fee / refund / expiry burn / reveal-failure slash).
    // Every party's real balance must equal the model's.
    function invariant_balancesMatchPayoutModel() public view {
        GoldToken gold = handler.getGold();
        (address alice, address bob, address dev, address sink, address funder) = handler.actors();
        assertEq(gold.balanceOf(alice), handler.ghostAlice(), "player A balance != model");
        assertEq(gold.balanceOf(bob), handler.ghostBob(), "player B balance != model");
        assertEq(gold.balanceOf(dev), handler.ghostDev(), "dev wallet != model (15% of fees)");
        assertEq(handler.initialSupply() - gold.totalSupply(), handler.ghostBurned(), "burned != model");
        assertEq(gold.balanceOf(sink), handler.ghostSink(), "reserve withdrawals != model");
        assertEq(gold.balanceOf(funder), handler.ghostFunder(), "reserve funding != model");
    }

    // ─── I-9: liveness ────────────────────────────────────────────
    //
    // Calls the rules say must succeed did (deposits with matching consent, settle in time,
    // finalize after the window, freeze inside it, resolve / expire a frozen battle, timeouts,
    // reserve withdrawals within the reserve), and calls that must fail did (consent mismatch,
    // overdrawing the reserve, early finalize/expire).
    function invariant_noUnexpectedOutcome() public view {
        assertEq(handler.ghostUnexpected(), 0, "a call succeeded/reverted against the rules");
    }

    // ─── I-10: a freeze only ever comes from review ───────────────
    //
    // freeze() succeeds only on a battle in AwaitingFinalize at or before its payoutDeadline, and
    // only for the guardian or the Safe. Structurally: every battle that was ever frozen carries a
    // full proposal, was frozen within its review window, and is Frozen or Settled now.
    function invariant_frozenOnlyFromReview() public view {
        assertEq(handler.ghostFreezeViolations(), 0, "freeze succeeded outside review / by a stranger");
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase == BattleArena.BattlePhase.Frozen) {
                assertGt(b.frozenAt, 0, "Frozen without frozenAt");
            }
            if (b.frozenAt == 0) continue;
            assertTrue(
                b.phase == BattleArena.BattlePhase.Frozen || b.phase == BattleArena.BattlePhase.Settled,
                "frozen battle left the Frozen -> Settled path"
            );
            assertLe(b.frozenAt, b.payoutDeadline, "frozen after the review window closed");
            assertTrue(b.finalStateHash != bytes32(0) && b.turnLogHash != bytes32(0), "frozen without a proposal");
        }
    }

    // ─── I-4: teamInBattle ↔ Active ───────────────────────────────
    //
    // Teams are locked only while a battle is being played (Active); settle() releases them. For
    // every battle past Active (in review, frozen, settled or cancelled) each revealed team is
    // marked in-battle iff some OTHER battle that is Active has it bound (teams are reused).
    function invariant_teamInBattleMatchesPhase() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase == BattleArena.BattlePhase.Active) {
                assertTrue(arena.teamInBattle(b.teamIdA) && arena.teamInBattle(b.teamIdB), "Active team not locked");
                continue;
            }
            if (b.teamRevealedA) {
                assertEq(arena.teamInBattle(b.teamIdA), _boundToActive(arena, b.teamIdA), "teamA lock out of step");
            }
            if (b.teamRevealedB) {
                assertEq(arena.teamInBattle(b.teamIdB), _boundToActive(arena, b.teamIdB), "teamB lock out of step");
            }
        }
    }

    function _boundToActive(BattleArena arena, uint256 teamId) internal view returns (bool) {
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase != BattleArena.BattlePhase.Active) continue;
            if (b.teamIdA == teamId || b.teamIdB == teamId) return true;
        }
        return false;
    }

    // ─── I-11: a result never locks a lobster ─────────────────────
    //
    // For any battle in AwaitingFinalize / Frozen / Settled / Cancelled, neither of its teams is
    // teamInBattle or TeamManager-active because of it: unless the team is bound to some other
    // battle that is Active right now, it is free in both the arena and TeamManager.
    function invariant_noTeamLockedByResultUnderReviewOrFrozen() public view {
        BattleArena arena = handler.getBattleArena();
        TeamManager tm = handler.getTeamManager();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            bool pastPlay = b.phase == BattleArena.BattlePhase.AwaitingFinalize
                || b.phase == BattleArena.BattlePhase.Frozen || b.phase == BattleArena.BattlePhase.Settled
                || b.phase == BattleArena.BattlePhase.Cancelled;
            if (!pastPlay) continue;
            uint256[2] memory teams = [b.teamIdA, b.teamIdB];
            bool[2] memory revealed = [b.teamRevealedA, b.teamRevealedB];
            for (uint256 t = 0; t < 2; t++) {
                if (!revealed[t] || _boundToActive(arena, teams[t])) continue;
                assertFalse(arena.teamInBattle(teams[t]), "team still teamInBattle after its battle ended");
                if (tm.teamExists(teams[t])) {
                    assertFalse(tm.getTeam(teams[t]).active, "team still TeamManager-active after its battle ended");
                }
            }
        }
    }

    // ─── I-4b (D-31): one team, one live battle ───────────────────
    function invariant_noTeamBoundToTwoLiveBattles() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        uint256[] memory bound = new uint256[](n * 2);
        uint256 count = 0;
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase != BattleArena.BattlePhase.Active) continue;
            uint256[2] memory teams = [b.teamIdA, b.teamIdB];
            for (uint256 t = 0; t < 2; t++) {
                for (uint256 k = 0; k < count; k++) {
                    assertTrue(bound[k] != teams[t], "one team is bound to two live battles");
                }
                bound[count++] = teams[t];
            }
        }
    }

    // ─── I-4c (D-31): a team in play has the Power the matchmaker recorded (F-04) ──
    //
    // Only while Active: after settle() the team is released and may legitimately evolve.
    function invariant_boundTeamsMatchPowerSnapshot() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase != BattleArena.BattlePhase.Active) continue;
            assertEq(handler.teamPower(b.teamIdA), b.powerA, "side A fights at a Power it was not matched at");
            assertEq(handler.teamPower(b.teamIdB), b.powerB, "side B fights at a Power it was not matched at");
        }
    }

    // ─── I-5: winner is a participant, or address(0) ──────────────
    //
    // A Settled battle with winner == address(0) is a draw, a refund or an expiry; all of those
    // went through settle() first and so carry both battle commitments.
    function invariant_winnerIsParticipantOrDraw() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.winner != address(0)) {
                assertTrue(b.winner == b.playerA || b.winner == b.playerB, "winner is not a battle participant");
                assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled), "winner set before Settled");
            } else if (b.phase == BattleArena.BattlePhase.Settled) {
                assertTrue(b.finalStateHash != bytes32(0), "settled without finalStateHash");
                assertTrue(b.turnLogHash != bytes32(0), "settled without turnLogHash");
            }
        }
    }

    // ─── I-6: battles in review carry a complete, valid proposal ──
    function invariant_awaitingFinalizeHasProposal() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase != BattleArena.BattlePhase.AwaitingFinalize && b.phase != BattleArena.BattlePhase.Frozen) {
                continue;
            }
            assertTrue(
                b.proposedWinner == b.playerA || b.proposedWinner == b.playerB || b.proposedWinner == address(0),
                "review with invalid proposedWinner"
            );
            if (b.proposedForfeiter != address(0)) {
                assertTrue(b.proposedWinner != address(0), "draw with a forfeiter");
                assertTrue(
                    b.proposedForfeiter == (b.proposedWinner == b.playerA ? b.playerB : b.playerA),
                    "forfeiter is not the loser"
                );
            }
            assertTrue(b.finalStateHash != bytes32(0), "review without finalStateHash");
            assertTrue(b.turnLogHash != bytes32(0), "review without turnLogHash");
            assertGt(b.payoutDeadline, 0, "review with zero payoutDeadline");
            assertTrue(b.depositA && b.depositB, "review without both deposits");
        }
    }

    // ─── Reachability (D-31) ──────────────────────────────────────
    // Handlers swallow reverts, so a guard that can never fire looks the same as one that
    // works. These drive the SAME entrypoints deterministically and require each rejection.

    function test_reachability_reveal_rejects_a_team_whose_power_moved() public {
        handler.handler_createAndDeposit(0, 0); // pool team #1 each side, snapshot 3/3
        handler.handler_evolvePoolLobster(0); // side A's team #1: Power 3 -> 4, before reveal
        assertEq(handler.ghostPoolEvolutions(), 1, "evolved a pool lobster");

        handler.handler_revealTeams(0);
        assertEq(handler.ghostRevealRejectedPower(), 1, "reveal must revert TeamPowerChanged");
        assertEq(handler.ghostReveals(), 0, "and must not open the battle");
    }

    function test_reachability_reveal_rejects_a_team_already_in_a_battle() public {
        for (uint256 i = 0; i < 3; i++) {
            handler.handler_createAndDeposit(0, 0);
        }
        handler.handler_createAndDeposit(0, 0); // seed 0 -> pool index 0 for A and B
        assertEq(handler.battleIdsLength(), 4);
        assertEq(
            handler.teamIdsA(handler.battleIds(0)), handler.teamIdsA(handler.battleIds(3)), "battles 1 and 4 share a team"
        );

        handler.handler_revealTeams(0);
        assertEq(handler.ghostReveals(), 1, "first battle opens");
        handler.handler_revealTeams(3);
        assertEq(handler.ghostRevealRejectedContention(), 1, "second reveal must revert TeamAlreadyInBattle");
        assertEq(handler.ghostReveals(), 1);
    }

    /// The review / freeze / resolve / expire / reserve handlers all reach their success paths,
    /// and the model stays exact through them.
    function test_reachability_reviewFreezeExpireReserve() public {
        handler.handler_fundReserve(60_000e18);
        handler.handler_openBattle(0, 0); // battle 0: Active
        handler.handler_settle(0, 0, true); // alice wins, bob forfeits
        handler.handler_freeze(0, false);
        assertEq(handler.ghostFreezes(), 1, "guardian froze");
        handler.handler_freezeByStranger(0);
        handler.handler_expireFrozen(0); // warps past 72 h, reserve covers -> burn
        assertEq(handler.ghostExpiryBurns(), 1, "expiry burned from the reserve");

        handler.handler_openBattle(2, 1); // battle 1 (High stake)
        handler.handler_settle(1, 2, false); // draw
        handler.handler_freeze(1, true);
        handler.handler_resolveFrozen(1, 1, true, false); // bob wins, alice forfeits
        assertEq(handler.ghostResolves(), 1);

        handler.handler_openBattle(2, 2); // battle 2 (High): reserve now < 100k -> no burn
        handler.handler_settle(2, 0, false);
        handler.handler_freeze(2, false);
        handler.handler_expireFrozen(2);
        assertEq(handler.ghostExpiries(), 2);
        assertEq(handler.ghostExpiryBurns(), 1, "short reserve returns the held stakes instead");

        handler.handler_openBattle(1, 3);
        handler.handler_settle(3, 2, false); // draw
        handler.handler_warp(2 hours);
        handler.handler_finalize(3);
        assertEq(handler.ghostDraws(), 1, "draw paid via finalize (the resolve above was not a draw)");

        handler.handler_withdrawReserve(1, true); // overdraw -> must revert
        handler.handler_withdrawReserve(type(uint256).max, false); // some of the reserve
        handler.handler_depositMismatch(0, 0);
        handler.handler_depositMismatch(0, 1);

        assertEq(handler.ghostForfeitSlashes(), 1, "forfeit slash paid by resolveFrozen");
        invariant_arenaBalanceEqualsEscrow();
        invariant_balancesMatchPayoutModel();
        invariant_noUnexpectedOutcome();
        invariant_frozenOnlyFromReview();
        invariant_noTeamLockedByResultUnderReviewOrFrozen();
    }

    /// Reveal-failure attribution: an accused side that does not open forfeits its 5%.
    function test_reachability_revealFailureSlash() public {
        handler.handler_createAndDeposit(0, 0);
        handler.handler_accuseRevealFailure(0, false, false); // bob accused, does not open
        handler.handler_accuseRevealFailure(0, true, true); // alice accused, opens
        handler.handler_warp(3 minutes);
        handler.handler_handleTimeout(0);
        assertEq(handler.ghostCancels(), 1);
        invariant_balancesMatchPayoutModel();
        invariant_arenaBalanceEqualsEscrow();
        invariant_noUnexpectedOutcome();
    }
}
