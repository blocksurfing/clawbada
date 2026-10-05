// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BattleArena} from "../contracts/BattleArena.sol";
import {BattleVRF} from "../contracts/BattleVRF.sol";
import {TeamManager} from "../contracts/TeamManager.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {GoldToken} from "../contracts/GoldToken.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {MiningPool} from "../contracts/MiningPool.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @dev Stands in for MiningPool: the two views the peg reads, settable at will.
contract StakeReferenceMock {
    uint256 public stakeReference;
    uint256 public currentBaseReward;

    function set(uint256 ref_, uint256 live) external {
        stakeReference = ref_;
        currentBaseReward = live;
    }
}

/// @notice D-E (owner decision 2026-10-03): stake brackets are a DAMPED LIVE PEG on the mining
///         rate. stake = multiplier × unit, unit = GENESIS × fixed + ref × (1 − fixed),
///         ref = MiningPool's daily sample (fallbacks: live rate, then GENESIS), capped at
///         GENESIS, floored to a whole GOLD. The amount is bound into the battle at creation and
///         the review window keys off the STORED bracket, never the amount.
contract BattleArenaStakePegTest is Test {
    bytes32 internal constant SEED_SECRET = keccak256("clawbada-test-seed-secret");
    bytes32 internal constant SALT_A = bytes32("saltA");
    bytes32 internal constant SALT_B = bytes32("saltB");
    bytes32 constant HASH_STATE = keccak256("final-state");
    bytes32 constant HASH_LOG = keccak256("turn-log");

    uint256 constant GENESIS = 1_250e18;
    uint256 constant BPS = 10_000;

    BattleArena arena;
    BattleVRF vrf;
    TeamManager tm;
    LobsterNFT nft;
    GoldToken gold;
    Treasury treasury;
    StakeReferenceMock peg;

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

    function setUp() public {
        vm.startPrank(admin);
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        gold = new GoldToken(admin, lpAddress, treasuryAddress);
        tm = new TeamManager(admin, address(nft));
        treasury = new Treasury(admin, devWallet);
        vrf = new BattleVRF(admin);
        peg = new StakeReferenceMock();
        arena = new BattleArena(
            admin, address(gold), address(nft), address(tm), address(treasury), address(vrf), address(peg)
        );

        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.LOCKER_ROLE(), address(tm));
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        nft.grantRole(nft.DAMAGE_ROLE(), address(arena));
        tm.grantRole(tm.ACTIVITY_ROLE(), address(arena));
        arena.grantRole(arena.MATCHMAKER_ROLE(), matchmaker);
        arena.grantRole(arena.RESOLVER_ROLE(), resolver);
        treasury.setGoldToken(address(gold));
        treasury.setAuthorized(address(arena), true);
        vrf.grantRole(vrf.OPERATOR_ROLE(), admin);
        vm.stopPrank();

        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37;
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);

        vm.prank(lpAddress);
        gold.transfer(alice, 200_000e18);
        vm.prank(lpAddress);
        gold.transfer(bob, 200_000e18);
    }

    // ──────────── Helpers ────────────

    /// @dev The spec's formula, written independently of the contract (ref implementation).
    function _expected(uint256 ref, uint256 fixedBps, uint256 multiplier) internal pure returns (uint256) {
        if (ref == 0 || ref > GENESIS) ref = GENESIS;
        uint256 stake = (multiplier * (GENESIS * fixedBps + ref * (BPS - fixedBps))) / BPS;
        return stake - (stake % 1e18);
    }

    function _setFixedBps(uint256 bps) internal {
        vm.prank(admin);
        arena.proposeStakeFixedBps(bps);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(admin);
        arena.enactStakeFixedBps();
    }

    function _create(uint8 bracket) internal returns (uint256 battleId) {
        vm.prank(matchmaker);
        battleId = arena.createBattle(alice, bob, bracket, 3, 3);
    }

    function _mintEvolvedLobster(address to) internal returns (uint256) {
        vm.startPrank(admin);
        uint256 id = nft.mint(to, validDNA, false);
        nft.setEvolutionTier(id, 1);
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

    function _commit(uint256 battleId, address player, uint256 teamId, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(battleId, player, teamId, salt));
    }

    function _deposit(uint256 battleId, address player, uint256 expectedStake, bytes32 commit) internal {
        uint256 stake = arena.getBattle(battleId).stakeAmount;
        vm.prank(player);
        gold.approve(address(arena), stake + stake * 500 / BPS);
        vm.prank(player);
        arena.deposit(battleId, expectedStake, 9, commit);
    }

    function _setupActive(uint8 bracket) internal returns (uint256 battleId) {
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 teamB = _createEvolvedTeam(bob);
        battleId = _create(bracket);
        uint256 stake = arena.getBattle(battleId).stakeAmount;
        _deposit(battleId, alice, stake, _commit(battleId, alice, teamA, SALT_A));
        _deposit(battleId, bob, stake, _commit(battleId, bob, teamB, SALT_B));
        vm.prank(resolver);
        arena.revealTeams(battleId, teamA, SALT_A, teamB, SALT_B, keccak256(abi.encodePacked(battleId, SEED_SECRET)));
    }

    // ──────────── The formula ────────────

    /// @dev Hand-computed vectors at the provisional 20 % fixed share (the human check).
    function test_DE_vectorsAtTwentyPercentFixed() public {
        // ref → (Low, Mid, High) in whole GOLD
        uint256[7] memory refs = [uint256(1_250e18), 625e18, 163e18, 80e18, 49e18, 25e18, 0];
        uint256[3][7] memory want = [
            [uint256(2_500e18), 10_000e18, 50_000e18], // launch: unit 1,250
            [uint256(1_500e18), 6_000e18, 30_000e18], // unit 250 + 500 = 750
            [uint256(760e18), 3_043e18, 15_216e18], // unit 250 + 130.4 = 380.4 → floors
            [uint256(628e18), 2_512e18, 12_560e18], // unit 250 + 64 = 314
            [uint256(578e18), 2_313e18, 11_568e18], // unit 250 + 39.2 = 289.2 → floors
            [uint256(540e18), 2_160e18, 10_800e18], // unit 250 + 20 = 270
            [uint256(2_500e18), 10_000e18, 50_000e18] // no ref, no live rate → GENESIS
        ];
        for (uint256 i = 0; i < refs.length; i++) {
            peg.set(refs[i], 0);
            for (uint8 b = 0; b < 3; b++) {
                assertEq(arena.stakeFor(b), want[i][b], "vector");
                assertEq(arena.stakeFor(b), _expected(refs[i], 2_000, arena.stakeMultiplier(b)), "formula");
            }
        }
    }

    function test_DE_fixedShareEndpoints() public {
        peg.set(625e18, 0);
        _setFixedBps(BPS); // 100 % fixed: stakes never move
        assertEq(arena.stakeFor(0), 2_500e18);
        assertEq(arena.stakeFor(1), 10_000e18);
        assertEq(arena.stakeFor(2), 50_000e18);
        _setFixedBps(0); // pure peg
        assertEq(arena.stakeFor(0), 1_250e18);
        assertEq(arena.stakeFor(1), 5_000e18);
        assertEq(arena.stakeFor(2), 25_000e18);
        _setFixedBps(1_000);
        peg.set(163e18, 0); // unit 125 + 146.7 = 271.7
        assertEq(arena.stakeFor(0), 543e18);
        assertEq(arena.stakeFor(1), 2_173e18);
        assertEq(arena.stakeFor(2), 10_868e18);
    }

    function test_DE_fallbackOrder() public {
        peg.set(0, 800e18); // no daily sample yet → the live rate
        assertEq(arena.stakeFor(0), _expected(800e18, 2_000, 2));
        assertEq(arena.stakeFor(0), 1_780e18); // 2 × (250 + 640)
        peg.set(900e18, 500e18); // a sample exists → the sample, not the live rate
        assertEq(arena.stakeFor(0), 1_940e18); // 2 × (250 + 720)
        peg.set(0, 0); // nothing at all (before the first season) → GENESIS
        assertEq(arena.stakeFor(0), 2_500e18);
        peg.set(3_000e18, 0); // an override above launch never raises a stake above its launch value
        assertEq(arena.stakeFor(2), 50_000e18);
        peg.set(0, 3_000e18);
        assertEq(arena.stakeFor(2), 50_000e18);
    }

    function test_DE_currentStakesMirrorsStakeFor() public {
        peg.set(163e18, 0);
        uint256[3] memory stakes = arena.currentStakes();
        for (uint8 b = 0; b < 3; b++) {
            assertEq(stakes[b], arena.stakeFor(b));
        }
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeBracket.selector, uint256(3)));
        arena.stakeMultiplier(3);
    }

    /// @dev Whole GOLD, never above the launch value, never below the fixed part, monotone in the
    ///      ref and in the fixed share's anchoring — for any ref and any dial setting.
    function testFuzz_DE_stakeBounds(uint256 ref, uint256 ref2, uint256 fixedBps, uint8 bracket) public {
        ref = bound(ref, 0, 3 * GENESIS);
        ref2 = bound(ref2, ref, 3 * GENESIS);
        fixedBps = bound(fixedBps, 0, BPS);
        bracket = uint8(bound(bracket, 0, 2));
        if (fixedBps != 2_000) _setFixedBps(fixedBps);
        uint256 mult = arena.stakeMultiplier(bracket);

        peg.set(ref, 0);
        uint256 stake = arena.stakeFor(bracket);
        assertEq(stake, _expected(ref, fixedBps, mult), "formula");
        assertEq(stake % 1e18, 0, "whole GOLD");
        assertLe(stake, mult * GENESIS, "never above launch");
        assertGe(stake + 1e18, mult * GENESIS * fixedBps / BPS, "never below the fixed part (floor)");

        peg.set(ref2, 0);
        uint256 stake2 = arena.stakeFor(bracket);
        if (ref == 0 || ref2 == 0) return; // the GENESIS fallback is not monotone by design
        assertGe(stake2, stake, "monotone in the ref");
    }

    // ──────────── The dial (timelocked) ────────────

    function test_DE_dialBoundsAndRoles() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.InvalidStakeShare.selector, uint256(10_001)));
        arena.proposeStakeFixedBps(10_001);

        bytes32 adminRole = arena.DEFAULT_ADMIN_ROLE();
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, adminRole));
        arena.proposeStakeFixedBps(5_000);
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, adminRole));
        arena.enactStakeFixedBps();

        vm.prank(admin);
        vm.expectRevert(BattleArena.NoPendingStakeShare.selector);
        arena.enactStakeFixedBps();
    }

    function test_DE_dialTimelock() public {
        uint256 t0 = block.timestamp;
        vm.prank(admin);
        vm.expectEmit(false, false, false, true, address(arena));
        emit BattleArena.StakeFixedBpsProposed(5_000, t0 + 24 hours);
        arena.proposeStakeFixedBps(5_000);
        assertEq(arena.pendingStakeFixedBps(), 5_000);
        assertEq(arena.pendingStakeFixedBpsAt(), t0);
        assertEq(arena.stakeFixedBps(), 2_000, "nothing changes at proposal");

        vm.warp(t0 + 24 hours - 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.StakeShareDelayNotElapsed.selector, t0 + 24 hours));
        arena.enactStakeFixedBps();

        vm.warp(t0 + 24 hours);
        vm.prank(admin);
        vm.expectEmit(false, false, false, true, address(arena));
        emit BattleArena.StakeFixedBpsSet(2_000, 5_000);
        arena.enactStakeFixedBps();
        assertEq(arena.stakeFixedBps(), 5_000);
        assertEq(arena.pendingStakeFixedBps(), 0);
        assertEq(arena.pendingStakeFixedBpsAt(), 0);

        vm.prank(admin);
        vm.expectRevert(BattleArena.NoPendingStakeShare.selector);
        arena.enactStakeFixedBps(); // one enactment per proposal

        // A newer proposal replaces the pending one and restarts the clock.
        vm.prank(admin);
        arena.proposeStakeFixedBps(1_000);
        vm.warp(block.timestamp + 12 hours);
        vm.prank(admin);
        arena.proposeStakeFixedBps(0);
        vm.warp(block.timestamp + 12 hours);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(BattleArena.StakeShareDelayNotElapsed.selector, block.timestamp + 12 hours)
        );
        arena.enactStakeFixedBps();
        vm.warp(block.timestamp + 12 hours);
        vm.prank(admin);
        arena.enactStakeFixedBps();
        assertEq(arena.stakeFixedBps(), 0);
    }

    // ──────────── Binding at creation ────────────

    function test_DE_createBindsTheQuoteAndStoresTheBracket() public {
        peg.set(625e18, 0);
        vm.expectEmit(true, true, true, true, address(arena));
        emit BattleArena.BattleCreated(1, alice, bob, 30_000e18, 3, 3, 2);
        uint256 battleId = _create(2);
        BattleArena.Battle memory b = arena.getBattle(battleId);
        assertEq(b.stakeAmount, 30_000e18, "High at ref 625");
        assertEq(b.bracket, 2);
    }

    function test_DE_boundAmountSurvivesAReferenceMove() public {
        peg.set(1_250e18, 0);
        uint256 teamA = _createEvolvedTeam(alice);
        uint256 battleId = _create(0);
        assertEq(arena.getBattle(battleId).stakeAmount, 2_500e18);

        peg.set(625e18, 0); // the day rolls over between match and deposit
        assertEq(arena.stakeFor(0), 1_500e18, "new battles would quote the new amount");
        assertEq(arena.getBattle(battleId).stakeAmount, 2_500e18, "this battle keeps what was matched");

        // Consent is to the amount the player was shown: the new quote is a mismatch (the error
        // reports the battle's bound stake and the opponent's Power)…
        vm.prank(alice);
        gold.approve(address(arena), 10_000e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleArena.ConsentMismatch.selector, battleId, 2_500e18, 3));
        arena.deposit(battleId, 1_500e18, 9, _commit(battleId, alice, teamA, SALT_A));
        // …and the bound amount escrows exactly stake + 5 %.
        uint256 before = gold.balanceOf(alice);
        _deposit(battleId, alice, 2_500e18, _commit(battleId, alice, teamA, SALT_A));
        assertEq(before - gold.balanceOf(alice), 2_500e18 + 125e18);

        // A battle matched now binds the new quote.
        uint256 later = _create(0);
        assertEq(arena.getBattle(later).stakeAmount, 1_500e18);
    }

    function test_DE_dialChangeLeavesCreatedBattlesAlone() public {
        peg.set(625e18, 0);
        uint256 battleId = _create(1);
        assertEq(arena.getBattle(battleId).stakeAmount, 6_000e18);
        _setFixedBps(BPS);
        assertEq(arena.getBattle(battleId).stakeAmount, 6_000e18, "bound");
        assertEq(arena.getBattle(_create(1)).stakeAmount, 10_000e18, "new quote");
    }

    /// @dev The review window keys off the STORED bracket: a Mid battle whose pegged amount is no
    ///      launch value still waits the Mid window, and a Low battle whose amount happens to equal
    ///      nothing in particular waits the Low window.
    function test_DE_reviewWindowFollowsTheStoredBracket() public {
        peg.set(625e18, 0);
        uint256 mid = _setupActive(1); // 6,000 GOLD
        assertEq(arena.getBattle(mid).stakeAmount, 6_000e18);
        uint256 settledAt = block.timestamp;
        vm.prank(resolver);
        arena.settle(mid, alice, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35], SEED_SECRET, address(0));
        assertEq(arena.getBattle(mid).payoutDeadline, settledAt + 30 minutes, "Mid window");

        peg.set(163e18, 0);
        uint256 low = _setupActive(0); // 760 GOLD
        settledAt = block.timestamp;
        vm.prank(resolver);
        arena.settle(low, bob, HASH_STATE, HASH_LOG, [uint8(10), 5, 8], [uint8(30), 25, 35], SEED_SECRET, address(0));
        assertEq(arena.getBattle(low).payoutDeadline, settledAt + 5 minutes, "Low window");

        // And the payout maths use the bound amount: winner gets 2·stake − 10 % + own 5 %.
        uint256 beforeAlice = gold.balanceOf(alice);
        vm.warp(arena.getBattle(mid).payoutDeadline + 1);
        arena.finalizeBattle(mid);
        assertEq(gold.balanceOf(alice) - beforeAlice, 12_000e18 - 1_200e18 + 300e18);
    }
}

