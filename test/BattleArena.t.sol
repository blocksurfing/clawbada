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

    /// @dev H-01: drive the full settle → warp past DISPUTE_WINDOW → finalize happy path.
    ///      Payout + damage + team release happen inside `finalizeBattle`, not `settle`.
    function _settleAndFinalize(
        uint256 battleId,
        address winner,
        uint8[3] memory winnerDamage,
        uint8[3] memory loserDamage
    ) internal {
        vm.prank(resolver);
        arena.settle(battleId, winner, winnerDamage, loserDamage);
        vm.warp(block.timestamp + arena.disputeWindows(0) + 1);
        arena.finalizeBattle(battleId);
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

    function test_settleRevertsWithoutVerifiedMovesAndPreservesState() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        // No round commits or reveals have occurred, so settlement must fail.
        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.SettlementRequiresVerifiedRound.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, bob, [uint8(99), 42, 17], [uint8(80), 70, 60]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Active);
        assertEq(b.winner, address(0));

        // Escrowed balances remain untouched.
        assertEq(claw.balanceOf(bob), bobBalBefore);
        assertEq(claw.balanceOf(alice), aliceBalBefore);

        // Team damage remains unchanged.
        TeamManager.Team memory teamA = tm.getTeam(teamIdA);
        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        assertEq(nft.getDamage(teamB.lobsterIds[0]), 0);
        assertEq(nft.getDamage(teamB.lobsterIds[1]), 0);
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 0);
        assertEq(nft.getDamage(teamA.lobsterIds[0]), 0);
        assertEq(nft.getDamage(teamA.lobsterIds[1]), 0);
        assertEq(nft.getDamage(teamA.lobsterIds[2]), 0);
    }

    function test_settleShouldRevertBeforeAnyMovesAreVerified() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Intended safety property: settlement should not be possible before a verified move transcript exists.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.SettlementRequiresVerifiedRound.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, bob, [uint8(99), 42, 17], [uint8(80), 70, 60]);
    }

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

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

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

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

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

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // Dev wallet should receive 15% of protocol fee
        assertEq(claw.balanceOf(devWallet), devBalBefore + devShare);
    }

    function test_settleDamageApplied() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

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

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

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

        // H-01: settle() emits BattleProposed, finalizeBattle() emits BattleSettled.
        uint256 expectedDeadline = block.timestamp + arena.disputeWindows(0);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleProposed(battleId, alice, expectedDeadline);

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        vm.warp(block.timestamp + arena.disputeWindows(0) + 1);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleSettled(battleId, alice, winnerPayout, protocolFee);
        arena.finalizeBattle(battleId);
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

    // ──────────── P-02 Regression: reveal withhold causes immediate forfeit ────────────

    function test_revealWithholdCausesImmediateForfeit() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Both commit moves
        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA,) = _commitMoves(battleId, movesA, movesB);

        // Only alice reveals
        vm.prank(alice);
        arena.revealMoves(battleId, movesA, saltA);

        // Bob withholds reveal → timeout
        vm.warp(block.timestamp + arena.COMMIT_WINDOW() + 1);
        arena.handleTimeout(battleId);

        // Bob should be immediately forfeited (no second chances for reveal withhold)
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Cancelled);
    }

    // ──────────── P-04 Regression: cumulative timeout counters across rounds ────────────

    function test_timeoutCountersCumulativeAcrossRounds() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Round 1: alice times out (only bob commits)
        {
            BattleArena.Battle memory b = arena.getBattle(battleId);
            bytes32 commit = keccak256(abi.encodePacked(battleId, b.currentRound, bob, hex"01", bytes32("s")));
            vm.prank(bob);
            arena.commitMoves(battleId, commit);
        }
        vm.warp(block.timestamp + arena.COMMIT_WINDOW() + 1);
        arena.handleTimeout(battleId);
        // consecutiveTimeoutsA = 1, not yet forfeited

        // Round 2: both cooperate (commit + reveal + advance)
        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        vm.prank(resolver);
        arena.advanceRound(battleId);
        // P-04 fix: advanceRound no longer resets consecutiveTimeoutsA

        // Round 3: alice times out again (only bob commits)
        {
            BattleArena.Battle memory b = arena.getBattle(battleId);
            bytes32 commit = keccak256(abi.encodePacked(battleId, b.currentRound, bob, hex"01", bytes32("s")));
            vm.prank(bob);
            arena.commitMoves(battleId, commit);
        }
        vm.warp(block.timestamp + arena.COMMIT_WINDOW() + 1);
        arena.handleTimeout(battleId);
        // consecutiveTimeoutsA = 2

        // Round 4: alice times out one more time → should hit threshold (3)
        {
            BattleArena.Battle memory b = arena.getBattle(battleId);
            bytes32 commit = keccak256(abi.encodePacked(battleId, b.currentRound, bob, hex"01", bytes32("s")));
            vm.prank(bob);
            arena.commitMoves(battleId, commit);
        }
        vm.warp(block.timestamp + arena.COMMIT_WINDOW() + 1);
        arena.handleTimeout(battleId);

        // Alice should be forfeited after 3 total timeouts (cumulative, not per-round)
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

        // Settle — alice wins (H-01: settle proposes, finalize pays)
        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

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

    // ──────────── Negative: settle phase guards ────────────

    function test_settleRevertsInDepositPhase() public {
        uint256 battleId = _createBattle();

        // Only Alice deposits — still in Deposit phase
        uint256 total = STAKE_LOW + STAKE_LOW * 500 / 10_000;
        vm.prank(alice);
        claw.approve(address(arena), total);
        vm.prank(alice);
        arena.deposit(battleId);

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.Active, BattleArena.BattlePhase.Deposit
            )
        );
        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleRevertsInTeamCommitPhase() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        // Phase is TeamCommit — settle should fail
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.Active, BattleArena.BattlePhase.TeamCommit
            )
        );
        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleRevertsInTeamRevealPhase() public {
        uint256 battleId = _createBattle();
        _depositBoth(battleId);

        uint256 teamIdA = _createEvolvedTeam(alice);
        uint256 teamIdB = _createEvolvedTeam(bob);
        _commitTeams(battleId, teamIdA, teamIdB);

        // Phase is TeamReveal — settle should fail
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.Active, BattleArena.BattlePhase.TeamReveal
            )
        );
        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleByNonResolverReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Complete one round of moves
        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, arena.RESOLVER_ROLE())
        );
        vm.prank(nobody);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleWithInvalidWinnerReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        // Winner is neither playerA nor playerB
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidWinner.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, nobody, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleAfterPartialMoveRevealReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Both commit moves
        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA,) = _commitMoves(battleId, movesA, movesB);

        // Only Alice reveals — lastVerifiedRound still 0
        vm.prank(alice);
        arena.revealMoves(battleId, movesA, saltA);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.SettlementRequiresVerifiedRound.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleWhenAlreadySettledReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        // First settle succeeds — H-01: phase goes to AwaitingFinalize, not Settled
        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // Second settle should revert — phase is now AwaitingFinalize
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Active,
                BattleArena.BattlePhase.AwaitingFinalize
            )
        );
        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // And after finalization, it reverts with phase=Settled
        vm.warp(block.timestamp + arena.disputeWindows(0) + 1);
        arena.finalizeBattle(battleId);

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Active,
                BattleArena.BattlePhase.Settled
            )
        );
        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_advanceRoundByNonResolverReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, arena.RESOLVER_ROLE())
        );
        vm.prank(alice);
        arena.advanceRound(battleId);
    }

    function test_lastVerifiedRoundSetAfterBothReveals() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Before any moves, lastVerifiedRound should be 0
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.lastVerifiedRound, 0);

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);

        // After commits but before reveals, still 0
        b = arena.getBattle(battleId);
        assertEq(b.lastVerifiedRound, 0);

        // After only Alice reveals, still 0
        vm.prank(alice);
        arena.revealMoves(battleId, movesA, saltA);
        b = arena.getBattle(battleId);
        assertEq(b.lastVerifiedRound, 0);

        // After Bob reveals, should be 1
        vm.prank(bob);
        arena.revealMoves(battleId, movesB, saltB);
        b = arena.getBattle(battleId);
        assertEq(b.lastVerifiedRound, 1);
    }

    function test_settleSucceedsAfterOneVerifiedRound() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Complete exactly one round of moves
        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        // Settle should succeed with exactly 1 verified round (boundary case).
        // H-01: settle proposes, finalize pays.
        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000;
        uint256 winnerPayout = combinedPot - protocolFee;

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Settled);
        assertEq(b.winner, alice);
        assertEq(claw.balanceOf(alice), aliceBalBefore + winnerPayout + antiGrief);
    }

    // ──────────── P-05 Regression: uint8 overflow in _applyDamage ────────────

    function test_settleDamageCapsAt100WithoutOverflow() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        // Pre-set high damage on loser's lobsters (simulating prior battles)
        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        vm.startPrank(admin);
        nft.grantRole(nft.DAMAGE_ROLE(), admin);
        nft.setDamage(teamB.lobsterIds[0], 70);
        nft.setDamage(teamB.lobsterIds[1], 90);
        nft.setDamage(teamB.lobsterIds[2], 60);
        vm.stopPrank();

        bytes memory movesA = hex"010203";
        bytes memory movesB = hex"040506";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, saltA, saltB);

        // Settle with damages that would overflow uint8 if added directly:
        // 70 + 40 = 110 > uint8 max? No, 110 < 256, but > 100 cap
        // 90 + 40 = 130 > 100
        // 60 + 40 = 100 exactly
        // More critically: test 220 + 40 = 260 > 255 (uint8 overflow)
        // But damages[i] is uint8 (max 40 per spec), so test currentDamage=220 isn't possible
        // since damage is capped at 100. Test the realistic overflow: currentDamage=70, damage=40
        _settleAndFinalize(battleId, alice, [uint8(5), 5, 5], [uint8(40), 40, 40]);

        // Verify damage capped at 100, not overflowed
        assertEq(nft.getDamage(teamB.lobsterIds[0]), 100); // 70 + 40 = 110 → capped at 100
        assertEq(nft.getDamage(teamB.lobsterIds[1]), 100); // 90 + 40 = 130 → capped at 100
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 100); // 60 + 40 = 100 → exactly 100
    }

    // ──────────── S-02: Emergency Withdraw ────────────

    function test_emergencyWithdrawAfterDelay() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Battle is Active. Warp past emergency delay.
        vm.warp(block.timestamp + 24 hours + 1);

        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);

        vm.prank(alice);
        arena.emergencyWithdraw(battleId);

        // Both players get full refund (stake + anti-grief)
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        assertEq(claw.balanceOf(alice), aliceBalBefore + STAKE_LOW + antiGrief);
        assertEq(claw.balanceOf(bob), bobBalBefore + STAKE_LOW + antiGrief);

        // Battle is cancelled
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Cancelled));
    }

    function test_emergencyWithdrawBeforeDelayReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Warp to just before delay expires
        vm.warp(block.timestamp + 24 hours - 1);

        vm.prank(alice);
        vm.expectRevert();
        arena.emergencyWithdraw(battleId);
    }

    function test_emergencyWithdrawByNonParticipantReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotBattleParticipant.selector, battleId));
        arena.emergencyWithdraw(battleId);
    }

    function test_emergencyWithdrawReleasesTeams() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        assertTrue(tm.isTeamActive(teamIdA));
        assertTrue(tm.isTeamActive(teamIdB));

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(bob);
        arena.emergencyWithdraw(battleId);

        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
    }

    function test_emergencyWithdrawOnSettledBattleReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        bytes memory movesA = abi.encodePacked(uint8(1));
        bytes memory movesB = abi.encodePacked(uint8(2));
        (bytes32 mSaltA, bytes32 mSaltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, mSaltA, mSaltB);

        vm.prank(resolver);
        arena.settle(battleId, alice, [uint8(10), 10, 10], [uint8(30), 30, 30]);

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(alice);
        vm.expectRevert();
        arena.emergencyWithdraw(battleId);
    }

    function test_emergencyWithdrawResetsAfterAdvanceRound() public {
        (uint256 battleId,,) = _setupActiveBattle();
        bytes memory movesA = abi.encodePacked(uint8(1));
        bytes memory movesB = abi.encodePacked(uint8(2));
        (bytes32 mSaltA, bytes32 mSaltB) = _commitMoves(battleId, movesA, movesB);
        _revealMoves(battleId, movesA, movesB, mSaltA, mSaltB);

        // Advance round resets lastProgressAt
        vm.prank(resolver);
        arena.advanceRound(battleId);

        // 23 hours after advanceRound — too early
        vm.warp(block.timestamp + 23 hours);
        vm.prank(alice);
        vm.expectRevert();
        arena.emergencyWithdraw(battleId);

        // 25 hours after advanceRound — now allowed
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        arena.emergencyWithdraw(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Cancelled));
    }

    function test_emergencyWithdrawNotAvailableOnNonActiveBattle() public {
        // Battle in Deposit phase (before teams committed)
        uint256 battleId = _createBattle();
        _depositBoth(battleId);
        // Now in TeamCommit phase

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(alice);
        vm.expectRevert();
        arena.emergencyWithdraw(battleId);
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

    // ──────────── F-02: revealMoves requires both commits ────────────

    function test_revealMovesRevertsBeforeBothCommits() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"01";
        bytes32 saltA = bytes32("moveSaltA");
        BattleArena.Battle memory b = arena.getBattle(battleId);
        bytes32 commitA = keccak256(abi.encodePacked(battleId, b.currentRound, alice, movesA, saltA));

        // Alice commits
        vm.prank(alice);
        arena.commitMoves(battleId, commitA);

        // Alice tries to reveal before Bob commits → should revert
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.BothCommitsRequired.selector, battleId));
        arena.revealMoves(battleId, movesA, saltA);
    }

    function test_revealMovesSucceedsAfterBothCommits() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"01";
        bytes memory movesB = hex"02";
        (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);

        // Both committed, reveals should work
        vm.prank(alice);
        arena.revealMoves(battleId, movesA, saltA);

        vm.prank(bob);
        arena.revealMoves(battleId, movesB, saltB);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.roundRevealedA);
        assertTrue(b.roundRevealedB);
        assertEq(b.lastVerifiedRound, 1);
    }

    // ──────────── F-03: MAX_ROUNDS enforcement ────────────

    function test_advanceRoundRevertsAtMaxRounds() public {
        (uint256 battleId,,) = _setupActiveBattle();

        bytes memory movesA = hex"01";
        bytes memory movesB = hex"02";

        // Play through 7 rounds (max)
        for (uint8 round = 1; round <= 7; round++) {
            (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
            _revealMoves(battleId, movesA, movesB, saltA, saltB);

            if (round < 7) {
                vm.prank(resolver);
                arena.advanceRound(battleId);
            }
        }

        // Round 7 complete, trying to advance to round 8 should revert
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.MaxRoundsReached.selector, battleId));
        arena.advanceRound(battleId);
    }

    function test_settleWorksAtMaxRound() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        bytes memory movesA = hex"01";
        bytes memory movesB = hex"02";

        // Play through all 7 rounds
        for (uint8 round = 1; round <= 7; round++) {
            (bytes32 saltA, bytes32 saltB) = _commitMoves(battleId, movesA, movesB);
            _revealMoves(battleId, movesA, movesB, saltA, saltB);

            if (round < 7) {
                vm.prank(resolver);
                arena.advanceRound(battleId);
            }
        }

        // Settlement should still work at round 7 (H-01: settle proposes, finalize pays)
        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, alice);
    }
}
