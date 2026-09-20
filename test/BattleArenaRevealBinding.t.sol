// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BattleArena} from "../contracts/BattleArena.sol";
import {BattleVRF} from "../contracts/BattleVRF.sol";
import {TeamManager} from "../contracts/TeamManager.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

/// @title BattleArenaRevealBindingTest
/// @notice Audit 2026-09 D-31. The atomic `revealTeams` carries the only on-chain defence
///         against queueing in one Power band and fighting in another (F-04), and against one
///         team being in two places at once. The code was read and is correct — but every
///         existing unit test, fuzz test and invariant handler builds battles at power 3/3
///         from fresh three-Evolved teams, so NOT ONE test could make `TeamPowerChanged`,
///         `InvalidPowerScore` or reveal-time `TeamAlreadyInBattle` fire. A refactor that
///         swapped powerA/powerB, or locked team A before validating team B, would have
///         passed the whole suite.
contract BattleArenaRevealBindingTest is Test {
    bytes32 internal constant SEED_SECRET = keccak256("clawbada-test-seed-secret");
    bytes32 internal constant SALT_A = bytes32("saltA");
    bytes32 internal constant SALT_B = bytes32("saltB");
    uint256 internal constant STAKE_LOW = 2_500e18;

    BattleArena arena;
    TeamManager tm;
    LobsterNFT nft;
    ClawToken claw;
    Treasury treasury;

    address admin = makeAddr("admin");
    address lp = makeAddr("lp");
    address matchmaker = makeAddr("matchmaker");
    address resolver = makeAddr("resolver");
    address miningPool = makeAddr("miningPool"); // stands in for MiningPool: holds ACTIVITY_ROLE
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 validDNA;

    function setUp() public {
        vm.startPrank(admin);
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        claw = new ClawToken(admin, lp, makeAddr("reserve"));
        tm = new TeamManager(admin, address(nft));
        treasury = new Treasury(admin, makeAddr("dev"));
        BattleVRF vrf = new BattleVRF(admin);
        arena = new BattleArena(admin, address(claw), address(nft), address(tm), address(treasury), address(vrf));

        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.LOCKER_ROLE(), address(tm));
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        nft.grantRole(nft.DAMAGE_ROLE(), address(arena));
        tm.grantRole(tm.ACTIVITY_ROLE(), address(arena));
        tm.grantRole(tm.ACTIVITY_ROLE(), miningPool);
        arena.grantRole(arena.MATCHMAKER_ROLE(), matchmaker);
        arena.grantRole(arena.RESOLVER_ROLE(), resolver);
        treasury.setClawToken(address(claw));
        treasury.setAuthorized(address(arena), true);
        vm.stopPrank();

        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) alleles[i] = 0x37;
        validDNA = DNALib.encode(3, 0, 5, alleles);

        for (uint256 i = 0; i < 3; i++) {
            address p = i == 0 ? alice : i == 1 ? bob : carol;
            vm.prank(lp);
            claw.transfer(p, 200_000e18);
            vm.prank(p);
            claw.approve(address(arena), type(uint256).max);
        }
    }

    // ──────────── helpers ────────────

    /// @dev A team whose lobsters have the given evolution tiers (1 Evolved, 2 Elite, 3 Apex).
    function _team(address owner, uint8[3] memory tiers) internal returns (uint256 teamId) {
        uint256[3] memory ids;
        vm.startPrank(admin);
        for (uint256 i = 0; i < 3; i++) {
            ids[i] = nft.mint(owner, validDNA, false);
            nft.setEvolutionTier(ids[i], tiers[i]);
        }
        vm.stopPrank();
        vm.prank(owner);
        teamId = tm.createTeam(ids);
    }

    function _evolved(address owner) internal returns (uint256) {
        return _team(owner, [uint8(1), 1, 1]);
    }

    function _create(address a, address b, uint8 powerA, uint8 powerB) internal returns (uint256 battleId) {
        vm.prank(matchmaker);
        battleId = arena.createBattle(a, b, STAKE_LOW, powerA, powerB);
    }

    function _depositAndCommit(uint256 battleId, address a, uint256 teamA, address b, uint256 teamB) internal {
        vm.prank(a);
        arena.deposit(battleId);
        vm.prank(b);
        arena.deposit(battleId);
        vm.prank(a);
        arena.commitTeam(battleId, keccak256(abi.encodePacked(battleId, a, teamA, SALT_A)));
        vm.prank(b);
        arena.commitTeam(battleId, keccak256(abi.encodePacked(battleId, b, teamB, SALT_B)));
    }

    function _reveal(uint256 battleId, uint256 teamA, uint256 teamB) internal {
        vm.prank(resolver);
        arena.revealTeams(battleId, teamA, SALT_A, teamB, SALT_B, keccak256(abi.encodePacked(battleId, SEED_SECRET)));
    }

    function _assertNothingBound(uint256 battleId, uint256 teamA, uint256 teamB) internal view {
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.TeamReveal), "still TeamReveal");
        assertEq(b.teamIdA, 0, "team A not bound");
        assertEq(b.teamIdB, 0, "team B not bound");
        assertFalse(arena.teamInBattle(teamA), "team A not locked by a failed reveal");
        assertFalse(arena.teamInBattle(teamB), "team B not locked by a failed reveal");
    }

    // ──────────── InvalidPowerScore ────────────

    function test_D31_createBattle_rejects_power_outside_3_to_9() public {
        vm.startPrank(matchmaker);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidPowerScore.selector, uint8(2)));
        arena.createBattle(alice, bob, STAKE_LOW, 2, 3);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidPowerScore.selector, uint8(10)));
        arena.createBattle(alice, bob, STAKE_LOW, 3, 10);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidPowerScore.selector, uint8(0)));
        arena.createBattle(alice, bob, STAKE_LOW, 0, 9);
        // the bounds themselves are valid
        arena.createBattle(alice, bob, STAKE_LOW, 3, 9);
        vm.stopPrank();
    }

    // ──────────── TeamPowerChanged (F-04) ────────────

    /// @dev The smurf: queue at Power 3, reveal a Power 4 team (one Elite swapped in).
    function test_D31_reveal_rejects_stronger_team_on_side_A() public {
        uint256 strongA = _team(alice, [uint8(2), 1, 1]); // Power 4
        uint256 teamB = _evolved(bob);
        uint256 battleId = _create(alice, bob, 3, 3);
        _depositAndCommit(battleId, alice, strongA, bob, teamB);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamPowerChanged.selector, strongA, uint8(3), uint8(4)));
        _reveal(battleId, strongA, teamB);
        _assertNothingBound(battleId, strongA, teamB);
    }

    function test_D31_reveal_rejects_stronger_team_on_side_B() public {
        uint256 teamA = _evolved(alice);
        uint256 strongB = _team(bob, [uint8(3), 3, 3]); // Power 9
        uint256 battleId = _create(alice, bob, 3, 3);
        _depositAndCommit(battleId, alice, teamA, bob, strongB);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamPowerChanged.selector, strongB, uint8(3), uint8(9)));
        _reveal(battleId, teamA, strongB);
        // B failed AFTER A validated: A must not have been locked on the way.
        _assertNothingBound(battleId, teamA, strongB);
    }

    /// @dev Each side is held to ITS OWN snapshot. A 4-vs-6 battle revealed with the powers
    ///      crossed (6 on side A, 4 on side B) must fail even though both numbers "exist".
    function test_D31_powers_are_not_interchangeable_between_sides() public {
        uint256 aPower6 = _team(alice, [uint8(2), 2, 2]);
        uint256 bPower4 = _team(bob, [uint8(2), 1, 1]);
        uint256 battleId = _create(alice, bob, 4, 6); // matchmaker recorded A=4, B=6
        _depositAndCommit(battleId, alice, aPower6, bob, bPower4);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamPowerChanged.selector, aPower6, uint8(4), uint8(6)));
        _reveal(battleId, aPower6, bPower4);
    }

    /// @dev The honest mixed-Power battle still opens — the binding is equality, not "<= 3".
    function test_D31_mixed_power_battle_reveals_when_both_match() public {
        uint256 aPower4 = _team(alice, [uint8(2), 1, 1]);
        uint256 bPower6 = _team(bob, [uint8(2), 2, 2]);
        uint256 battleId = _create(alice, bob, 4, 6);
        _depositAndCommit(battleId, alice, aPower4, bob, bPower6);
        _reveal(battleId, aPower4, bPower6);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Active));
        assertEq(b.teamIdA, aPower4);
        assertEq(b.teamIdB, bPower6);
    }

    /// @dev A weaker team is refused too: Power is a band, not a ceiling (it also keys the boost).
    function test_D31_reveal_rejects_weaker_team() public {
        uint256 weakA = _evolved(alice); // Power 3
        uint256 teamB = _team(bob, [uint8(2), 2, 1]); // Power 5
        uint256 battleId = _create(alice, bob, 5, 5);
        _depositAndCommit(battleId, alice, weakA, bob, teamB);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamPowerChanged.selector, weakA, uint8(5), uint8(3)));
        _reveal(battleId, weakA, teamB);
    }

    // ──────────── TeamAlreadyInBattle ────────────

    /// @dev One team committed to two concurrent battles: the first reveal takes it, the
    ///      second reverts, and the second battle then cancels cleanly with full refunds.
    function test_D31_one_team_cannot_open_two_battles() public {
        uint256 teamA = _evolved(alice);
        uint256 teamB = _evolved(bob);
        uint256 teamC = _evolved(carol);

        uint256 first = _create(alice, bob, 3, 3);
        uint256 second = _create(alice, carol, 3, 3);
        _depositAndCommit(first, alice, teamA, bob, teamB);
        _depositAndCommit(second, alice, teamA, carol, teamC);

        _reveal(first, teamA, teamB);
        assertTrue(arena.teamInBattle(teamA));

        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamAlreadyInBattle.selector, teamA));
        _reveal(second, teamA, teamC);
        assertFalse(arena.teamInBattle(teamC), "carol's team was not locked by the failed reveal");

        // The second battle is not stuck: past the reveal window anyone cancels it, and both
        // players get stake + anti-grief back (an unopenable reveal is a no-fault cancel).
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 carolBefore = claw.balanceOf(carol);
        vm.warp(block.timestamp + arena.TEAM_REVEAL_WINDOW() + 1);
        arena.handleTimeout(second);

        uint256 refund = STAKE_LOW + (STAKE_LOW * 500) / 10_000;
        assertEq(uint8(arena.getBattle(second).phase), uint8(BattleArena.BattlePhase.Cancelled));
        assertEq(claw.balanceOf(alice) - aliceBefore, refund, "alice refunded in full");
        assertEq(claw.balanceOf(carol) - carolBefore, refund, "carol refunded in full");
        // ...and the FIRST battle is untouched.
        assertEq(uint8(arena.getBattle(first).phase), uint8(BattleArena.BattlePhase.Active));
        assertTrue(arena.teamInBattle(teamA), "team A still bound to the first battle");
    }

    /// @dev `teamInBattle` is the arena's OWN record; `Team.active` is a flag it shares with
    ///      every ACTIVITY_ROLE holder. In normal operation both are set together, so either
    ///      guard alone would stop a double reveal — which is why this test clears the shared
    ///      flag from outside (a buggy or compromised activity-role contract) and shows the
    ///      arena's own mapping still holds the line.
    function test_D31_teamInBattle_holds_even_if_the_shared_active_flag_is_cleared() public {
        uint256 teamA = _evolved(alice);
        uint256 teamB = _evolved(bob);
        uint256 teamC = _evolved(carol);
        uint256 first = _create(alice, bob, 3, 3);
        uint256 second = _create(alice, carol, 3, 3);
        _depositAndCommit(first, alice, teamA, bob, teamB);
        _depositAndCommit(second, alice, teamA, carol, teamC);
        _reveal(first, teamA, teamB);

        vm.prank(miningPool);
        tm.setTeamActive(teamA, false); // the shared flag lies; the arena's mapping does not

        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamAlreadyInBattle.selector, teamA));
        _reveal(second, teamA, teamC);
    }

    /// @dev A team that started a mining expedition between commit and reveal is `active`
    ///      in TeamManager — the flag MiningPool and BattleArena share.
    function test_D31_team_that_started_mining_after_commit_cannot_be_revealed() public {
        uint256 teamA = _evolved(alice);
        uint256 teamB = _evolved(bob);
        uint256 battleId = _create(alice, bob, 3, 3);
        _depositAndCommit(battleId, alice, teamA, bob, teamB);

        vm.prank(miningPool); // MiningPool.startExpedition does exactly this
        tm.setTeamActive(teamB, true);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamAlreadyInBattle.selector, teamB));
        _reveal(battleId, teamA, teamB);
        _assertNothingBound(battleId, teamA, teamB);
    }

    /// @dev Disbanding the committed team makes the reveal unopenable; nothing is bound.
    function test_D31_disbanded_team_cannot_be_revealed() public {
        uint256 teamA = _evolved(alice);
        uint256 teamB = _evolved(bob);
        uint256 battleId = _create(alice, bob, 3, 3);
        _depositAndCommit(battleId, alice, teamA, bob, teamB);

        vm.prank(alice);
        tm.disbandTeam(teamA);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamNotOwned.selector, teamA));
        _reveal(battleId, teamA, teamB);
        assertFalse(arena.teamInBattle(teamB));
    }
}
