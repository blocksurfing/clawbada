// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for BattleArena: phase state machine, consent + commit in deposit, settlement
///      review (freeze / resolveFrozen / expireFrozen / refund reserve), payout conservation,
///      reveal-failure attribution, access control and timelocked tuning.
contract FuzzBattleArena is BaseSetup {
    // D-01: every test battle uses one known secret; the commitment binds it to the battle id.
    bytes32 internal constant SEED_SECRET = keccak256("clawbada-test-seed-secret");

    function _seedCommit(uint256 battleId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(battleId, SEED_SECRET));
    }

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal guardian = makeAddr("guardian");
    address internal funder = makeAddr("reserve-funder");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant LOW_STAKE = 2_500e18;
    // V3 settle commitments (any non-zero value)
    bytes32 internal constant HASH_STATE = keccak256("final-state");
    bytes32 internal constant HASH_LOG = keccak256("turn-log");

    function setUp() public override {
        super.setUp();
        bytes32 guardianRole = battleArena.GUARDIAN_ROLE();
        vm.prank(admin);
        battleArena.grantRole(guardianRole, guardian);
    }

    // ─────────────────────────── helpers ───────────────────────────

    function _ag(uint256 stake) internal view returns (uint256) {
        return stake * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
    }

    function _commitHash(uint256 battleId, address player, uint256 teamId, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(battleId, player, teamId, salt));
    }

    function _saltA(uint256 battleId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("salt-A", battleId));
    }

    function _saltB(uint256 battleId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("salt-B", battleId));
    }

    function _createBattleAt(uint256 stake) internal returns (uint256 battleId) {
        vm.prank(admin);
        // Power 3 == three Evolved lobsters (the standard _createEvolvedTeam composition).
        battleId = battleArena.createBattle(alice, bob, stake, 3, 3);
    }

    function _createBattle() internal returns (uint256) {
        return _createBattleAt(LOW_STAKE);
    }

    /// @dev Fund + approve + deposit with full consent (expected stake, any opponent power).
    function _depositWith(address player, uint256 battleId, uint256 stake, bytes32 commitHash) internal {
        uint256 total = stake + _ag(stake);
        _giveClaw(player, total);
        vm.startPrank(player);
        claw.approve(address(battleArena), total);
        battleArena.deposit(battleId, stake, 9, commitHash);
        vm.stopPrank();
    }

    /// @dev Deposit committing to `teamId` with the per-side deterministic salt.
    function _depositTeam(address player, uint256 battleId, uint256 stake, uint256 teamId) internal {
        bytes32 salt = player == alice ? _saltA(battleId) : _saltB(battleId);
        _depositWith(player, battleId, stake, _commitHash(battleId, player, teamId, salt));
    }

    /// @dev Deposit with a throwaway (non-zero) commitment, for tests that never reveal.
    function _deposit(address player, uint256 battleId) internal {
        _depositWith(player, battleId, LOW_STAKE, keccak256(abi.encodePacked("dummy", player, battleId)));
    }

    function _bothDeposit(uint256 battleId) internal {
        _deposit(alice, battleId);
        _deposit(bob, battleId);
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

    /// @dev Battle in TeamReveal with both commits bound to fresh Evolved teams.
    function _setupRevealPhase(uint256 stake) internal returns (uint256 battleId, uint256 teamA, uint256 teamB) {
        teamA = _createEvolvedTeam(alice);
        teamB = _createEvolvedTeam(bob);
        battleId = _createBattleAt(stake);
        _depositTeam(alice, battleId, stake, teamA);
        _depositTeam(bob, battleId, stake, teamB);
    }

    function _reveal(uint256 battleId, uint256 teamA, uint256 teamB) internal {
        vm.prank(admin);
        battleArena.revealTeams(battleId, teamA, _saltA(battleId), teamB, _saltB(battleId), _seedCommit(battleId));
    }

    function _setupActiveAt(uint256 stake) internal returns (uint256 battleId, uint256 teamA, uint256 teamB) {
        (battleId, teamA, teamB) = _setupRevealPhase(stake);
        _reveal(battleId, teamA, teamB);
    }

    function _setupSettleableBattle() internal returns (uint256 battleId, uint256 teamA, uint256 teamB) {
        return _setupActiveAt(LOW_STAKE);
    }

    function _settle(uint256 battleId, address winner, address forfeiter) internal {
        vm.prank(admin);
        battleArena.settle(
            battleId, winner, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20], SEED_SECRET, forfeiter
        );
    }

    function _settleProposing(uint256 battleId, address winner) internal {
        _settle(battleId, winner, address(0));
    }

    function _fundReserve(uint256 amount) internal {
        _giveClaw(funder, amount);
        vm.startPrank(funder);
        claw.approve(address(battleArena), amount);
        battleArena.fundReserve(amount);
        vm.stopPrank();
    }

    /// @dev Fuzz selector → address: 0 alice, 1 bob, 2 address(0), 3 stranger.
    function _pick(uint8 sel) internal view returns (address) {
        sel = sel % 4;
        if (sel == 0) return alice;
        if (sel == 1) return bob;
        if (sel == 2) return address(0);
        return stranger;
    }

    function _isValidResult(address winner, address forfeiter) internal view returns (bool) {
        if (winner != address(0) && winner != alice && winner != bob) return false;
        if (forfeiter == address(0)) return true;
        if (winner == address(0) || forfeiter == winner) return false;
        return forfeiter == alice || forfeiter == bob;
    }

    function _expectedResultError(uint256 battleId, address winner) internal view returns (bytes memory) {
        if (winner != address(0) && winner != alice && winner != bob) {
            return abi.encodeWithSelector(BattleArena.InvalidWinner.selector, battleId);
        }
        return abi.encodeWithSelector(BattleArena.InvalidForfeiter.selector, battleId);
    }

    struct Snap {
        uint256 alice;
        uint256 bob;
        uint256 dev;
        uint256 supply;
        uint256 arena;
        uint256 treasury;
        uint256 reserve;
    }

    function _snap() internal view returns (Snap memory s) {
        s.alice = claw.balanceOf(alice);
        s.bob = claw.balanceOf(bob);
        s.dev = claw.balanceOf(devWallet);
        s.supply = claw.totalSupply();
        s.arena = claw.balanceOf(address(battleArena));
        s.treasury = claw.balanceOf(address(treasury));
        s.reserve = battleArena.refundReserve();
    }

    /// @dev Expected (alicePaid, bobPaid, feeToTreasury) for a paid result.
    function _expectedPayout(uint256 stake, address winner, address forfeiter)
        internal
        view
        returns (uint256 toAlice, uint256 toBob, uint256 fee)
    {
        uint256 ag = _ag(stake);
        if (winner == address(0)) {
            uint256 side = stake * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
            return (stake - side + ag, stake - side + ag, side * 2);
        }
        uint256 pot = stake * 2;
        uint256 pfee = pot * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
        address loser = winner == alice ? bob : alice;
        uint256 loserGets = forfeiter == loser ? 0 : ag;
        fee = pfee + (forfeiter == loser ? ag : 0);
        if (winner == alice) return (pot - pfee + ag, loserGets, fee);
        return (loserGets, pot - pfee + ag, fee);
    }

    /// @dev Assert every escrowed token left the arena to a player or the Treasury split.
    function _assertPaid(Snap memory before, uint256 stake, address winner, address forfeiter) internal view {
        (uint256 eA, uint256 eB, uint256 eFee) = _expectedPayout(stake, winner, forfeiter);
        Snap memory a = _snap();
        uint256 paidA = a.alice - before.alice;
        uint256 paidB = a.bob - before.bob;
        uint256 dev = a.dev - before.dev;
        uint256 burned = before.supply - a.supply;
        assertEq(paidA, eA, "alice payout");
        assertEq(paidB, eB, "bob payout");
        assertEq(dev + burned, eFee, "fee routed to Treasury");
        assertEq(burned, eFee * treasury.BURN_BPS() / treasury.BPS_DENOMINATOR(), "85% burned");
        assertEq(a.treasury, before.treasury, "Treasury keeps nothing");
        assertEq(paidA + paidB + eFee, 2 * (stake + _ag(stake)), "conservation: transfers + fee == escrow");
        assertEq(before.arena - a.arena, 2 * (stake + _ag(stake)), "whole escrow left the arena");
        assertEq(a.arena, a.reserve, "only the reserve remains");
    }

    // ─────────────────────── creation / phases ───────────────────────

    function testFuzz_invalid_stake_reverts(uint256 amount) public {
        vm.assume(amount != 2_500e18 && amount != 10_000e18 && amount != 50_000e18);
        amount = bound(amount, 1, type(uint128).max);
        vm.assume(amount != 2_500e18 && amount != 10_000e18 && amount != 50_000e18);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeAmount.selector, amount));
        battleArena.createBattle(alice, bob, amount, 3, 3);
    }

    function test_same_player_reverts() public {
        vm.prank(admin);
        vm.expectRevert(BattleArena.PlayerCannotBeSelf.selector);
        battleArena.createBattle(alice, alice, LOW_STAKE, 3, 3);
    }

    /// D-13: the commit rides in the deposit; both deposits go straight to TeamReveal.
    function test_phase_deposit_to_team_reveal() public {
        uint256 battleId = _createBattle();
        assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Deposit));

        bytes32 hA = keccak256("commit-A");
        _depositWith(alice, battleId, LOW_STAKE, hA);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Deposit), "still Deposit after 1");
        assertEq(b.teamCommitA, hA, "commit A stored with the deposit");

        bytes32 hB = keccak256("commit-B");
        uint256 t = block.timestamp;
        _depositWith(bob, battleId, LOW_STAKE, hB);
        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.TeamReveal), "TeamReveal after both");
        assertEq(b.teamCommitB, hB, "commit B stored with the deposit");
        assertEq(b.phaseDeadline, t + battleArena.TEAM_REVEAL_WINDOW(), "reveal deadline");
    }

    function test_phase_reveal_to_active() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        _reveal(battleId, teamA, teamB);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Active), "Active after atomic reveal");
        assertTrue(battleArena.teamInBattle(teamA) && battleArena.teamInBattle(teamB), "teams locked while playing");
        assertTrue(teamMgr.getTeam(teamA).active && teamMgr.getTeam(teamB).active, "TeamManager-active while playing");
    }

    function test_zero_commit_hash_reverts() public {
        uint256 battleId = _createBattle();
        uint256 total = LOW_STAKE + _ag(LOW_STAKE);
        _giveClaw(alice, total);
        vm.startPrank(alice);
        claw.approve(address(battleArena), total);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        battleArena.deposit(battleId, LOW_STAKE, 9, bytes32(0));
        vm.stopPrank();
    }

    function test_double_deposit_reverts() public {
        uint256 battleId = _createBattle();
        _deposit(alice, battleId);

        uint256 total = LOW_STAKE + _ag(LOW_STAKE);
        _giveClaw(alice, total);
        vm.startPrank(alice);
        claw.approve(address(battleArena), total);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyDeposited.selector, battleId));
        battleArena.deposit(battleId, LOW_STAKE, 9, keccak256("again"));
        vm.stopPrank();
    }

    function test_non_participant_reverts() public {
        uint256 battleId = _createBattle();
        uint256 total = LOW_STAKE + _ag(LOW_STAKE);
        _giveClaw(stranger, total);
        vm.startPrank(stranger);
        claw.approve(address(battleArena), total);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotBattleParticipant.selector, battleId));
        battleArena.deposit(battleId, LOW_STAKE, 9, keccak256("x"));
        vm.stopPrank();
    }

    function test_deposit_timeout_refunds() public {
        uint256 battleId = _createBattle();
        _deposit(alice, battleId);
        uint256 aliceBefore = claw.balanceOf(alice);

        vm.warp(block.timestamp + battleArena.DEPOSIT_WINDOW() + 1);
        battleArena.handleTimeout(battleId);

        assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Cancelled));
        assertEq(claw.balanceOf(alice) - aliceBefore, LOW_STAKE + _ag(LOW_STAKE), "alice refunded");
        assertEq(claw.balanceOf(address(battleArena)), 0, "nothing stuck");
    }

    function test_wrong_phase_deposit_reverts() public {
        uint256 battleId = _createBattle();
        _bothDeposit(battleId); // phase -> TeamReveal

        uint256 total = LOW_STAKE + _ag(LOW_STAKE);
        _giveClaw(alice, total);
        vm.startPrank(alice);
        claw.approve(address(battleArena), total);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Deposit,
                BattleArena.BattlePhase.TeamReveal
            )
        );
        battleArena.deposit(battleId, LOW_STAKE, 9, keccak256("late"));
        vm.stopPrank();
    }

    // ─────────────────────── D-08 consent ───────────────────────

    /// deposit reverts ConsentMismatch iff the stake differs from what the player agreed to or
    /// the opponent's Power snapshot exceeds the player's ceiling; otherwise it escrows and commits.
    function testFuzz_consent_revertsIffMismatch(
        uint8 bracket,
        uint8 powerA,
        uint8 powerB,
        bool depositorIsA,
        bool stakeMatches,
        uint256 wrongStake,
        uint8 maxOpponentPower
    ) public {
        uint256 stake = battleArena.STAKE_BRACKETS(bound(bracket, 0, 2));
        powerA = uint8(bound(powerA, 3, 9));
        powerB = uint8(bound(powerB, 3, 9));
        uint256 expectedStake = stakeMatches ? stake : wrongStake;

        vm.prank(admin);
        uint256 battleId = battleArena.createBattle(alice, bob, stake, powerA, powerB);

        address player = depositorIsA ? alice : bob;
        uint8 opponentPower = depositorIsA ? powerB : powerA;
        bool mismatch = expectedStake != stake || opponentPower > maxOpponentPower;

        uint256 total = stake + _ag(stake);
        _giveClaw(player, total);
        vm.startPrank(player);
        claw.approve(address(battleArena), total);
        if (mismatch) {
            vm.expectRevert(
                abi.encodeWithSelector(BattleArena.ConsentMismatch.selector, battleId, stake, opponentPower)
            );
        }
        battleArena.deposit(battleId, expectedStake, maxOpponentPower, keccak256("c"));
        vm.stopPrank();

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        bool deposited = depositorIsA ? b.depositA : b.depositB;
        assertEq(deposited, !mismatch, "deposit lands iff consent matches");
        assertEq(claw.balanceOf(address(battleArena)), mismatch ? 0 : total, "escrow iff consent matches");
        assertEq(claw.balanceOf(player), mismatch ? total : 0, "player keeps funds on mismatch");
    }

    // ─────────────────────── reveal ───────────────────────

    function test_high_damage_lobster_blocked() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        TeamManager.Team memory team = teamMgr.getTeam(teamA);
        vm.prank(admin);
        nft.setDamage(team.lobsterIds[0], 80);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.LobsterDamageTooHigh.selector, team.lobsterIds[0], 80));
        battleArena.revealTeams(battleId, teamA, _saltA(battleId), teamB, _saltB(battleId), _seedCommit(battleId));
    }

    function test_invalid_commit_hash_reverts() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        battleArena.revealTeams(battleId, teamA, bytes32(uint256(999)), teamB, _saltB(battleId), _seedCommit(battleId));
    }

    function test_F5_01_revealTeams_onlyResolver() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        bytes32 resolverRole = battleArena.RESOLVER_ROLE();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, resolverRole
            )
        );
        battleArena.revealTeams(battleId, teamA, _saltA(battleId), teamB, _saltB(battleId), _seedCommit(battleId));

        vm.prank(stranger);
        vm.expectRevert();
        battleArena.revealTeams(battleId, teamA, _saltA(battleId), teamB, _saltB(battleId), _seedCommit(battleId));

        _reveal(battleId, teamA, teamB);
        assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Active));
    }

    function test_F5_01_revealTimeout_isCostlessMutualCancel() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        Snap memory s = _snap();

        vm.warp(block.timestamp + battleArena.TEAM_REVEAL_WINDOW() + 1);
        vm.expectEmit(true, false, false, true, address(battleArena));
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.MutualTimeout);
        battleArena.handleTimeout(battleId);

        assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Cancelled));
        uint256 full = LOW_STAKE + _ag(LOW_STAKE);
        assertEq(claw.balanceOf(alice) - s.alice, full, "alice fully refunded");
        assertEq(claw.balanceOf(bob) - s.bob, full, "bob fully refunded");
        assertEq(claw.totalSupply(), s.supply, "nothing burned");
        assertFalse(battleArena.teamInBattle(teamA));
        assertFalse(battleArena.teamInBattle(teamB));
    }

    // ─────────────────────── D-14 reveal-failure attribution ───────────────────────

    /// For every accuse/open combination, a reveal timeout slashes exactly the accused players
    /// who did not open their own commit, and refunds everything else.
    function testFuzz_revealFailureAttribution(bool accA, bool accB, bool openA, bool openB, uint256 lateBy) public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        lateBy = bound(lateBy, 1, 30 days);

        if (accA) {
            vm.prank(admin);
            battleArena.accuseRevealFailure(battleId, alice);
        }
        if (accB) {
            vm.prank(admin);
            battleArena.accuseRevealFailure(battleId, bob);
        }
        if (accA && openA) {
            vm.prank(alice);
            battleArena.openOwnCommit(battleId, teamA, _saltA(battleId));
        } else if (openA) {
            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(BattleArena.NotAccused.selector, battleId));
            battleArena.openOwnCommit(battleId, teamA, _saltA(battleId));
        }
        if (accB && openB) {
            vm.prank(bob);
            battleArena.openOwnCommit(battleId, teamB, _saltB(battleId));
        }

        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        Snap memory s = _snap();
        vm.warp(b.phaseDeadline + lateBy);
        battleArena.handleTimeout(battleId);

        bool faultA = accA && !openA;
        bool faultB = accB && !openB;
        uint256 ag = _ag(LOW_STAKE);
        assertEq(claw.balanceOf(alice) - s.alice, LOW_STAKE + (faultA ? 0 : ag), "alice refund");
        assertEq(claw.balanceOf(bob) - s.bob, LOW_STAKE + (faultB ? 0 : ag), "bob refund");
        uint256 slashed = (faultA ? ag : 0) + (faultB ? ag : 0);
        assertEq(s.supply - claw.totalSupply(), slashed * treasury.BURN_BPS() / treasury.BPS_DENOMINATOR(), "burn");
        assertEq(claw.balanceOf(address(battleArena)), 0, "nothing stuck");
        assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Cancelled));
    }

    /// An accused player who opens their commit lets the resolver reveal inside the grace,
    /// even after the original 20 s reveal window.
    function test_accusedOpens_thenRevealWithinGrace() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        vm.prank(admin);
        battleArena.accuseRevealFailure(battleId, bob);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyAccused.selector, battleId));
        battleArena.accuseRevealFailure(battleId, bob);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        battleArena.openOwnCommit(battleId, teamB, bytes32(uint256(1)));
        vm.prank(bob);
        battleArena.openOwnCommit(battleId, teamB, _saltB(battleId));

        vm.warp(block.timestamp + battleArena.TEAM_REVEAL_WINDOW() + 30);
        _reveal(battleId, teamA, teamB);
        assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Active));
    }

    // ─────────────────────── settle / review ───────────────────────

    function test_settle_stake_accounting() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        Snap memory s = _snap();
        vm.warp(block.timestamp + battleArena.reviewWindows(0) + 1);
        battleArena.finalizeBattle(battleId);
        _assertPaid(s, LOW_STAKE, alice, address(0));
    }

    /// settle() moves no money, applies damage and releases both teams immediately.
    function test_settle_appliesDamage_releasesTeams_movesNoFunds() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupSettleableBattle();
        Snap memory s = _snap();

        _settleProposing(battleId, alice);

        Snap memory a = _snap();
        assertEq(a.arena, s.arena, "arena balance unchanged");
        assertEq(a.alice, s.alice, "alice unchanged");
        assertEq(a.bob, s.bob, "bob unchanged");

        assertFalse(battleArena.teamInBattle(teamA), "teamA released at settle");
        assertFalse(battleArena.teamInBattle(teamB), "teamB released at settle");
        assertFalse(teamMgr.getTeam(teamA).active, "teamA inactive in TeamManager");
        assertFalse(teamMgr.getTeam(teamB).active, "teamB inactive in TeamManager");

        TeamManager.Team memory tA = teamMgr.getTeam(teamA);
        TeamManager.Team memory tB = teamMgr.getTeam(teamB);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(nft.getDamage(tA.lobsterIds[i]), 5, "A damage applied at settle");
            assertEq(nft.getDamage(tB.lobsterIds[i]), 20, "B damage applied at settle");
        }
    }

    /// A released team can enter a new battle while the old result is in review and while frozen.
    function test_releasedTeam_canFightAgain_whileReviewedOrFrozen() public {
        (uint256 id1, uint256 teamA, uint256 teamB) = _setupSettleableBattle();
        _settleProposing(id1, alice);
        vm.prank(guardian);
        battleArena.freeze(id1);

        uint256 id2 = _createBattle();
        _depositTeam(alice, id2, LOW_STAKE, teamA);
        _depositTeam(bob, id2, LOW_STAKE, teamB);
        _reveal(id2, teamA, teamB);
        assertEq(uint8(battleArena.getBattle(id2).phase), uint8(BattleArena.BattlePhase.Active));
        assertEq(uint8(battleArena.getBattle(id1).phase), uint8(BattleArena.BattlePhase.Frozen));
    }

    function test_applyDamage_overflow_caps_at_100() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        TeamManager.Team memory tA = teamMgr.getTeam(teamA);
        TeamManager.Team memory tB = teamMgr.getTeam(teamB);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setDamage(tA.lobsterIds[i], 60);
            vm.prank(admin);
            nft.setDamage(tB.lobsterIds[i], 60);
        }
        _reveal(battleId, teamA, teamB);

        vm.prank(admin);
        battleArena.settle(
            battleId, alice, HASH_STATE, HASH_LOG, [uint8(200), 200, 200], [uint8(200), 200, 200], SEED_SECRET, address(0)
        );
        for (uint256 i = 0; i < 3; i++) {
            assertEq(nft.getDamage(tA.lobsterIds[i]), 100, "winner lobster capped at 100");
            assertEq(nft.getDamage(tB.lobsterIds[i]), 100, "loser lobster capped at 100");
        }
    }

    function test_non_resolver_settle_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        bytes32 resolverRole = battleArena.RESOLVER_ROLE();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, resolverRole)
        );
        battleArena.settle(
            battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(5), 5, 5], SEED_SECRET, address(0)
        );
    }

    function test_unfrozenFinalize_paysWinner() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.AwaitingFinalize));
        assertEq(b.proposedWinner, alice);

        Snap memory s = _snap();
        vm.warp(b.payoutDeadline + 1);
        vm.prank(stranger);
        battleArena.finalizeBattle(battleId);
        _assertPaid(s, LOW_STAKE, alice, address(0));

        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, alice);
    }

    function test_finalizeBeforeDeadline_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.ReviewWindowOpen.selector, battleId, b.payoutDeadline));
        battleArena.finalizeBattle(battleId);
    }

    function test_handleTimeout_inReview_finalizes() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        vm.warp(b.payoutDeadline);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        battleArena.handleTimeout(battleId);
        vm.warp(b.payoutDeadline + 1);
        vm.prank(stranger);
        battleArena.handleTimeout(battleId);
        b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, alice);
    }

    /// For any (winner, forfeiter) pair settle accepts exactly the valid results.
    function testFuzz_settle_resultValidation(uint8 winnerSel, uint8 forfeiterSel) public {
        (uint256 battleId,,) = _setupSettleableBattle();
        address winner = _pick(winnerSel);
        address forfeiter = _pick(forfeiterSel);
        bool valid = _isValidResult(winner, forfeiter);
        if (!valid) vm.expectRevert(_expectedResultError(battleId, winner));
        _settle(battleId, winner, forfeiter);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        if (valid) {
            assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.AwaitingFinalize));
            assertEq(b.proposedWinner, winner);
            assertEq(b.proposedForfeiter, forfeiter);
        } else {
            assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Active));
        }
    }

    /// Payout conservation for a random valid result at every bracket, paid through finalize or
    /// handleTimeout: every escrowed token goes to a player or the Treasury, nothing stays.
    function testFuzz_payoutConservation(uint8 bracket, uint8 outcome, bool forfeit, bool viaTimeout, uint256 reserve)
        public
    {
        bracket = uint8(bound(bracket, 0, 2));
        uint256 stake = battleArena.STAKE_BRACKETS(bracket);
        (uint256 battleId,,) = _setupActiveAt(stake);
        reserve = bound(reserve, 0, 500_000e18);
        if (reserve > 0) _fundReserve(reserve);

        uint8 o = outcome % 3;
        address winner = o == 0 ? alice : (o == 1 ? bob : address(0));
        address forfeiter = (forfeit && winner != address(0)) ? (winner == alice ? bob : alice) : address(0);
        _settle(battleId, winner, forfeiter);

        Snap memory s = _snap();
        vm.warp(battleArena.getBattle(battleId).payoutDeadline + 1);
        if (viaTimeout) battleArena.handleTimeout(battleId);
        else battleArena.finalizeBattle(battleId);

        _assertPaid(s, stake, winner, forfeiter);
        assertEq(battleArena.refundReserve(), reserve, "payout never touches the reserve");
    }

    /// A forfeiter (the loser) loses exactly the anti-grief deposit to the Treasury.
    function test_forfeiter_slashes_anti_grief() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settle(battleId, alice, bob);
        Snap memory s = _snap();
        uint256 ag = _ag(LOW_STAKE);
        vm.warp(battleArena.getBattle(battleId).payoutDeadline + 1);
        vm.expectEmit(true, true, false, true, address(battleArena));
        emit BattleArena.AntiGriefSlashed(battleId, bob, ag);
        battleArena.finalizeBattle(battleId);
        assertEq(claw.balanceOf(bob), s.bob, "bob gets nothing back");
        _assertPaid(s, LOW_STAKE, alice, bob);
    }

    /// D-03: a draw pays exactly the normal protocol fee, split half per side, at every bracket.
    function testFuzz_drawFee_exact(uint8 bracket) public {
        bracket = uint8(bound(bracket, 0, 2));
        uint256 stake = battleArena.STAKE_BRACKETS(bracket);
        (uint256 battleId,,) = _setupActiveAt(stake);
        _settleProposing(battleId, address(0));
        Snap memory s = _snap();
        vm.warp(battleArena.getBattle(battleId).payoutDeadline + 1);

        uint256 decidedFee = 2 * stake * battleArena.PROTOCOL_FEE_BPS() / battleArena.BPS_DENOMINATOR();
        vm.expectEmit(true, true, false, true, address(battleArena));
        emit BattleArena.BattleSettled(battleId, address(0), 0, decidedFee);
        battleArena.finalizeBattle(battleId);

        uint256 side = stake / 10;
        assertEq(claw.balanceOf(alice) - s.alice, stake - side + _ag(stake), "alice: stake - 10% + 5%");
        assertEq(claw.balanceOf(bob) - s.bob, stake - side + _ag(stake), "bob: stake - 10% + 5%");
        assertEq(claw.balanceOf(devWallet) - s.dev + (s.supply - claw.totalSupply()), decidedFee, "draw fee == decided fee");
        assertEq(claw.balanceOf(devWallet) - s.dev, decidedFee * 15 / 100, "dev share");
        _assertPaid(s, stake, address(0), address(0));
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(b.winner, address(0));
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
    }

    function testFuzz_settle_damageNeverExceeds100(uint8[3] memory dmgA, uint8[3] memory dmgB, uint8 pre, bool draw)
        public
    {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupRevealPhase(LOW_STAKE);
        pre = uint8(bound(pre, 0, 79));
        TeamManager.Team memory tA = teamMgr.getTeam(teamA);
        TeamManager.Team memory tB = teamMgr.getTeam(teamB);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setDamage(tA.lobsterIds[i], pre);
            vm.prank(admin);
            nft.setDamage(tB.lobsterIds[i], pre);
        }
        _reveal(battleId, teamA, teamB);

        vm.prank(admin);
        battleArena.settle(battleId, draw ? address(0) : alice, HASH_STATE, HASH_LOG, dmgA, dmgB, SEED_SECRET, address(0));

        for (uint256 i = 0; i < 3; i++) {
            uint256 expA = uint256(pre) + dmgA[i];
            if (expA > 100) expA = 100;
            uint256 expB = uint256(pre) + dmgB[i];
            if (expB > 100) expB = 100;
            assertEq(nft.getDamage(tA.lobsterIds[i]), expA, "A slot damage");
            assertEq(nft.getDamage(tB.lobsterIds[i]), expB, "B slot damage");
        }
    }

    // ─────────────────────── freeze ───────────────────────

    /// Any time t <= payoutDeadline the result can be frozen (and not finalized); after it, it can
    /// be finalized and no longer frozen.
    function testFuzz_freezeTimingBoundary(uint8 bracket, uint256 t, bool byAdmin) public {
        bracket = uint8(bound(bracket, 0, 2));
        uint256 stake = battleArena.STAKE_BRACKETS(bracket);
        (uint256 battleId,,) = _setupActiveAt(stake);
        uint256 settledAt = block.timestamp;
        _settleProposing(battleId, alice);
        uint256 deadline = battleArena.getBattle(battleId).payoutDeadline;
        assertEq(deadline, settledAt + battleArena.reviewWindows(bracket), "deadline = settle + window");

        t = bound(t, 0, battleArena.reviewWindows(bracket) + 3 days);
        vm.warp(settledAt + t);
        address who = byAdmin ? admin : guardian;

        if (block.timestamp <= deadline) {
            vm.expectRevert(abi.encodeWithSelector(BattleArena.ReviewWindowOpen.selector, battleId, deadline));
            battleArena.finalizeBattle(battleId);

            Snap memory s = _snap();
            vm.expectEmit(true, true, false, true, address(battleArena));
            emit BattleArena.BattleFrozen(battleId, who);
            vm.prank(who);
            battleArena.freeze(battleId);
            BattleArena.Battle memory b = battleArena.getBattle(battleId);
            assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Frozen));
            assertEq(b.frozenAt, block.timestamp);
            Snap memory a = _snap();
            assertEq(a.arena, s.arena, "freeze moves no money");
            assertEq(a.alice, s.alice);
            assertEq(a.bob, s.bob);

            // A frozen result cannot be finalized, even after the review window.
            vm.warp(deadline + 1);
            vm.expectRevert(
                abi.encodeWithSelector(
                    BattleArena.InvalidBattlePhase.selector,
                    battleId,
                    BattleArena.BattlePhase.AwaitingFinalize,
                    BattleArena.BattlePhase.Frozen
                )
            );
            battleArena.finalizeBattle(battleId);
        } else {
            vm.prank(who);
            vm.expectRevert(abi.encodeWithSelector(BattleArena.ReviewWindowClosed.selector, battleId, deadline));
            battleArena.freeze(battleId);
            battleArena.finalizeBattle(battleId);
            assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Settled));
        }
    }

    function testFuzz_freeze_onlyGuardianOrAdmin(address caller) public {
        vm.assume(caller != admin && caller != guardian);
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        bytes32 guardianRole = battleArena.GUARDIAN_ROLE();
        vm.prank(caller);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, guardianRole)
        );
        battleArena.freeze(battleId);
    }

    /// The guardian can only pause: it cannot resolve, withdraw the reserve or settle.
    function test_guardian_cannotMoveMoney() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        vm.prank(guardian);
        battleArena.freeze(battleId);
        _fundReserve(10_000e18);

        bytes32 adminRole = battleArena.DEFAULT_ADMIN_ROLE();
        vm.startPrank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, adminRole)
        );
        battleArena.resolveFrozen(battleId, alice, address(0), false);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, adminRole)
        );
        battleArena.withdrawReserve(guardian, 1);
        vm.stopPrank();
    }

    // ─────────────────────── resolveFrozen ───────────────────────

    /// The Safe settles a frozen battle: refundBoth returns stake + 5% each with no fee; otherwise
    /// it pays the corrected (valid) result exactly like finalize, and rejects an invalid one.
    function testFuzz_resolveFrozen(uint8 bracket, uint8 winnerSel, uint8 forfeiterSel, bool refundBoth, uint8 proposed)
        public
    {
        bracket = uint8(bound(bracket, 0, 2));
        uint256 stake = battleArena.STAKE_BRACKETS(bracket);
        (uint256 battleId,,) = _setupActiveAt(stake);
        _settleProposing(battleId, proposed % 2 == 0 ? alice : address(0));
        vm.prank(guardian);
        battleArena.freeze(battleId);

        address winner = _pick(winnerSel);
        address forfeiter = _pick(forfeiterSel);
        Snap memory s = _snap();

        if (refundBoth) {
            vm.prank(admin);
            battleArena.resolveFrozen(battleId, winner, forfeiter, true);
            uint256 back = stake + _ag(stake);
            assertEq(claw.balanceOf(alice) - s.alice, back, "alice refunded");
            assertEq(claw.balanceOf(bob) - s.bob, back, "bob refunded");
            assertEq(claw.totalSupply(), s.supply, "no fee on refundBoth");
            assertEq(claw.balanceOf(devWallet), s.dev, "no dev share on refundBoth");
            assertEq(claw.balanceOf(address(battleArena)), 0, "nothing stuck");
            BattleArena.Battle memory b = battleArena.getBattle(battleId);
            assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
            assertEq(b.winner, address(0));
            return;
        }

        if (!_isValidResult(winner, forfeiter)) {
            vm.prank(admin);
            vm.expectRevert(_expectedResultError(battleId, winner));
            battleArena.resolveFrozen(battleId, winner, forfeiter, false);
            assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Frozen));
            return;
        }
        vm.prank(admin);
        battleArena.resolveFrozen(battleId, winner, forfeiter, false);
        _assertPaid(s, stake, winner, forfeiter);
        BattleArena.Battle memory b2 = battleArena.getBattle(battleId);
        assertEq(uint8(b2.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b2.winner, winner);
    }

    // ─────────────────────── expireFrozen + reserve ───────────────────────

    /// Long-stop boundary: expireFrozen (and handleTimeout) revert up to frozenAt + 72 h inclusive.
    function testFuzz_expireFrozen_longStopBoundary(uint256 waitAfterFreeze, uint256 freezeAt) public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        freezeAt = bound(freezeAt, 0, battleArena.reviewWindows(0));
        vm.warp(block.timestamp + freezeAt);
        vm.prank(guardian);
        battleArena.freeze(battleId);
        uint256 frozenAt = block.timestamp;
        uint256 availableAt = frozenAt + battleArena.FREEZE_LONG_STOP();

        waitAfterFreeze = bound(waitAfterFreeze, 0, battleArena.FREEZE_LONG_STOP() + 30 days);
        vm.warp(frozenAt + waitAfterFreeze);
        if (block.timestamp <= availableAt) {
            vm.expectRevert(abi.encodeWithSelector(BattleArena.LongStopNotReached.selector, battleId, availableAt));
            battleArena.expireFrozen(battleId);
            vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
            battleArena.handleTimeout(battleId);
        } else {
            battleArena.expireFrozen(battleId);
            assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Settled));
        }
    }

    /// expireFrozen with any reserve: the held stakes are burned iff the reserve covers 2·stake;
    /// players always get stake + 5% back; reserve and arena balance stay exactly in step.
    function testFuzz_expireFrozen_reserveAccounting(uint8 bracket, uint256 reserve, bool viaTimeout, bool forfeit)
        public
    {
        bracket = uint8(bound(bracket, 0, 2));
        uint256 stake = battleArena.STAKE_BRACKETS(bracket);
        (uint256 battleId,,) = _setupActiveAt(stake);
        // Bias toward the boundary: half the runs land within ±2 wei of 2·stake.
        if (reserve % 2 == 0) reserve = 2 * stake - 2 + (reserve >> 1) % 5;
        else reserve = bound(reserve, 0, 300_000e18);
        if (reserve > 0) _fundReserve(reserve);
        assertEq(battleArena.refundReserve(), reserve);

        _settle(battleId, alice, forfeit ? bob : address(0));
        vm.prank(admin);
        battleArena.freeze(battleId);
        vm.warp(block.timestamp + battleArena.FREEZE_LONG_STOP() + 1);

        Snap memory s = _snap();
        bool burns = reserve >= 2 * stake;
        vm.expectEmit(true, false, false, true, address(battleArena));
        emit BattleArena.FrozenExpired(battleId, burns ? 2 * stake : 0, burns ? 2 * stake : 0);
        vm.prank(stranger);
        if (viaTimeout) battleArena.handleTimeout(battleId);
        else battleArena.expireFrozen(battleId);

        uint256 back = stake + _ag(stake);
        assertEq(claw.balanceOf(alice) - s.alice, back, "alice: stake + 5% (forfeiter ignored)");
        assertEq(claw.balanceOf(bob) - s.bob, back, "bob: stake + 5% (forfeiter ignored)");
        assertEq(s.supply - claw.totalSupply(), burns ? 2 * stake : 0, "burn iff reserve covers");
        assertEq(claw.balanceOf(devWallet), s.dev, "no fee on expiry");
        uint256 newReserve = burns ? reserve - 2 * stake : reserve;
        assertEq(battleArena.refundReserve(), newReserve, "reserve accounting");
        assertEq(claw.balanceOf(address(battleArena)), newReserve, "arena holds exactly the reserve");
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, address(0));
    }

    /// Random fund / withdraw sequences: withdraw beyond the reserve reverts; the arena balance is
    /// always escrow + reserve; the escrowed battles still pay out in full afterwards.
    function testFuzz_reserveSequences_neverTouchEscrow(uint256[] memory ops, bool freezeOne) public {
        vm.assume(ops.length > 0);
        if (ops.length > 12) {
            assembly {
                mstore(ops, 12)
            }
        }
        (uint256 idReview,,) = _setupActiveAt(battleArena.STAKE_BRACKETS(1));
        _settleProposing(idReview, bob);
        (uint256 idActive,,) = _setupActiveAt(LOW_STAKE);
        if (freezeOne) {
            vm.prank(guardian);
            battleArena.freeze(idReview);
        }
        uint256 escrow = 2 * (battleArena.STAKE_BRACKETS(1) + _ag(battleArena.STAKE_BRACKETS(1)))
            + 2 * (LOW_STAKE + _ag(LOW_STAKE));
        assertEq(claw.balanceOf(address(battleArena)), escrow);

        uint256 model;
        address sink = makeAddr("reserve-sink");
        for (uint256 i = 0; i < ops.length; i++) {
            uint256 amount = bound(ops[i] >> 8, 0, 100_000e18);
            if (ops[i] % 3 == 0) {
                _fundReserve(amount);
                model += amount;
            } else {
                // Sometimes target exactly the reserve or just over it.
                if (ops[i] % 3 == 2) amount = model + ((ops[i] >> 4) % 2);
                uint256 sinkBefore = claw.balanceOf(sink);
                vm.prank(admin);
                if (amount > model) {
                    vm.expectRevert(abi.encodeWithSelector(BattleArena.InsufficientReserve.selector, amount, model));
                    battleArena.withdrawReserve(sink, amount);
                } else {
                    battleArena.withdrawReserve(sink, amount);
                    model -= amount;
                    assertEq(claw.balanceOf(sink) - sinkBefore, amount, "sink received");
                }
            }
            assertEq(battleArena.refundReserve(), model, "reserve == model");
            assertEq(claw.balanceOf(address(battleArena)), escrow + model, "balance == escrow + reserve");
        }

        // Escrow is intact: both battles still pay out in full.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InsufficientReserve.selector, model + 1, model));
        battleArena.withdrawReserve(sink, model + 1);

        if (freezeOne) {
            vm.prank(admin);
            battleArena.resolveFrozen(idReview, bob, address(0), false);
        } else {
            vm.warp(battleArena.getBattle(idReview).payoutDeadline + 1);
            battleArena.finalizeBattle(idReview);
        }
        vm.warp(battleArena.getBattle(idActive).phaseDeadline + 1);
        battleArena.handleTimeout(idActive);
        assertEq(claw.balanceOf(address(battleArena)), model, "after payouts only the reserve remains");

        vm.prank(admin);
        battleArena.withdrawReserve(sink, model);
        assertEq(claw.balanceOf(address(battleArena)), 0, "fully drained, nothing stuck");
    }

    function test_withdrawReserve_guards() public {
        _fundReserve(1_000e18);
        bytes32 adminRole = battleArena.DEFAULT_ADMIN_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, adminRole)
        );
        battleArena.withdrawReserve(stranger, 1);

        vm.prank(admin);
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        battleArena.withdrawReserve(address(0), 1);
    }

    // ─────────────────────── TM-01 deleted-team tolerance ───────────────────────

    /// A team force-deleted mid-battle (compromised ACTIVITY_ROLE) cannot brick settle/finalize.
    function test_TM01_settleAndFinalize_tolerateDeletedTeam() public {
        (uint256 battleId, uint256 teamA,) = _setupSettleableBattle();
        vm.prank(address(miningPool));
        teamMgr.setTeamActive(teamA, false);
        vm.prank(alice);
        teamMgr.disbandTeam(teamA);
        assertFalse(teamMgr.teamExists(teamA));

        _settleProposing(battleId, alice);
        assertFalse(battleArena.teamInBattle(teamA), "link cleared although the team is gone");
        vm.warp(battleArena.getBattle(battleId).payoutDeadline + 1);
        battleArena.finalizeBattle(battleId);
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, alice);
    }

    function test_TM01_handleTimeout_toleratesDeletedTeam() public {
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupSettleableBattle();
        vm.prank(address(miningPool));
        teamMgr.setTeamActive(teamA, false);
        vm.prank(alice);
        teamMgr.disbandTeam(teamA);

        vm.warp(battleArena.getBattle(battleId).phaseDeadline + 1);
        battleArena.handleTimeout(battleId);
        assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Cancelled));
        assertFalse(battleArena.teamInBattle(teamB));
        assertFalse(battleArena.teamInBattle(teamA));
    }

    // ─────────────────────── review windows (T-02 / T-03) ───────────────────────

    function test_perBracket_reviewWindows() public {
        uint256[3] memory expected = [uint256(5 minutes), 30 minutes, 1 hours];
        for (uint256 i = 0; i < 3; i++) {
            (uint256 battleId,,) = _setupActiveAt(battleArena.STAKE_BRACKETS(i));
            uint256 settleAt = block.timestamp;
            _settleProposing(battleId, alice);
            assertEq(battleArena.getBattle(battleId).payoutDeadline, settleAt + expected[i], "bracket window");
        }
    }

    function test_proposeAndEnactReviewWindow_onlyAdmin() public {
        vm.prank(stranger);
        vm.expectRevert();
        battleArena.proposeReviewWindow(0, 10 minutes);

        vm.prank(admin);
        battleArena.proposeReviewWindow(0, 10 minutes);
        assertEq(battleArena.reviewWindows(0), 5 minutes, "live value unchanged before enact");

        vm.warp(block.timestamp + battleArena.MIN_TUNING_DELAY());
        vm.prank(stranger);
        vm.expectRevert();
        battleArena.enactReviewWindow(0);
        vm.prank(admin);
        battleArena.enactReviewWindow(0);
        assertEq(battleArena.reviewWindows(0), 10 minutes, "live value updated after enact");
    }

    function testFuzz_proposeReviewWindow_bounds(uint8 bracket, uint256 window) public {
        uint256 idx = bound(bracket, 0, 3);
        window = bound(window, 0, 10 days);
        vm.prank(admin);
        if (idx >= 3) {
            vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeBracket.selector, idx));
            battleArena.proposeReviewWindow(idx, window);
            return;
        }
        uint256 maxW = idx == 0 ? 1 days : (idx == 1 ? 3 days : 7 days);
        bool ok = window >= 60 && window <= maxW;
        if (!ok) vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidReviewWindow.selector, window));
        battleArena.proposeReviewWindow(idx, window);
        if (ok) assertEq(battleArena.pendingReviewWindow(idx), window);
    }

    function test_timelock_enactBeforeDelay_reverts() public {
        uint256 delay = battleArena.MIN_TUNING_DELAY();
        uint256 proposedAt = block.timestamp;
        vm.prank(admin);
        battleArena.proposeReviewWindow(0, 10 minutes);
        vm.warp(proposedAt + delay - 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.TuningDelayNotElapsed.selector, 0, proposedAt + delay));
        battleArena.enactReviewWindow(0);
    }

    function test_timelock_enactWithoutPropose_reverts() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NoPendingChange.selector, 0));
        battleArena.enactReviewWindow(0);
    }

    function test_timelock_repropose_resetsTimer() public {
        uint256 delay = battleArena.MIN_TUNING_DELAY();
        vm.prank(admin);
        battleArena.proposeReviewWindow(0, 10 minutes);
        vm.warp(block.timestamp + 12 hours);
        uint256 reproposedAt = block.timestamp;
        vm.prank(admin);
        battleArena.proposeReviewWindow(0, 20 minutes);

        vm.warp(reproposedAt + 12 hours);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.TuningDelayNotElapsed.selector, 0, reproposedAt + delay));
        battleArena.enactReviewWindow(0);

        vm.warp(reproposedAt + delay);
        vm.prank(admin);
        battleArena.enactReviewWindow(0);
        assertEq(battleArena.reviewWindows(0), 20 minutes);
    }

    function test_timelock_enactClearsPending() public {
        vm.prank(admin);
        battleArena.proposeReviewWindow(1, 2 hours);
        vm.warp(block.timestamp + battleArena.MIN_TUNING_DELAY());
        vm.prank(admin);
        battleArena.enactReviewWindow(1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NoPendingChange.selector, 1));
        battleArena.enactReviewWindow(1);
        assertEq(battleArena.pendingReviewWindow(1), 0);
        assertEq(battleArena.pendingReviewWindowAt(1), 0);
    }

    /// A battle already in review keeps the deadline it got at settle.
    function test_enactedWindow_doesNotMoveExistingDeadline() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        _settleProposing(battleId, alice);
        uint256 deadline = battleArena.getBattle(battleId).payoutDeadline;
        vm.prank(admin);
        battleArena.proposeReviewWindow(0, 1 days);
        vm.warp(block.timestamp + battleArena.MIN_TUNING_DELAY());
        vm.prank(admin);
        battleArena.enactReviewWindow(0);
        assertEq(battleArena.getBattle(battleId).payoutDeadline, deadline);
    }

    // ─────────────────────── BA-M1 / ACTIVE_WINDOW ───────────────────────

    function test_BA_M1_lateAction_reverts() public {
        uint256 battleId = _createBattle();
        vm.warp(battleArena.getBattle(battleId).phaseDeadline + 1);
        uint256 total = LOW_STAKE + _ag(LOW_STAKE);
        _giveClaw(alice, total);
        vm.startPrank(alice);
        claw.approve(address(battleArena), total);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        battleArena.deposit(battleId, LOW_STAKE, 9, keccak256("late"));
        vm.stopPrank();

        (uint256 battleId2,,) = _setupSettleableBattle();
        vm.warp(battleArena.getBattle(battleId2).phaseDeadline + 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId2));
        battleArena.settle(
            battleId2, alice, HASH_STATE, HASH_LOG, [uint8(0), 0, 0], [uint8(0), 0, 0], SEED_SECRET, address(0)
        );
    }

    function testFuzz_activeWindow_lateSettleReverts_timeoutRefunds(uint256 late) public {
        late = bound(late, 1, 30 days);
        (uint256 battleId, uint256 teamA, uint256 teamB) = _setupSettleableBattle();
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        assertEq(b.phaseDeadline, block.timestamp + battleArena.ACTIVE_WINDOW());
        Snap memory s = _snap();

        vm.warp(b.phaseDeadline + late);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        battleArena.settle(
            battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20], SEED_SECRET, address(0)
        );

        vm.prank(stranger);
        battleArena.handleTimeout(battleId);
        assertEq(uint8(battleArena.getBattle(battleId).phase), uint8(BattleArena.BattlePhase.Cancelled));
        assertEq(claw.balanceOf(alice) - s.alice, LOW_STAKE + _ag(LOW_STAKE));
        assertEq(claw.balanceOf(bob) - s.bob, LOW_STAKE + _ag(LOW_STAKE));
        assertEq(claw.balanceOf(address(battleArena)), 0);
        assertFalse(battleArena.teamInBattle(teamA) || battleArena.teamInBattle(teamB), "teams released");
    }

    function test_zeroHash_reverts() public {
        (uint256 battleId,,) = _setupSettleableBattle();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        battleArena.settle(
            battleId, alice, bytes32(0), HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20], SEED_SECRET, address(0)
        );
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        battleArena.settle(
            battleId, alice, HASH_STATE, bytes32(0), [uint8(5), 5, 5], [uint8(20), 20, 20], SEED_SECRET, address(0)
        );
    }

    function testFuzz_settle_wrongSeedSecret_reverts(bytes32 secret) public {
        vm.assume(secret != SEED_SECRET);
        (uint256 battleId,,) = _setupSettleableBattle();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSeedReveal.selector, battleId));
        battleArena.settle(
            battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20], secret, address(0)
        );
    }
}
