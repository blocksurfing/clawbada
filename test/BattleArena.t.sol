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

/// @notice Unit tests for BattleArena (2026-10-01 redesign): commit + consent ride in deposit(),
///         settle() applies damage and releases both teams, the money waits for a per-bracket
///         review window, a guardian can freeze a result, the Safe resolves it (or anyone expires
///         it after 72 h against the refund reserve), forfeits slash the anti-grief deposit, and a
///         draw pays the normal fee split across both sides.
contract BattleArenaTest is Test {
    // D-01: every test battle uses one known secret; the commitment binds it to the battle id.
    bytes32 internal constant SEED_SECRET = keccak256("clawbada-test-seed-secret");
    bytes32 internal constant SALT_A = bytes32("saltA");
    bytes32 internal constant SALT_B = bytes32("saltB");

    function _seedCommit(uint256 battleId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(battleId, SEED_SECRET));
    }

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
    address guardian = makeAddr("guardian");
    address funder = makeAddr("funder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address nobody = makeAddr("nobody");

    uint256 validDNA;
    uint256 constant STAKE_LOW = 2_500e18;
    uint256 constant STAKE_MID = 10_000e18;
    uint256 constant STAKE_HIGH = 50_000e18;
    // V3 settle commitments (any non-zero value)
    bytes32 constant HASH_STATE = keccak256("final-state");
    bytes32 constant HASH_LOG = keccak256("turn-log");

    function setUp() public {
        vm.startPrank(admin);

        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        claw = new ClawToken(admin, lpAddress, treasuryAddress);
        tm = new TeamManager(admin, address(nft));
        treasury = new Treasury(admin, devWallet);
        vrf = new BattleVRF(admin);

        arena = new BattleArena(admin, address(claw), address(nft), address(tm), address(treasury), address(vrf));

        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.LOCKER_ROLE(), address(tm));
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        nft.grantRole(nft.DAMAGE_ROLE(), address(arena));
        tm.grantRole(tm.ACTIVITY_ROLE(), address(arena));
        arena.grantRole(arena.MATCHMAKER_ROLE(), matchmaker);
        arena.grantRole(arena.RESOLVER_ROLE(), resolver);
        arena.grantRole(arena.GUARDIAN_ROLE(), guardian);
        treasury.setClawToken(address(claw));
        treasury.setAuthorized(address(arena), true);
        vrf.grantRole(vrf.OPERATOR_ROLE(), admin);

        vm.stopPrank();

        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37;
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);

        _fundPlayer(alice, 200_000e18);
        _fundPlayer(bob, 200_000e18);
        _fundPlayer(funder, 1_000_000e18);
    }

    // ──────────── Helpers ────────────

    function _fundPlayer(address player, uint256 amount) internal {
        vm.prank(lpAddress);
        claw.transfer(player, amount);
    }

    function _ag(uint256 stake) internal pure returns (uint256) {
        return stake * 500 / 10_000;
    }

    function _commitHash(uint256 battleId, address player, uint256 teamId, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(battleId, player, teamId, salt));
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

    function _createBattleAt(uint256 stake, uint8 powerA, uint8 powerB) internal returns (uint256 battleId) {
        vm.prank(matchmaker);
        battleId = arena.createBattle(alice, bob, stake, powerA, powerB);
    }

    function _createBattle() internal returns (uint256) {
        // Power 3 == three Evolved lobsters (the standard _createEvolvedTeam composition).
        return _createBattleAt(STAKE_LOW, 3, 3);
    }

    /// @dev Approve exactly stake + 5% and deposit with full consent (any opponent power).
    function _deposit(uint256 battleId, address player, bytes32 commit) internal {
        uint256 stake = arena.getBattle(battleId).stakeAmount;
        vm.prank(player);
        claw.approve(address(arena), stake + _ag(stake));
        vm.prank(player);
        arena.deposit(battleId, stake, 9, commit);
    }

    function _depositBoth(uint256 battleId, uint256 teamIdA, uint256 teamIdB) internal {
        _deposit(battleId, alice, _commitHash(battleId, alice, teamIdA, SALT_A));
        _deposit(battleId, bob, _commitHash(battleId, bob, teamIdB, SALT_B));
    }

    function _reveal(uint256 battleId, uint256 teamIdA, uint256 teamIdB) internal {
        // F5-01: team reveal is atomic and resolver-submitted.
        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, SALT_A, teamIdB, SALT_B, _seedCommit(battleId));
    }

    /// @dev Both deposited (with commits) → TeamReveal.
    function _setupRevealPhase() internal returns (uint256 battleId, uint256 teamIdA, uint256 teamIdB) {
        teamIdA = _createEvolvedTeam(alice);
        teamIdB = _createEvolvedTeam(bob);
        battleId = _createBattle();
        _depositBoth(battleId, teamIdA, teamIdB);
    }

    function _setupActiveBattleAt(uint256 stake) internal returns (uint256 battleId, uint256 teamIdA, uint256 teamIdB) {
        teamIdA = _createEvolvedTeam(alice);
        teamIdB = _createEvolvedTeam(bob);
        battleId = _createBattleAt(stake, 3, 3);
        _depositBoth(battleId, teamIdA, teamIdB);
        _reveal(battleId, teamIdA, teamIdB);
    }

    function _setupActiveBattle() internal returns (uint256, uint256, uint256) {
        return _setupActiveBattleAt(STAKE_LOW);
    }

    /// @dev Settle with the standard damage arrays (A: 10/5/8, B: 30/25/35).
    function _settle(uint256 battleId, address winner, address forfeiter) internal {
        vm.prank(resolver);
        arena.settle(
            battleId, winner, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35], SEED_SECRET, forfeiter
        );
    }

    /// @dev settle → warp past the review window → finalize.
    function _settleAndFinalize(uint256 battleId, address winner, uint8[3] memory damageA, uint8[3] memory damageB)
        internal
    {
        vm.prank(resolver);
        arena.settle(battleId, winner, HASH_STATE, HASH_LOG, damageA, damageB, SEED_SECRET, address(0));
        vm.warp(arena.getBattle(battleId).payoutDeadline + 1);
        arena.finalizeBattle(battleId);
    }

    function _settleAndFreeze(uint256 battleId, address winner) internal {
        _settle(battleId, winner, address(0));
        vm.prank(guardian);
        arena.freeze(battleId);
    }

    function _fundReserve(uint256 amount) internal {
        vm.prank(funder);
        claw.approve(address(arena), amount);
        vm.prank(funder);
        arena.fundReserve(amount);
    }

    /// @dev CLAW the arena should be holding for players, derived from every battle's phase.
    function _escrowHeld() internal view returns (uint256 total) {
        uint256 n = arena.nextBattleId();
        for (uint256 id = 1; id < n; id++) {
            BattleArena.Battle memory b = arena.getBattle(id);
            uint256 perSide = b.stakeAmount + _ag(b.stakeAmount);
            if (b.phase == BattleArena.BattlePhase.Deposit) {
                total += (b.depositA ? perSide : 0) + (b.depositB ? perSide : 0);
            } else if (
                b.phase == BattleArena.BattlePhase.TeamReveal || b.phase == BattleArena.BattlePhase.Active
                    || b.phase == BattleArena.BattlePhase.AwaitingFinalize || b.phase == BattleArena.BattlePhase.Frozen
            ) {
                total += 2 * perSide;
            }
        }
    }

    /// @dev Token conservation: the arena holds exactly the open escrow plus the refund reserve.
    function _assertConservation() internal view {
        assertEq(claw.balanceOf(address(arena)), _escrowHeld() + arena.refundReserve(), "arena == escrow + reserve");
        assertEq(claw.balanceOf(address(treasury)), 0, "treasury holds nothing (burns + forwards)");
    }

    /// @dev Treasury.processFee(amount): 85% burned, 15% to the dev wallet.
    function _assertTreasuryReceived(uint256 devBefore, uint256 supplyBefore, uint256 amount) internal view {
        uint256 burned = amount * 8500 / 10_000;
        assertEq(claw.balanceOf(devWallet), devBefore + amount - burned, "dev got 15%");
        assertEq(claw.totalSupply(), supplyBefore - burned, "85% burned");
    }

    function _expectPhase(uint256 battleId, BattleArena.BattlePhase expected) internal view {
        assertEq(uint8(arena.getBattle(battleId).phase), uint8(expected), "phase");
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
        assertEq(arena.refundReserve(), 0);
        assertEq(arena.GUARDIAN_ROLE(), keccak256("GUARDIAN_ROLE"));
        assertEq(arena.TEAM_REVEAL_WINDOW(), 20 seconds);
        assertEq(arena.REVEAL_GRACE(), 2 minutes);
        assertEq(arena.FREEZE_LONG_STOP(), 72 hours);
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

    function test_reviewWindowsDefaultPerBracket() public view {
        assertEq(arena.reviewWindows(0), 5 minutes);
        assertEq(arena.reviewWindows(1), 30 minutes);
        assertEq(arena.reviewWindows(2), 1 hours);
    }

    /// @dev Phase numbers are read off-chain; TeamCommit keeps slot 2 although it is unreachable.
    function test_phaseNumbersAreStable() public pure {
        assertEq(uint8(BattleArena.BattlePhase.TeamCommit), 2);
        assertEq(uint8(BattleArena.BattlePhase.TeamReveal), 3);
        assertEq(uint8(BattleArena.BattlePhase.Active), 4);
        assertEq(uint8(BattleArena.BattlePhase.AwaitingFinalize), 5);
        assertEq(uint8(BattleArena.BattlePhase.Settled), 6);
        assertEq(uint8(BattleArena.BattlePhase.Cancelled), 7);
        assertEq(uint8(BattleArena.BattlePhase.Frozen), 8);
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
        assertEq(b.phaseDeadline, block.timestamp + arena.DEPOSIT_WINDOW());
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

    // ──────────── deposit (stake + anti-grief + team commit + consent) ────────────

    function test_depositPlayerA() public {
        uint256 battleId = _createBattle();
        uint256 total = STAKE_LOW + _ag(STAKE_LOW);
        uint256 balBefore = claw.balanceOf(alice);
        bytes32 commitA = _commitHash(battleId, alice, 1, SALT_A);

        vm.prank(alice);
        claw.approve(address(arena), total);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.StakeDeposited(battleId, alice);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.TeamCommitted(battleId, alice);
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW, 9, commitA);

        assertEq(claw.balanceOf(alice), balBefore - total);
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.depositA);
        assertFalse(b.depositB);
        assertEq(b.teamCommitA, commitA, "commit stored with the deposit");
        assertEq(b.teamCommitB, bytes32(0));
        assertTrue(b.phase == BattleArena.BattlePhase.Deposit); // waiting for B
        _assertConservation();
    }

    /// @dev D-13: there is no commit phase — both deposits go straight to TeamReveal with the 20 s clock.
    function test_depositBothTransitionsStraightToTeamReveal() public {
        uint256 battleId = _createBattle();
        vm.warp(block.timestamp + 30);
        _deposit(battleId, alice, _commitHash(battleId, alice, 1, SALT_A));
        _expectPhase(battleId, BattleArena.BattlePhase.Deposit);
        vm.warp(block.timestamp + 10);
        _deposit(battleId, bob, _commitHash(battleId, bob, 2, SALT_B));

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.depositA);
        assertTrue(b.depositB);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.TeamReveal));
        assertEq(b.phaseDeadline, block.timestamp + 20 seconds, "20 s reveal clock from the second deposit");
        assertEq(b.teamCommitB, _commitHash(battleId, bob, 2, SALT_B));
        _assertConservation();
    }

    function test_depositAlreadyDepositedReverts() public {
        uint256 battleId = _createBattle();
        uint256 total = STAKE_LOW + _ag(STAKE_LOW);

        vm.prank(alice);
        claw.approve(address(arena), total * 2);
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW, 3, bytes32("c1"));

        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyDeposited.selector, battleId));
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW, 3, bytes32("c2"));
        assertEq(arena.getBattle(battleId).teamCommitA, bytes32("c1"), "a second deposit cannot swap the commit");
    }

    function test_depositWrongPhaseReverts() public {
        (uint256 battleId,,) = _setupRevealPhase();

        vm.prank(alice);
        claw.approve(address(arena), STAKE_LOW + _ag(STAKE_LOW));
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Deposit,
                BattleArena.BattlePhase.TeamReveal
            )
        );
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW, 3, bytes32("c"));
    }

    function test_depositNonParticipantReverts() public {
        uint256 battleId = _createBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotBattleParticipant.selector, battleId));
        vm.prank(nobody);
        arena.deposit(battleId, STAKE_LOW, 3, bytes32("c"));
    }

    function test_depositAfterDeadlineReverts() public {
        uint256 battleId = _createBattle();
        vm.warp(block.timestamp + arena.DEPOSIT_WINDOW() + 1);
        vm.prank(alice);
        claw.approve(address(arena), STAKE_LOW + _ag(STAKE_LOW));
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW, 3, bytes32("c"));
    }

    function test_depositZeroCommitReverts() public {
        uint256 battleId = _createBattle();
        vm.prank(alice);
        claw.approve(address(arena), STAKE_LOW + _ag(STAKE_LOW));
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW, 9, bytes32(0));
    }

    /// @dev D-08: the stake must be exactly the one the player agreed to — higher or lower.
    function test_depositConsentStakeMismatchReverts() public {
        uint256 battleId = _createBattle();
        vm.prank(alice);
        claw.approve(address(arena), type(uint256).max);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.ConsentMismatch.selector, battleId, STAKE_LOW, uint8(3)));
        vm.prank(alice);
        arena.deposit(battleId, STAKE_MID, 9, bytes32("c"));

        vm.expectRevert(abi.encodeWithSelector(BattleArena.ConsentMismatch.selector, battleId, STAKE_LOW, uint8(3)));
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW - 1, 9, bytes32("c"));

        assertFalse(arena.getBattle(battleId).depositA);
        assertEq(claw.balanceOf(address(arena)), 0, "nothing escrowed on a refused deposit");
    }

    /// @dev D-08: each side is checked against the OTHER side's power snapshot.
    function test_depositConsentOpponentPowerTooHighReverts_sideA() public {
        uint256 battleId = _createBattleAt(STAKE_LOW, 3, 5); // A=3, B=5
        vm.prank(alice);
        claw.approve(address(arena), type(uint256).max);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.ConsentMismatch.selector, battleId, STAKE_LOW, uint8(5)));
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW, 4, bytes32("c"));

        // Exact boundary: maxOpponentPower == opponent's power is accepted.
        vm.prank(alice);
        arena.deposit(battleId, STAKE_LOW, 5, bytes32("c"));
        assertTrue(arena.getBattle(battleId).depositA);
    }

    function test_depositConsentOpponentPowerTooHighReverts_sideB() public {
        uint256 battleId = _createBattleAt(STAKE_LOW, 6, 3); // A=6, B=3
        vm.prank(bob);
        claw.approve(address(arena), type(uint256).max);

        // Bob's own power (3) is irrelevant: his opponent is Power 6.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.ConsentMismatch.selector, battleId, STAKE_LOW, uint8(6)));
        vm.prank(bob);
        arena.deposit(battleId, STAKE_LOW, 5, bytes32("c"));

        vm.prank(bob);
        arena.deposit(battleId, STAKE_LOW, 6, bytes32("c"));
        assertTrue(arena.getBattle(battleId).depositB);
    }

    /// @dev Consent is a ceiling: a weaker opponent than agreed is fine.
    function test_depositConsentWeakerOpponentAccepted() public {
        uint256 battleId = _createBattleAt(STAKE_MID, 3, 3);
        vm.prank(alice);
        claw.approve(address(arena), STAKE_MID + _ag(STAKE_MID));
        vm.prank(alice);
        arena.deposit(battleId, STAKE_MID, 9, bytes32("c"));
        assertEq(claw.balanceOf(address(arena)), STAKE_MID + _ag(STAKE_MID));
    }

    // ──────────── revealTeams ────────────

    function test_revealTeamValidatesHash() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();

        // F5-01: atomic resolver-submitted reveal. A wrong salt for either side reverts.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, bytes32("wrong"), teamIdB, SALT_B, _seedCommit(battleId));

        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, SALT_A, teamIdB, bytes32("wrong"), _seedCommit(battleId));

        _reveal(battleId, teamIdA, teamIdB);
        _expectPhase(battleId, BattleArena.BattlePhase.Active);
    }

    function test_revealTeamValidatesEligibility() public {
        uint256 battleId = _createBattle();

        // A team with Base tier lobsters (not Evolved)
        vm.startPrank(admin);
        uint256 lob1 = nft.mint(alice, validDNA, false);
        uint256 lob2 = nft.mint(alice, validDNA, false);
        uint256 lob3 = nft.mint(alice, validDNA, false);
        vm.stopPrank();
        vm.prank(alice);
        uint256 baseTeam = tm.createTeam([lob1, lob2, lob3]);
        uint256 teamIdB = _createEvolvedTeam(bob);

        _depositBoth(battleId, baseTeam, teamIdB);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.LobsterTierTooLow.selector, lob1, 1, 0));
        _reveal(battleId, baseTeam, teamIdB);
    }

    function test_revealTeamLocksTeam() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();
        _reveal(battleId, teamIdA, teamIdB);

        assertTrue(arena.teamInBattle(teamIdA));
        assertTrue(tm.isTeamActive(teamIdA));
        assertTrue(arena.teamInBattle(teamIdB));
        assertTrue(tm.isTeamActive(teamIdB));
    }

    function test_revealAtTwentySecondBoundary() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();
        uint256 deadline = arena.getBattle(battleId).phaseDeadline;

        uint256 snap = vm.snapshotState();
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        _reveal(battleId, teamIdA, teamIdB);
        vm.revertToState(snap);

        vm.warp(deadline);
        _reveal(battleId, teamIdA, teamIdB);
        _expectPhase(battleId, BattleArena.BattlePhase.Active);
    }

    // ──────────── settle: result recorded, damage + release immediate ────────────

    function test_settleAppliesDamageAndReleasesTeamsImmediately() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();
        uint256 arenaBefore = claw.balanceOf(address(arena));

        _settle(battleId, alice, address(0));

        // Phase is "in review" — money waits, lobsters do not.
        _expectPhase(battleId, BattleArena.BattlePhase.AwaitingFinalize);
        assertEq(claw.balanceOf(address(arena)), arenaBefore, "no money moves at settle");

        TeamManager.Team memory teamA = tm.getTeam(teamIdA);
        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        assertEq(nft.getDamage(teamA.lobsterIds[0]), 10);
        assertEq(nft.getDamage(teamA.lobsterIds[1]), 5);
        assertEq(nft.getDamage(teamA.lobsterIds[2]), 8);
        assertEq(nft.getDamage(teamB.lobsterIds[0]), 30);
        assertEq(nft.getDamage(teamB.lobsterIds[1]), 25);
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 35);

        assertFalse(arena.teamInBattle(teamIdA));
        assertFalse(arena.teamInBattle(teamIdB));
        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
        _assertConservation();
    }

    /// @dev finalize does not apply the damage a second time.
    function test_finalizeDoesNotReapplyDamage() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();
        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        TeamManager.Team memory teamA = tm.getTeam(teamIdA);
        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        assertEq(nft.getDamage(teamA.lobsterIds[0]), 10);
        assertEq(nft.getDamage(teamA.lobsterIds[2]), 8);
        assertEq(nft.getDamage(teamB.lobsterIds[0]), 30);
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 35);
        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
    }

    /// @dev A released team is really free: its owner can disband it while the payout is in review.
    function test_releasedTeamCanBeDisbandedDuringReview() public {
        (uint256 battleId, uint256 teamIdA,) = _setupActiveBattle();
        _settle(battleId, bob, address(0));

        vm.prank(alice);
        tm.disbandTeam(teamIdA);
        assertFalse(tm.teamExists(teamIdA));

        // ...and the battle still pays out.
        vm.warp(arena.getBattle(battleId).payoutDeadline + 1);
        arena.finalizeBattle(battleId);
        _expectPhase(battleId, BattleArena.BattlePhase.Settled);
        _assertConservation();
    }

    /// @dev The headline behaviour: a result never locks a lobster. Both teams can enter a NEW
    ///      battle while the first one's money is still in review.
    function test_releasedTeamsCanEnterNewBattleWhileFirstInReview() public {
        (uint256 first, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();
        _settle(first, alice, address(0));

        uint256 second = _createBattle();
        _depositBoth(second, teamIdA, teamIdB);
        _reveal(second, teamIdA, teamIdB);

        _expectPhase(second, BattleArena.BattlePhase.Active);
        _expectPhase(first, BattleArena.BattlePhase.AwaitingFinalize);
        assertTrue(arena.teamInBattle(teamIdA));
        assertTrue(tm.isTeamActive(teamIdA));
        _assertConservation();

        // The first battle's payout does NOT release the teams that are now in the second battle.
        vm.warp(arena.getBattle(first).payoutDeadline + 1);
        arena.finalizeBattle(first);
        assertTrue(arena.teamInBattle(teamIdA), "finalize of battle 1 must not unlock battle 2's team");
        assertTrue(tm.isTeamActive(teamIdB));
        _assertConservation();
    }

    function test_releasedTeamsCanEnterNewBattleWhileFirstFrozen() public {
        (uint256 first, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();
        _settleAndFreeze(first, alice);

        uint256 second = _createBattle();
        _depositBoth(second, teamIdA, teamIdB);
        _reveal(second, teamIdA, teamIdB);
        _expectPhase(second, BattleArena.BattlePhase.Active);
        _expectPhase(first, BattleArena.BattlePhase.Frozen);
        _assertConservation();

        // Resolving the frozen battle leaves the second battle's locks alone.
        vm.prank(admin);
        arena.resolveFrozen(first, alice, address(0), false);
        assertTrue(arena.teamInBattle(teamIdA));
        assertTrue(arena.teamInBattle(teamIdB));
        _assertConservation();
    }

    function test_settleStoresHashesAndProposal() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.prank(resolver);
        arena.settle(battleId, bob, HASH_STATE, HASH_LOG, [uint8(20), 21, 22], [uint8(1), 2, 3], SEED_SECRET, alice);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.AwaitingFinalize);
        assertEq(b.proposedWinner, bob);
        assertEq(b.proposedForfeiter, alice);
        assertEq(b.winner, address(0), "winner set only at payout");
        assertEq(b.finalStateHash, HASH_STATE);
        assertEq(b.turnLogHash, HASH_LOG);
        assertEq(b.proposedDamageA[0], 20);
        assertEq(b.proposedDamageA[2], 22);
        assertEq(b.proposedDamageB[0], 1);
        assertEq(b.proposedDamageB[2], 3);
        assertEq(b.payoutDeadline, block.timestamp + arena.reviewWindows(0));
    }

    function test_settleEmitsEvent() public {
        (uint256 battleId,,) = _setupActiveBattle();

        uint256 combinedPot = STAKE_LOW * 2;
        uint256 protocolFee = combinedPot * 1000 / 10_000;
        uint256 winnerPayout = combinedPot - protocolFee;

        uint256 expectedDeadline = block.timestamp + arena.reviewWindows(0);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleProposed(battleId, alice, expectedDeadline, HASH_STATE, HASH_LOG);
        _settle(battleId, alice, address(0));

        vm.warp(expectedDeadline + 1);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleSettled(battleId, alice, winnerPayout, protocolFee);
        arena.finalizeBattle(battleId);
    }

    /// @dev Review window is chosen by the battle's stake bracket.
    function test_reviewWindowPerBracket() public {
        uint256[3] memory stakes = [STAKE_LOW, STAKE_MID, STAKE_HIGH];
        uint256[3] memory windows = [uint256(5 minutes), 30 minutes, 1 hours];
        for (uint256 i = 0; i < 3; i++) {
            (uint256 battleId,,) = _setupActiveBattleAt(stakes[i]);
            _settle(battleId, alice, address(0));
            assertEq(arena.getBattle(battleId).payoutDeadline, block.timestamp + windows[i], "bracket window");
        }
        _assertConservation();
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

    function test_settleDamageCapsAt100WithoutOverflow() public {
        (uint256 battleId,, uint256 teamIdB) = _setupActiveBattle();

        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        vm.startPrank(admin);
        nft.grantRole(nft.DAMAGE_ROLE(), admin);
        nft.setDamage(teamB.lobsterIds[0], 70);
        nft.setDamage(teamB.lobsterIds[1], 90);
        nft.setDamage(teamB.lobsterIds[2], 60);
        vm.stopPrank();

        _settleAndFinalize(battleId, alice, [uint8(5), 5, 5], [uint8(40), 40, 40]);

        assertEq(nft.getDamage(teamB.lobsterIds[0]), 100); // 70 + 40 → capped
        assertEq(nft.getDamage(teamB.lobsterIds[1]), 100); // 90 + 40 → capped
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 100); // exactly 100
    }

    // ──────────── settle: guards ────────────

    function test_settleRevertsInDepositPhase() public {
        uint256 battleId = _createBattle();
        _deposit(battleId, alice, bytes32("c"));

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.Active, BattleArena.BattlePhase.Deposit
            )
        );
        _settle(battleId, alice, address(0));
    }

    function test_settleRevertsInTeamRevealPhase() public {
        (uint256 battleId,,) = _setupRevealPhase();

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.Active, BattleArena.BattlePhase.TeamReveal
            )
        );
        _settle(battleId, alice, address(0));
    }

    function test_settleByNonResolverReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, arena.RESOLVER_ROLE())
        );
        vm.prank(nobody);
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35], SEED_SECRET, address(0));
    }

    function test_settleWithInvalidWinnerReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidWinner.selector, battleId));
        _settle(battleId, nobody, address(0));
    }

    function test_settleDrawWithForfeiterReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidForfeiter.selector, battleId));
        _settle(battleId, address(0), bob);
    }

    function test_settleForfeiterEqualsWinnerReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidForfeiter.selector, battleId));
        _settle(battleId, alice, alice);
    }

    function test_settleNonParticipantForfeiterReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidForfeiter.selector, battleId));
        _settle(battleId, alice, nobody);
    }

    function test_settleWhenAlreadySettledReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, address(0));

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Active,
                BattleArena.BattlePhase.AwaitingFinalize
            )
        );
        _settle(battleId, alice, address(0));

        vm.warp(arena.getBattle(battleId).payoutDeadline + 1);
        arena.finalizeBattle(battleId);

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.Active, BattleArena.BattlePhase.Settled
            )
        );
        _settle(battleId, alice, address(0));
    }

    function test_settleZeroFinalStateHashReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, alice, bytes32(0), HASH_LOG, [uint8(1), 1, 1], [uint8(1), 1, 1], SEED_SECRET, address(0));
    }

    function test_settleZeroTurnLogHashReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSettlementHash.selector, battleId));
        vm.prank(resolver);
        arena.settle(battleId, alice, HASH_STATE, bytes32(0), [uint8(1), 1, 1], [uint8(1), 1, 1], SEED_SECRET, address(0));
    }

    function test_settleAfterActiveWindowReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + arena.ACTIVE_WINDOW() + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        _settle(battleId, alice, address(0));
    }

    function test_settleAtActiveWindowBoundarySucceeds() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + arena.ACTIVE_WINDOW()); // == deadline is still in time
        _settle(battleId, alice, address(0));
        _expectPhase(battleId, BattleArena.BattlePhase.AwaitingFinalize);
    }

    // ──────────── finalizeBattle: decided ────────────

    function test_finalizeWinnerPayoutAndFeeSplit() public {
        (uint256 battleId,,) = _setupActiveBattle();
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        // pot 5,000; fee 500 (425 burned, 75 dev); winner 4,500 + own 125; loser own 125.
        assertEq(claw.balanceOf(alice), aliceBefore + 4_500e18 + 125e18);
        assertEq(claw.balanceOf(bob), bobBefore + 125e18);
        _assertTreasuryReceived(devBefore, supplyBefore, 500e18);
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, alice);
        _assertConservation();
    }

    function test_finalizeBeforeDeadlineReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, address(0));
        uint256 deadline = arena.getBattle(battleId).payoutDeadline;

        vm.expectRevert(abi.encodeWithSelector(BattleArena.ReviewWindowOpen.selector, battleId, deadline));
        arena.finalizeBattle(battleId);

        vm.warp(deadline); // the deadline itself is still inside the window
        vm.expectRevert(abi.encodeWithSelector(BattleArena.ReviewWindowOpen.selector, battleId, deadline));
        arena.finalizeBattle(battleId);

        vm.warp(deadline + 1);
        vm.prank(nobody); // permissionless
        arena.finalizeBattle(battleId);
        _expectPhase(battleId, BattleArena.BattlePhase.Settled);
    }

    function test_finalizeTwiceReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFinalize(battleId, alice, [uint8(1), 1, 1], [uint8(1), 1, 1]);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.AwaitingFinalize,
                BattleArena.BattlePhase.Settled
            )
        );
        arena.finalizeBattle(battleId);
    }

    // ──────────── forfeiter ────────────

    /// @dev D-15: the forfeiting loser's 5% goes to the Treasury with the fee.
    function test_forfeiterLosesAntiGriefToTreasury() public {
        (uint256 battleId,,) = _setupActiveBattle();
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        _settle(battleId, alice, bob);
        vm.warp(arena.getBattle(battleId).payoutDeadline + 1);

        vm.expectEmit(true, true, false, true);
        emit BattleArena.AntiGriefSlashed(battleId, bob, 125e18);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleSettled(battleId, alice, 4_500e18, 500e18);
        arena.finalizeBattle(battleId);

        assertEq(claw.balanceOf(alice), aliceBefore + 4_500e18 + 125e18, "winner unaffected by the forfeit");
        assertEq(claw.balanceOf(bob), bobBefore, "forfeiter gets nothing back");
        _assertTreasuryReceived(devBefore, supplyBefore, 500e18 + 125e18);
        _assertConservation();
    }

    /// @dev Mirror: player A as the forfeiting loser.
    function test_forfeiterSideA() public {
        (uint256 battleId,,) = _setupActiveBattleAt(STAKE_MID);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        _settle(battleId, bob, alice);
        vm.warp(arena.getBattle(battleId).payoutDeadline + 1);
        arena.finalizeBattle(battleId);

        // pot 20,000; fee 2,000; slash 500.
        assertEq(claw.balanceOf(bob), bobBefore + 18_000e18 + 500e18);
        assertEq(claw.balanceOf(alice), aliceBefore);
        _assertTreasuryReceived(devBefore, supplyBefore, 2_000e18 + 500e18);
        _assertConservation();
    }

    // ──────────── draws (D-03) ────────────

    /// @dev A draw now pays the normal fee, split: each side pays 10% of its own stake.
    function test_settleDrawChargesEachSideTenPercent() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        uint256 sideFee = STAKE_LOW * 1000 / 10_000; // 250
        uint256 drawFee = 2 * sideFee; // 500 == the fee of a decided battle
        assertEq(drawFee, (2 * STAKE_LOW) * 1000 / 10_000);

        vm.prank(resolver);
        arena.settle(battleId, address(0), HASH_STATE, HASH_LOG, [uint8(5), 6, 7], [uint8(8), 9, 10], SEED_SECRET, address(0));
        vm.warp(arena.getBattle(battleId).payoutDeadline + 1);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleSettled(battleId, address(0), 0, drawFee);
        arena.finalizeBattle(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Settled);
        assertEq(b.winner, address(0));
        assertEq(b.proposedWinner, address(0));

        // Each side: stake − 10% + own 5% = 2,375.
        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW - sideFee + _ag(STAKE_LOW));
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW - sideFee + _ag(STAKE_LOW));
        _assertTreasuryReceived(devBefore, supplyBefore, drawFee);

        // Repair damage still applies to both teams, keyed by slot; teams released.
        TeamManager.Team memory teamA = tm.getTeam(teamIdA);
        TeamManager.Team memory teamB = tm.getTeam(teamIdB);
        assertEq(nft.getDamage(teamA.lobsterIds[0]), 5);
        assertEq(nft.getDamage(teamA.lobsterIds[2]), 7);
        assertEq(nft.getDamage(teamB.lobsterIds[0]), 8);
        assertEq(nft.getDamage(teamB.lobsterIds[2]), 10);
        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
        _assertConservation();
    }

    function test_settleDrawEmitsProposedWithZeroWinner() public {
        (uint256 battleId,,) = _setupActiveBattle();

        uint256 expectedDeadline = block.timestamp + arena.reviewWindows(0);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleProposed(battleId, address(0), expectedDeadline, HASH_STATE, HASH_LOG);
        _settle(battleId, address(0), address(0));
    }

    // ──────────── freeze ────────────

    function test_freezeByGuardianMovesNoTokens() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, address(0));

        uint256 arenaBefore = claw.balanceOf(address(arena));
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.warp(block.timestamp + 60);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleFrozen(battleId, guardian);
        vm.prank(guardian);
        arena.freeze(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Frozen));
        assertEq(uint256(b.frozenAt), block.timestamp);
        assertEq(claw.balanceOf(address(arena)), arenaBefore);
        assertEq(claw.balanceOf(alice), aliceBefore);
        assertEq(claw.balanceOf(bob), bobBefore);
        assertEq(claw.balanceOf(devWallet), devBefore);
        assertEq(claw.totalSupply(), supplyBefore);
        _assertConservation();

        // Frozen money cannot be paid by finalize any more.
        vm.warp(b.payoutDeadline + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.AwaitingFinalize,
                BattleArena.BattlePhase.Frozen
            )
        );
        arena.finalizeBattle(battleId);
    }

    function test_freezeByAdmin() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, address(0));
        vm.prank(admin);
        arena.freeze(battleId);
        _expectPhase(battleId, BattleArena.BattlePhase.Frozen);
    }

    function test_freezeByRandomOrResolverReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, address(0));

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, arena.GUARDIAN_ROLE())
        );
        vm.prank(nobody);
        arena.freeze(battleId);

        // The resolver that proposed the result cannot freeze it either.
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, resolver, arena.GUARDIAN_ROLE())
        );
        vm.prank(resolver);
        arena.freeze(battleId);

        // Nor can a player.
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, arena.GUARDIAN_ROLE())
        );
        vm.prank(bob);
        arena.freeze(battleId);
    }

    function test_freezeAfterDeadlineReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, address(0));
        uint256 deadline = arena.getBattle(battleId).payoutDeadline;

        uint256 snap = vm.snapshotState();
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.ReviewWindowClosed.selector, battleId, deadline));
        vm.prank(guardian);
        arena.freeze(battleId);
        vm.revertToState(snap);

        // The deadline second itself can still freeze.
        vm.warp(deadline);
        vm.prank(guardian);
        arena.freeze(battleId);
        _expectPhase(battleId, BattleArena.BattlePhase.Frozen);
    }

    function test_freezeWrongPhaseReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.AwaitingFinalize,
                BattleArena.BattlePhase.Active
            )
        );
        vm.prank(guardian);
        arena.freeze(battleId);

        _settleAndFreeze(battleId, alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.AwaitingFinalize,
                BattleArena.BattlePhase.Frozen
            )
        );
        vm.prank(guardian);
        arena.freeze(battleId); // no re-freeze to restart the long-stop clock
    }

    // ──────────── resolveFrozen ────────────

    function test_resolveFrozenCorrectedWinner() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice); // proposed alice; the Safe finds bob won
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.expectEmit(true, true, false, true);
        emit BattleArena.FrozenResolved(battleId, bob, false);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleSettled(battleId, bob, 4_500e18, 500e18);
        vm.prank(admin);
        arena.resolveFrozen(battleId, bob, address(0), false);

        assertEq(claw.balanceOf(bob), bobBefore + 4_500e18 + 125e18);
        assertEq(claw.balanceOf(alice), aliceBefore + 125e18);
        _assertTreasuryReceived(devBefore, supplyBefore, 500e18);
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, bob);
        _assertConservation();
    }

    /// @dev Upholding the proposal pays exactly what finalize would have.
    function test_resolveFrozenSameResultPaysLikeFinalize() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        vm.prank(admin);
        arena.resolveFrozen(battleId, alice, address(0), false);

        assertEq(claw.balanceOf(alice), aliceBefore + 4_500e18 + 125e18);
        assertEq(claw.balanceOf(bob), bobBefore + 125e18);
        _assertConservation();
    }

    function test_resolveFrozenWithForfeiterSlashes() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.expectEmit(true, true, false, true);
        emit BattleArena.AntiGriefSlashed(battleId, bob, 125e18);
        vm.prank(admin);
        arena.resolveFrozen(battleId, alice, bob, false);

        assertEq(claw.balanceOf(alice), aliceBefore + 4_500e18 + 125e18, "winner: pot minus fee, plus own 5%");
        assertEq(claw.balanceOf(bob), bobBefore);
        _assertTreasuryReceived(devBefore, supplyBefore, 625e18);
        _assertConservation();
    }

    /// @dev The Safe can turn a proposed draw into a decided result (was: disputed draw → winner named).
    function test_resolveFrozenDrawToWinner() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, address(0));
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        vm.prank(admin);
        arena.resolveFrozen(battleId, alice, address(0), false);

        assertEq(claw.balanceOf(alice), aliceBefore + 4_500e18 + 125e18);
        assertEq(claw.balanceOf(bob), bobBefore + 125e18, "loser: only the 5% back");
        assertEq(arena.getBattle(battleId).winner, alice);
        _assertConservation();
    }

    /// @dev ...and a proposed win into a draw (draw fee applies).
    function test_resolveFrozenToDraw() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.expectEmit(true, true, false, true);
        emit BattleArena.FrozenResolved(battleId, address(0), false);
        vm.prank(admin);
        arena.resolveFrozen(battleId, address(0), address(0), false);

        assertEq(claw.balanceOf(alice), aliceBefore + 2_375e18);
        assertEq(claw.balanceOf(bob), bobBefore + 2_375e18);
        _assertTreasuryReceived(devBefore, supplyBefore, 500e18);
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, address(0));
        _assertConservation();
    }

    function test_resolveFrozenRefundBoth() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.expectEmit(true, true, false, true);
        emit BattleArena.FrozenResolved(battleId, address(0), true);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.BattleSettled(battleId, address(0), 0, 0);
        vm.prank(admin);
        // winner/forfeiter are ignored on a refund, even if they would be invalid
        arena.resolveFrozen(battleId, nobody, nobody, true);

        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW + _ag(STAKE_LOW));
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW + _ag(STAKE_LOW));
        assertEq(claw.balanceOf(devWallet), devBefore, "no fee on a refund");
        assertEq(claw.totalSupply(), supplyBefore, "nothing burned on a refund");
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, address(0));
        _assertConservation();
    }

    function test_resolveFrozenNonAdminReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, arena.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(guardian);
        arena.resolveFrozen(battleId, bob, address(0), false);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, resolver, arena.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(resolver);
        arena.resolveFrozen(battleId, bob, address(0), true);
    }

    function test_resolveFrozenWrongPhaseReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, address(0)); // in review, not frozen

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Frozen,
                BattleArena.BattlePhase.AwaitingFinalize
            )
        );
        vm.prank(admin);
        arena.resolveFrozen(battleId, alice, address(0), true);
    }

    function test_resolveFrozenInvalidResultReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidWinner.selector, battleId));
        arena.resolveFrozen(battleId, nobody, address(0), false);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidForfeiter.selector, battleId));
        arena.resolveFrozen(battleId, address(0), alice, false);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidForfeiter.selector, battleId));
        arena.resolveFrozen(battleId, alice, alice, false);
        vm.stopPrank();
    }

    // ──────────── expireFrozen (72 h long-stop) ────────────

    function test_expireFrozenBeforeLongStopReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);
        uint256 availableAt = uint256(arena.getBattle(battleId).frozenAt) + 72 hours;

        vm.expectRevert(abi.encodeWithSelector(BattleArena.LongStopNotReached.selector, battleId, availableAt));
        arena.expireFrozen(battleId);

        vm.warp(availableAt); // exactly 72 h is not yet past it
        vm.expectRevert(abi.encodeWithSelector(BattleArena.LongStopNotReached.selector, battleId, availableAt));
        arena.expireFrozen(battleId);
    }

    /// @dev Reserve covers it: the held stakes are burned and the players are paid from the reserve.
    function test_expireFrozenWithFundedReserveBurnsStakes() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _fundReserve(3 * STAKE_LOW);
        _settleAndFreeze(battleId, alice);
        vm.warp(uint256(arena.getBattle(battleId).frozenAt) + 72 hours + 1);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.expectEmit(true, false, false, true);
        emit BattleArena.FrozenExpired(battleId, 2 * STAKE_LOW, 2 * STAKE_LOW);
        vm.prank(nobody); // permissionless
        arena.expireFrozen(battleId);

        assertEq(claw.totalSupply(), supplyBefore - 2 * STAKE_LOW, "exactly 2 stakes burned");
        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW + _ag(STAKE_LOW));
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW + _ag(STAKE_LOW));
        assertEq(claw.balanceOf(devWallet), devBefore, "no fee on expiry");
        assertEq(arena.refundReserve(), STAKE_LOW, "reserve paid 2 stakes");
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, address(0));
        _assertConservation();
        assertEq(claw.balanceOf(address(arena)), STAKE_LOW, "only the reserve remains");
    }

    /// @dev Boundary: a reserve of exactly 2 stakes is enough.
    function test_expireFrozenReserveExactlyTwoStakesBurns() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _fundReserve(2 * STAKE_LOW);
        _settleAndFreeze(battleId, alice);
        vm.warp(uint256(arena.getBattle(battleId).frozenAt) + 72 hours + 1);
        uint256 supplyBefore = claw.totalSupply();

        arena.expireFrozen(battleId);

        assertEq(claw.totalSupply(), supplyBefore - 2 * STAKE_LOW);
        assertEq(arena.refundReserve(), 0);
        assertEq(claw.balanceOf(address(arena)), 0);
        _assertConservation();
    }

    /// @dev Reserve short: nothing burned, the held stakes go straight back.
    function test_expireFrozenInsufficientReserveReturnsHeldStakes() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _fundReserve(2 * STAKE_LOW - 1);
        _settleAndFreeze(battleId, alice);
        vm.warp(uint256(arena.getBattle(battleId).frozenAt) + 72 hours + 1);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 supplyBefore = claw.totalSupply();

        vm.expectEmit(true, false, false, true);
        emit BattleArena.FrozenExpired(battleId, 0, 0);
        arena.expireFrozen(battleId);

        assertEq(claw.totalSupply(), supplyBefore, "no burn");
        assertEq(arena.refundReserve(), 2 * STAKE_LOW - 1, "reserve untouched");
        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW + _ag(STAKE_LOW));
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW + _ag(STAKE_LOW));
        _assertConservation();
    }

    function test_expireFrozenWithEmptyReserve() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, bob);
        vm.warp(uint256(arena.getBattle(battleId).frozenAt) + 72 hours + 1);
        uint256 supplyBefore = claw.totalSupply();
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        arena.expireFrozen(battleId);

        assertEq(claw.totalSupply(), supplyBefore);
        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW + 125e18, "held stake returned, no burn");
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW + 125e18, "held stake returned, no burn");
        assertEq(claw.balanceOf(address(arena)), 0);
        _assertConservation();
    }

    function test_expireFrozenWrongPhaseReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, address(0));
        vm.warp(block.timestamp + 73 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Frozen,
                BattleArena.BattlePhase.AwaitingFinalize
            )
        );
        arena.expireFrozen(battleId);
    }

    /// @dev The Safe may still resolve after 72 h if nobody has expired the battle yet; once
    ///      expired, it cannot be resolved again.
    function test_expireFrozenThenResolveReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);
        vm.warp(block.timestamp + 72 hours + 1);
        arena.expireFrozen(battleId);

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.Frozen, BattleArena.BattlePhase.Settled
            )
        );
        vm.prank(admin);
        arena.resolveFrozen(battleId, alice, address(0), false);
    }

    // ──────────── refund reserve ────────────

    function test_fundReserveByAnyone() public {
        vm.prank(funder);
        claw.approve(address(arena), 1_000e18);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.ReserveFunded(funder, 1_000e18);
        vm.prank(funder);
        arena.fundReserve(1_000e18);

        assertEq(arena.refundReserve(), 1_000e18);
        assertEq(claw.balanceOf(address(arena)), 1_000e18);
        _assertConservation();
    }

    function test_fundReserveWithoutAllowanceReverts() public {
        vm.prank(funder);
        vm.expectRevert();
        arena.fundReserve(1_000e18);
        assertEq(arena.refundReserve(), 0);
    }

    function test_withdrawReserveByAdmin() public {
        _fundReserve(5_000e18);
        address safeDest = makeAddr("safeDest");

        vm.expectEmit(true, false, false, true);
        emit BattleArena.ReserveWithdrawn(safeDest, 2_000e18);
        vm.prank(admin);
        arena.withdrawReserve(safeDest, 2_000e18);

        assertEq(claw.balanceOf(safeDest), 2_000e18);
        assertEq(arena.refundReserve(), 3_000e18);
        _assertConservation();
    }

    function test_withdrawReserveAccessAndBounds() public {
        _fundReserve(1_000e18);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, funder, arena.DEFAULT_ADMIN_ROLE())
        );
        vm.prank(funder); // funding does not give a right to withdraw
        arena.withdrawReserve(funder, 1);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, arena.DEFAULT_ADMIN_ROLE())
        );
        vm.prank(guardian);
        arena.withdrawReserve(guardian, 1);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InsufficientReserve.selector, 1_000e18 + 1, 1_000e18));
        arena.withdrawReserve(admin, 1_000e18 + 1);
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        arena.withdrawReserve(address(0), 1);
        vm.stopPrank();
    }

    /// @dev Escrow is never reachable through the reserve, even when the arena holds far more.
    function test_withdrawReserveCannotTouchEscrow() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _fundReserve(100e18);
        assertGt(claw.balanceOf(address(arena)), 100e18 + 1);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.InsufficientReserve.selector, 100e18 + 1, 100e18));
        vm.prank(admin);
        arena.withdrawReserve(admin, 100e18 + 1);

        vm.prank(admin);
        arena.withdrawReserve(admin, 100e18);
        assertEq(claw.balanceOf(address(arena)), 2 * (STAKE_LOW + _ag(STAKE_LOW)), "escrow intact");
        _assertConservation();

        // The battle still pays out in full.
        uint256 aliceBefore = claw.balanceOf(alice);
        _settleAndFinalize(battleId, alice, [uint8(1), 1, 1], [uint8(1), 1, 1]);
        assertEq(claw.balanceOf(alice), aliceBefore + 4_625e18);
        assertEq(claw.balanceOf(address(arena)), 0);
    }

    /// @dev A normal payout never dips into the reserve.
    function test_finalizeDoesNotTouchReserve() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _fundReserve(7_777e18);
        _settleAndFinalize(battleId, alice, [uint8(1), 1, 1], [uint8(1), 1, 1]);
        assertEq(arena.refundReserve(), 7_777e18);
        assertEq(claw.balanceOf(address(arena)), 7_777e18);
        _assertConservation();
    }

    // ──────────── handleTimeout ────────────

    function test_handleTimeoutDepositCancel() public {
        uint256 battleId = _createBattle();
        _deposit(battleId, alice, bytes32("c"));
        uint256 total = STAKE_LOW + _ag(STAKE_LOW);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        vm.warp(block.timestamp + arena.DEPOSIT_WINDOW() + 1);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.DepositTimeout);
        arena.handleTimeout(battleId);

        _expectPhase(battleId, BattleArena.BattlePhase.Cancelled);
        assertEq(claw.balanceOf(alice), aliceBefore + total);
        assertEq(claw.balanceOf(bob), bobBefore, "bob never deposited");
        _assertConservation();
    }

    /// @dev Reveal clock runs out with no accusation: a no-fault mutual cancel (was: neither committed).
    function test_handleTimeoutRevealMutualCancel() public {
        (uint256 battleId,,) = _setupRevealPhase();
        uint256 total = STAKE_LOW + _ag(STAKE_LOW);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        vm.warp(block.timestamp + arena.TEAM_REVEAL_WINDOW() + 1);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.MutualTimeout);
        arena.handleTimeout(battleId);

        _expectPhase(battleId, BattleArena.BattlePhase.Cancelled);
        assertEq(claw.balanceOf(alice), aliceBefore + total);
        assertEq(claw.balanceOf(bob), bobBefore + total);
        _assertConservation();
    }

    function test_handleTimeoutNotExpiredReverts() public {
        uint256 battleId = _createBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);

        vm.warp(block.timestamp + arena.DEPOSIT_WINDOW());
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);
    }

    function test_handleTimeoutRevealAtDeadlineReverts() public {
        (uint256 battleId,,) = _setupRevealPhase();
        vm.warp(block.timestamp + arena.TEAM_REVEAL_WINDOW());
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);
    }

    function test_handleTimeoutActiveBeforeWindowReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + arena.ACTIVE_WINDOW());
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);
    }

    function test_handleTimeoutActiveAfterWindowCancelsWithFullRefunds() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupActiveBattle();

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 supplyBefore = claw.totalSupply();
        uint256 total = STAKE_LOW + _ag(STAKE_LOW);

        vm.warp(block.timestamp + arena.ACTIVE_WINDOW() + 1);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.StaleBattle);
        arena.handleTimeout(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Cancelled);
        assertEq(b.winner, address(0));
        assertEq(claw.balanceOf(alice), aliceBefore + total);
        assertEq(claw.balanceOf(bob), bobBefore + total);
        assertEq(claw.totalSupply(), supplyBefore);
        assertEq(claw.balanceOf(address(arena)), 0);
        assertFalse(arena.teamInBattle(teamIdA));
        assertFalse(arena.teamInBattle(teamIdB));
        assertFalse(tm.isTeamActive(teamIdA));
        assertFalse(tm.isTeamActive(teamIdB));
    }

    /// @dev In review, handleTimeout acts as finalizeBattle (forfeit included).
    function test_handleTimeoutInReviewRoutesToFinalize() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, bob);
        uint256 deadline = arena.getBattle(battleId).payoutDeadline;

        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();
        vm.warp(deadline + 1);
        arena.handleTimeout(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(uint8(b.phase), uint8(BattleArena.BattlePhase.Settled));
        assertEq(b.winner, alice);
        assertEq(claw.balanceOf(alice), aliceBefore + 4_625e18);
        assertEq(claw.balanceOf(bob), bobBefore);
        _assertTreasuryReceived(devBefore, supplyBefore, 625e18);
        _assertConservation();
    }

    /// @dev Frozen past the long-stop, handleTimeout acts as expireFrozen.
    function test_handleTimeoutFrozenRoutesToExpire() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _fundReserve(2 * STAKE_LOW);
        _settleAndFreeze(battleId, alice);
        uint256 availableAt = uint256(arena.getBattle(battleId).frozenAt) + 72 hours;

        // In the frozen phase the review deadline no longer counts — only the long-stop.
        vm.warp(arena.getBattle(battleId).payoutDeadline + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);
        vm.warp(availableAt);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);

        uint256 supplyBefore = claw.totalSupply();
        uint256 aliceBefore = claw.balanceOf(alice);
        vm.warp(availableAt + 1);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.FrozenExpired(battleId, 2 * STAKE_LOW, 2 * STAKE_LOW);
        arena.handleTimeout(battleId);

        assertEq(claw.totalSupply(), supplyBefore - 2 * STAKE_LOW);
        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW + _ag(STAKE_LOW));
        assertEq(arena.refundReserve(), 0);
        _expectPhase(battleId, BattleArena.BattlePhase.Settled);
        _assertConservation();
    }

    function test_handleTimeoutOnFinishedBattleReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFinalize(battleId, alice, [uint8(1), 1, 1], [uint8(1), 1, 1]);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.BattleDoesNotExist.selector, battleId));
        arena.handleTimeout(battleId);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.BattleDoesNotExist.selector, uint256(99)));
        arena.handleTimeout(99);
    }

    // ──────────── D-14: reveal-failure attribution ────────────

    function test_accuseNonResolverReverts() public {
        (uint256 battleId,,) = _setupRevealPhase();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, arena.RESOLVER_ROLE())
        );
        vm.prank(bob); // the opponent cannot accuse
        arena.accuseRevealFailure(battleId, alice);
    }

    function test_accuseGuards() public {
        uint256 depositPhase = _createBattle();
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                depositPhase,
                BattleArena.BattlePhase.TeamReveal,
                BattleArena.BattlePhase.Deposit
            )
        );
        vm.prank(resolver);
        arena.accuseRevealFailure(depositPhase, alice);

        (uint256 battleId,,) = _setupRevealPhase();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotBattleParticipant.selector, battleId));
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, nobody);

        vm.warp(block.timestamp + arena.TEAM_REVEAL_WINDOW() + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
    }

    function test_accuseExtendsDeadlineByGrace() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();
        vm.warp(block.timestamp + 15);

        vm.expectEmit(true, true, false, true);
        emit BattleArena.RevealFailureAccused(battleId, alice, block.timestamp + 2 minutes);
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.accusedA);
        assertFalse(b.accusedB);
        assertEq(b.phaseDeadline, block.timestamp + 2 minutes);

        // Past the original 20 s, the battle is not timed out and can still be revealed.
        vm.warp(block.timestamp + 30);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseNotTimedOut.selector, battleId));
        arena.handleTimeout(battleId);
        vm.prank(alice);
        arena.openOwnCommit(battleId, teamIdA, SALT_A);
        _reveal(battleId, teamIdA, teamIdB);
        _expectPhase(battleId, BattleArena.BattlePhase.Active);
    }

    function test_accuseTwiceSameSideReverts() public {
        (uint256 battleId,,) = _setupRevealPhase();
        vm.startPrank(resolver);
        arena.accuseRevealFailure(battleId, bob);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyAccused.selector, battleId));
        arena.accuseRevealFailure(battleId, bob);
        // The other side can still be accused (once).
        arena.accuseRevealFailure(battleId, alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyAccused.selector, battleId));
        arena.accuseRevealFailure(battleId, alice);
        vm.stopPrank();
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.accusedA && b.accusedB);
    }

    function test_openOwnCommitGuards() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);

        // Bob is not accused.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotAccused.selector, battleId));
        vm.prank(bob);
        arena.openOwnCommit(battleId, teamIdB, SALT_B);

        // A stranger is not a participant.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NotBattleParticipant.selector, battleId));
        vm.prank(nobody);
        arena.openOwnCommit(battleId, teamIdA, SALT_A);

        // Wrong salt / wrong team do not open the commit.
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        vm.prank(alice);
        arena.openOwnCommit(battleId, teamIdA, bytes32("wrong"));
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidCommitHash.selector, battleId));
        vm.prank(alice);
        arena.openOwnCommit(battleId, teamIdB, SALT_A);
        assertFalse(arena.getBattle(battleId).openedA);

        vm.expectEmit(true, true, false, true);
        emit BattleArena.CommitOpened(battleId, alice, teamIdA, SALT_A);
        vm.prank(alice);
        arena.openOwnCommit(battleId, teamIdA, SALT_A);
        assertTrue(arena.getBattle(battleId).openedA);
    }

    function test_openOwnCommitAfterGraceReverts() public {
        (uint256 battleId, uint256 teamIdA,) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        vm.warp(block.timestamp + 2 minutes + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.PhaseTimedOut.selector, battleId));
        vm.prank(alice);
        arena.openOwnCommit(battleId, teamIdA, SALT_A);
    }

    /// @dev Accused player who opened is cleared: if the reveal still never happens, no-fault cancel.
    function test_openedButNotRevealedIsMutualCancelNoSlash() public {
        (uint256 battleId, uint256 teamIdA,) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        vm.prank(alice);
        arena.openOwnCommit(battleId, teamIdA, SALT_A);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 devBefore = claw.balanceOf(devWallet);
        vm.warp(block.timestamp + 2 minutes + 1);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.MutualTimeout);
        arena.handleTimeout(battleId);

        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW + _ag(STAKE_LOW));
        assertEq(claw.balanceOf(devWallet), devBefore);
        _assertConservation();
    }

    /// @dev Accused and silent → ForfeitA: alice loses her 5% to the Treasury, stakes refunded.
    ///      (Intent of the old "forfeit the non-committer" test.)
    function test_accusedNotOpenedForfeitsA() public {
        (uint256 battleId,,) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.warp(block.timestamp + 2 minutes + 1);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.AntiGriefSlashed(battleId, alice, _ag(STAKE_LOW));
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.ForfeitA);
        arena.handleTimeout(battleId);

        _expectPhase(battleId, BattleArena.BattlePhase.Cancelled);
        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW, "stake back, 5% slashed");
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW + _ag(STAKE_LOW), "innocent side in full");
        _assertTreasuryReceived(devBefore, supplyBefore, _ag(STAKE_LOW));
        _assertConservation();
    }

    function test_accusedNotOpenedForfeitsB() public {
        (uint256 battleId, uint256 teamIdA,) = _setupRevealPhase();
        vm.startPrank(resolver);
        arena.accuseRevealFailure(battleId, bob);
        arena.accuseRevealFailure(battleId, alice);
        vm.stopPrank();
        vm.prank(alice); // alice clears herself; bob stays silent
        arena.openOwnCommit(battleId, teamIdA, SALT_A);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.warp(block.timestamp + 2 minutes + 1);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.ForfeitB);
        arena.handleTimeout(battleId);

        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW);
        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW + _ag(STAKE_LOW));
        _assertTreasuryReceived(devBefore, supplyBefore, _ag(STAKE_LOW));
        _assertConservation();
    }

    function test_bothAccusedNeitherOpenedBothSlashed() public {
        (uint256 battleId,,) = _setupRevealPhase();
        vm.startPrank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        arena.accuseRevealFailure(battleId, bob);
        vm.stopPrank();

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.warp(block.timestamp + 2 minutes + 1);
        vm.expectEmit(true, true, false, true);
        emit BattleArena.AntiGriefSlashed(battleId, alice, _ag(STAKE_LOW));
        vm.expectEmit(true, true, false, true);
        emit BattleArena.AntiGriefSlashed(battleId, bob, _ag(STAKE_LOW));
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.ForfeitBoth); // review I1: not "mutual"
        arena.handleTimeout(battleId);

        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW);
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW);
        _assertTreasuryReceived(devBefore, supplyBefore, 2 * _ag(STAKE_LOW));
        _assertConservation();
    }

    // ──────────── Review 2026-10-03: D-F damage cap ────────────

    function test_settleDamageAbove40Reverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        assertEq(arena.MAX_BATTLE_DAMAGE(), 40);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.DamageTooHigh.selector, battleId, uint8(1), uint8(41)));
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 41, 8], [uint8(30), 25, 35], SEED_SECRET, address(0));
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.DamageTooHigh.selector, battleId, uint8(2), uint8(100)));
        arena.settle(battleId, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 100], SEED_SECRET, address(0));
        // Exactly the cap is a legal battle.
        _settleAndFinalize(battleId, alice, [uint8(40), 40, 40], [uint8(40), 40, 40]);
        _expectPhase(battleId, BattleArena.BattlePhase.Settled);
    }

    // ──────────── Review 2026-10-03 T2: the Safe's result, not the proposal, decides the forfeit ────────────

    function test_resolveFrozenClearsProposedForfeit() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, bob); // proposed: alice won, bob forfeited
        vm.prank(guardian);
        arena.freeze(battleId);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.prank(admin);
        arena.resolveFrozen(battleId, alice, address(0), false); // the Safe: alice won, nobody forfeited

        assertEq(claw.balanceOf(alice), aliceBefore + 4_500e18 + 125e18, "winner: pot minus fee, plus own 5%");
        assertEq(claw.balanceOf(bob), bobBefore + 125e18, "loser keeps the 5%: the proposed forfeit was overridden");
        _assertTreasuryReceived(devBefore, supplyBefore, 500e18);
        _assertConservation();
    }

    function test_resolveFrozenFlipsWinnerAndForfeit() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settle(battleId, alice, bob);
        vm.prank(guardian);
        arena.freeze(battleId);
        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.expectEmit(true, true, false, true);
        emit BattleArena.AntiGriefSlashed(battleId, alice, 125e18);
        vm.prank(admin);
        arena.resolveFrozen(battleId, bob, alice, false); // the Safe: bob won, alice forfeited

        assertEq(claw.balanceOf(bob), bobBefore + 4_500e18 + 125e18);
        assertEq(claw.balanceOf(alice), aliceBefore, "alice: stake lost and the 5% slashed");
        _assertTreasuryReceived(devBefore, supplyBefore, 625e18);
        _assertConservation();
    }

    // ──────────── Review 2026-10-03 D-A: opening a commit proves the team is playable ────────────

    function test_openOwnCommitRejectsDisbandedTeam() public {
        (uint256 battleId, uint256 teamIdA,) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        vm.prank(alice);
        tm.disbandTeam(teamIdA);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamNotOwned.selector, teamIdA));
        arena.openOwnCommit(battleId, teamIdA, SALT_A);
        assertFalse(arena.getBattle(battleId).openedA);
    }

    function test_openOwnCommitRejectsTeamSentMining() public {
        (uint256 battleId, uint256 teamIdA,) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        // The committed team starts mining (MiningPool holds ACTIVITY_ROLE in production).
        vm.startPrank(admin);
        tm.grantRole(tm.ACTIVITY_ROLE(), admin);
        tm.setTeamActive(teamIdA, true);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamAlreadyInBattle.selector, teamIdA));
        arena.openOwnCommit(battleId, teamIdA, SALT_A);
    }

    function test_openOwnCommitRejectsPowerChange() public {
        (uint256 battleId, uint256 teamIdA,) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        TeamManager.Team memory t = tm.getTeam(teamIdA);
        vm.prank(admin);
        nft.setEvolutionTier(t.lobsterIds[0], 2); // Power 3 -> 4
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamPowerChanged.selector, teamIdA, uint8(3), uint8(4)));
        arena.openOwnCommit(battleId, teamIdA, SALT_A);
    }

    /// @dev The review's free cancel, closed: a depositor who makes their own team unrevealable
    ///      can no longer clear themselves by opening the hash — the lapse slashes them.
    function test_accusedWithUnplayableTeamIsSlashedAtLapse() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();
        vm.prank(alice);
        tm.disbandTeam(teamIdA);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamNotOwned.selector, teamIdA));
        arena.revealTeams(battleId, teamIdA, SALT_A, teamIdB, SALT_B, _seedCommit(battleId));
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.TeamNotOwned.selector, teamIdA));
        arena.openOwnCommit(battleId, teamIdA, SALT_A);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);
        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();
        vm.warp(arena.getBattle(battleId).phaseDeadline + 1);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleCancelled(battleId, BattleArena.CancelReason.ForfeitA);
        arena.handleTimeout(battleId);
        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW, "alice: stake back, 5% gone");
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW + _ag(STAKE_LOW), "bob: full refund");
        _assertTreasuryReceived(devBefore, supplyBefore, _ag(STAKE_LOW));
        _assertConservation();
    }

    // ──────────── Review 2026-10-03: previously untested reverts and boundary seconds ────────────

    function test_createBattleNonMatchmakerReverts() public {
        address[3] memory callers = [resolver, guardian, alice];
        bytes32 role = arena.MATCHMAKER_ROLE(); // read BEFORE the prank (a view call would consume it)
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(
                abi.encodeWithSelector(bytes4(keccak256("AccessControlUnauthorizedAccount(address,bytes32)")), callers[i], role)
            );
            arena.createBattle(alice, bob, STAKE_LOW, 3, 3);
        }
    }

    function test_createBattleZeroAddressPlayerReverts() public {
        vm.prank(matchmaker);
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        arena.createBattle(address(0), bob, STAKE_LOW, 3, 3);
        vm.prank(matchmaker);
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        arena.createBattle(alice, address(0), STAKE_LOW, 3, 3);
    }

    function test_depositAlreadyDepositedReverts_sideB() public {
        uint256 battleId = _createBattle();
        _deposit(battleId, bob, bytes32("b1"));
        uint256 held = claw.balanceOf(address(arena));
        vm.prank(bob);
        claw.approve(address(arena), STAKE_LOW + _ag(STAKE_LOW));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.AlreadyDeposited.selector, battleId));
        arena.deposit(battleId, STAKE_LOW, 9, bytes32("b2"));
        assertEq(claw.balanceOf(address(arena)), held, "one escrow, not two");
        assertEq(arena.getBattle(battleId).teamCommitB, bytes32("b1"), "commit not swapped");
    }

    function test_finalizeBeforeSettleReverts() public {
        _expectFinalizeRejected(_createBattle(), BattleArena.BattlePhase.Deposit);
        (uint256 inReveal,,) = _setupRevealPhase();
        _expectFinalizeRejected(inReveal, BattleArena.BattlePhase.TeamReveal);
        (uint256 active,,) = _setupActiveBattle();
        _expectFinalizeRejected(active, BattleArena.BattlePhase.Active);
    }

    function _expectFinalizeRejected(uint256 battleId, BattleArena.BattlePhase actual) internal {
        uint256 held = claw.balanceOf(address(arena));
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.AwaitingFinalize, actual
            )
        );
        arena.finalizeBattle(battleId);
        assertEq(claw.balanceOf(address(arena)), held, "nothing moved");
    }

    function test_revealTeamsWrongPhaseReverts() public {
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);
        uint256 battleId = _createBattle();
        _deposit(battleId, alice, _commitHash(battleId, alice, teamA, SALT_A)); // one deposit: still Deposit
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.TeamReveal, BattleArena.BattlePhase.Deposit
            )
        );
        arena.revealTeams(battleId, teamA, SALT_A, teamB, SALT_B, _seedCommit(battleId));

        (uint256 active, uint256 a2, uint256 b2) = _setupActiveBattle();
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, active, BattleArena.BattlePhase.TeamReveal, BattleArena.BattlePhase.Active
            )
        );
        arena.revealTeams(active, a2, SALT_A, b2, SALT_B, _seedCommit(active));
        _settle(active, alice, address(0));
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, active, BattleArena.BattlePhase.TeamReveal, BattleArena.BattlePhase.AwaitingFinalize
            )
        );
        arena.revealTeams(active, a2, SALT_A, b2, SALT_B, _seedCommit(active));
    }

    function test_accuseAfterRevealReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.TeamReveal, BattleArena.BattlePhase.Active
            )
        );
        arena.accuseRevealFailure(battleId, alice);
    }

    function test_secondAccusationInsideGraceExtendsAgain() public {
        (uint256 battleId,,) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        uint256 firstGrace = arena.getBattle(battleId).phaseDeadline;
        vm.warp(block.timestamp + 30 seconds); // past the original 20 s window, inside the first grace
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, bob);
        assertEq(arena.getBattle(battleId).phaseDeadline, block.timestamp + arena.REVEAL_GRACE());
        assertGt(arena.getBattle(battleId).phaseDeadline, firstGrace);
    }

    function test_resolveFrozenStillAllowedAfterLongStop() public {
        (uint256 battleId,,) = _setupActiveBattle();
        _settleAndFreeze(battleId, alice);
        vm.warp(uint256(arena.getBattle(battleId).frozenAt) + 72 hours + 1);
        uint256 aliceBefore = claw.balanceOf(alice);
        vm.prank(admin);
        arena.resolveFrozen(battleId, alice, address(0), false);
        assertEq(claw.balanceOf(alice), aliceBefore + 4_500e18 + 125e18);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector, battleId, BattleArena.BattlePhase.Frozen, BattleArena.BattlePhase.Settled
            )
        );
        arena.expireFrozen(battleId);
    }

    function test_terminalBattlesRejectEveryAction() public {
        (uint256 settled,,) = _setupActiveBattle();
        _settleAndFinalize(settled, alice, [uint8(5), 5, 5], [uint8(20), 20, 20]);
        uint256 cancelled = _createBattle();
        vm.warp(block.timestamp + arena.DEPOSIT_WINDOW() + 1);
        arena.handleTimeout(cancelled);
        uint256[2] memory ids = [settled, cancelled];
        for (uint256 i = 0; i < 2; i++) {
            uint256 id = ids[i];
            BattleArena.BattlePhase p = arena.getBattle(id).phase;
            vm.prank(resolver);
            vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidBattlePhase.selector, id, BattleArena.BattlePhase.Active, p));
            arena.settle(id, alice, HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20], SEED_SECRET, address(0));
            vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidBattlePhase.selector, id, BattleArena.BattlePhase.AwaitingFinalize, p));
            arena.finalizeBattle(id);
            vm.prank(guardian);
            vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidBattlePhase.selector, id, BattleArena.BattlePhase.AwaitingFinalize, p));
            arena.freeze(id);
            vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidBattlePhase.selector, id, BattleArena.BattlePhase.Frozen, p));
            arena.expireFrozen(id);
            vm.expectRevert(abi.encodeWithSelector(BattleArena.BattleDoesNotExist.selector, id));
            arena.handleTimeout(id);
            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidBattlePhase.selector, id, BattleArena.BattlePhase.Deposit, p));
            arena.deposit(id, STAKE_LOW, 9, bytes32("x"));
        }
        vm.expectRevert(abi.encodeWithSelector(BattleArena.BattleDoesNotExist.selector, uint256(99)));
        arena.getBattle(99);
    }

    function test_depositAtExactDeadlineAccepted() public {
        uint256 battleId = _createBattle();
        vm.warp(arena.getBattle(battleId).phaseDeadline); // == deadline: still open
        _deposit(battleId, alice, bytes32("c"));
        assertTrue(arena.getBattle(battleId).depositA);
    }

    function test_openOwnCommitAtExactGraceDeadlineAccepted() public {
        (uint256 battleId, uint256 teamIdA,) = _setupRevealPhase();
        vm.prank(resolver);
        arena.accuseRevealFailure(battleId, alice);
        vm.warp(arena.getBattle(battleId).phaseDeadline);
        vm.prank(alice);
        arena.openOwnCommit(battleId, teamIdA, SALT_A);
        assertTrue(arena.getBattle(battleId).openedA);
    }

    function test_emergencyWithdrawAtExactAvailableAtAccepted() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(arena.getBattle(battleId).lastProgressAt + 24 hours);
        vm.prank(alice);
        arena.emergencyWithdraw(battleId);
        _expectPhase(battleId, BattleArena.BattlePhase.Cancelled);
    }

    function test_constructorZeroAddressRevertsRemainingArgs() public {
        vm.startPrank(admin);
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        new BattleArena(admin, address(claw), address(nft), address(0), address(treasury), address(vrf));
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        new BattleArena(admin, address(claw), address(nft), address(tm), address(0), address(vrf));
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        new BattleArena(admin, address(claw), address(nft), address(tm), address(treasury), address(0));
        vm.stopPrank();
    }

    // ──────────── review-window tuning (T-02 timelock) ────────────

    function test_proposeReviewWindowBounds() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidReviewWindow.selector, uint256(59)));
        arena.proposeReviewWindow(0, 59);
        arena.proposeReviewWindow(0, 60);
        arena.proposeReviewWindow(0, 1 days);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidReviewWindow.selector, uint256(1 days + 1)));
        arena.proposeReviewWindow(0, 1 days + 1);

        arena.proposeReviewWindow(1, 3 days);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidReviewWindow.selector, uint256(3 days + 1)));
        arena.proposeReviewWindow(1, 3 days + 1);

        arena.proposeReviewWindow(2, 7 days);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidReviewWindow.selector, uint256(7 days + 1)));
        arena.proposeReviewWindow(2, 7 days + 1);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidReviewWindow.selector, uint256(59)));
        arena.proposeReviewWindow(2, 59);

        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeBracket.selector, uint256(3)));
        arena.proposeReviewWindow(3, 10 minutes);
        vm.stopPrank();

        assertEq(arena.pendingReviewWindow(0), 1 days);
        assertEq(arena.reviewWindows(0), 5 minutes, "proposal does not take effect immediately");
    }

    function test_proposeReviewWindowNonAdminReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, arena.DEFAULT_ADMIN_ROLE())
        );
        vm.prank(guardian);
        arena.proposeReviewWindow(0, 10 minutes);

        vm.prank(admin);
        arena.proposeReviewWindow(0, 10 minutes);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, arena.DEFAULT_ADMIN_ROLE())
        );
        vm.prank(nobody);
        arena.enactReviewWindow(0);
    }

    function test_enactReviewWindowTimelock() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.NoPendingChange.selector, uint256(0)));
        arena.enactReviewWindow(0);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeBracket.selector, uint256(3)));
        arena.enactReviewWindow(3);

        uint256 proposedAt = block.timestamp;
        vm.expectEmit(true, false, false, true);
        emit BattleArena.ReviewWindowProposed(0, 20 minutes, proposedAt + 24 hours);
        arena.proposeReviewWindow(0, 20 minutes);

        vm.warp(proposedAt + 24 hours - 1);
        vm.expectRevert(
            abi.encodeWithSelector(BattleArena.TuningDelayNotElapsed.selector, uint256(0), proposedAt + 24 hours)
        );
        arena.enactReviewWindow(0);

        vm.warp(proposedAt + 24 hours); // exactly the delay is enough
        vm.expectEmit(true, false, false, true);
        emit BattleArena.ReviewWindowSet(0, 5 minutes, 20 minutes);
        arena.enactReviewWindow(0);
        vm.stopPrank();

        assertEq(arena.reviewWindows(0), 20 minutes);
        assertEq(arena.pendingReviewWindow(0), 0);
        assertEq(uint256(arena.pendingReviewWindowAt(0)), 0);
        assertEq(arena.reviewWindows(1), 30 minutes, "other brackets untouched");

        vm.expectRevert(abi.encodeWithSelector(BattleArena.NoPendingChange.selector, uint256(0)));
        vm.prank(admin);
        arena.enactReviewWindow(0);
    }

    /// @dev A battle already in review keeps its deadline; the next settle uses the new window.
    function test_enactedReviewWindowAppliesToNewSettlementsOnly() public {
        vm.prank(admin);
        arena.proposeReviewWindow(0, 2 hours);
        vm.warp(block.timestamp + 24 hours);

        (uint256 first,,) = _setupActiveBattle();
        _settle(first, alice, address(0));
        uint256 firstDeadline = arena.getBattle(first).payoutDeadline;
        assertEq(firstDeadline, block.timestamp + 5 minutes);

        vm.prank(admin);
        arena.enactReviewWindow(0);
        assertEq(arena.getBattle(first).payoutDeadline, firstDeadline, "in-review deadline unchanged");

        (uint256 second,,) = _setupActiveBattle();
        _settle(second, bob, address(0));
        assertEq(arena.getBattle(second).payoutDeadline, block.timestamp + 2 hours);
    }

    // ──────────── E2E ────────────

    function test_fullBattleLifecycleE2E() public {
        uint256 teamIdA = _createEvolvedTeam(alice);
        uint256 teamIdB = _createEvolvedTeam(bob);
        uint256 battleId = _createBattle();

        _depositBoth(battleId, teamIdA, teamIdB);
        _expectPhase(battleId, BattleArena.BattlePhase.TeamReveal);
        _reveal(battleId, teamIdA, teamIdB);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Active);
        assertEq(b.phaseDeadline, block.timestamp + arena.ACTIVE_WINDOW());

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        _settleAndFinalize(battleId, alice, [uint8(10), 5, 8], [uint8(30), 25, 35]);

        b = arena.getBattle(battleId);
        assertTrue(b.phase == BattleArena.BattlePhase.Settled);
        assertEq(b.winner, alice);
        assertEq(claw.balanceOf(alice), aliceBefore + 4_500e18 + 125e18);
        assertEq(claw.balanceOf(bob), bobBefore + 125e18);
        _assertConservation();
    }

    // ──────────── S-02: Emergency Withdraw ────────────

    function test_emergencyWithdrawAfterDelay() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + 24 hours + 1);

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore = claw.balanceOf(bob);

        vm.prank(alice);
        arena.emergencyWithdraw(battleId);

        assertEq(claw.balanceOf(alice), aliceBefore + STAKE_LOW + _ag(STAKE_LOW));
        assertEq(claw.balanceOf(bob), bobBefore + STAKE_LOW + _ag(STAKE_LOW));
        _expectPhase(battleId, BattleArena.BattlePhase.Cancelled);
        _assertConservation();
    }

    function test_emergencyWithdrawBeforeDelayReverts() public {
        (uint256 battleId,,) = _setupActiveBattle();
        uint256 availableAt = arena.getBattle(battleId).lastProgressAt + 24 hours;
        vm.warp(availableAt - 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.EmergencyWithdrawTooEarly.selector, battleId, availableAt));
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
        _settle(battleId, alice, address(0));

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Active,
                BattleArena.BattlePhase.AwaitingFinalize
            )
        );
        arena.emergencyWithdraw(battleId);
    }

    function test_emergencyWithdrawNotAvailableOnNonActiveBattle() public {
        (uint256 battleId,,) = _setupRevealPhase();
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleArena.InvalidBattlePhase.selector,
                battleId,
                BattleArena.BattlePhase.Active,
                BattleArena.BattlePhase.TeamReveal
            )
        );
        arena.emergencyWithdraw(battleId);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_antiGriefCalculation(uint256 stake) public pure {
        stake = bound(stake, 1e18, 100_000e18);
        assertEq(stake * 500 / 10_000, stake * 5 / 100);
    }

    /// @dev For every bracket, a draw costs the pair exactly what a decided battle costs.
    function testFuzz_drawFeeEqualsDecidedFee(uint8 bracket) public pure {
        uint256[3] memory stakes = [STAKE_LOW, STAKE_MID, STAKE_HIGH];
        uint256 stake = stakes[bound(bracket, 0, 2)];
        uint256 sideFee = stake * 1000 / 10_000;
        assertEq(2 * sideFee, (2 * stake) * 1000 / 10_000);
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

    // ═══════════════════════ D-01: battle seed commit-reveal ═══════════════════════

    function test_D01_revealRequiresSeedCommit() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSeedCommit.selector, battleId));
        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, SALT_A, teamIdB, SALT_B, bytes32(0));
    }

    function test_D01_revealRecordsCommitAndTimestamp() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();

        vm.warp(block.timestamp + 7);
        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleSeedCommitted(battleId, _seedCommit(battleId), uint64(block.timestamp));
        _reveal(battleId, teamIdA, teamIdB);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.seedCommit, _seedCommit(battleId), "commit stored");
        assertEq(uint256(b.revealedAt), block.timestamp, "revealedAt is the reveal block time");
        assertEq(b.seedSecret, bytes32(0), "secret stays hidden until settle");
    }

    function test_D01_settleRejectsWrongSecret() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSeedReveal.selector, battleId));
        vm.prank(resolver);
        arena.settle(
            battleId, alice, HASH_STATE, HASH_LOG, [uint8(1), 1, 1], [uint8(1), 1, 1], keccak256("not the secret"), address(0)
        );
    }

    /// @dev The commitment includes the battle id, so the resolver cannot commit once and then
    ///      open whichever battle it likes with a secret whose seed it has already seen.
    function test_D01_commitIsBoundToTheBattleId() public {
        (uint256 battleId, uint256 teamIdA, uint256 teamIdB) = _setupRevealPhase();

        vm.prank(resolver);
        arena.revealTeams(battleId, teamIdA, SALT_A, teamIdB, SALT_B, _seedCommit(battleId + 1));

        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidSeedReveal.selector, battleId));
        _settle(battleId, alice, address(0));
    }

    /// @dev Known answer shared with packages/chain/src/__tests__/battle-seed.test.ts.
    function test_D01_commitmentKnownAnswer() public pure {
        bytes32 secret = 0x1111111111111111111111111111111111111111111111111111111111111111;
        assertEq(
            keccak256(abi.encodePacked(uint256(7), secret)),
            bytes32(0x1cb972df85b64850dbe8c661744bd0bef0baa3ef8ecb4f0dcc959ea1e0990bab)
        );
    }

    function test_D01_settleDisclosesTheSecret() public {
        (uint256 battleId,,) = _setupActiveBattle();

        vm.expectEmit(true, false, false, true);
        emit BattleArena.BattleSeedRevealed(battleId, SEED_SECRET);
        _settle(battleId, alice, address(0));

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.seedSecret, SEED_SECRET);
        assertEq(keccak256(abi.encodePacked(battleId, b.seedSecret)), b.seedCommit);
    }

    function test_D01_expiredBattleNeverDisclosesTheSecret() public {
        (uint256 battleId,,) = _setupActiveBattle();
        vm.warp(block.timestamp + arena.ACTIVE_WINDOW() + 1);
        arena.handleTimeout(battleId);

        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.seedSecret, bytes32(0));
        assertEq(uint256(b.phase), uint256(BattleArena.BattlePhase.Cancelled));
    }
}