/// @notice The peg end to end against the real MiningPool: the ref seeds at the first season,
///         re-samples once a season-day, and the arena's quotes follow it.
contract BattleArenaStakePegIntegrationTest is Test {
    BattleArena arena;
    MiningPool pool;
    LobsterNFT nft;
    GoldToken gold;
    TeamManager tm;
    Treasury treasury;
    BattleVRF vrf;

    address admin = makeAddr("admin");
    address seasonAdmin = makeAddr("seasonAdmin");
    address matchmaker = makeAddr("matchmaker");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant S1_EMISSION = 352_500_000e18;
    uint256 constant BASE_REWARD = 1_250e18;

    function setUp() public {
        vm.startPrank(admin);
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        gold = new GoldToken(admin, makeAddr("lp"), makeAddr("reserve"));
        tm = new TeamManager(admin, address(nft));
        treasury = new Treasury(admin, makeAddr("dev"));
        vrf = new BattleVRF(admin);
        pool = new MiningPool(admin, address(gold), address(nft), address(tm));
        arena = new BattleArena(
            admin, address(gold), address(nft), address(tm), address(treasury), address(vrf), address(pool)
        );
        pool.grantRole(pool.SEASON_ADMIN_ROLE(), seasonAdmin);
        arena.grantRole(arena.MATCHMAKER_ROLE(), matchmaker);
        vm.stopPrank();
    }

    function test_DE_quotesFollowTheDailySample() public {
        // Before any season: the launch amounts.
        assertEq(pool.stakeReference(), 0);
        assertEq(arena.stakeFor(0), 2_500e18);
        assertEq(arena.stakeFor(1), 10_000e18);
        assertEq(arena.stakeFor(2), 50_000e18);

        vm.prank(seasonAdmin);
        pool.startSeason(S1_EMISSION, BASE_REWARD);
        assertEq(pool.stakeReference(), BASE_REWARD, "seeded at the first season");
        assertEq(arena.stakeFor(0), 2_500e18);

        // The rate moves during the day (emergency override, no demand needed) — stakes do not.
        vm.prank(seasonAdmin);
        pool.setBaseReward(1_000e18);
        vm.warp(block.timestamp + 5 hours);
        pool.repeg();
        assertEq(pool.currentBaseReward(), 1_000e18);
        assertEq(pool.stakeReference(), BASE_REWARD, "same season-day: no re-sample");
        assertEq(arena.stakeFor(0), 2_500e18);

        // The next season-day's first touch re-samples: unit = 250 + 800 = 1,050.
        vm.warp(block.timestamp + 19 hours);
        pool.repeg();
        assertEq(pool.stakeReference(), 1_000e18);
        assertEq(arena.stakeFor(0), 2_100e18);
        assertEq(arena.stakeFor(1), 8_400e18);
        assertEq(arena.stakeFor(2), 42_000e18);

        // A battle matched now binds 2,100 — the amount both players consent to.
        vm.prank(matchmaker);
        uint256 battleId = arena.createBattle(alice, bob, 0, 3, 3);
        assertEq(arena.getBattle(battleId).stakeAmount, 2_100e18);
        assertEq(arena.getBattle(battleId).bracket, 0);
    }
}
