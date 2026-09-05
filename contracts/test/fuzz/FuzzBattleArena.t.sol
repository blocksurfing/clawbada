// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for BattleArena: phase state machine, stake accounting, access control.
contract FuzzBattleArena is BaseSetup {
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    uint256 internal constant LOW_STAKE = 2_500e18;
    // V3 settle commitments (any non-zero value)
    bytes32 internal constant HASH_STATE = keccak256("final-state");
    bytes32 internal constant HASH_LOG = keccak256("turn-log");

    function _createBattle() internal returns (uint256 battleId) {
        vm.prank(admin);
        // Power 3 == three Evolved lobsters (the standard _createEvolvedTeam composition).
        battleId = battleArena.createBattle(alice, bob, LOW_STAKE, 3, 3);
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

    // F5-01: team reveal is atomic and resolver-submitted. `admin` holds RESOLVER_ROLE in
    // this harness. Assumes alice = playerA, bob = playerB (the convention these tests use).
    function _revealTeams(
        uint256 battleId,
        uint256 teamA,
        bytes32 saltA,
        uint256 teamB,
        bytes32 saltB
    ) internal {
        vm.prank(admin);
        battleArena.revealTeams(battleId, teamA, saltA, teamB, saltB);
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

    // ── Invalid stake reverts ─────────────────────────────────────

    function testFuzz_invalid_stake_reverts(uint256 amount) public {
        // Not one of the 3 brackets
        vm.assume(amount != 2_500e18 && amount != 10_000e18 && amount != 50_000e18);
        amount = bound(amount, 1, type(uint128).max);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeAmount.selector, amount));
        battleArena.createBattle(alice, bob, amount, 3, 3);
    }

    // ── Same player reverts ───────────────────────────────────────

    function test_same_player_reverts() public {
        vm.prank(admin);
        vm.expectRevert(BattleArena.PlayerCannotBeSelf.selector);
        battleArena.createBattle(alice, alice, LOW_STAKE, 3, 3);
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

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.TeamReveal), "TeamReveal after both commits");

        // F5-01: atomic resolver-submitted reveal binds both teams and transitions
        // straight to Active — there is no one-sided intermediate reveal state.
        _revealTeams(battleId, teamA, saltA, teamB, saltB);
        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Active), "Active after atomic reveal");
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
        _revealTeams(battleId, teamA, saltA, teamB, saltB);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore   = claw.balanceOf(bob);
        uint256 supplyBefore = claw.totalSupply();

        // Settle with alice as winner, minimal damage.
        // H-01: settle proposes, finalize pays.
        uint8[3] memory winnerDmg = [uint8(5), 5, 5];
        uint8[3] memory loserDmg  = [uint8(20), 20, 20];

        vm.prank(admin);
        battleArena.settle(battleId, alice, HASH_STATE, HASH_LOG, winnerDmg, loserDmg);
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

        // F5-01: atomic reveal validates both teams; alice's over-damaged team reverts.
        vm.prank(admin);
        vm.expectRevert(); // LobsterDamageTooHigh
        battleArena.revealTeams(battleId, teamA, saltA, teamB, saltB);
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

        // Try to reveal with wrong salt for team A
        bytes32 wrongSalt = bytes32(uint256(999));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        battleArena.revealTeams(battleId, teamA, wrongSalt, teamB, saltB);
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
        _revealTeams(battleId, teamA, saltA, teamB, saltB);

        // 60 + 200 = 260 overflows uint8 — old code panicked, new code caps at 100.
        // H-01: damage application happens in finalizeBattle, not settle.
        uint8[3] memory winnerDmg = [uint8(200), 200, 200];
        uint8[3] memory loserDmg  = [uint8(200), 200, 200];

        vm.prank(admin);
        battleArena.settle(battleId, alice, HASH_STATE, HASH_LOG, winnerDmg, loserDmg);
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
        battleArena.settle(battleId, alice, HASH_STATE, HASH_LOG, dmg, dmg);
    }

    // ── F5-01: team reveal is atomic + resolver-submitted ─────────
    // Closes the matchup-dodge exploit. Sequential per-player reveal leaked the first
    // revealer's composition mid-window, letting the second mover bail on a bad matchup
    // for only the 5% anti-grief. Now no player can self-submit a reveal (nothing leaks),
    // and an honest reveal-window timeout is a COSTLESS mutual cancel — a dropped
    // connection never costs a human (or agent) their stake.

    function test_F5_01_revealTeams_onlyResolver() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);
        bytes32 saltA = bytes32(uint256(0xA));
        bytes32 saltB = bytes32(uint256(0xB));
        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob, battleId, teamB, saltB);

        // A participant cannot self-submit the reveal — this was the leak vector.
        vm.prank(alice);
        vm.expectRevert(); // AccessControlUnauthorizedAccount(alice, RESOLVER_ROLE)
        battleArena.revealTeams(battleId, teamA, saltA, teamB, saltB);

        // Neither can a non-participant stranger.
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        battleArena.revealTeams(battleId, teamA, saltA, teamB, saltB);

        // Only the resolver can, and it transitions straight to Active.
        _revealTeams(battleId, teamA, saltA, teamB, saltB);
        assertEq(
            uint8(battleArena.getBattle(battleId).phase),
            uint8(BattleArena.BattlePhase.Active),
            "resolver reveal -> Active"
        );
    }

    function test_F5_01_revealTimeout_isCostlessMutualCancel() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId);
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);
        bytes32 saltA = bytes32(uint256(0xA));
        bytes32 saltB = bytes32(uint256(0xB));
        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob, battleId, teamB, saltB);

        // Balances after deposit (stake + anti-grief is escrowed in the arena).
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 supplyBefore = claw.totalSupply();

        // Resolver never submits revealTeams (e.g. a player dropped offline mid-window).
        // After the reveal window anyone can time it out.
        vm.warp(block.timestamp + battleArena.TEAM_REVEAL_WINDOW() + 1);
        battleArena.handleTimeout(battleId);

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Cancelled), "mutual cancel");

        // Both players made whole: full stake + anti-grief refunded, NO slash.
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 fullRefund = LOW_STAKE + antiGrief;
        assertEq(claw.balanceOf(alice) - aliceBefore, fullRefund, "alice fully refunded");
        assertEq(claw.balanceOf(bob) - bobBefore, fullRefund, "bob fully refunded");

        // Nothing burned — distinguishes the costless cancel from the forfeit path, where
        // the loser's anti-grief is slashed to Treasury (85% burned).
        assertEq(claw.totalSupply(), supplyBefore, "no anti-grief burned on reveal timeout");

        // Neither team was locked (atomic reveal never landed), so both stay free.
        assertFalse(battleArena.teamInBattle(teamA), "teamA not locked");
        assertFalse(battleArena.teamInBattle(teamB), "teamB not locked");
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

    // ─────────────────────────────────────────────────────────────
    // H-01: challenge window (AwaitingFinalize / disputeBattle /
    //       finalizeBattle / adminResolveDispute)
    // ─────────────────────────────────────────────────────────────

    // Helper: drive a battle to a state where settle() can be called (V3: any
    // Active battle — turns are off-chain, nothing else has to land on-chain first).
    function _setupSettleableBattle() internal returns (uint256 battleId, uint256 teamA, uint256 teamB) {
        battleId = _createBattle();
        _bothDeposit(battleId);

        teamA = _createEvolvedTeam(alice);
        teamB = _createEvolvedTeam(bob);
        bytes32 saltA = keccak256(abi.encodePacked("H01-teamA", battleId));
        bytes32 saltB = keccak256(abi.encodePacked("H01-teamB", battleId));
        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob,   battleId, teamB, saltB);
        _revealTeams(battleId, teamA, saltA, teamB, saltB);

    }

    // Helper: settle() with the default H-01 proposal (alice wins, small damages)
    function _settleProposing(uint256 battleId, address winner) internal {
        vm.prank(admin);
        battleArena.settle(battleId, winner, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);
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
        battleArena.adminResolveDispute(battleId, bob, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

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
        battleArena.adminResolveDispute(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);
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
        battleArena.adminResolveDispute(battleId, ghost, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);
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

        // V3: past ACTIVE_WINDOW, handleTimeout mutually cancels (_cancelBattle →
        // _releaseTeam). Without TM-01 tolerance, _releaseTeam reverts
        // TeamDoesNotExist on team A and the stakes are trapped.
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.phaseDeadline + 1);
        battleArena.handleTimeout(battleId);

        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Cancelled), "stale Active battle cancels without bricking");
        assertFalse(battleArena.teamInBattle(teamB), "team B released");
        assertFalse(battleArena.teamInBattle(teamA), "team A link cleared even though the team is gone");
    }

    // ─────────────────────────────────────────────────────────────
    // V3 S1: bonded disputes + per-address rate limit + per-bracket
    //        windows + admin tuning. Layered on top of shipped H-01.
    // ─────────────────────────────────────────────────────────────

    /// @dev Like _setupSettleableBattle but accepts any STAKE_BRACKETS value.
    function _setupSettleableBattleAtStake(uint256 stake) internal returns (uint256 battleId) {
        vm.prank(admin);
        battleId = battleArena.createBattle(alice, bob, stake, 3, 3);

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
        _revealTeams(battleId, teamA, saltA, teamB, saltB);

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
        battleArena.adminResolveDispute(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

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
        battleArena.adminResolveDispute(battleId, bob, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

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

    // ─────────────────────────────────────────────────────────────
    // Meat-grinder fixes (2026-05): BA-H1 / BA-M1 / BA-M2 / BA-M3
    // ─────────────────────────────────────────────────────────────

    /// @dev Drive a battle to Active (teams revealed; V3: the battle itself is off-chain).
    function _setupActiveBattle() internal returns (uint256 battleId) {
        battleId = _createBattle();
        _bothDeposit(battleId);
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);
        bytes32 saltA = keccak256(abi.encodePacked("active-A", battleId));
        bytes32 saltB = keccak256(abi.encodePacked("active-B", battleId));
        _commitTeam(alice, battleId, teamA, saltA);
        _commitTeam(bob,   battleId, teamB, saltB);
        _revealTeams(battleId, teamA, saltA, teamB, saltB);
    }

    // BA-M1: phase-bound actions revert once their deadline passes — enforced at the
    // action, not only via handleTimeout. Covers a late deposit and a late settle.
    function test_BA_M1_lateAction_reverts() public {
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();

        // Late deposit.
        uint256 battleId = _createBattle();
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.phaseDeadline + 1);
        _giveClaw(alice, LOW_STAKE + antiGrief);
        vm.startPrank(alice);
        claw.approve(address(battleArena), LOW_STAKE + antiGrief);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        battleArena.deposit(battleId);
        vm.stopPrank();

        // Late settle in Active (V3: the only Active-phase action left).
        uint256 battleId2 = _setupActiveBattle();
        BattleArena.Battle memory bb = battleArena.getBattle(battleId2);
        vm.warp(bb.phaseDeadline + 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId2));
        battleArena.settle(battleId2, alice, HASH_STATE, HASH_LOG, [uint8(0), 0, 0], [uint8(0), 0, 0]);
    }

    // BA-M2: a dispute that changes ONLY the damage arrays (winner unchanged) now
    // counts as the disputer prevailing → bond refunded. Previously the bond was
    // always slashed when the winner was unchanged, making damage disputes futile.
    function test_BA_M2_damageOnlyDispute_refundsBond() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice); // winner alice, dmg [5,5,5]/[20,20,20]

        _setupBondAndDispute(bob, battleId);
        uint256 bond = battleArena.disputeBonds(0);
        uint256 bobBefore = claw.balanceOf(bob);

        // Admin keeps the SAME winner (alice) but CORRECTS the loser damage → disputer wins.
        vm.prank(admin);
        battleArena.adminResolveDispute(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(10), 10, 10]);

        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        // Bob lost the battle but was right about the damage: bond refunded + antiGrief.
        assertEq(claw.balanceOf(bob) - bobBefore, bond + antiGrief, "BA-M2: damage-only disputer refunded bond");
    }

    // BA-M3: proposeDisputeBond rejects a nonzero bond below the Treasury fee floor
    // (BPS_DENOMINATOR wei) — which would otherwise brick adminResolveDispute's slash
    // path and lock the disputed battle. 0 (bonding disabled) and >= floor are allowed.
    function test_BA_M3_dustDisputeBond_rejected() public {
        uint256 floor = battleArena.BPS_DENOMINATOR();

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeBond.selector, uint256(1)));
        battleArena.proposeDisputeBond(0, 1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidDisputeBond.selector, floor - 1));
        battleArena.proposeDisputeBond(0, floor - 1);

        // Exactly the floor is accepted.
        vm.prank(admin);
        battleArena.proposeDisputeBond(0, floor);

        // Zero (bonding disabled) is accepted.
        vm.prank(admin);
        battleArena.proposeDisputeBond(0, 0);
    }

    // ─────────────────────────────────────────────────────────────
    // V3: settle carries battle hashes; draws refund; ACTIVE_WINDOW
    // ─────────────────────────────────────────────────────────────

    /// Damage never exceeds the 100-point cap on either team, win or draw, for any
    /// pre-existing damage and any proposed per-slot damage.
    function testFuzz_settle_damageNeverExceeds100(uint8[3] memory dmgA, uint8[3] memory dmgB, uint8 pre, bool draw) public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupSettleableBattle();
        pre = uint8(bound(pre, 0, 100));
        TeamManager.Team memory tA = teamMgr.getTeam(teamA);
        TeamManager.Team memory tB = teamMgr.getTeam(teamB);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin); nft.setDamage(tA.lobsterIds[i], pre);
            vm.prank(admin); nft.setDamage(tB.lobsterIds[i], pre);
        }

        vm.prank(admin);
        battleArena.settle(battleId, draw ? address(0) : alice, HASH_STATE, HASH_LOG, dmgA, dmgB);
        vm.warp(block.timestamp + battleArena.disputeWindows(0) + 1);
        battleArena.finalizeBattle(battleId);

        for (uint256 i = 0; i < 3; i++) {
            uint256 expA = uint256(pre) + dmgA[i]; if (expA > 100) expA = 100;
            uint256 expB = uint256(pre) + dmgB[i]; if (expB > 100) expB = 100;
            assertEq(nft.getDamage(tA.lobsterIds[i]), expA, "A slot damage");
            assertEq(nft.getDamage(tB.lobsterIds[i]), expB, "B slot damage");
        }
    }

    /// A draw is exactly conservative at every stake bracket: both players get stake +
    /// anti-grief back, nothing is burned, the dev wallet gets nothing, the arena is empty.
    function testFuzz_settle_draw_isConservative_atEveryBracket(uint8 bracketIdx) public {
        bracketIdx = uint8(bound(bracketIdx, 0, 2));
        uint256 stake = battleArena.STAKE_BRACKETS(bracketIdx);
        uint256 battleId = _setupSettleableBattleAtStake(stake);

        uint256 antiGrief = stake * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.prank(admin);
        battleArena.settle(battleId, address(0), HASH_STATE, HASH_LOG, [uint8(7), 7, 7], [uint8(9), 9, 9]);
        vm.warp(block.timestamp + battleArena.disputeWindows(bracketIdx) + 1);
        battleArena.finalizeBattle(battleId);

        assertEq(claw.balanceOf(alice) - aliceBefore, stake + antiGrief, "alice refunded stake + anti-grief");
        assertEq(claw.balanceOf(bob) - bobBefore, stake + antiGrief, "bob refunded stake + anti-grief");
        assertEq(claw.balanceOf(devWallet), devBefore, "no dev share on a draw");
        assertEq(claw.totalSupply(), supplyBefore, "no burn on a draw");
        assertEq(claw.balanceOf(address(battleArena)), 0, "arena holds nothing after a draw");
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, address(0));
    }

    /// The Active phase cannot outlive ACTIVE_WINDOW: past it, settle reverts and anyone
    /// can cancel with full refunds — a dead resolver never traps a stake.
    function testFuzz_activeWindow_lateSettleReverts_timeoutRefunds(uint256 late) public {
        late = bound(late, 1, 30 days);
        uint256 battleId = _setupActiveBattle();
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(b.phaseDeadline, block.timestamp + battleArena.ACTIVE_WINDOW());

        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        vm.warp(b.phaseDeadline + late);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        battleArena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        vm.prank(makeAddr("anyone"));
        battleArena.handleTimeout(battleId);

        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Cancelled));
        assertEq(claw.balanceOf(alice) - aliceBefore, LOW_STAKE + antiGrief);
        assertEq(claw.balanceOf(bob) - bobBefore, LOW_STAKE + antiGrief);
        assertEq(claw.balanceOf(address(battleArena)), 0);
    }

    /// settle() and adminResolveDispute() both reject a zero commitment.
    function test_V3_zeroHash_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        battleArena.settle(battleId, alice, bytes32(0), HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        battleArena.settle(battleId, alice, HASH_STATE, bytes32(0), [uint8(5), 5, 5], [uint8(20), 20, 20]);

        _settleProposing(battleId, alice);
        _setupBondAndDispute(bob, battleId);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        battleArena.adminResolveDispute(battleId, alice, HASH_STATE, bytes32(0), [uint8(5), 5, 5], [uint8(20), 20, 20]);
    }

    /// BA-M2 (V3 extension): a hash-only correction counts as the disputer prevailing.
    function test_V3_hashOnlyDispute_refundsBond() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        _setupBondAndDispute(bob, battleId);
        uint256 bond = battleArena.disputeBonds(0);
        uint256 bobBefore = claw.balanceOf(bob);

        bytes32 corrected = keccak256("turn-log-corrected");
        vm.prank(admin);
        battleArena.adminResolveDispute(battleId, alice, HASH_STATE, corrected, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        assertEq(claw.balanceOf(bob) - bobBefore, bond + antiGrief, "hash-only disputer refunded bond");
        assertEq(battleArena.getBattle(battleId).turnLogHash, corrected, "admin's hash recorded");
    }

    /// Draw <-> win disputes route the bond correctly in both directions.
    function test_V3_drawDispute_bothDirections() public {
        // Proposed draw, admin names bob -> disputer (bob) refunded + paid.
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, address(0));
        _setupBondAndDispute(bob, battleId);
        uint256 bond = battleArena.disputeBonds(0);
        uint256 bobBefore = claw.balanceOf(bob);
        vm.prank(admin);
        battleArena.adminResolveDispute(battleId, bob, HASH_STATE, HASH_LOG, [uint8(20), 20, 20], [uint8(5), 5, 5]);
        uint256 combinedPot = LOW_STAKE * 2;
        uint256 winnerPayout = combinedPot - combinedPot * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
        uint256 antiGrief = LOW_STAKE * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        assertEq(claw.balanceOf(bob) - bobBefore, bond + winnerPayout + antiGrief, "draw->win: disputer paid + bond back");

        // Proposed alice win, admin rules a draw -> disputer (bob) refunded, both stakes back.
        (uint256 battleId2,,) = _setupSettleableBattle();
        _settleProposing(battleId2, alice);
        _setupBondAndDispute(bob, battleId2);
        bobBefore = claw.balanceOf(bob);
        vm.prank(admin);
        battleArena.adminResolveDispute(battleId2, address(0), HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(5), 5, 5]);
        assertEq(claw.balanceOf(bob) - bobBefore, bond + LOW_STAKE + antiGrief, "win->draw: disputer refunded stake + bond");
        assertEq(battleArena.getBattle(battleId2).winner, address(0));
    }
}
