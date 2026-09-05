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
        bytes4[] memory selectors = new bytes4[](10);
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
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            bool terminal =
                b.phase == BattleArena.BattlePhase.Settled ||
                b.phase == BattleArena.BattlePhase.Cancelled;

            // If a team was revealed and the battle is terminal, arena must
            // have released teamInBattle for both.
            if (terminal) {
                if (b.teamRevealedA) {
                    assertFalse(arena.teamInBattle(b.teamIdA), "teamA still in-battle post-terminal");
                }
                if (b.teamRevealedB) {
                    assertFalse(arena.teamInBattle(b.teamIdB), "teamB still in-battle post-terminal");
                }
            }
        }
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
