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
///      deposit → team commit/reveal → round commit/reveal → settle/dispute/
///      finalize → timeout state machine; this contract only reads state and
///      asserts the cross-cutting properties.
contract InvariantBattleArena is Test {
    BattleArenaHandler internal handler;

    function setUp() public {
        handler = new BattleArenaHandler();
        targetContract(address(handler));

        // Restrict fuzzer to handler_* entrypoints so it doesn't call the
        // inherited BaseSetup.setUp() (which would re-deploy contracts and
        // orphan the battleIds[] ghost array).
        bytes4[] memory selectors = new bytes4[](13);
        selectors[0]  = BattleArenaHandler.handler_createAndDeposit.selector;
        selectors[1]  = BattleArenaHandler.handler_commitTeams.selector;
        selectors[2]  = BattleArenaHandler.handler_revealTeams.selector;
        selectors[3]  = BattleArenaHandler.handler_commitMoves.selector;
        selectors[4]  = BattleArenaHandler.handler_revealMoves.selector;
        selectors[5]  = BattleArenaHandler.handler_advanceRound.selector;
        selectors[6]  = BattleArenaHandler.handler_settle.selector;
        selectors[7]  = BattleArenaHandler.handler_dispute.selector;
        selectors[8]  = BattleArenaHandler.handler_finalize.selector;
        selectors[9]  = BattleArenaHandler.handler_adminResolve.selector;
        selectors[10] = BattleArenaHandler.handler_handleTimeout.selector;
        selectors[11] = BattleArenaHandler.handler_emergencyWithdraw.selector;
        selectors[12] = BattleArenaHandler.handler_warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ─── I-1: currentRound never exceeds MAX_ROUNDS ───────────────
    //
    // N-01 was a concrete failure of this property (round 7 → 8 via
    // _handleActiveTimeout). Invariant keeps that regression honest
    // across every path the fuzzer exercises.
    function invariant_currentRoundBounded() public view {
        BattleArena arena = handler.getBattleArena();
        uint8 maxRounds = arena.MAX_ROUNDS();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            assertLe(b.currentRound, maxRounds, "currentRound > MAX_ROUNDS");
        }
    }

    // ─── I-2: lastVerifiedRound never exceeds currentRound ────────
    //
    // revealMoves sets lastVerifiedRound = currentRound only when both
    // sides have revealed. advanceRound bumps currentRound, resets the
    // reveal flags — but lastVerifiedRound must never overtake it.
    function invariant_lastVerifiedRoundLeCurrentRound() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            assertLe(b.lastVerifiedRound, b.currentRound, "lastVerifiedRound > currentRound");
        }
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

    // ─── I-5: winner is always a participant once set ─────────────
    //
    // settle() / adminResolveDispute rejects non-participants; but both
    // paths could go through buggy alternative flows. Invariant catches
    // any path that writes b.winner to a non-participant address.
    function invariant_winnerIsParticipant() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();

        for (uint256 i = 0; i < n; i++) {
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            if (b.winner == address(0)) continue;
            assertTrue(
                b.winner == b.playerA || b.winner == b.playerB,
                "winner is not a battle participant"
            );
        }
    }

    // ─── I-6: AwaitingFinalize battles have a proposed winner ─────
    //
    // settle() always sets proposedWinner before transitioning; anything
    // that lands in AwaitingFinalize without a valid proposedWinner is a
    // bug in the phase machine.
    function invariant_awaitingFinalizeHasProposal() public view {
        BattleArena arena = handler.getBattleArena();
        uint256 n = handler.battleIdsLength();

        for (uint256 i = 0; i < n; i++) {
            uint256 battleId = handler.battleIds(i);
            BattleArena.Battle memory b = arena.getBattle(battleId);
            if (b.phase != BattleArena.BattlePhase.AwaitingFinalize) continue;
            assertTrue(
                b.proposedWinner == b.playerA || b.proposedWinner == b.playerB,
                "AwaitingFinalize with invalid proposedWinner"
            );
            assertGt(b.payoutDeadline, 0, "AwaitingFinalize with zero payoutDeadline");
        }
    }
}
