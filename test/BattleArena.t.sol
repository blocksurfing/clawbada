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
    // V3 settle commitments (any non-zero value; the contract only checks non-zero + equality on dispute)
    bytes32 constant HASH_STATE = keccak256("final-state");
    bytes32 constant HASH_LOG = keccak256("turn-log");

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
        // Power 3 == three Evolved lobsters (the standard _createEvolvedTeam composition).
        battleId = arena.createBattle(alice, bob, STAKE_LOW, 3, 3);
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
        // F5-01: team reveal is atomic and resolver-submitted.
        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, saltA, teamIdB, saltB);
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
    /// @dev V3: damage arrays are keyed by player slot (A/B); `winner == address(0)` is a draw.
    function _settleAndFinalize(
        uint256 battleId,
        address winner,
        uint8[3] memory damageA,
        uint8[3] memory damageB
    ) internal {
        vm.prank(resolver);
        arena.settle(battleId, winner, HASH_STATE, HASH_LOG, damageA, damageB);
        vm.warp(block.timestamp + arena.disputeWindows(0) + 1);
        arena.finalizeBattle(battleId);
    }

    /// @dev Post the bracket bond and dispute as `who`.
    function _dispute(uint256 battleId, address who) internal {
        uint256 bond = arena.disputeBonds(0);
        vm.prank(who);
        claw.approve(address(arena), bond);
        vm.prank(who);
        arena.disputeBattle(battleId, hex"01");
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
        uint256 battleId = arena.createBattle(alice, bob, STAKE_LOW, 3, 3);

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
        emit BattleArena.BattleCreated(1, alice, bob, STAKE_MID, 3, 3);

        vm.prank(matchmaker);
        arena.createBattle(alice, bob, STAKE_MID, 3, 3);
    }

    function test_createBattleInvalidStakeReverts() public {
        vm.prank(matchmaker);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeAmount.selector, 999e18));
        arena.createBattle(alice, bob, 999e18, 3, 3);
    }

    function test_createBattleSamePlayerReverts() public {
        vm.prank(matchmaker);
        vm.expectRevert(BattleArena.PlayerCannotBeSelf.selector);
        arena.createBattle(alice, alice, STAKE_LOW, 3, 3);
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

    // ──────────── commitTeam / revealTeams ────────────

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
        (bytes32 saltA, bytes32 saltB) = _commitTeams(battleId, teamIdA, teamIdB);

        // F5-01: atomic resolver-submitted reveal. A wrong salt for either side reverts.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, bytes32("wrong"), teamIdB, saltB);

        // Correct reveal of both teams works.
        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, saltA, teamIdB, saltB);
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

        // F5-01: atomic reveal validates both teams; alice's Base-tier team reverts.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.LobsterTierTooLow.selector, lob1, 1, 0));
        vm.prank(resolver);
        arena.revealTeams(battleId, baseTeam, saltA, teamIdB, saltB);
    }

    function test_revealTeamLocksTeam() public {
        uint256 teamIdA = _createEvolvedTeam(alice);
        uint256 teamIdB = _createEvolvedTeam(bob);

        uint256 battleId = _createBattle();
        _depositBoth(battleId);
        (bytes32 saltA, bytes32 saltB) = _commitTeams(battleId, teamIdA, teamIdB);

        // F5-01: atomic reveal locks BOTH teams at once.
        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, saltA, teamIdB, saltB);

        assertTrue(arena.teamInBattle(teamIdA));
        assertTrue(tm.isTeamActive(teamIdA));
        assertTrue(arena.teamInBattle(teamIdB));
        assertTrue(tm.isTeamActive(teamIdB));
    }

    // ──────────── settle ────────────

    function test_settleWinnerPayout() public {
        (uint256 battleId,,) = _setupActiveBattle();

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

        uint256 bobBalBefore = claw.balanceOf(bob);
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // Loser gets anti-grief back
        assertEq(claw.balanceOf(bob), bobBalBefore + antiGrief);
    }

    function test_settleFeeRoutedToTreasury() public {
        (uint256 battleId,,) = _setupActiveBattle();

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

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        assertFalse(arena.teamInBattle(teamIdA));
        assertFalse(arena.teamInBattle(teamIdB));
        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
    }

    function test_settleEmitsEvent() public {
        (uint256 battleId,,) = _setupActiveBattle();

        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000;
        uint256 winnerPayout = combinedPot - protocolFee;

        // H-01: settle() emits BattleProposed, finalizeBattle() emits BattleSettled.
        uint256 expectedDeadline = block.timestamp + arena.disputeWindows(0);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleProposed(battleId, alice, expectedDeadline, HASH_STATE, HASH_LOG);

        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);

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

        // V3: the battle now runs off-chain over WebSocket. On-chain, Active just
        // carries the ACTIVE_WINDOW deadline the resolver must settle within.
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Active);
        assertEq(b.phaseDeadline, block.timestamp + arena.ACTIVE_WINDOW());

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
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);
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
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);
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
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleByNonResolverReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, arena.RESOLVER_ROLE())
        );
        vm.prank(nobody);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleWithInvalidWinnerReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // Winner is neither playerA nor playerB
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidWinner.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, nobody, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);
    }

    function test_settleWhenAlreadySettledReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        // First settle succeeds — H-01: phase goes to AwaitingFinalize, not Settled
        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);

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
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);

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
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35]);
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
        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 10, 10], [uint8(30), 30, 30]);

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(alice);
        vm.expectRevert();
        arena.emergencyWithdraw(battleId);
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

    // ──────────── V3: Active phase = off-chain battle, on-chain ACTIVE_WINDOW ────────────

    function test_revealTeamsSetsActiveWindowDeadline() public {
        (uint256 battleId,,) = _setupActiveBattle();

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Active);
        assertEq(b.phaseDeadline, block.timestamp + arena.ACTIVE_WINDOW());
        assertEq(b.lastProgressAt, block.timestamp);
        assertEq(arena.ACTIVE_WINDOW(), 3 hours);
    }

    function test_settleFromActiveWithoutAnyOnChainRounds() public {
        (uint256 battleId,,) = _setupActiveBattle();

        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000;
        uint256 winnerPayout = combinedPot - protocolFee;

        // No move data ever touches the chain in V3 — settle straight from Active.
        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Settled);
        assertEq(b.winner, alice);
        assertEq(claw.balanceOf(alice), aliceBalBefore + winnerPayout + antiGrief);
    }

    function test_settleStoresHashesAndProposal() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.prank(resolver);
        arena.settle(battleId, bob, HASH_STATE, HASH_LOG, [uint8(20), 21, 22], [uint8(1), 2, 3]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.AwaitingFinalize);
        assertEq(b.proposedWinner, bob);
        assertEq(b.finalStateHash, HASH_STATE);
        assertEq(b.turnLogHash, HASH_LOG);
        // Damage is keyed by player slot, not winner/loser: A's array stays A's.
        assertEq(b.proposedDamageA[0], 20);
        assertEq(b.proposedDamageA[2], 22);
        assertEq(b.proposedDamageB[0], 1);
        assertEq(b.proposedDamageB[2], 3);
        assertEq(b.payoutDeadline, block.timestamp + arena.disputeWindows(0));
    }

    function test_settleDamageKeyedByPlayerSlotWhenBWins() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        _settleAndFinalize(battleId, bob, [uint8(30), 25, 35], [uint8(10), 5, 8]);

        TeamManager.Team memory teamA = tm.getTeam(teamIdA);
        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        assertEq(nft.getDamage(teamA.lobsterIds[0]), 30);
        assertEq(nft.getDamage(teamA.lobsterIds[1]), 25);
        assertEq(nft.getDamage(teamA.lobsterIds[2]), 35);
        assertEq(nft.getDamage(teamB.lobsterIds[0]), 10);
        assertEq(nft.getDamage(teamB.lobsterIds[1]), 5);
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 8);
    }

    function test_settleZeroFinalStateHashReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, alice, bytes32(0), HASH_LOG, [uint8(1), 1, 1], [uint8(1), 1, 1]);
    }

    function test_settleZeroTurnLogHashReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, bytes32(0), [uint8(1), 1, 1], [uint8(1), 1, 1]);
    }

    function test_settleAfterActiveWindowReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + arena.ACTIVE_WINDOW() + 1);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(1), 1, 1], [uint8(1), 1, 1]);
    }

    function test_settleAtActiveWindowBoundarySucceeds() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + arena.ACTIVE_WINDOW()); // == deadline is still in time

        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(1), 1, 1], [uint8(1), 1, 1]);
        assertTrue(arena.getBattle(battleId).phase == BattleArena.BattlePhase.AwaitingFinalize);
    }

    function test_handleTimeoutActiveBeforeWindowReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + arena.ACTIVE_WINDOW()); // not yet past
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);
    }

    function test_handleTimeoutActiveAfterWindowCancelsWithFullRefunds() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);
        uint256 supplyBefore = claw.totalSupply();
        uint256 total = STAKE_LOW + STAKE_LOW * 500 / 10_000;

        vm.warp(block.timestamp + arena.ACTIVE_WINDOW() + 1);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.StaleBattle);
        arena.handleTimeout(battleId); // permissionless

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Cancelled);
        assertEq(b.winner, address(0));
        // A dead server never costs a stake: both refunded in full, nothing burned.
        assertEq(claw.balanceOf(alice), aliceBalBefore + total);
        assertEq(claw.balanceOf(bob), bobBalBefore + total);
        assertEq(claw.totalSupply(), supplyBefore);
        assertEq(claw.balanceOf(address(arena)), 0);
        assertFalse(arena.teamInBattle(teamIdA));
        assertFalse(arena.teamInBattle(teamIdB));
        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
    }

    // ──────────── V3: draws ────────────

    function test_settleDrawRefundsBothWithNoFee() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        uint256 aliceBalBefore = claw.balanceOf(alice);
        uint256 bobBalBefore = claw.balanceOf(bob);
        uint256 devBalBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();
        uint256 arenaBalBefore = claw.balanceOf(address(arena));
        uint256 total = STAKE_LOW + STAKE_LOW * 500 / 10_000;

        _settleAndFinalize(battleId, address(0), [uint8(5), 6, 7], [uint8(8), 9, 10]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Settled);
        assertEq(b.winner, address(0));
        assertEq(b.proposedWinner, address(0));

        // Mutual refund incl. anti-grief; no protocol fee (no burn, no dev share).
        assertEq(claw.balanceOf(alice), aliceBalBefore + total);
        assertEq(claw.balanceOf(bob), bobBalBefore + total);
        assertEq(claw.balanceOf(devWallet), devBalBefore);
        assertEq(claw.totalSupply(), supplyBefore);
        assertEq(claw.balanceOf(address(arena)), arenaBalBefore - 2 * total);

        // Repair damage still applies to both teams, keyed by slot.
        TeamManager.Team memory teamA = tm.getTeam(teamIdA);
        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        assertEq(nft.getDamage(teamA.lobsterIds[0]), 5);
        assertEq(nft.getDamage(teamA.lobsterIds[2]), 7);
        assertEq(nft.getDamage(teamB.lobsterIds[0]), 8);
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 10);

        // Teams released.
        assertFalse(arena.teamInBattle(teamIdA));
        assertFalse(arena.teamInBattle(teamIdB));
        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
    }

    function test_settleDrawEmitsProposedAndSettledWithZeroWinner() public {
        (uint256 battleId,,) = _setupActiveBattle();

        uint256 expectedDeadline = block.timestamp + arena.disputeWindows(0);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleProposed(battleId, address(0), expectedDeadline, HASH_STATE, HASH_LOG);
        vm.prank(resolver);
        arena.settle(battleId, address(0), HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(5), 5, 5]);

        vm.warp(block.timestamp + arena.disputeWindows(0) + 1);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleSettled(battleId, address(0), 0, 0);
        arena.finalizeBattle(battleId);
    }

    function test_drawDisputeAdminCanNameWinnerAndRefundsBond() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.prank(resolver);
        arena.settle(battleId, address(0), HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(5), 5, 5]);

        uint256 bond = arena.disputeBonds(0);
        uint256 aliceBalBeforeDispute = claw.balanceOf(alice);
        _dispute(battleId, alice);
        assertEq(claw.balanceOf(alice), aliceBalBeforeDispute - bond);

        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        uint256 combinedPot = STAKE_LOW * 2;
        uint256 winnerPayout = combinedPot - combinedPot * 1000 / 10_000;

        // Admin overturns the draw in alice's favour → the disputer was right → bond back.
        vm.prank(admin);
        arena.adminResolveDispute(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Settled);
        assertEq(b.winner, alice);
        assertEq(claw.balanceOf(alice), aliceBalBeforeDispute + winnerPayout + antiGrief);
    }

    function test_adminResolveToDrawRefundsDisputerBondAndBothStakes() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        uint256 bobBalBeforeDispute = claw.balanceOf(bob);
        _dispute(battleId, bob);

        uint256 total = STAKE_LOW + STAKE_LOW * 500 / 10_000;
        vm.prank(admin);
        arena.adminResolveDispute(battleId, address(0), HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(5), 5, 5]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Settled);
        assertEq(b.winner, address(0));
        // bob: bond refunded + his full deposit back → net = before-dispute + total
        assertEq(claw.balanceOf(bob), bobBalBeforeDispute + total);
    }

    function test_adminResolveHashOnlyChangeRefundsBond() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        uint256 bond = arena.disputeBonds(0);
        uint256 bobBalBeforeDispute = claw.balanceOf(bob);
        _dispute(battleId, bob);

        // Same winner, same damage — only the turn-log commitment differs. BA-M2 (V3
        // extension): any change to the proposal means the disputer prevails.
        bytes32 otherLog = keccak256("turn-log-corrected");
        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        vm.prank(admin);
        arena.adminResolveDispute(battleId, alice, HASH_STATE, otherLog, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.turnLogHash, otherLog);
        assertEq(b.finalStateHash, HASH_STATE);
        // bob (loser) got his bond back plus his anti-grief.
        assertEq(claw.balanceOf(bob), bobBalBeforeDispute + antiGrief);
        assertEq(bond, arena.disputeBonds(0));
    }

    function test_adminResolveUnchangedProposalSlashesBond() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        uint256 bond = arena.disputeBonds(0);
        uint256 bobBalBeforeDispute = claw.balanceOf(bob);
        _dispute(battleId, bob);

        uint256 antiGrief = STAKE_LOW * 500 / 10_000;
        vm.expectEmit(true, true, false, true);
        emit BattleArena.DisputeBondSlashed(battleId, bob, bond);
        vm.prank(admin);
        arena.adminResolveDispute(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);

        // bob loses the bond, gets only anti-grief back.
        assertEq(claw.balanceOf(bob), bobBalBeforeDispute - bond + antiGrief);
    }

    function test_adminResolveZeroHashReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);
        _dispute(battleId, bob);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        vm.prank(admin);
        arena.adminResolveDispute(battleId, alice, bytes32(0), HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20]);
    }
}
