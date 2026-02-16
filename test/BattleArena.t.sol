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
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract BattleArenaTest is Test {
    BattleArena arena;
    BattleVRF vrf;
    TeamManager tm;
    LobsterNFT nft;
    ClawToken claw;
    Treasury treasury;

    address admin = makeAddr("admin");
    address devWallet = makeAddr("devWallet");
    address lpAddress = makeAddr("lpAddress");
    address treasuryAddress = makeAddr("treasuryAddress");
    address matchmaker = makeAddr("matchmaker");
    address resolver = makeAddr("resolver");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address nobody = makeAddr("nobody");

    uint256 validDNA;
    uint256 constant STAKE_LOW = 2_500e18;
    uint256 constant STAKE_MID = 10_000e18;
    uint256 constant STAKE_HIGH = 50_000e18;

    function setUp() public {
        vm.startPrank(admin);

        // Deploy dependencies
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        claw = new ClawToken(admin, lpAddress, treasuryAddress);
        tm = new TeamManager(admin, address(nft));
        treasury = new Treasury(admin, devWallet);
        vrf = new BattleVRF(admin);

        // Deploy arena
        arena = new BattleArena(admin, address(claw), address(nft), address(tm), address(treasury), address(vrf));

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.LOCKER_ROLE(), address(tm));
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        nft.grantRole(nft.DAMAGE_ROLE(), address(arena));
        tm.grantRole(tm.ACTIVITY_ROLE(), address(arena));
        arena.grantRole(arena.MATCHMAKER_ROLE(), matchmaker);
        arena.grantRole(arena.RESOLVER_ROLE(), resolver);
        treasury.setClawToken(address(claw));
        treasury.setAuthorized(address(arena), true);
        vrf.grantRole(vrf.OPERATOR_ROLE(), admin);

        vm.stopPrank();

        // Build valid DNA
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37;
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);

        // Fund alice and bob with CLAW for deposits
        _fundPlayer(alice, 200_000e18);
        _fundPlayer(bob, 200_000e18);
    }

    // ──────────── Helpers ────────────

    function _fundPlayer(address player, uint256 amount) internal {
        vm.prank(lpAddress);
        claw.transfer(player, amount);
    }

    function _mintEvolvedLobster(address to) internal returns (uint256) {
        vm.startPrank(admin);
        uint256 id = nft.mint(to, validDNA, false);
        nft.setEvolutionTier(id, 1); // Evolved
        vm.stopPrank();
        return id;
    }

    function _createEvolvedTeam(address owner) internal returns (uint256 teamId) {
        uint256 id1 = _mintEvolvedLobster(owner);
        uint256 id2 = _mintEvolvedLobster(owner);
        uint256 id3 = _mintEvolvedLobster(owner);
        vm.prank(owner);
        teamId = tm.createTeam([id1, id2, id3]);
    }

    function _createBattle() internal returns (uint256 battleId) {
        vm.prank(matchmaker);
        battleId = arena.createBattle(alice, bob, STAKE_LOW);
    }

    function _depositBoth(uint256 battleId) internal {
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 total = STAKE_LOW + antiGrief;

        vm.prank(alice);
        claw.approve(address(arena), total);
        vm.prank(alice);
        arena.deposit(battleId);

        vm.prank(bob);
        claw.approve(address(arena), total);
        vm.prank(bob);
        arena.deposit(battleId);
    }

    function _commitTeams(uint256 battleId, uint256 teamIdA, uint256 teamIdB)
        internal
        returns (bytes32 saltA, bytes32 saltB)
    {
        saltA = bytes32("saltA");
        saltB = bytes32("saltB");

        bytes32 commitA = keccak256(abi.encodePacked(battleId, alice, teamIdA, saltA));
        bytes32 commitB = keccak256(abi.encodePacked(battleId, bob, teamIdB, saltB));

        vm.prank(alice);
        arena.commitTeam(battleId, commitA);
        vm.prank(bob);
        arena.commitTeam(battleId, commitB);
    }

    function _revealTeams(uint256 battleId, uint256 teamIdA, uint256 teamIdB, bytes32 saltA, bytes32 saltB)
        internal
    {
        vm.prank(alice);
        arena.revealTeam(battleId, teamIdA, saltA);
        vm.prank(bob);
        arena.revealTeam(battleId, teamIdB, saltB);
    }

    function _commitMoves(uint256 battleId, bytes memory movesA, bytes memory movesB)
        internal
        returns (bytes32 saltA, bytes32 saltB)
    {
        BattleArena.Battle memory b = arena.getBattle(battleId);
        saltA = bytes32("moveSaltA");
        saltB = bytes32("moveSaltB");

        bytes32 commitA = keccak256(abi.encodePacked(battleId, b.currentRound, alice, movesA, saltA));
        bytes32 commitB = keccak256(abi.encodePacked(battleId, b.currentRound, bob, movesB, saltB));

        vm.prank(alice);
        arena.commitMoves(battleId, commitA);
        vm.prank(bob);
        arena.commitMoves(battleId, commitB);
    }

    function _revealMoves(uint256 battleId, bytes memory movesA, bytes memory movesB, bytes32 saltA, bytes32 saltB)
        internal
    {
        vm.prank(alice);
        arena.revealMoves(battleId, movesA, saltA);
        vm.prank(bob);
        arena.revealMoves(battleId, movesB, saltB);
    }

    /// @dev Full setup to Active phase round 1
    function _setupActiveBattle() internal returns (uint256 battleId, uint256 teamIdA, uint256 teamIdB) {
        teamIdA = _createEvolvedTeam(alice);
        teamIdB = _createEvolvedTeam(bob);

        battleId = _createBattle();
        _depositBoth(battleId);

        (bytes32 saltA, bytes32 saltB) = _commitTeams(battleId, teamIdA, teamIdB);
        _revealTeams(battleId, teamIdA, teamIdB, saltA, saltB);
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsState() public view {
        assertEq(address(arena.clawToken()), address(claw));
        assertEq(address(arena.lobsterNFT()), address(nft));
        assertEq(address(arena.teamManager()), address(tm));
        assertEq(address(arena.treasury()), address(treasury));
        assertEq(address(arena.battleVRF()), address(vrf));
        assertTrue(arena.hasRole(arena.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(arena.nextBattleId(), 1);
    }

    function test_constructorZeroAddressReverts() public {
        vm.startPrank(admin);
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        new BattleArena(address(0), address(claw), address(nft), address(tm), address(treasury), address(vrf));

        vm.expectRevert(BattleArena.ZeroAddress.selector);
        new BattleArena(admin, address(0), address(nft), address(tm), address(treasury), address(vrf));

        vm.expectRevert(BattleArena.ZeroAddress.selector);
        new BattleArena(admin, address(claw), address(0), address(tm), address(treasury), address(vrf));
        vm.stopPrank();
    }

    function test_stakeBracketsSet() public view {
        assertEq(arena.STAKE_BRACKETS(0), STAKE_LOW);
        assertEq(arena.STAKE_BRACKETS(1), STAKE_MID);
        assertEq(arena.STAKE_BRACKETS(2), STAKE_HIGH);
    }

    // ──────────── createBattle ────────────

    function test_createBattleHappyPath() public {
        vm.prank(matchmaker);
        uint256 battleId = arena.createBattle(alice, bob, STAKE_LOW);

        assertEq(battleId, 1);
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.playerA, alice);
        assertEq(b.playerB, bob);
        assertEq(b.stakeAmount, STAKE_LOW);
        assertTrue(b.phase == BattleArena.BattlePhase.Deposit);
        assertEq(arena.nextBattleId(), 2);
    }

    function test_createBattleEmitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit BattleArena.BattleCreated(1, alice, bob, STAKE_MID);

        vm.prank(matchmaker);
        arena.createBattle(alice, bob, STAKE_MID);
    }

    function test_createBattleInvalidStakeReverts() public {
        vm.prank(matchmaker);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeAmount.selector, 999e18));
        arena.createBattle(alice, bob, 999e18);
    }

    function test_createBattleSamePlayerReverts() public {
        vm.prank(matchmaker);
        vm.expectRevert(BattleArena.PlayerCannotBeSelf.selector);
        arena.createBattle(alice, alice, STAKE_LOW);
    }

    // ──────────── deposit ────────────

    function test_depositPlayerA() public {
        uint256 battleId = _createBattle();
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 total = STAKE_LOW + antiGrief;
        uint256 balBefore = claw.balanceOf(alice);

        vm.prank(alice);
        claw.approve(address(arena), total);
        vm.prank(alice);
        arena.deposit(battleId);

        assertEq(claw.balanceOf(alice), balBefore - total);
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.depositA);
        assertFalse(b.depositB);
        assertTrue(b.phase == BattleArena.BattlePhase.Deposit); // Still Deposit phase — waiting for B
    }

    function test_depositBothTransitionsToTeamCommit() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.depositA);
        assertTrue(b.depositB);
        assertTrue(b.phase == BattleArena.BattlePhase.TeamCommit);
    }

    function test_depositAlreadyDepositedReverts() public {
        uint256 battleId = _createBattle();
        uint256 total = STAKE_LOW + STAKE_LOW * 500 / 10_000;

        vm.prank(alice);
        claw.approve(address(arena), total * 2);
        vm.prank(alice);
        arena.deposit(battleId);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyDeposited.selector, battleId));
        vm.prank(alice);
        arena.deposit(battleId);
    }

    function test_depositWrongPhaseReverts() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        // Now in TeamCommit phase, deposit should revert
        uint256 total = STAKE_LOW + STAKE_LOW * 500 / 10_000;
        vm.prank(alice);
        claw.approve(address(arena), total);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Deposit,
                BattleArena.BattlePhase.TeamCommit
            )
        );
        vm.prank(alice);
        arena.deposit(battleId);
    }

    function test_depositNonParticipantReverts() public {
        uint256 battleId = _createBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotBattleParticipant.selector, battleId));
        vm.prank(nobody);
        arena.deposit(battleId);
    }

    // ──────────── commitTeam / revealTeam ────────────

    function test_commitTeamStoresHash() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        bytes32 commitA = keccak256(abi.encodePacked(battleId, alice, uint256(1), bytes32("salt")));
        vm.prank(alice);
        arena.commitTeam(battleId, commitA);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.teamCommitA, commitA);
        assertTrue(b.phase == BattleArena.BattlePhase.TeamCommit); // Still waiting for B
    }

    function test_commitTeamBothTransitionsToReveal() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        uint256 teamIdA = _createEvolvedTeam(alice);
        uint256 teamIdB = _createEvolvedTeam(bob);
        _commitTeams(battleId, teamIdA, teamIdB);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.TeamReveal);
    }

    function test_revealTeamValidatesHash() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        uint256 teamIdA = _createEvolvedTeam(alice);
        uint256 teamIdB = _createEvolvedTeam(bob);
        (, bytes32 saltB) = _commitTeams(battleId, teamIdA, teamIdB);

        // Try to reveal with wrong salt
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        vm.prank(alice);
        arena.revealTeam(battleId, teamIdA, bytes32("wrong"));

        // Correct reveal works
        vm.prank(alice);
        arena.revealTeam(battleId, teamIdA, bytes32("saltA"));
    }

    function test_revealTeamValidatesEligibility() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        // Create a team with Base tier lobsters (not Evolved)
        vm.startPrank(admin);
        uint256 lob1 = nft.mint(alice, validDNA, false);
        uint256 lob2 = nft.mint(alice, validDNA, false);
        uint256 lob3 = nft.mint(alice, validDNA, false);
        vm.stopPrank();
        vm.prank(alice);
        uint256 baseTeam = tm.createTeam([lob1, lob2, lob3]);

        uint256 teamIdB = _createEvolvedTeam(bob);

        bytes32 saltA = bytes32("saltA");
        bytes32 saltB = bytes32("saltB");
        bytes32 commitA = keccak256(abi.encodePacked(battleId, alice, baseTeam, saltA));
        bytes32 commitB = keccak256(abi.encodePacked(battleId, bob, teamIdB, saltB));

        vm.prank(alice);
        arena.commitTeam(battleId, commitA);
        vm.prank(bob);
        arena.commitTeam(battleId, commitB);

        // Alice tries to reveal with Base-tier team → should revert
        vm.expectRevert(abi.encodeWithSelector(BattleArena.LobsterTierTooLow.selector, lob1, 1, 0));
        vm.prank(alice);
        arena.revealTeam(battleId, baseTeam, saltA);
    }

    function test_revealTeamLocksTeam() public {
        uint256 teamIdA = _createEvolvedTeam(alice);
        uint256 teamIdB = _createEvolvedTeam(bob);

        uint256 battleId = _createBattle();
        _depositBoth(battleId);
        (bytes32 saltA,) = _commitTeams(battleId, teamIdA, teamIdB);

        vm.prank(alice);
        arena.revealTeam(battleId, teamIdA, saltA);

        assertTrue(arena.teamInBattle(teamIdA));
        assertTrue(tm.isTeamActive(teamIdA));
    }

    function test_revealTeamBothStartsRound1() public {
        (uint256 battleId,,) = _setupActiveBattle();

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Active);
        assertEq(b.currentRound, 1);
    }

    // ──────────── commitMoves / revealMoves ────────────

    function test_commitMovesStoresHash() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes32 commit = keccak256(abi.encodePacked(battleId, uint8(1), alice, hex"01", bytes32("salt")));
        vm.prank(alice);
        arena.commitMoves(battleId, commit);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.roundCommitA, commit);
    }

    function test_commitMovesBothSetsRevealDeadline() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";

        _commitMoves(battleId, movesA, movesB);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        // After both commit, deadline should be set for reveal
        assertEq(b.phaseDeadline, block.timestamp + arena.REVEAL_WINDOW());
    }

    function test_revealMovesValidatesHash() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA,) = _commitMoves(battleId, movesA, movesB);

        // Wrong data should revert
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        vm.prank(alice);
        arena.revealMoves(battleId, hex"ffffff", saltA);
    }

    function test_revealMovesEmitsEvent() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);

        vm.expectEmit(true, true, true, true);
        emit BattleArena.MoveRevealed(battleId, 1, alice, movesA);

        vm.prank(alice);
        arena.revealMoves(battleId, movesA, saltA);
    }

    // ──────────── advanceRound ────────────

    function test_advanceRoundIncrementsRound() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        vm.prank(resolver);
        arena.advanceRound(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.currentRound, 2);
    }

    function test_advanceRoundResetsState() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        vm.prank(resolver);
        arena.advanceRound(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.roundCommitA, bytes32(0));
        assertEq(b.roundCommitB, bytes32(0));
        assertFalse(b.roundRevealedA);
        assertFalse(b.roundRevealedB);
    }

    function test_advanceRoundOnlyResolver() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, arena.RESOLVER_ROLE()
            )
        );
        vm.prank(nobody);
        arena.advanceRound(battleId);
    }

    // ──────────── settle ────────────

    function test_settleWinnerPayout() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Do one round of moves
        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000; // 10%
        uint256 winnerPayout = combinedPot - protocolFee;

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // Winner gets payout + their anti-grief
        assertEq(claw.balanceOf(alice), aliceBalBefore + winnerPayout + antiGrief);
    }

    function test_settleLoserGetsAntiGrief() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        uint256 bobBalBefore = claw.balanceOf(bob);
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // Loser gets anti-grief back
        assertEq(claw.balanceOf(bob), bobBalBefore + antiGrief);
    }

    function test_settleFeeRoutedToTreasury() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        uint256 devBalBefore = claw.balanceOf(devWallet);
        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000;
        uint256 devShare = protocolFee - (protocolFee * 8500 / 10_000); // 15% of fee

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // Dev wallet should receive 15% of protocol fee
        assertEq(claw.balanceOf(devWallet), devBalBefore + devShare);
    }

    function test_settleDamageApplied() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // Check winner team damage
        TeamManager.Team memory teamA = tm.getTeam(teamIdA);
        assertEq(nft.getDamage(teamA.lobsterIds[0]), 10);
        assertEq(nft.getDamage(teamA.lobsterIds[1]), 5);
        assertEq(nft.getDamage(teamA.lobsterIds[2]), 8);

        // Check loser team damage
        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        assertEq(nft.getDamage(teamB.lobsterIds[0]), 30);
        assertEq(nft.getDamage(teamB.lobsterIds[1]), 25);
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 35);
    }

    function test_settleReleasesTeams() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        assertFalse(arena.teamInBattle(teamIdA));
        assertFalse(arena.teamInBattle(teamIdB));
        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
    }

    function test_settleEmitsEvent() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000;
        uint256 winnerPayout = combinedPot - protocolFee;

        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleSettled(battleId, alice, winnerPayout, protocolFee);

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    // ──────────── handleTimeout / forfeit ────────────

    function test_handleTimeoutDepositCancel() public {
        uint256 battleId = _createBattle();

        // Only Alice deposits
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 total = STAKE_LOW + antiGrief;
        vm.prank(alice);
        claw.approve(address(arena), total);
        vm.prank(alice);
        arena.deposit(battleId);

        uint256 aliceBalBefore = claw.balanceOf(alice);

        // Warp past deposit deadline
        vm.warp(block.timestamp + arena.DEPOSIT_WINDOW() + 1);
        arena.handleTimeout(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Cancelled);

        // Alice gets her deposit back
        assertEq(claw.balanceOf(alice), aliceBalBefore + total);
    }

    function test_handleTimeoutForfeitNonCommitter() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        // Only Alice commits team
        uint256 teamIdA = _createEvolvedTeam(alice);
        bytes32 salt = bytes32("salt");
        bytes32 commit = keccak256(abi.encodePacked(battleId, alice, teamIdA, salt));
        vm.prank(alice);
        arena.commitTeam(battleId, commit);

        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;

        // Warp past team commit deadline
        vm.warp(block.timestamp + arena.TEAM_COMMIT_WINDOW() + 1);
        arena.handleTimeout(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Cancelled);

        // Alice (non-forfeiting) gets stake + anti-grief
        assertEq(claw.balanceOf(alice), aliceBalBefore + STAKE_LOW + antiGrief);
        // Bob (forfeiter) loses anti-grief but gets stake back
        assertEq(claw.balanceOf(bob), bobBalBefore + STAKE_LOW);
    }

    function test_handleTimeoutMutualCancel() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 total = STAKE_LOW + antiGrief;

        // Neither commits team — warp past deadline
        vm.warp(block.timestamp + arena.TEAM_COMMIT_WINDOW() + 1);
        arena.handleTimeout(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Cancelled);

        // Both get full refund
        assertEq(claw.balanceOf(alice), aliceBalBefore + total);
        assertEq(claw.balanceOf(bob), bobBalBefore + total);
    }

    function test_handleTimeoutNotExpiredReverts() public {
        uint256 battleId = _createBattle();

        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);
    }

    function test_handleTimeoutAutoForfeit3Strikes() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Simulate 3 consecutive timeouts for alice (only bob commits)
        for (uint256 i = 0; i < 2; i++) {
            BattleArena.Battle memory b = arena.getBattle(battleId);

            // Only bob commits
            bytes32 commit = keccak256(abi.encodePacked(battleId, b.currentRound, bob, hex"01", bytes32("s")));
            vm.prank(bob);
            arena.commitMoves(battleId, commit);

            vm.warp(block.timestamp + arena.COMMIT_WINDOW() + 1);
            arena.handleTimeout(battleId);
        }

        // Third timeout should cause auto-forfeit
        {
            BattleArena.Battle memory b = arena.getBattle(battleId);
            bytes32 commit = keccak256(abi.encodePacked(battleId, b.currentRound, bob, hex"01", bytes32("s")));
            vm.prank(bob);
            arena.commitMoves(battleId, commit);
        }

        vm.warp(block.timestamp + arena.COMMIT_WINDOW() + 1);
        arena.handleTimeout(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Cancelled);
    }

    // ──────────── E2E ────────────

    function test_fullBattleLifecycleE2E() public {
        // Create teams
        uint256 teamIdA = _createEvolvedTeam(alice);
        uint256 teamIdB = _createEvolvedTeam(bob);

        // Create battle
        uint256 battleId = _createBattle();

        // Deposit
        _depositBoth(battleId);

        // Commit & reveal teams
        (bytes32 teamSaltA, bytes32 teamSaltB) = _commitTeams(battleId, teamIdA, teamIdB);
        _revealTeams(battleId, teamIdA, teamIdB, teamSaltA, teamSaltB);

        // Verify round 1 started
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.currentRound, 1);
        assertTrue(b.phase == BattleArena.BattlePhase.Active);

        // Round 1: commit & reveal moves
        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 moveSaltA, bytes32 moveSaltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, moveSaltA, moveSaltB);

        // Advance to round 2
        vm.prank(resolver);
        arena.advanceRound(battleId);

        b = arena.getBattle(battleId);
        assertEq(b.currentRound, 2);

        // Round 2: commit & reveal moves
        bytes memory movesA2 = hex"070809";
        bytes memory movesB2 = hex"0a0b0c";
        (moveSaltA, moveSaltB) = _commitMoves(battleId, movesA2, movesB2);
        _revealMoves(battleId, movesA2, movesB2, moveSaltA, moveSaltB);

        // Settle — alice wins
        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // Verify final state
        b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Settled);
        assertEq(b.winner, alice);

        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000;
        uint256 winnerPayout = combinedPot - protocolFee;

        assertEq(claw.balanceOf(alice), aliceBalBefore + winnerPayout + antiGrief);
        assertEq(claw.balanceOf(bob), bobBalBefore + antiGrief);
    }

    function test_battleCancelledDuringDepositE2E() public {
        uint256 battleId = _createBattle();

        // Only alice deposits
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 total = STAKE_LOW + antiGrief;
        vm.prank(alice);
        claw.approve(address(arena), total);
        vm.prank(alice);
        arena.deposit(battleId);

        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);

        // Warp past deadline → cancel
        vm.warp(block.timestamp + arena.DEPOSIT_WINDOW() + 1);
        arena.handleTimeout(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Cancelled);

        // Alice gets full refund, Bob never deposited
        assertEq(claw.balanceOf(alice), aliceBalBefore + total);
        assertEq(claw.balanceOf(bob), bobBalBefore);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_antiGriefCalculation(uint256 stake) public view {
        stake = bound(stake, 1e18, 100_000e18);
        uint256 antiGrief = stake * 500 / 10_000;
        assertEq(antiGrief, stake * 5 / 100);
    }

    function testFuzz_protocolFeeCalculation(uint256 stake) public view {
        stake = bound(stake, 1e18, 100_000e18);
        uint256 combinedPot = stake * 2;
        uint256 fee = combinedPot * 1000 / 10_000;
        assertEq(fee, combinedPot / 10);
    }
}
