// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for BattleArena: phase state machine, stake accounting, access control.
contract FuzzBattleArena is BaseSetup {
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    uint256 internal constant LOW_STAKE = 2_500e18;

    function _createBattle() internal returns (uint256 battleId) {
        vm.prank(admin);
        battleId = battleArena.createBattle(alice, bob, LOW_STAKE);
    }

    function _deposit(address player, uint256 battleId) internal {
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 total = LOW_STAKE + antiGrief;
        _giveClaw(player, total);
        vm.startPrank(player);
        claw.approve(address(battleArena), total);
        battleArena.deposit(battleId);
        vm.stopPrank();
    }

    function _bothDeposit(uint256 battleId) internal {
        _deposit(alice, battleId);
        _deposit(bob, battleId);
    }

    /// @dev V3 S1: mint + approve the dispute bond for `disputer` so a subsequent
    ///      `battleArena.disputeBattle(...)` call doesn't revert with InsufficientAllowance.
    ///      All existing tests use LOW_STAKE bracket (index 0); this helper assumes that.
    function _setupDisputeBond(address disputer) internal {
        uint256 bond = battleArena.disputeBonds(0);
        if (bond == 0) return;
        _giveClaw(disputer, bond);
        vm.prank(disputer);
        claw.approve(address(battleArena), bond);
    }

    function _commitTeam(address player, uint256 battleId, uint256 teamId, bytes32 salt) internal {
        bytes32 hash = keccak256(abi.encodePacked(battleId, player, teamId, salt));
        vm.prank(player);
        battleArena.commitTeam(battleId, hash);
    }

    function _revealTeam(address player, uint256 battleId, uint256 teamId, bytes32 salt) internal {
        vm.prank(player);
        battleArena.revealTeam(battleId, teamId, salt);
    }

    function _createEvolvedTeam(address owner) internal returns (uint256 teamId) {
        uint256[3] memory ids = _mint3(owner);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setEvolutionTier(ids[i], 1);
        }
        vm.prank(owner);
        teamId = teamMgr.createTeam(ids);
    }

    // Runs one full commit+reveal cycle for the current round so that
    // lastVerifiedRound is set — a precondition for settle().
    function _playRound(uint256 battleId, bytes memory moveDataA, bytes memory moveDataB) internal {
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        uint8 round = b.currentRound;
        bytes32 saltA = keccak256(abi.encodePacked("playRound:A", round));
        bytes32 saltB = keccak256(abi.encodePacked("playRound:B", round));

        bytes32 hashA = keccak256(abi.encodePacked(battleId, round, b.playerA, moveDataA, saltA));
        bytes32 hashB = keccak256(abi.encodePacked(battleId, round, b.playerB, moveDataB, saltB));

        vm.prank(b.playerA);
        battleArena.commitMoves(battleId, hashA);
        vm.prank(b.playerB);
        battleArena.commitMoves(battleId, hashB);

        vm.prank(b.playerA);
        battleArena.revealMoves(battleId, moveDataA, saltA);
        vm.prank(b.playerB);
        battleArena.revealMoves(battleId, moveDataB, saltB);
    }

    // ── Invalid stake reverts ─────────────────────────────────────

    function testFuzz_invalid_stake_reverts(uint256 amount) public {
        // Not one of the 3 brackets
        vm.assume(amount != 2_500e18 && amount != 10_000e18 && amount != 50_000e18);
        amount = bound(amount, 1, type(uint128).max);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeAmount.selector, amount));
        battleArena.createBattle(alice, bob, amount);
    }

    // ── Same player reverts ───────────────────────────────────────

    function test_same_player_reverts() public {
        vm.prank(admin);
        vm.expectRevert(BattleArena.PlayerCannotBeSelf.selector);
        battleArena.createBattle(alice, alice, LOW_STAKE);
    }

    // ── Phase progression ─────────────────────────────────────────

    function test_phase_deposit_to_team_commit() public {
        uint256 battleId = _createBattle();
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Deposit));

        _deposit(alice, battleId);
        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Deposit), "still Deposit after 1");

        _deposit(bob, battleId);
        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.TeamCommit), "TeamCommit after both");
    }

    function test_phase_team_commit_to_reveal() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);

        bytes32 saltA = bytes32(uint256(1));
        bytes32 saltB = bytes32(uint256(2));
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);

        _commitTeam(alice, battleId, teamA, saltA);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.TeamCommit), "still TeamCommit after 1");

        _commitTeam(bob, battleId, teamB, saltB);
        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.TeamReveal), "TeamReveal after both");
    }

    function test_phase_reveal_to_active() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);

        bytes32 saltA = bytes32(uint256(11));
        bytes32 saltB = bytes32(uint256(22));
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);

        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob, battleId, teamB, saltB);

        _revealTeam(alice, battleId, teamA, saltA);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.TeamReveal), "still TeamReveal");

        _revealTeam(bob, battleId, teamB, saltB);
        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Active), "Active after both reveals");
    }

    // ── Stake accounting: settlement is zero-sum ──────────────────

    function test_settle_stake_accounting() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);

        bytes32 saltA = bytes32(uint256(111));
        bytes32 saltB = bytes32(uint256(222));
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);

        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob, battleId, teamB, saltB);
        _revealTeam(alice, battleId, teamA, saltA);
        _revealTeam(bob, battleId, teamB, saltB);

        // settle() now requires lastVerifiedRound > 0, so run one round end-to-end.
        _playRound(battleId, hex"01", hex"02");

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore   = claw.balanceOf(bob);
        uint256 supplyBefore = claw.totalSupply();

        // Settle with alice as winner, minimal damage.
        // H-01: settle proposes, finalize pays.
        uint8[3] memory winnerDmg = [uint8(5), 5, 5];
        uint8[3] memory loserDmg  = [uint8(20), 20, 20];

        vm.prank(admin);
        battleArena.settle(battleId, alice, winnerDmg, loserDmg);
        vm.warp(block.timestamp + battleArena.disputeWindows(0) + 1);
        battleArena.finalizeBattle(battleId);

        uint256 aliceAfter = claw.balanceOf(alice);
        uint256 bobAfter   = claw.balanceOf(bob);

        // Combined pot = 2 × LOW_STAKE
        uint256 combinedPot = LOW_STAKE * 2;
        uint256 protocolFee = combinedPot * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 winnerPayout = combinedPot - protocolFee;
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();

        // Alice net: winnerPayout + antiGrief - LOW_STAKE - antiGrief = winnerPayout - LOW_STAKE = net gain
        uint256 aliceNet = aliceAfter - aliceBefore;

        assertEq(aliceNet, winnerPayout + antiGrief, "alice receives winnerPayout + antiGrief");
        assertEq(bobAfter, antiGrief, "bob gets antiGrief back"); // bob started with 0 after giving to arena

        // Protocol fee burned
        uint256 burned = supplyBefore - claw.totalSupply();
        uint256 burnedFee = protocolFee * treasury.BURN_BPS() / treasury.BPS_DENOMINATOR();
        assertEq(burned, burnedFee, "protocol fee burn");
    }

    // ── Double deposit reverts ────────────────────────────────────

    function test_double_deposit_reverts() public {
        uint256 battleId = _createBattle();
        _deposit(alice, battleId);

        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 total = LOW_STAKE + antiGrief;
        _giveClaw(alice, total);

        vm.startPrank(alice);
        claw.approve(address(battleArena), total);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyDeposited.selector, battleId));
        battleArena.deposit(battleId);
        vm.stopPrank();
    }

    // ── Non-participant cannot deposit ────────────────────────────

    function test_non_participant_reverts() public {
        address charlie = makeAddr("charlie");
        uint256 battleId = _createBattle();

        uint256 total = LOW_STAKE + (LOW_STAKE * 500 / 10_000);
        _giveClaw(charlie, total);

        vm.startPrank(charlie);
        claw.approve(address(battleArena), total);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotBattleParticipant.selector, battleId));
        battleArena.deposit(battleId);
        vm.stopPrank();
    }

    // ── Deposit timeout cancels and refunds ───────────────────────

    function test_deposit_timeout_refunds() public {
        uint256 battleId = _createBattle();
        _deposit(alice, battleId); // only alice deposits

        uint256 aliceBefore = claw.balanceOf(alice);

        vm.warp(block.timestamp + battleArena.DEPOSIT_WINDOW() + 1);
        battleArena.handleTimeout(battleId);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Cancelled));

        // Alice should get refunded
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 expectedRefund = LOW_STAKE + antiGrief;
        assertEq(claw.balanceOf(alice) - aliceBefore, expectedRefund, "alice refunded");
    }

    // ── Wrong phase prevents action ───────────────────────────────

    function test_wrong_phase_deposit_reverts() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId); // phase → TeamCommit

        uint256 total = LOW_STAKE + (LOW_STAKE * 500 / 10_000);
        _giveClaw(alice, total);
        vm.startPrank(alice);
        claw.approve(address(battleArena), total);
        vm.expectRevert(); // InvalidBattlePhase
        battleArena.deposit(battleId);
        vm.stopPrank();
    }

    // ── Lobster damage gate enforced ──────────────────────────────

    function test_high_damage_lobster_blocked() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);

        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);

        bytes32 saltA = bytes32(uint256(999));
        bytes32 saltB = bytes32(uint256(888));
        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob, battleId, teamB, saltB);

        // Set one of alice's lobsters to damage=80 (blocked)
        TeamManager.Team memory team = teamMgr.getTeam(teamA);
        vm.prank(admin);
        nft.setDamage(team.lobsterIds[0], 80);

        vm.prank(alice);
        vm.expectRevert(); // LobsterDamageTooHigh
        battleArena.revealTeam(battleId, teamA, saltA);
    }

    // ── Invalid commit hash reverts ───────────────────────────────

    function test_invalid_commit_hash_reverts() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);

        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);

        bytes32 saltA = bytes32(uint256(1));
        bytes32 saltB = bytes32(uint256(2));
        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob, battleId, teamB, saltB);

        // Try to reveal with wrong salt
        bytes32 wrongSalt = bytes32(uint256(999));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        battleArena.revealTeam(battleId, teamA, wrongSalt);
    }

    // ── MED-01: uint8 overflow in _applyDamage caps at 100 ───────────
    // Regression: currentDamage(60) + damages[i](200) = 260 > 255, panicked
    // before fix. Now caps at 100 without reverting.
    function test_applyDamage_overflow_caps_at_100() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);

        bytes32 saltA = bytes32(uint256(333));
        bytes32 saltB = bytes32(uint256(444));
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);

        // Pre-set lobster damage to 60 (below the 80 battle entry threshold)
        TeamManager.Team memory teamAData = teamMgr.getTeam(teamA);
        TeamManager.Team memory teamBData = teamMgr.getTeam(teamB);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setDamage(teamAData.lobsterIds[i], 60);
            vm.prank(admin);
            nft.setDamage(teamBData.lobsterIds[i], 60);
        }

        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob, battleId, teamB, saltB);
        _revealTeam(alice, battleId, teamA, saltA);
        _revealTeam(bob, battleId, teamB, saltB);

        // settle() now requires lastVerifiedRound > 0, so run one round end-to-end.
        _playRound(battleId, hex"01", hex"02");

        // 60 + 200 = 260 overflows uint8 — old code panicked, new code caps at 100.
        // H-01: damage application happens in finalizeBattle, not settle.
        uint8[3] memory winnerDmg = [uint8(200), 200, 200];
        uint8[3] memory loserDmg  = [uint8(200), 200, 200];

        vm.prank(admin);
        battleArena.settle(battleId, alice, winnerDmg, loserDmg);
        vm.warp(block.timestamp + battleArena.disputeWindows(0) + 1);
        battleArena.finalizeBattle(battleId);

        for (uint256 i = 0; i < 3; i++) {
            assertEq(nft.getDamage(teamAData.lobsterIds[i]), 100, "winner lobster capped at 100");
            assertEq(nft.getDamage(teamBData.lobsterIds[i]), 100, "loser lobster capped at 100");
        }
    }

    // ── Only resolver can settle ──────────────────────────────────

    function test_non_resolver_settle_reverts() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);

        uint8[3] memory dmg = [uint8(5), 5, 5];
        vm.prank(alice);
        vm.expectRevert();
        battleArena.settle(battleId, alice, dmg, dmg);
    }

    // ── Forfeit slashes anti-grief ────────────────────────────────

    function test_forfeit_slashes_anti_grief() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);

        // Alice commits, bob doesn't → bob forfeits after TeamCommit timeout
        uint256 teamA = _createEvolvedTeam(alice);
        bytes32 saltA = bytes32(uint256(55));
        _commitTeam(alice, battleId, teamA, saltA);
        // Bob doesn't commit

        uint256 bobBefore   = claw.balanceOf(bob);
        uint256 supplyBefore = claw.totalSupply();

        vm.warp(block.timestamp + battleArena.TEAM_COMMIT_WINDOW() + 1);
        battleArena.handleTimeout(battleId);

        // Bob forfeited: loses antiGrief, gets stake back
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        // Bob got stake back only (no antiGrief)
        assertEq(claw.balanceOf(bob) - bobBefore, LOW_STAKE, "bob gets only stake back");

        // AntiGrief burned via treasury
        uint256 burnedFee = antiGrief * treasury.BURN_BPS() / treasury.BPS_DENOMINATOR();
        assertEq(supplyBefore - claw.totalSupply(), burnedFee, "antiGrief burned");
    }

    // ── N-01: _handleActiveTimeout must respect MAX_ROUNDS ────────
    //
    // F-03 added the MAX_ROUNDS cap to advanceRound() (line ~352) but missed
    // the neighbor path in _handleActiveTimeout() (line ~648). On an Active-
    // phase timeout at the final round, the fall-through branch used to
    // increment currentRound to 8. The fix: at MAX_ROUNDS we either forfeit
    // the side that missed its commit, or revert (both-revealed case is
    // settlement territory — the resolver must call settle()).
    //
    // Two scenarios covered:
    //   (a) both revealed + deadline passed → handleTimeout reverts
    //       MaxRoundsReached; currentRound stays at MAX_ROUNDS
    //   (b) one side missed commit at final round → forfeit, battle settles
    // In both cases, currentRound must never exceed MAX_ROUNDS.

    function test_N01_handleTimeout_at_maxRounds_bothRevealed_reverts() public {
        uint256 battleId = _playToFinalRound_bothReveal();
        uint8 maxRounds = battleArena.MAX_ROUNDS();

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.phaseDeadline + 1);

        // Pre-fix: silently advanced currentRound to 8. Post-fix: reverts,
        // signalling the resolver should call settle() instead.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.MaxRoundsReached.selector, battleId));
        battleArena.handleTimeout(battleId);

        b = battleArena.getBattle(battleId);
        assertLe(
            b.currentRound,
            maxRounds,
            "N-01: currentRound must never exceed MAX_ROUNDS"
        );
    }

    function test_N01_handleTimeout_at_maxRounds_oneMissedCommit_forfeits() public {
        uint256 battleId = _playToFinalRound_noCommits();
        uint8 maxRounds = battleArena.MAX_ROUNDS();

        // Bob commits, Alice doesn't. Before the fix, once the COMMIT_WINDOW
        // expires `_handleActiveTimeout` would stretch currentRound to 8
        // (alice is below AUTO_FORFEIT_THRESHOLD at this point). Post-fix:
        // alice gets force-forfeited at the final round.
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        bytes32 hashB = keccak256(abi.encodePacked(battleId, b.currentRound, bob, hex"02", bytes32(uint256(99))));
        vm.prank(bob);
        battleArena.commitMoves(battleId, hashB);

        vm.warp(block.timestamp + battleArena.COMMIT_WINDOW() + 1);
        battleArena.handleTimeout(battleId);

        b = battleArena.getBattle(battleId);
        assertLe(
            b.currentRound,
            maxRounds,
            "N-01: currentRound must never exceed MAX_ROUNDS"
        );
        assertEq(
            uint8(b.phase),
            uint8(BattleArena.BattlePhase.Cancelled),
            "missed-commit side must forfeit at MAX_ROUNDS (battle cancelled via _forfeit)"
        );
    }

    // Helper: drive a battle to the final round with both sides revealing
    // round `MAX_ROUNDS` (so the fall-through "both revealed, timeout" case
    // applies).
    function _playToFinalRound_bothReveal() internal returns (uint256 battleId) {
        battleId = _playToFinalRound_noCommits();
        _playRound(battleId, hex"AA", hex"BB");
    }

    // Helper: drive a battle through rounds 1..MAX_ROUNDS-1 and advance to
    // round MAX_ROUNDS without committing for the final round yet.
    function _playToFinalRound_noCommits() internal returns (uint256 battleId) {
        battleId = _createBattle();
        _bothDeposit(battleId);

        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);
        bytes32 teamSaltA = bytes32(uint256(111));
        bytes32 teamSaltB = bytes32(uint256(222));
        _commitTeam(alice, battleId, teamA, teamSaltA);
        _commitTeam(bob,   battleId, teamB, teamSaltB);
        _revealTeam(alice, battleId, teamA, teamSaltA);
        _revealTeam(bob,   battleId, teamB, teamSaltB);

        uint8 maxRounds = battleArena.MAX_ROUNDS();
        for (uint8 i = 1; i < maxRounds; i++) {
            _playRound(battleId, hex"01", hex"02");
            vm.prank(admin);
            battleArena.advanceRound(battleId);
        }

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        require(b.currentRound == maxRounds, "setup: at MAX_ROUNDS");
    }

    // ─────────────────────────────────────────────────────────────
    // H-01: challenge window (AwaitingFinalize / disputeBattle /
    //       finalizeBattle / adminResolveDispute)
    // ─────────────────────────────────────────────────────────────

    // Helper: drive a battle to a state where settle() can be called
    // (Active phase with lastVerifiedRound == 1).
    function _setupSettleableBattle() internal returns (uint256 battleId, uint256 teamA, uint256 teamB) {
        battleId = _createBattle();
        _bothDeposit(battleId);

        teamA = _createEvolvedTeam(alice);
        teamB = _createEvolvedTeam(bob);
        bytes32 saltA = keccak256(abi.encodePacked("H01-teamA", battleId));
        bytes32 saltB = keccak256(abi.encodePacked("H01-teamB", battleId));
        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob,   battleId, teamB, saltB);
        _revealTeam(alice, battleId, teamA, saltA);
        _revealTeam(bob,   battleId, teamB, saltB);

        _playRound(battleId, hex"01", hex"02");
    }

    // Helper: settle() with the default H-01 proposal (alice wins, small damages)
    function _settleProposing(uint256 battleId, address winner) internal {
        vm.prank(admin);
        battleArena.settle(battleId, winner, [uint8(5), 5, 5], [uint8(20), 20, 20]);
    }

    // 1. Happy path: settle → wait out window → permissionless finalize transfers.
    function test_H01_undisputedFinalize_paysWinner() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.AwaitingFinalize), "phase after settle");
        assertEq(b.proposedWinner, alice, "proposedWinner recorded");

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        vm.warp(b.payoutDeadline + 1);
        address anyone = makeAddr("anyone");
        vm.prank(anyone);
        battleArena.finalizeBattle(battleId);

        uint256 combinedPot = LOW_STAKE * 2;
        uint256 protocolFee = combinedPot * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 winnerPayout = combinedPot - protocolFee;
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();

        assertEq(claw.balanceOf(alice) - aliceBefore, winnerPayout + antiGrief, "alice gets payout + antiGrief");
        assertEq(claw.balanceOf(bob) - bobBefore, antiGrief, "bob gets antiGrief back");

        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled), "phase Settled after finalize");
        assertEq(b.winner, alice, "final winner recorded");
    }

    // 2. Settle alone moves no funds, applies no damage, leaves teams locked.
    function test_H01_settle_proposes_without_sideEffects() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupSettleableBattle();

        uint256 contractBalBefore = claw.balanceOf(address(battleArena));
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        _settleProposing(battleId, alice);

        assertEq(claw.balanceOf(address(battleArena)), contractBalBefore, "arena balance unchanged");
        assertEq(claw.balanceOf(alice), aliceBefore, "alice balance unchanged");
        assertEq(claw.balanceOf(bob), bobBefore, "bob balance unchanged");

        assertTrue(battleArena.teamInBattle(teamA), "teamA still locked");
        assertTrue(battleArena.teamInBattle(teamB), "teamB still locked");

        TeamManager.Team memory tA = teamMgr.getTeam(teamA);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(nft.getDamage(tA.lobsterIds[i]), 0, "no damage applied yet");
        }
    }

    // 3. Early finalize (before payoutDeadline) reverts.
    function test_H01_finalizeBeforeDeadline_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.DisputeWindowOpen.selector, battleId, b.payoutDeadline));
        battleArena.finalizeBattle(battleId);
    }

    // 4. Late dispute (after payoutDeadline) reverts.
    function test_H01_disputeAfterDeadline_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.payoutDeadline + 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.DisputeWindowClosed.selector, battleId, b.payoutDeadline));
        battleArena.disputeBattle(battleId, hex"");
    }

    // 5. Non-participant cannot dispute.
    function test_H01_disputeByNonParticipant_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        address outsider = makeAddr("outsider");
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotBattleParticipant.selector, battleId));
        battleArena.disputeBattle(battleId, hex"");
    }

    // 6. Double dispute rejected.
    function test_H01_doubleDispute_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        _setupDisputeBond(bob);
        vm.prank(bob);
        battleArena.disputeBattle(battleId, hex"01");

        // Second dispute reverts at AlreadyDisputed (before bond pull), no bond setup needed.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyDisputed.selector, battleId));
        battleArena.disputeBattle(battleId, hex"02");
    }

    // 7. Finalize after dispute reverts.
    function test_H01_finalizeOnDisputed_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        _setupDisputeBond(bob);
        vm.prank(bob);
        battleArena.disputeBattle(battleId, hex"");

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.payoutDeadline + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.BattleIsDisputed.selector, battleId));
        battleArena.finalizeBattle(battleId);
    }

    // 8. Admin can resolve a disputed battle and override the winner.
    function test_H01_adminResolve_overridesWinner() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        _setupDisputeBond(bob);
        vm.prank(bob);
        battleArena.disputeBattle(battleId, hex"deadbeef");

        uint256 bobBefore = claw.balanceOf(bob);
        uint256 disputeBond = battleArena.disputeBonds(0); // V3 S1: bob's bond will refund

        vm.prank(admin);
        battleArena.adminResolveDispute(battleId, bob, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, bob, "admin flipped winner to bob");

        uint256 combinedPot = LOW_STAKE * 2;
        uint256 protocolFee = combinedPot * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 winnerPayout = combinedPot - protocolFee;
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        // V3 S1: disputer bob was right → bond refunded in addition to winner payout.
        assertEq(
            claw.balanceOf(bob) - bobBefore,
            winnerPayout + antiGrief + disputeBond,
            "bob gets winner payout + dispute bond refund"
        );
    }

    // 9. Admin cannot resolve without a dispute.
    function test_H01_adminResolveWithoutDispute_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotDisputed.selector, battleId));
        battleArena.adminResolveDispute(battleId, alice, [uint8(5), 5, 5], [uint8(20), 20, 20]);
    }

    // 10. Admin cannot flip the winner to a non-participant.
    function test_H01_adminResolve_invalidWinner_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        _setupDisputeBond(bob);
        vm.prank(bob);
        battleArena.disputeBattle(battleId, hex"");

        address ghost = makeAddr("ghost");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidWinner.selector, battleId));
        battleArena.adminResolveDispute(battleId, ghost, [uint8(5), 5, 5], [uint8(20), 20, 20]);
    }

    // 11. handleTimeout on undisputed AwaitingFinalize = permissionless finalize.
    function test_H01_handleTimeout_undisputed_finalizes() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.payoutDeadline + 1);
        address anyone = makeAddr("anyone");
        vm.prank(anyone);
        battleArena.handleTimeout(battleId);

        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, alice, "handleTimeout executed the proposed outcome");
    }

    // 12. handleTimeout on disputed AwaitingFinalize reverts — admin must resolve.
    function test_H01_handleTimeout_disputed_requiresAdmin() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        _setupDisputeBond(bob);
        vm.prank(bob);
        battleArena.disputeBattle(battleId, hex"");

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.payoutDeadline + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.DisputedBattleRequiresAdmin.selector, battleId));
        battleArena.handleTimeout(battleId);
    }

    // ─────────────────────────────────────────────────────────────
    // Adversarial fuzz tests for attack angles identified in the
    // 2026-04-17 BattleArena read pass. Each targets a specific
    // concrete property rather than "doesn't revert".
    // ─────────────────────────────────────────────────────────────

    // Attack angle: dispute window boundary. `disputeBattle` must accept
    // calls at exactly `payoutDeadline` (<=) and reject anything past it.
    // Fuzz the deadline offset within a generous range.
    function testFuzz_disputeWindow_boundaryInside_accepted(uint256 offsetInto) public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        uint256 maxOffset = b.payoutDeadline - block.timestamp;
        offsetInto = bound(offsetInto, 0, maxOffset);
        vm.warp(block.timestamp + offsetInto);

        _setupDisputeBond(bob);
        vm.prank(bob);
        battleArena.disputeBattle(battleId, hex"");

        b = battleArena.getBattle(battleId);
        assertTrue(b.disputed, "dispute at or before deadline must be accepted");
    }

    function testFuzz_disputeWindow_pastDeadline_rejected(uint256 offsetPast) public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        offsetPast = bound(offsetPast, 1, 365 days);
        vm.warp(b.payoutDeadline + offsetPast);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.DisputeWindowClosed.selector, battleId, b.payoutDeadline));
        battleArena.disputeBattle(battleId, hex"");
    }

    // Attack angle: commit-hash round binding. If the player crafts a
    // commit hash using a round number other than the current round, the
    // reveal must fail with InvalidCommitHash. Prevents precommit/replay
    // across rounds.
    function testFuzz_commitHash_wrongRound_revealFails(uint8 wrongRound) public {
        (uint256 battleId,,) = _setupSettleableBattle();
        // Settle clears the round commit state, so we need a battle still in Active.
        // Start a new battle to explicitly test the round-binding.
        vm.prank(admin);
        uint256 battleId2 = battleArena.createBattle(alice, bob, LOW_STAKE);
        _deposit(alice, battleId2);
        _deposit(bob,   battleId2);

        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);
        bytes32 saltA = keccak256(abi.encodePacked("fuzz-teamA", battleId2));
        bytes32 saltB = keccak256(abi.encodePacked("fuzz-teamB", battleId2));
        _commitTeam(alice, battleId2, teamA, saltA);
        _commitTeam(bob,   battleId2, teamB, saltB);
        _revealTeam(alice, battleId2, teamA, saltA);
        _revealTeam(bob,   battleId2, teamB, saltB);

        // Battle is now Active at currentRound == 1. Craft a commit hash
        // that binds to a DIFFERENT round.
        BattleArena.Battle memory b = battleArena.getBattle(battleId2);
        wrongRound = uint8(bound(wrongRound, 0, 20));
        vm.assume(wrongRound != b.currentRound);

        bytes memory moveData = hex"AA";
        bytes32 moveSalt = bytes32(uint256(42));
        bytes32 bogusHash = keccak256(abi.encodePacked(battleId2, wrongRound, alice, moveData, moveSalt));

        vm.prank(alice);
        battleArena.commitMoves(battleId2, bogusHash);

        // Bob submits a valid commit so reveals are unblocked.
        bytes32 validHashB = keccak256(abi.encodePacked(battleId2, b.currentRound, bob, moveData, moveSalt));
        vm.prank(bob);
        battleArena.commitMoves(battleId2, validHashB);

        // Alice's reveal must fail because the commit binds the wrong round.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId2));
        battleArena.revealMoves(battleId2, moveData, moveSalt);
    }

    // Attack angle D: resolver can indefinitely block emergencyWithdraw by
    // calling advanceRound just before the 24h EMERGENCY_WITHDRAW_DELAY.
    // This test documents the intended behavior AND the starvation vector.
    // Post-H-01: players have disputeBattle as a complementary recourse
    // once the resolver calls settle(); during the Active phase this gap
    // remains and is called out in the trust NatSpec.
    function test_attack_emergencyWithdraw_blockedByResolverAdvance() public {
        (uint256 battleId,,) = _setupSettleableBattle();

        // _setupSettleableBattle leaves round 1 fully revealed but not yet
        // advanced. Advance to round 2 so the starvation loop can run
        // commit+reveal cycles from a clean commit slot.
        vm.prank(admin);
        battleArena.advanceRound(battleId);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        uint256 delay = battleArena.EMERGENCY_WITHDRAW_DELAY();

        // Starvation loop: advance round every (delay - 1s). lastProgressAt
        // resets on each advance so emergencyWithdraw never unlocks while
        // the battle still has rounds to play.
        while (b.currentRound < battleArena.MAX_ROUNDS()) {
            // Skip ahead in time but stay just under the delay.
            vm.warp(b.lastProgressAt + delay - 1);

            vm.prank(alice);
            vm.expectRevert();
            battleArena.emergencyWithdraw(battleId);

            // Resolver plays the round to advance.
            _playRound(battleId, hex"AA", hex"BB");
            vm.prank(admin);
            battleArena.advanceRound(battleId);
            b = battleArena.getBattle(battleId);
        }
        // At MAX_ROUNDS the starvation ends because advanceRound reverts;
        // the player can wait out the delay and reclaim. Property still
        // holds: emergencyWithdraw was blocked for the entire duration.
    }

    // N-02: _handleActiveTimeout fall-through advances currentRound but
    // forgets to refresh lastProgressAt. That lets a griefer time out every
    // round, watch the arena advance via timeout, and trigger
    // emergencyWithdraw 24h after the INITIAL revealTeam — effectively
    // cancelling (not settling) a battle that had been progressing all
    // along, escaping a losing position without paying the protocol fee.
    //
    // Discovered by Codex red-team pass, 2026-04-18.
    function test_N02_handleActiveTimeout_refreshesLastProgressAt() public {
        (uint256 battleId,,) = _setupSettleableBattle();

        // After _setupSettleableBattle, round 1 is fully revealed (via
        // _playRound) and lastProgressAt was set by revealTeam only.
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        uint256 lastProgressAtBefore = b.lastProgressAt;

        // Advance to round 2 cleanly so we have a fresh commit window.
        vm.prank(admin);
        battleArena.advanceRound(battleId);

        // Exercise the _handleActiveTimeout fall-through: Bob commits,
        // Alice doesn't, phase times out (below AUTO_FORFEIT_THRESHOLD so
        // we fall through to the non-terminal round advance).
        b = battleArena.getBattle(battleId);
        bytes32 saltB = bytes32(uint256(42));
        bytes memory moveB = hex"BB";
        bytes32 hashB = keccak256(abi.encodePacked(battleId, b.currentRound, bob, moveB, saltB));
        vm.prank(bob);
        battleArena.commitMoves(battleId, hashB);

        uint256 timestampBeforeTimeout = block.timestamp;
        vm.warp(block.timestamp + battleArena.COMMIT_WINDOW() + 1);
        battleArena.handleTimeout(battleId);

        b = battleArena.getBattle(battleId);
        // Battle must still be Active (fall-through, not forfeit path).
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Active), "fall-through kept battle active");
        // The round advanced — and lastProgressAt MUST have advanced with it.
        assertGt(
            b.lastProgressAt,
            lastProgressAtBefore,
            "N-02: lastProgressAt must refresh when _handleActiveTimeout advances a round"
        );
        assertGe(
            b.lastProgressAt,
            timestampBeforeTimeout,
            "N-02: lastProgressAt must reflect the timeout-driven advance"
        );
    }

    // Attack angle C variation: consecutive-timeout counters are cumulative
    // across rounds (per NatSpec comment). Fuzz a sequence of commit-A-only
    // timeouts and assert the counter increments monotonically until the
    // forfeit threshold.
    function testFuzz_consecutiveTimeoutCounter_monotonic(uint8 nTimeouts) public {
        (uint256 battleId,,) = _setupSettleableBattle();
        nTimeouts = uint8(bound(nTimeouts, 1, battleArena.AUTO_FORFEIT_THRESHOLD() - 1));

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        // After _setupSettleableBattle, round 1 already has both reveals
        // and the round commit state has NOT been reset (advanceRound not
        // called yet). Force advance so we're in a fresh commit window.
        vm.prank(admin);
        battleArena.advanceRound(battleId);

        uint8 prevCounter = 0;
        for (uint8 i = 0; i < nTimeouts; i++) {
            b = battleArena.getBattle(battleId);
            // Only bob commits; alice times out.
            bytes32 hashB = keccak256(abi.encodePacked(battleId, b.currentRound, bob, hex"BB", bytes32(uint256(i + 1))));
            vm.prank(bob);
            battleArena.commitMoves(battleId, hashB);

            vm.warp(block.timestamp + battleArena.COMMIT_WINDOW() + 1);
            battleArena.handleTimeout(battleId);

            b = battleArena.getBattle(battleId);
            assertGt(b.consecutiveTimeoutsA, prevCounter, "counter must strictly increment on each timeout");
            prevCounter = b.consecutiveTimeoutsA;

            // Stop if battle became terminal (shouldn't happen below threshold).
            if (b.phase == BattleArena.BattlePhase.Cancelled) break;
        }
    }

    // TM-01: BattleArena's terminal paths must tolerate a deleted team
    // (M-01 parity for BattleArena). Pre-fix, a compromised ACTIVITY_ROLE
    // could force-mark a battle team inactive, the owner could then
    // disband it, and the resulting `teamManager.getTeam(...)` call in
    // `_applyDamage` (or `setTeamActive` in `_releaseTeam`) reverted
    // `TeamDoesNotExist`, permanently bricking the settle/finalize and
    // timeout paths and trapping escrowed CLAW.
    function test_TM01_finalize_toleratesDeletedTeam() public {
        (uint256 battleId, uint256 teamA,) = _setupSettleableBattle();

        _settleProposing(battleId, alice);

        // Compromised-role attack: force-deactivate alice's team via an
        // ACTIVITY_ROLE holder (only MiningPool / BattleArena have this in
        // production; we impersonate MiningPool to simulate compromise).
        vm.prank(address(miningPool));
        teamMgr.setTeamActive(teamA, false);
        vm.prank(alice);
        teamMgr.disbandTeam(teamA);
        assertFalse(teamMgr.teamExists(teamA), "setup: team A is gone");

        // Finalize must still terminate cleanly. Without the TM-01 guard,
        // _applyDamage's getTeam() would revert and brick this path.
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.payoutDeadline + 1);
        battleArena.finalizeBattle(battleId);

        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled), "battle settled despite missing team");
        assertEq(b.winner, alice, "winner recorded");
    }

    // TM-01: same scenario via the timeout path (no settle, just timeout
    // on Active phase with a forced-inactive + disbanded team).
    function test_TM01_handleTimeout_toleratesDeletedTeam() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupSettleableBattle();

        // Force-disband team A mid-Active via a compromised ACTIVITY_ROLE holder.
        vm.prank(address(miningPool));
        teamMgr.setTeamActive(teamA, false);
        vm.prank(alice);
        teamMgr.disbandTeam(teamA);
        assertFalse(teamMgr.teamExists(teamA));

        // Warp past the COMMIT_WINDOW deadline. handleTimeout drives the
        // battle into _handleActiveTimeout, which (with both reveals done)
        // currently reverts MaxRoundsReached at MAX_ROUNDS — not the case
        // here. Round 2 commit phase: nobody commits, both deadline-out,
        // _cancelBattle path (which calls _releaseTeam). Without TM-01
        // tolerance, _releaseTeam reverts TeamDoesNotExist on team A.
        vm.prank(admin);
        battleArena.advanceRound(battleId);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.phaseDeadline + 1);
        battleArena.handleTimeout(battleId);

        b = battleArena.getBattle(battleId);
        // Battle reaches a terminal state (Cancelled via mutual timeout)
        assertTrue(
            b.phase == BattleArena.BattlePhase.Cancelled || b.phase == BattleArena.BattlePhase.Active,
            "timeout terminates without bricking"
        );
        // Team B's link still cleared if battle terminal
        if (b.phase == BattleArena.BattlePhase.Cancelled) {
            assertFalse(battleArena.teamInBattle(teamB), "team B released");
        }
    }

    // ─────────────────────────────────────────────────────────────
    // V3 S1: bonded disputes + per-address rate limit + per-bracket
    //        windows + admin tuning. Layered on top of shipped H-01.
    // ─────────────────────────────────────────────────────────────

    /// @dev Like _setupSettleableBattle but accepts any STAKE_BRACKETS value.
    function _setupSettleableBattleAtStake(uint256 stake) internal returns (uint256 battleId) {
        vm.prank(admin);
        battleId = battleArena.createBattle(alice, bob, stake);

        uint256 antiGrief = stake * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 total = stake + antiGrief;
        _giveClaw(alice, total);
        _giveClaw(bob,   total);
        vm.startPrank(alice); claw.approve(address(battleArena), total); battleArena.deposit(battleId); vm.stopPrank();
        vm.startPrank(bob);   claw.approve(address(battleArena), total); battleArena.deposit(battleId); vm.stopPrank();

        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);
        bytes32 saltA = keccak256(abi.encodePacked("V3-teamA", battleId));
        bytes32 saltB = keccak256(abi.encodePacked("V3-teamB", battleId));
        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob,   battleId, teamB, saltB);
        _revealTeam(alice, battleId, teamA, saltA);
        _revealTeam(bob,   battleId, teamB, saltB);

        _playRound(battleId, hex"01", hex"02");
    }

    /// @dev Setup-bond + dispute helper that respects the actual battle's bracket.
    function _setupBondAndDispute(address disputer, uint256 battleId) internal {
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        uint256 bond;
        if (b.stakeAmount == battleArena.STAKE_BRACKETS(0)) bond = battleArena.disputeBonds(0);
        else if (b.stakeAmount == battleArena.STAKE_BRACKETS(1)) bond = battleArena.disputeBonds(1);
        else bond = battleArena.disputeBonds(2);
        if (bond > 0) {
            _giveClaw(disputer, bond);
            vm.prank(disputer);
            claw.approve(address(battleArena), bond);
        }
        vm.prank(disputer);
        battleArena.disputeBattle(battleId, hex"");
    }

    // ── Per-bracket dispute window ────────────────────────────────

    function test_V3_perBracket_window_low_5min() public {
        uint256 battleId = _setupSettleableBattleAtStake(battleArena.STAKE_BRACKETS(0));
        uint256 settleAt = block.timestamp;
        _settleProposing(battleId, alice);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(b.payoutDeadline, settleAt + 5 minutes, "Low: 5 min window");
    }

    function test_V3_perBracket_window_mid_30min() public {
        uint256 battleId = _setupSettleableBattleAtStake(battleArena.STAKE_BRACKETS(1));
        uint256 settleAt = block.timestamp;
        _settleProposing(battleId, alice);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(b.payoutDeadline, settleAt + 30 minutes, "Mid: 30 min window");
    }

    function test_V3_perBracket_window_high_1hour() public {
        uint256 battleId = _setupSettleableBattleAtStake(battleArena.STAKE_BRACKETS(2));
        uint256 settleAt = block.timestamp;
        _settleProposing(battleId, alice);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(b.payoutDeadline, settleAt + 1 hours, "High: 1 hour window");
    }

    function test_V3_perBracket_bond_amounts() public {
        assertEq(battleArena.disputeBonds(0), 250e18,    "Low bond = 250 CLAW");
        assertEq(battleArena.disputeBonds(1), 1_000e18,  "Mid bond = 1,000 CLAW");
        assertEq(battleArena.disputeBonds(2), 5_000e18,  "High bond = 5,000 CLAW");
    }

    // ── Bond slashing on disputer-loses ───────────────────────────

    function test_V3_disputeBond_loserSlashed_routedToTreasury() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice); // alice proposed winner

        _setupBondAndDispute(bob, battleId); // bob disputes (will lose)

        uint256 bond = battleArena.disputeBonds(0);
        uint256 supplyBefore = claw.totalSupply();
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 bobBefore = claw.balanceOf(bob);

        // Admin upholds the proposed winner (alice). Disputer (bob) was wrong.
        vm.prank(admin);
        battleArena.adminResolveDispute(battleId, alice, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        // Bob's bond is slashed → no refund. Bob still gets antiGrief back as
        // a losing battle participant.
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        assertEq(claw.balanceOf(bob) - bobBefore, antiGrief, "bob: only antiGrief, no bond refund");

        // Treasury split: 85% burn (true burn — reduces totalSupply) + 15% dev.
        // The bond passes through the same Treasury.processFee path as the protocol
        // fee from settlement, so verify the combined effect.
        uint256 combinedPot = LOW_STAKE * 2;
        uint256 protocolFee = combinedPot * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 totalSlashed = bond + protocolFee;
        uint256 expectedDev = totalSlashed * 15 / 100;
        uint256 expectedBurn = totalSlashed - expectedDev;

        assertEq(claw.balanceOf(devWallet) - devBefore, expectedDev, "dev gets 15% of (bond + fee)");
        assertEq(supplyBefore - claw.totalSupply(),     expectedBurn, "burn = 85% of (bond + fee)");
    }

    // ── Bond snapshot: admin tuning mid-window does not affect already-disputed ──

    function test_V3_disputeBond_snapshot_independentOfLaterTuning() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        _setupBondAndDispute(bob, battleId);

        uint256 paidBond = battleArena.getBattle(battleId).disputeBondPaid;
        assertEq(paidBond, 250e18, "snapshot taken at dispute time");

        // T-02 timelock: admin proposes a new bond, must wait MIN_TUNING_DELAY to enact.
        // 500e18 is exactly 20% of LOW_STAKE — the new T-01 cap.
        vm.prank(admin);
        battleArena.proposeDisputeBond(0, 500e18);
        vm.warp(block.timestamp + battleArena.MIN_TUNING_DELAY());
        vm.prank(admin);
        battleArena.enactDisputeBond(0);

        // Already-disputed battle still resolves with snapshot (250e18), not new 500e18.
        uint256 bobBefore = claw.balanceOf(bob);
        vm.prank(admin);
        battleArena.adminResolveDispute(battleId, bob, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 combinedPot = LOW_STAKE * 2;
        uint256 protocolFee = combinedPot * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 winnerPayout = combinedPot - protocolFee;
        assertEq(
            claw.balanceOf(bob) - bobBefore,
            paidBond + winnerPayout + antiGrief,
            "bob refunded snapshot bond, not new tuned bond"
        );
    }

    // ── Per-address rate limit (5 per rolling 24h) ────────────────

    function test_V3_rateLimit_5_then_6th_reverts() public {
        // Build 6 settleable battles for bob to dispute. He's a participant of all.
        // Alice is participant alongside.
        uint256[] memory battleIds = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) {
            battleIds[i] = _setupSettleableBattleAtStake(battleArena.STAKE_BRACKETS(0));
            _settleProposing(battleIds[i], alice);
        }

        // First 5 disputes: succeed.
        for (uint256 i = 0; i < 5; i++) {
            _setupBondAndDispute(bob, battleIds[i]);
        }
        assertEq(battleArena.activeDisputesFor(bob), 5, "5 active disputes");

        // 6th: rate limit hit.
        uint256 bond = battleArena.disputeBonds(0);
        _giveClaw(bob, bond);
        vm.prank(bob);
        claw.approve(address(battleArena), bond);
        vm.prank(bob);
        // The DisputeRateLimitExceeded selector with the retryAt parameter — we can't
        // easily compute retryAt without reading internal storage, so use partial match.
        vm.expectRevert();
        battleArena.disputeBattle(battleIds[5], hex"");
    }

    function test_V3_rateLimit_prunesAfter24h() public {
        // 5 disputes back-to-back, then warp 24h+1, then a 6th must succeed.
        uint256[] memory battleIds = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) {
            battleIds[i] = _setupSettleableBattleAtStake(battleArena.STAKE_BRACKETS(0));
            _settleProposing(battleIds[i], alice);
        }

        for (uint256 i = 0; i < 5; i++) {
            _setupBondAndDispute(bob, battleIds[i]);
        }

        // Battle 6's payoutDeadline is `settleAt + 5 min`. To make a successful
        // dispute possible after 24h, we settle battle 6 AGAIN (re-settling is
        // not possible; the battle is in AwaitingFinalize). So instead: just
        // advance 24h+1 then verify the 5 prior disputes pruned and the 6th
        // can be filed — but battle 6's window has long since closed.
        //
        // Pivot: warp past battle 6's window, build a NEW battle 7 fresh, file.
        vm.warp(block.timestamp + 24 hours + 1);

        uint256 battleId7 = _setupSettleableBattleAtStake(battleArena.STAKE_BRACKETS(0));
        _settleProposing(battleId7, alice);

        // After warp, all prior 5 timestamps are stale → pruned on next dispute.
        // activeDisputesFor sees 0 active.
        assertEq(battleArena.activeDisputesFor(bob), 0, "all 5 disputes pruned");

        _setupBondAndDispute(bob, battleId7);
        assertEq(battleArena.activeDisputesFor(bob), 1, "post-warp dispute counted");
    }

    // ── Admin setters: timelocked propose + enact (T-02), tiered window caps
    //    (T-03), 20% bond cap (T-01) ────────────────────────────────

    function test_V3_proposeAndEnactDisputeWindow_onlyAdmin() public {
        address randomCaller = makeAddr("random");
        vm.prank(randomCaller);
        vm.expectRevert();
        battleArena.proposeDisputeWindow(0, 10 minutes);

        vm.prank(admin);
        battleArena.proposeDisputeWindow(0, 10 minutes);
        // Pre-enact: live value unchanged (still default 5 min)
        assertEq(battleArena.disputeWindows(0), 5 minutes, "live value unchanged before enact");

        vm.warp(block.timestamp + battleArena.MIN_TUNING_DELAY());
        vm.prank(admin);
        battleArena.enactDisputeWindow(0);
        assertEq(battleArena.disputeWindows(0), 10 minutes, "live value updated after enact");
    }

    function test_V3_proposeDisputeWindow_tieredCapsByBracket() public {
        vm.startPrank(admin);
        // T-03: Low bracket cap = 1 day
        battleArena.proposeDisputeWindow(0, 1 days); // OK
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeWindow.selector, 1 days + 1));
        battleArena.proposeDisputeWindow(0, 1 days + 1);

        // Mid bracket cap = 3 days
        battleArena.proposeDisputeWindow(1, 3 days);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeWindow.selector, 3 days + 1));
        battleArena.proposeDisputeWindow(1, 3 days + 1);

        // High bracket cap = 7 days
        battleArena.proposeDisputeWindow(2, 7 days);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeWindow.selector, 7 days + 1));
        battleArena.proposeDisputeWindow(2, 7 days + 1);

        // Below 60s reverts at all brackets
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeWindow.selector, 30));
        battleArena.proposeDisputeWindow(0, 30);

        // Invalid bracket reverts
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeBracket.selector, 3));
        battleArena.proposeDisputeWindow(3, 1 minutes);
        vm.stopPrank();
    }

    function test_V3_proposeAndEnactDisputeBond_onlyAdmin() public {
        address randomCaller = makeAddr("random");
        vm.prank(randomCaller);
        vm.expectRevert();
        battleArena.proposeDisputeBond(0, 100e18);

        vm.prank(admin);
        battleArena.proposeDisputeBond(0, 100e18);
        assertEq(battleArena.disputeBonds(0), 250e18, "live value unchanged before enact");

        vm.warp(block.timestamp + battleArena.MIN_TUNING_DELAY());
        vm.prank(admin);
        battleArena.enactDisputeBond(0);
        assertEq(battleArena.disputeBonds(0), 100e18, "live value updated after enact");
    }

    function test_V3_proposeDisputeBond_capped_at_20pct_of_stake() public {
        vm.startPrank(admin);
        // T-01: Exactly 20% of Low bracket stake (500 CLAW) is fine
        battleArena.proposeDisputeBond(0, 500e18);
        // 20% + 1 wei reverts
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeBond.selector, 500e18 + 1));
        battleArena.proposeDisputeBond(0, 500e18 + 1);
        // Bond can be set to 0 (disables bond requirement for that bracket)
        battleArena.proposeDisputeBond(0, 0);
        // Mid bracket cap = 2,000 CLAW (20% of 10K)
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeBond.selector, 2_000e18 + 1));
        battleArena.proposeDisputeBond(1, 2_000e18 + 1);
        battleArena.proposeDisputeBond(1, 2_000e18);
        // High bracket cap = 10,000 CLAW (20% of 50K)
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeBond.selector, 10_000e18 + 1));
        battleArena.proposeDisputeBond(2, 10_000e18 + 1);
        battleArena.proposeDisputeBond(2, 10_000e18);
        vm.stopPrank();
    }

    // T-02 timelock-specific behaviors

    function test_V3_timelock_enactBeforeDelay_reverts() public {
        uint256 delay = battleArena.MIN_TUNING_DELAY(); // pre-compute so it doesn't consume the prank
        uint256 proposedAt = block.timestamp;
        vm.prank(admin);
        battleArena.proposeDisputeWindow(0, 10 minutes);

        // Try to enact 1 second before delay elapses
        vm.warp(proposedAt + delay - 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(
            BattleArena.TuningDelayNotElapsed.selector,
            0,
            proposedAt + delay
        ));
        battleArena.enactDisputeWindow(0);
    }

    function test_V3_timelock_enactWithoutPropose_reverts() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NoPendingChange.selector, 0));
        battleArena.enactDisputeWindow(0);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NoPendingChange.selector, 1));
        battleArena.enactDisputeBond(1);
    }

    function test_V3_timelock_repropose_resetsTimer() public {
        uint256 delay = battleArena.MIN_TUNING_DELAY(); // pre-compute
        vm.prank(admin);
        battleArena.proposeDisputeWindow(0, 10 minutes);

        vm.warp(block.timestamp + 12 hours); // halfway through original delay
        uint256 reproposedAt = block.timestamp;
        vm.prank(admin);
        battleArena.proposeDisputeWindow(0, 20 minutes); // overwrites + resets timer

        // 24h after the FIRST propose (12h after the second) is too early
        vm.warp(reproposedAt + 12 hours);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(
            BattleArena.TuningDelayNotElapsed.selector,
            0,
            reproposedAt + delay
        ));
        battleArena.enactDisputeWindow(0);

        // 24h after the SECOND propose succeeds
        vm.warp(reproposedAt + delay);
        vm.prank(admin);
        battleArena.enactDisputeWindow(0);
        assertEq(battleArena.disputeWindows(0), 20 minutes, "second proposal value enacted");
    }

    function test_V3_timelock_enactClearsPending() public {
        vm.prank(admin);
        battleArena.proposeDisputeBond(0, 100e18);
        vm.warp(block.timestamp + battleArena.MIN_TUNING_DELAY());
        vm.prank(admin);
        battleArena.enactDisputeBond(0);

        // Second enact (no new proposal) reverts NoPendingChange
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NoPendingChange.selector, 0));
        battleArena.enactDisputeBond(0);

        // Pending storage is zeroed
        assertEq(battleArena.pendingDisputeBond(0), 0, "pending value cleared");
        assertEq(battleArena.pendingDisputeBondAt(0), 0, "pending timestamp cleared");
    }

    // ── activeDisputesFor view sanity ─────────────────────────────

    function test_V3_activeDisputesFor_matchesActualCount() public {
        assertEq(battleArena.activeDisputesFor(bob), 0, "no disputes yet");

        uint256 battleId = _setupSettleableBattleAtStake(battleArena.STAKE_BRACKETS(0));
        _settleProposing(battleId, alice);
        _setupBondAndDispute(bob, battleId);

        assertEq(battleArena.activeDisputesFor(bob), 1, "one active dispute");
        assertEq(battleArena.activeDisputesFor(alice), 0, "alice didn't dispute");
    }
}
