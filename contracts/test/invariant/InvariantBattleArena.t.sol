// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {BattleArenaHandler} from "./handlers/BattleArenaHandler.sol";
import {BattleArena} from "../../BattleArena.sol";
import {ClawToken} from "../../ClawToken.sol";
import {TeamManager} from "../../TeamManager.sol";
import {LobsterNFT} from "../../LobsterNFT.sol";

/// @dev Stateful invariant harness for BattleArena. The handler drives the full
///      deposit → team commit/reveal → (off-chain battle) → settle (win or draw) /
///      dispute / finalize → timeout state machine; this contract only reads state
///      and asserts the cross-cutting properties.
contract InvariantBattleArena is Test {
    BattleArenaHandler internal handler;

    function setUp() public {
        handler = new BattleArenaHandler();
        targetContract(address(handler));

        // Restrict fuzzer to handler_* entrypoints so it doesn't call the
        // inherited BaseSetup.setUp() (which would re-deploy contracts and
        // orphan the battleIds[] ghost array).
        bytes4[] memory selectors = new bytes4[](13);
        selectors[0] = BattleArenaHandler.handler_createAndDeposit.selector;
        selectors[1] = BattleArenaHandler.handler_commitTeams.selector;
        selectors[2] = BattleArenaHandler.handler_revealTeams.selector;
        selectors[3] = BattleArenaHandler.handler_settle.selector;
        selectors[4] = BattleArenaHandler.handler_dispute.selector;
        selectors[5] = BattleArenaHandler.handler_finalize.selector;
        selectors[6] = BattleArenaHandler.handler_adminResolve.selector;
        selectors[7] = BattleArenaHandler.handler_handleTimeout.selector;
        selectors[8] = BattleArenaHandler.handler_emergencyWithdraw.selector;
        selectors[9] = BattleArenaHandler.handler_warp.selector;
        selectors[10] = BattleArenaHandler.handler_evolvePoolLobster.selector;
        selectors[11] = BattleArenaHandler.handler_healPoolTeam.selector;
        selectors[12] = BattleArenaHandler.handler_openBattle.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ─── I-3: escrow coverage ─────────────────────────────────────
    //
    // The arena must always hold at least the sum of escrowed stake +
    // anti-grief for every non-terminal battle where deposits landed,
    // plus the AwaitingFinalize escrow (proposed outcome not yet paid).
    // Terminal battles (Settled, Cancelled) have already paid out.
    function invariant_escrowCoversActiveBattles() public view {
        BattleArena arena = handler.getBattleArena();
        ClawToken clawToken = handler.getClaw();
        uint256 n = handler.battleIdsLength();

        uint256 expected = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            if (
                b.phase == BattleArena.BattlePhase.Settled ||
                b.phase == BattleArena.BattlePhase.Cancelled ||
                b.phase == BattleArena.BattlePhase.None
            ) continue;

            uint256 antiGrief = b.stakeAmount * arena.ANTI_GRIEF_BPS() / arena.BPS_DENOMINATOR();
            uint256 perPlayer = b.stakeAmount + antiGrief;

            if (b.depositA) expected += perPlayer;
            if (b.depositB) expected += perPlayer;
        }

        assertGe(
            clawToken.balanceOf(address(arena)),
            expected,
            "arena CLAW balance below active-battle escrow"
        );
    }

    // ─── I-4: teamInBattle ↔ non-terminal phase ───────────────────
    //
    // A team is marked in-battle only while the owning battle is in a
    // non-terminal phase (TeamReveal after its reveal, Active, Awaiting-
    // Finalize). Terminal phases must have released both teams.
    function invariant_teamInBattleMatchesPhase() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();

        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            bool terminal =
                b.phase == BattleArena.BattlePhase.Settled ||
                b.phase == BattleArena.BattlePhase.Cancelled;
            if (!terminal) continue;

            // D-31: teams are reused across battles now, so "released" no longer means
            // "not in any battle" — a team freed by THIS battle may already be fighting in a
            // later one. The exact statement: once a battle is terminal, its teams are
            // marked in-battle if and only if some OTHER live battle has them bound.
            if (b.teamRevealedA) {
                assertEq(arena.teamInBattle(b.teamIdA), _boundToALiveBattle(arena, b.teamIdA), "teamA lock out of step with live battles");
            }
            if (b.teamRevealedB) {
                assertEq(arena.teamInBattle(b.teamIdB), _boundToALiveBattle(arena, b.teamIdB), "teamB lock out of step with live battles");
            }
        }
    }

    function _boundToALiveBattle(BattleArena arena, uint256 teamId) internal view returns (bool) {
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase != BattleArena.BattlePhase.Active && b.phase != BattleArena.BattlePhase.AwaitingFinalize) continue;
            if (b.teamIdA == teamId || b.teamIdB == teamId) return true;
        }
        return false;
    }

    // ─── I-4b (D-31): one team, one live battle ───────────────────
    //
    // The handler reuses a small pool of teams, so concurrent battles really do want the
    // same team. Among battles whose teams are bound and not yet released (Active,
    // AwaitingFinalize), no team id may appear twice.
    function invariant_noTeamBoundToTwoLiveBattles() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        uint256[] memory bound = new uint256[](n * 2);
        uint256 count = 0;

        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase != BattleArena.BattlePhase.Active && b.phase != BattleArena.BattlePhase.AwaitingFinalize) continue;
            uint256[2] memory teams = [b.teamIdA, b.teamIdB];
            for (uint256 t = 0; t < 2; t++) {
                for (uint256 k = 0; k < count; k++) {
                    assertTrue(bound[k] != teams[t], "one team is bound to two live battles");
                }
                bound[count++] = teams[t];
                assertTrue(arena.teamInBattle(teams[t]), "a bound team must be marked in-battle");
            }
        }
    }

    // ─── I-4c (D-31): a bound team has the Power the matchmaker recorded (F-04) ──
    //
    // The handler evolves pool lobsters between match and reveal. Whatever it does, a team
    // that made it INTO a battle must have exactly the snapshot Power on its side — not the
    // other side's, and not merely "at most".
    function invariant_boundTeamsMatchPowerSnapshot() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            BattleArena.Battle memory b = arena.getBattle(handler.battleIds(i));
            if (b.phase != BattleArena.BattlePhase.Active && b.phase != BattleArena.BattlePhase.AwaitingFinalize) continue;
            assertEq(handler.teamPower(b.teamIdA), b.powerA, "side A fights at a Power it was not matched at");
            assertEq(handler.teamPower(b.teamIdB), b.powerB, "side B fights at a Power it was not matched at");
        }
    }

    // ─── Reachability (D-31) ──────────────────────────────────────
    // Handlers swallow reverts, so a guard that can never fire looks the same as one that
    // works. These drive the SAME entrypoints deterministically and require each rejection.

    function test_reachability_reveal_rejects_a_team_whose_power_moved() public {
        handler.handler_createAndDeposit(0, 0); // pool team #1 each side, snapshot 3/3
        handler.handler_commitTeams(0);
        handler.handler_evolvePoolLobster(0);    // side A's team #1: Power 3 -> 4, before reveal
        assertEq(handler.ghostPoolEvolutions(), 1, "evolved a pool lobster");

        handler.handler_revealTeams(0);
        assertEq(handler.ghostRevealRejectedPower(), 1, "reveal must revert TeamPowerChanged");
        assertEq(handler.ghostReveals(), 0, "and must not open the battle");
    }

    function test_reachability_reveal_rejects_a_team_already_in_a_battle() public {
        // Fill both pools (3 creates), then a 4th battle that reuses pool team #1 on both sides.
        for (uint256 i = 0; i < 3; i++) handler.handler_createAndDeposit(0, 0);
        handler.handler_createAndDeposit(0, 0); // seed 0 -> pool index 0 for A and B
        assertEq(handler.battleIdsLength(), 4);
        assertEq(handler.teamIdsA(handler.battleIds(0)), handler.teamIdsA(handler.battleIds(3)), "battles 1 and 4 share a team");

        handler.handler_commitTeams(0);
        handler.handler_commitTeams(3);
        handler.handler_revealTeams(0);
        assertEq(handler.ghostReveals(), 1, "first battle opens");

        handler.handler_revealTeams(3);
        assertEq(handler.ghostRevealRejectedContention(), 1, "second reveal must revert TeamAlreadyInBattle");
        assertEq(handler.ghostReveals(), 1);
    }

    // ─── I-5: winner is a participant, or address(0) for a V3 draw ──
    //
    // settle() / adminResolveDispute reject non-participants; but both
    // paths could go through buggy alternative flows. Invariant catches
    // any path that writes b.winner to a non-participant address. A
    // Settled battle with winner == address(0) is a draw and must carry
    // the two battle commitments that every settlement records.
    function invariant_winnerIsParticipantOrDraw() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();

        for (uint256 i = 0; i < n; i++) {
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            if (b.winner != address(0)) {
                assertTrue(
                    b.winner == b.playerA || b.winner == b.playerB,
                    "winner is not a battle participant"
                );
            } else if (b.phase == BattleArena.BattlePhase.Settled) {
                assertTrue(b.finalStateHash != bytes32(0), "settled draw without finalStateHash");
                assertTrue(b.turnLogHash != bytes32(0), "settled draw without turnLogHash");
            }
        }
    }

    // ─── I-6: AwaitingFinalize battles carry a complete proposal ──
    //
    // settle() always records proposedWinner (participant or address(0)
    // for a draw), both battle hashes and the payout deadline before
    // transitioning; anything that lands in AwaitingFinalize without them
    // is a bug in the phase machine.
    function invariant_awaitingFinalizeHasProposal() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();

        for (uint256 i = 0; i < n; i++) {
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            if (b.phase != BattleArena.BattlePhase.AwaitingFinalize) continue;
            assertTrue(
                b.proposedWinner == b.playerA || b.proposedWinner == b.playerB || b.proposedWinner == address(0),
                "AwaitingFinalize with invalid proposedWinner"
            );
            assertTrue(b.finalStateHash != bytes32(0), "AwaitingFinalize without finalStateHash");
            assertTrue(b.turnLogHash != bytes32(0), "AwaitingFinalize without turnLogHash");
            assertGt(b.payoutDeadline, 0, "AwaitingFinalize with zero payoutDeadline");
        }
    }

    // ─── I-7: exact token conservation ────────────────────────────
    //
    // The arena's CLAW balance equals exactly the escrow it owes: stake +
    // anti-grief for every deposited side of a non-terminal battle, plus
    // the dispute bond of every disputed AwaitingFinalize battle. Strictly
    // stronger than I-3 (>=): no token is ever stuck in the arena after a
    // win, a draw, a forfeit or a cancel, and none ever leaks out early.
    function invariant_arenaBalanceEqualsEscrow() public view {
        BattleArena arena = handler.getBattleArena();
        ClawToken clawToken = handler.getClaw();
        uint256 n = handler.battleIdsLength();

        uint256 expected = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            if (
                b.phase == BattleArena.BattlePhase.Settled ||
                b.phase == BattleArena.BattlePhase.Cancelled ||
                b.phase == BattleArena.BattlePhase.None
            ) continue;

            uint256 antiGrief = b.stakeAmount * arena.ANTI_GRIEF_BPS() / arena.BPS_DENOMINATOR();
            uint256 perPlayer = b.stakeAmount + antiGrief;
            if (b.depositA) expected += perPlayer;
            if (b.depositB) expected += perPlayer;
            if (b.phase == BattleArena.BattlePhase.AwaitingFinalize && b.disputed) expected += b.disputeBondPaid;
        }

        assertEq(clawToken.balanceOf(address(arena)), expected, "arena CLAW balance != owed escrow");
    }
}
