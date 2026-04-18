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

        // Settle with alice as winner, minimal damage
        uint8[3] memory winnerDmg = [uint8(5), 5, 5];
        uint8[3] memory loserDmg  = [uint8(20), 20, 20];

        vm.prank(admin);
        battleArena.settle(battleId, alice, winnerDmg, loserDmg);

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

        // 60 + 200 = 260 overflows uint8 — old code panicked, new code caps at 100
        uint8[3] memory winnerDmg = [uint8(200), 200, 200];
        uint8[3] memory loserDmg  = [uint8(200), 200, 200];

        vm.prank(admin);
        battleArena.settle(battleId, alice, winnerDmg, loserDmg);

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
}
